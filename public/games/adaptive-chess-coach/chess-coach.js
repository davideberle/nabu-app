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
//     sentence with "Keep my move" / "Show me a better idea" — no unlimited
//     "wrong, try again" loops;
//   - one strength + one next idea at the end, always skippable;
//   - isolated Santiago/Isabel profiles (namespaced storage; a profile is only
//     ever loaded back for the child it was written for).
//
// Pure: storage is injected (Web Storage-shaped), so Node tests drive it with a
// fake store. Depends on chess-engine.js and chess-ai.js.
// ===========================================================================

(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Engine = isNode ? require("./chess-engine.js") : root.ChessEngine;
  const AI = isNode ? require("./chess-ai.js") : root.ChessAI;

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
      name: "Pip the Penguin",
      emoji: "🐧",
      blurb: "Just learned how the pieces move. Slides around a lot.",
      minLevel: 0,
      difficulty: { depth: 1, randomness: 1, blunder: 0.6 },
    },
    {
      id: "waffles",
      name: "Sir Waffles",
      emoji: "🧇",
      blurb: "A friendly knight who often forgets his plan halfway through.",
      minLevel: 1,
      difficulty: { depth: 1, randomness: 0.8, blunder: 0.4 },
    },
    {
      id: "bongo",
      name: "Bongo the Sloth",
      emoji: "🦥",
      blurb: "Slow and steady. Grabs a free piece if you leave one hanging.",
      minLevel: 2,
      difficulty: { depth: 1, randomness: 0.5, blunder: 0.2 },
    },
    {
      id: "gizmo",
      name: "Gizmo the Robot",
      emoji: "🤖",
      blurb: "Calculates one move ahead and rarely gives anything away.",
      minLevel: 3,
      difficulty: { depth: 2, randomness: 0.4, blunder: 0.05 },
    },
    {
      id: "luna",
      name: "Captain Luna",
      emoji: "🚀",
      blurb: "A sharp explorer who looks for little traps.",
      minLevel: 4,
      difficulty: { depth: 2, randomness: 0.15, blunder: 0 },
    },
    {
      id: "hoot",
      name: "Professor Hoot",
      emoji: "🦉",
      blurb: "The wise old owl. Plays a careful, thoughtful game.",
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
  const CONCEPTS = [
    { id: "center", title: "Own the middle", text: "Try to put a pawn in the four middle squares. The center is the best place to start." },
    { id: "develop", title: "Wake up your pieces", text: "Bring your knights and bishops out early so they can help. Sleepy pieces can't do much!" },
    { id: "castle", title: "Keep your king cozy", text: "Castling tucks your king safely in the corner behind its pawns. Do it early." },
    { id: "queen-late", title: "Queen takes her time", text: "Don't rush your queen out. If she comes out too early she can get chased around." },
    { id: "look-captures", title: "Spot the captures", text: "Before you move, look for pieces you can take — and pieces of yours that could be taken." },
    { id: "protect", title: "Guard your pieces", text: "A piece is safe if a friendly piece is watching the square it stands on." },
    { id: "knight-rim", title: "Knights love the middle", text: "A knight in the center reaches more squares than one stuck on the edge." },
    { id: "trade-up", title: "Trade wisely", text: "It's a good deal to win a big piece for a small one, and a bad deal to do the opposite." },
  ];

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
    };
  }

  // Review a child move BEFORE it is committed. Returns a checkpoint to show,
  // or null to let the move stand. A checkpoint is only surfaced for a
  // meaningful blunder and only while the 3-per-game budget remains. This is
  // the single gate that guarantees "at most three" and "no unlimited guessing"
  // (each move is checkpointed at most once).
  function reviewChildMove(session, state, move) {
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

    return {
      playedMove: move,
      betterMove: analysis.betterMove,
      riskText: explainRisk(analysis),
      playedLabel: describeMove(state, move),
      betterLabel: describeMove(state, analysis.betterMove),
      checkpointNumber: session.checkpointsUsed,
      checkpointsRemaining: MAX_CHECKPOINTS_PER_GAME - session.checkpointsUsed,
    };
  }

  // Record the child's decision at a checkpoint. `chosen` is "keep" or "better".
  // Returns the move to actually play. No re-guessing: the decision is final and
  // play continues from whichever move is returned.
  function resolveCheckpoint(session, checkpoint, chosen) {
    if (chosen === "better") {
      session.hintsTaken += 1;
      return {
        move: checkpoint.betterMove,
        comparison: `You picked the safer idea: ${checkpoint.betterLabel} instead of ${checkpoint.playedLabel}. Nice adjusting!`,
      };
    }
    return {
      move: checkpoint.playedMove,
      comparison: `Okay, playing your move: ${checkpoint.playedLabel}. ${checkpoint.betterLabel} was a little safer, but let's see how it goes!`,
    };
  }

  // One concrete sentence naming the real risk. Built from engine analysis, not
  // free text, so it is always true of the position.
  function explainRisk(analysis) {
    const t = analysis.threat;
    if (t) {
      const mine = pieceWord(t.capturedType);
      const theirs = pieceWord(t.byType);
      if (!t.defended) {
        return `That leaves your ${mine} where their ${theirs} can take it for free.`;
      }
      return `That trades your ${mine} for only their ${theirs} — not a fair swap.`;
    }
    if (analysis.walksIntoMate) {
      return "That move lets your opponent build a checkmate against your king.";
    }
    return "There's a stronger move here that keeps your pieces safer.";
  }

  const PIECE_WORDS = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  function pieceWord(t) {
    return PIECE_WORDS[t] || "piece";
  }

  // Human, non-notation move description for kids.
  function describeMove(state, move) {
    if (move.flag === "castleK") return "castle kingside (keep the king safe)";
    if (move.flag === "castleQ") return "castle queenside (keep the king safe)";
    const piece = pieceWord(Engine.typeOf(move.piece));
    const dest = Engine.squareName(move.to);
    const takes = move.captured || move.flag === "ep";
    let text = takes ? `${cap(piece)} takes ${dest}` : `${cap(piece)} to ${dest}`;
    if (move.flag === "promo") {
      text += ` and becomes a ${pieceWord(Engine.typeOf(move.promotion))}`;
    }
    return text;
  }
  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
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
        return { delta: 0, reason: "You won! You had a few wobbles, so let's stay here and lock it in." };
      }
      return { delta: 1, reason: "You won and played well — moving up to a slightly tougher friend." };
    }
    if (result === "loss") {
      if (blunders === 0) {
        return { delta: 0, reason: "A close game with no big mistakes — staying at the same level." };
      }
      return { delta: -1, reason: "That was a tricky one — easing back a step so the next game is more fun." };
    }
    return { delta: 0, reason: "A draw — staying right where you are." };
  }

  function clampLevel(level) {
    return Math.max(0, Math.min(MAX_LEVEL, level));
  }

  // One strength + one next idea. Always skippable in the UI.
  function buildRecap(session, result, change, newlyUnlocked) {
    let strength;
    if (result === "win") strength = "You found a way to win — great focus!";
    else if (session.blundersDetected === 0) strength = "You kept your pieces safe the whole game.";
    else if (session.capturesByChild > 0) strength = "You spotted captures and grabbed material.";
    else strength = "You kept going and finished the whole game — that's how you get better.";

    let nextIdea;
    if (session.blundersDetected > 0) {
      nextIdea = "Next time, before each move, check if the square you land on is safe.";
    } else if (session.concept) {
      nextIdea = `Keep practising today's idea: ${session.concept.title.toLowerCase()}.`;
    } else {
      nextIdea = "Try to bring out a new piece every move at the start.";
    }

    const unlockNote =
      newlyUnlocked && newlyUnlocked.length
        ? `You unlocked a new opponent: ${opponentById(newlyUnlocked[newlyUnlocked.length - 1]).name}!`
        : null;

    return { strength, nextIdea, unlockNote, levelReason: change.reason };
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
