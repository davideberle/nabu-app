// ===========================================================================
// chess-coach.js — the adaptive coaching layer. Owns the named opponent
// ladder, per-child learning profiles, adaptive difficulty, the one pre-game
// idea, the at-most-three blunder checkpoints, and the skippable recap.
//
// This is where the product rules live (family-assistant/DESIGN.md §7.5.1):
//   - deliberately easy first opponent, gradual measured progression;
//   - funny named opponents unlocked over time;
//   - one small concept before a game;
//   - at most 3 meaningful blunder checkpoints per game, each a single concrete
//     sentence with «Ich bleibe bei meinem Zug» / «Zeig mir eine bessere Idee» —
//     no unlimited "wrong, try again" loops. Since Nov 18, 2026 the better idea is
//     NOT played for the child: her move is taken back, the suggested piece and
//     target are highlighted, and whatever she plays next is accepted (no
//     second nudge on that turn);
//   - all child-facing text is simple German from the closed spoken line set in
//     chess-lines-de.js (each spoken sentence is a fixed key → text);
//   - one strength + one next idea at the end, always skippable;
//   - isolated Santiago/Isabel profiles (namespaced storage; a profile is only
//     ever loaded back for the child it was written for).
//
// Pure: storage is injected (Web Storage-shaped), so Node tests drive it with a
// fake store. Depends on chess-engine.js, chess-ai.js and chess-lines-de.js.
// The stored profile (keys and shape) is unchanged by the German texts: the
// profile keeps its English level label / progression reasons (parent-facing);
// only what the child sees and hears is German.
// ===========================================================================

(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Engine = isNode ? require("./chess-engine.js") : root.ChessEngine;
  const AI = isNode ? require("./chess-ai.js") : root.ChessAI;
  const LINES = (isNode ? require("./chess-lines-de.js") : root.ChessLinesDE).LINES;

  // The fixed German text of a spoken line key (throws on an unknown key, so a
  // typo can never silently produce an unspoken/unrecorded sentence).
  function lineText(key) {
    if (!Object.prototype.hasOwnProperty.call(LINES, key)) throw new Error("unknown coach line: " + key);
    return LINES[key];
  }

  const PROFILE_VERSION = 1;
  const STORAGE_PREFIX = "chess-coach:v1:";
  const MAX_CHECKPOINTS_PER_GAME = 3;
  const MAX_LEVEL = 8;
  const HISTORY_LIMIT = 20;

  // Analysis settings for checkpoints: shallow enough to be instant on an iPad,
  // deep enough to see a hung piece or a one-move tactic.
  const CHECKPOINT_DEPTH = 2;
  const CHECKPOINT_THRESHOLD = 180; // centipawns lost vs. the best move

  // The child always plays White in the pilot so "your move" maps to a fixed
  // colour and the board never silently flips ownership mid-lesson.
  const CHILD_COLOR = Engine.WHITE;

  // ---- Opponent ladder --------------------------------------------------
  // Ordered easiest → hardest. `minLevel` gates unlocking; `difficulty` feeds
  // AI.pickMove. Pip is deliberately near-random so a first game is winnable.
  const OPPONENTS = [
    {
      id: "pip",
      name: "Pip der Pinguin",
      emoji: "🐧",
      blurb: "Er lernt gerade die Züge. Ein leichter Gegner.",
      introKey: "intro.pip",
      minLevel: 0,
      difficulty: { depth: 1, randomness: 1, blunder: 0.6 },
    },
    {
      id: "waffles",
      name: "Sir Waffel",
      emoji: "🧇",
      blurb: "Ein netter Ritter. Er ist oft vergesslich.",
      introKey: "intro.waffles",
      minLevel: 1,
      difficulty: { depth: 1, randomness: 0.8, blunder: 0.4 },
    },
    {
      id: "bongo",
      name: "Bongo das Faultier",
      emoji: "🦥",
      blurb: "Langsam. Aber er frisst gern freie Figuren.",
      introKey: "intro.bongo",
      minLevel: 2,
      difficulty: { depth: 1, randomness: 0.5, blunder: 0.2 },
    },
    {
      id: "gizmo",
      name: "Gizmo der Roboter",
      emoji: "🤖",
      blurb: "Er denkt einen Zug voraus.",
      introKey: "intro.gizmo",
      minLevel: 3,
      difficulty: { depth: 2, randomness: 0.4, blunder: 0.05 },
    },
    {
      id: "luna",
      name: "Kapitänin Luna",
      emoji: "🚀",
      blurb: "Sie stellt kleine Fallen.",
      introKey: "intro.luna",
      minLevel: 4,
      difficulty: { depth: 2, randomness: 0.15, blunder: 0 },
    },
    {
      id: "hoot",
      name: "Professor Uhu",
      emoji: "🦉",
      blurb: "Die kluge alte Eule. Er spielt sehr genau.",
      introKey: "intro.hoot",
      minLevel: 5,
      difficulty: { depth: 3, randomness: 0.1, blunder: 0 },
    },
  ];

  function opponentById(id) {
    return OPPONENTS.find((o) => o.id === id) || null;
  }

  function unlockedOpponentIds(level) {
    return OPPONENTS.filter((o) => o.minLevel <= level).map((o) => o.id);
  }

  // The opponent a given level should face: the hardest one unlocked.
  function opponentForLevel(level) {
    let chosen = OPPONENTS[0];
    for (const o of OPPONENTS) {
      if (o.minLevel <= level) chosen = o;
    }
    return chosen;
  }

  // ---- Pre-game concepts (one small idea) -------------------------------
  // Titles are shown; the sentence is the spoken line `idea.<id>`.
  const CONCEPT_TITLES = [
    ["center", "Die Mitte"],
    ["develop", "Weck deine Figuren"],
    ["castle", "Ein sicherer König"],
    ["queen-late", "Die Dame wartet"],
    ["look-captures", "Wer kann fressen?"],
    ["protect", "Pass auf deine Figuren auf"],
    ["knight-rim", "Pferde lieben die Mitte"],
    ["trade-up", "Klug tauschen"],
  ];
  const CONCEPTS = CONCEPT_TITLES.map(([id, title]) =>
    Object.freeze({ id, title, lineKey: "idea." + id, text: lineText("idea." + id) }),
  );

  function conceptById(id) {
    return CONCEPTS.find((c) => c.id === id) || null;
  }

  // Pick a small idea the child hasn't seen recently, rotating through the set.
  function pickConcept(profile, rng) {
    const random = rng || Math.random;
    const seen = new Set(profile.recentConcepts || []);
    const fresh = CONCEPTS.filter((c) => !seen.has(c.id));
    const pool = fresh.length ? fresh : CONCEPTS;
    return pool[Math.floor(random() * pool.length)];
  }

  // ---- Profiles ---------------------------------------------------------
  function defaultProfile(childId) {
    return {
      version: PROFILE_VERSION,
      childId,
      level: 0,
      estimatedLevelLabel: levelLabel(0),
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      hintsUsed: 0,
      conceptsSeen: [],
      recentConcepts: [],
      unlockedOpponents: unlockedOpponentIds(0),
      lastOpponentId: null,
      history: [],
      progressionLog: [],
    };
  }

  function levelLabel(level) {
    if (level <= 1) return "Just starting out";
    if (level <= 3) return "Getting the hang of it";
    if (level <= 5) return "Playing real games";
    return "Sharp player";
  }

  // German label for the screen only (the stored profile keeps `levelLabel`).
  function levelLabelDe(level) {
    if (level <= 1) return "Anfängerin oder Anfänger";
    if (level <= 3) return "Es klappt schon gut";
    if (level <= 5) return "Richtige Spiele";
    return "Schach-Profi";
  }

  // The screen text of the start greeting: the spoken intro line, with the
  // child's name added after «Hallo» ON SCREEN only (the clip is name-free).
  function introScreenText(opponent, displayName) {
    const text = lineText(opponent.introKey);
    return displayName ? text.replace(/^Hallo!/, "Hallo " + displayName + "!") : text;
  }

  function storageKey(childId) {
    return STORAGE_PREFIX + childId;
  }

  // Load a child's profile. Isolation is enforced twice: the key is namespaced
  // by child id, AND a stored blob whose childId does not match is discarded
  // (never returned for a different child). Any corruption → a fresh profile.
  function loadProfile(storage, childId) {
    if (!storage) return defaultProfile(childId);
    let raw;
    try {
      raw = storage.getItem(storageKey(childId));
    } catch {
      return defaultProfile(childId);
    }
    if (!raw) return defaultProfile(childId);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultProfile(childId);
    }
    if (!parsed || parsed.childId !== childId || parsed.version !== PROFILE_VERSION) {
      return defaultProfile(childId);
    }
    // Merge onto defaults so older/partial blobs stay valid.
    return { ...defaultProfile(childId), ...parsed, childId };
  }

  function saveProfile(storage, profile) {
    if (!storage) return;
    try {
      storage.setItem(storageKey(profile.childId), JSON.stringify(profile));
    } catch {
      /* storage full/blocked — in-memory profile still drives this session */
    }
  }

  // ---- Game session -----------------------------------------------------
  // A session is per-game coaching state. It is not persisted; only the profile
  // is. It carries the checkpoint budget so the cap is enforced in one place.
  function startGame(profile, opts) {
    const options = opts || {};
    const rng = options.rng || Math.random;
    const opponent = options.opponent || opponentForLevel(profile.level);
    const concept = options.concept || pickConcept(profile, rng);
    return {
      childId: profile.childId,
      opponentId: opponent.id,
      opponent,
      concept,
      childColor: CHILD_COLOR,
      checkpointsUsed: 0,
      blundersDetected: 0,
      hintsTaken: 0,
      movesPlayed: 0,
      capturesByChild: 0,
      startLevel: profile.level,
      // Squares already checkpointed so we never re-nag the identical move.
      _checkpointedMoves: new Set(),
      // Set by a «bessere Idee» takeback: the child's NEXT move is accepted
      // whatever it is (no second nudge on the same turn — no try-again loop).
      _acceptNextMove: false,
    };
  }

  // Review a child move BEFORE it is committed. Returns a checkpoint to show,
  // or null to let the move stand. A checkpoint is only surfaced for a
  // meaningful blunder and only while the 3-per-game budget remains. This is
  // the single gate that guarantees "at most three" and "no unlimited guessing"
  // (each move is checkpointed at most once).
  function reviewChildMove(session, state, move) {
    if (session._acceptNextMove) {
      session._acceptNextMove = false;
      return null;
    }
    if (session.checkpointsUsed >= MAX_CHECKPOINTS_PER_GAME) return null;
    const moveKey = move.from + "-" + move.to + "-" + (move.promotion || "");
    if (session._checkpointedMoves.has(moveKey)) return null;

    const analysis = AI.analyzeMove(state, move, {
      depth: CHECKPOINT_DEPTH,
      threshold: CHECKPOINT_THRESHOLD,
    });
    if (!analysis.meaningful) return null;
    if (!analysis.betterMove) return null;
    // If the "better" move isn't actually different, there's nothing to show.
    if (
      analysis.betterMove.from === move.from &&
      analysis.betterMove.to === move.to &&
      (analysis.betterMove.promotion || "") === (move.promotion || "")
    ) {
      return null;
    }

    session.checkpointsUsed += 1;
    session.blundersDetected += 1;
    session._checkpointedMoves.add(moveKey);

    const riskKey = riskKeyFor(analysis);
    const t = analysis.threat;
    const showThreat = riskKey !== "nudge.mate" && riskKey !== "nudge.other" && t;
    return {
      playedMove: move,
      betterMove: analysis.betterMove,
      riskKey,
      riskText: lineText(riskKey),
      // Squares to highlight on the board AFTER the intended move: the piece in
      // danger and the piece that can take it (null when there is no capture).
      threatSquare: showThreat ? t.capturedSquare : null,
      attackerSquare: showThreat && typeof t.bySquare === "number" ? t.bySquare : null,
      playedLabel: describeMove(state, move),
      betterLabel: describeMove(state, analysis.betterMove),
      checkpointNumber: session.checkpointsUsed,
      checkpointsRemaining: MAX_CHECKPOINTS_PER_GAME - session.checkpointsUsed,
    };
  }

  // Record the child's decision at a checkpoint. `chosen` is "keep" or "better".
  //   keep   → `move` is the child's own move, to be played as before.
  //   better → NOTHING is played: `move` is null, `takeback` is true and `hint`
  //            names the suggested piece's square and its target to highlight.
  //            The child then moves herself, and that next move is accepted
  //            without review (session._acceptNextMove).
  // No re-guessing either way: the decision is final.
  function resolveCheckpoint(session, checkpoint, chosen) {
    if (chosen === "better") {
      session.hintsTaken += 1;
      session._acceptNextMove = true;
      return {
        move: null,
        takeback: true,
        hint: { from: checkpoint.betterMove.from, to: checkpoint.betterMove.to },
        lineKey: "choice.better",
        comparison: lineText("choice.better"),
      };
    }
    return {
      move: checkpoint.playedMove,
      takeback: false,
      hint: null,
      lineKey: "choice.keep",
      comparison: lineText("choice.keep"),
    };
  }

  // The spoken nudge key: which of the child's pieces is in danger (picture-
  // first: the board highlights it and its attacker), or the mate / generic
  // line. Built from engine analysis, so it is always true of the position.
  function riskKeyFor(analysis) {
    const t = analysis.threat;
    if (t && ["p", "n", "b", "r", "q"].includes(t.capturedType)) return "nudge." + t.capturedType;
    if (analysis.walksIntoMate) return "nudge.mate";
    return "nudge.other";
  }

  function explainRisk(analysis) {
    return lineText(riskKeyFor(analysis));
  }

  const PIECE_WORDS = { p: "Bauer", n: "Pferd", b: "Läufer", r: "Turm", q: "Dame", k: "König" };
  function pieceWord(t) {
    return PIECE_WORDS[t] || "Figur";
  }

  // Human, non-notation move description for kids.
  function describeMove(state, move) {
    if (move.flag === "castleK" || move.flag === "castleQ") return "Rochade";
    const piece = pieceWord(Engine.typeOf(move.piece));
    const dest = Engine.squareName(move.to);
    const takes = move.captured || move.flag === "ep";
    let text = takes ? `${piece} frisst auf ${dest}` : `${piece} nach ${dest}`;
    if (move.flag === "promo") {
      text += ` und wird ${pieceWord(Engine.typeOf(move.promotion))}`;
    }
    return text;
  }

  // ---- Finishing a game: adapt difficulty, build the recap ---------------
  // result: "win" | "loss" | "draw" from the child's perspective.
  function finishGame(profile, session, result, dateISO) {
    const updated = { ...profile };
    updated.gamesPlayed += 1;
    if (result === "win") updated.wins += 1;
    else if (result === "loss") updated.losses += 1;
    else updated.draws += 1;
    updated.hintsUsed = (profile.hintsUsed || 0) + (session.hintsTaken || 0);

    // Concepts seen.
    const conceptsSeen = new Set(profile.conceptsSeen || []);
    if (session.concept) conceptsSeen.add(session.concept.id);
    updated.conceptsSeen = Array.from(conceptsSeen);
    updated.recentConcepts = [session.concept ? session.concept.id : null, ...(profile.recentConcepts || [])]
      .filter(Boolean)
      .slice(0, 4);

    // Adaptive difficulty from BOTH result and move quality (blunders).
    const change = computeLevelChange(result, session.blundersDetected);
    const newLevel = clampLevel(profile.level + change.delta);
    updated.level = newLevel;
    updated.estimatedLevelLabel = levelLabel(newLevel);
    updated.unlockedOpponents = unlockedOpponentIds(newLevel);
    updated.lastOpponentId = session.opponentId;

    const newlyUnlocked = updated.unlockedOpponents.filter(
      (id) => !(profile.unlockedOpponents || []).includes(id),
    );

    updated.progressionLog = [
      {
        date: dateISO || null,
        result,
        blunders: session.blundersDetected,
        from: profile.level,
        to: newLevel,
        reason: change.reason,
      },
      ...(profile.progressionLog || []),
    ].slice(0, HISTORY_LIMIT);

    updated.history = [
      {
        date: dateISO || null,
        opponentId: session.opponentId,
        result,
        movesPlayed: session.movesPlayed,
        blunders: session.blundersDetected,
        hintsTaken: session.hintsTaken,
      },
      ...(profile.history || []),
    ].slice(0, HISTORY_LIMIT);

    const recap = buildRecap(session, result, change, newlyUnlocked);
    return { profile: updated, recap, levelChange: change, newlyUnlocked };
  }

  function computeLevelChange(result, blunders) {
    if (result === "win") {
      if (blunders >= 3) {
        return { delta: 0, reason: "You won! You had a few wobbles, so let's stay here and lock it in.", key: "win-wobbly" };
      }
      return { delta: 1, reason: "You won and played well — moving up to a slightly tougher friend.", key: "win-up" };
    }
    if (result === "loss") {
      if (blunders === 0) {
        return { delta: 0, reason: "A close game with no big mistakes — staying at the same level.", key: "loss-clean" };
      }
      return { delta: -1, reason: "That was a tricky one — easing back a step so the next game is more fun.", key: "loss-down" };
    }
    return { delta: 0, reason: "A draw — staying right where you are.", key: "draw" };
  }

  function clampLevel(level) {
    return Math.max(0, Math.min(MAX_LEVEL, level));
  }

  // Screen-only German reason for the level change (the stored progression log
  // keeps the English `reason` for the parent).
  const LEVEL_REASON_DE = {
    "win-wobbly": "Gewonnen! Wir bleiben noch auf dieser Stufe.",
    "win-up": "Gewonnen! Nächstes Mal wird es ein bisschen schwerer.",
    "loss-clean": "Knapp! Wir bleiben auf dieser Stufe.",
    "loss-down": "Das war schwer. Nächstes Mal wird es etwas leichter.",
    draw: "Unentschieden. Wir bleiben auf dieser Stufe.",
  };

  // One strength + one next idea (spoken lines). Always skippable in the UI.
  function buildRecap(session, result, change, newlyUnlocked) {
    let strengthKey;
    if (result === "win") strengthKey = "recap.win";
    else if (session.blundersDetected === 0) strengthKey = "recap.safe";
    else if (session.capturesByChild > 0) strengthKey = "recap.captures";
    else strengthKey = "recap.finished";

    let nextKey;
    if (session.blundersDetected > 0) nextKey = "next.safe-square";
    else if (session.concept) nextKey = "next.idea";
    else nextKey = "next.develop";

    const unlocked =
      newlyUnlocked && newlyUnlocked.length ? opponentById(newlyUnlocked[newlyUnlocked.length - 1]) : null;
    const unlockNote = unlocked ? `Neuer Gegner freigeschaltet: ${unlocked.name}!` : null;

    return {
      strengthKey,
      nextKey,
      strength: lineText(strengthKey),
      nextIdea: lineText(nextKey),
      unlockNote,
      levelReason: LEVEL_REASON_DE[change.key] || "",
    };
  }

  // ---- Parent-facing helpers (explainable & reversible) -----------------
  // A parent can read why difficulty changed (progressionLog) and reset it.
  function setLevel(profile, level, reasonNote) {
    const newLevel = clampLevel(level);
    return {
      ...profile,
      level: newLevel,
      estimatedLevelLabel: levelLabel(newLevel),
      unlockedOpponents: unlockedOpponentIds(newLevel),
      progressionLog: [
        { date: null, result: "parent-set", blunders: 0, from: profile.level, to: newLevel, reason: reasonNote || "Adjusted by a grown-up." },
        ...(profile.progressionLog || []),
      ].slice(0, HISTORY_LIMIT),
    };
  }

  const ChessCoach = {
    LINES,
    lineText,
    levelLabelDe,
    introScreenText,
    riskKeyFor,
    PROFILE_VERSION,
    STORAGE_PREFIX,
    MAX_CHECKPOINTS_PER_GAME,
    MAX_LEVEL,
    CHILD_COLOR,
    OPPONENTS,
    CONCEPTS,
    opponentById,
    opponentForLevel,
    unlockedOpponentIds,
    conceptById,
    pickConcept,
    defaultProfile,
    levelLabel,
    storageKey,
    loadProfile,
    saveProfile,
    startGame,
    reviewChildMove,
    resolveCheckpoint,
    explainRisk,
    describeMove,
    finishGame,
    computeLevelChange,
    buildRecap,
    setLevel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ChessCoach;
  if (typeof root !== "undefined") root.ChessCoach = ChessCoach;
})(typeof globalThis !== "undefined" ? globalThis : this);
