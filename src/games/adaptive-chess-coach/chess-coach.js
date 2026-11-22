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
// Nov 22, 2026 (David, after Isabel's Nov 21 games):
//   - a nudge she FOLLOWS is not a mistake: each nudge records what she chose
//     (kept / followed / changed / open) and only KEPT flagged moves count in
//     the level rules (same thresholds as before);
//   - the beginner opponents (minLevel ≤ 2: Pip, Sir Waffel, Bongo) resign right
//     after her move when she leads by a queen's worth (≥ 9 points) and has
//     played at least 10 moves — `opponent-resigned`, a win for the level rules;
//   - an unfinished game (time ran out, new game, page left) is judged by
//     material: a lead of ≥ 5 counts as a win, anything else changes nothing.
//     It is applied once per game id: a later finish of the same (resumed) game
//     replaces that judgement instead of adding to it;
//   - every game becomes a structured record (no free text) that the Companion
//     App stores server-side (gameRecord / profileSnapshot).
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

  // ---- Material, resignation, unfinished games (Nov 22, 2026) -----------
  // Plain piece values a parent can check by hand: P=1, N=B=3, R=5, Q=9.
  const MATERIAL_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const RESIGN_MAX_MIN_LEVEL = 2; // Pip (0), Sir Waffel (1), Bongo (2) may resign
  const RESIGN_MATERIAL_LEAD = 9; // a queen's worth
  const RESIGN_MIN_CHILD_MOVES = 10; // the game is at least 10 of her moves old
  const UNFINISHED_WIN_LEAD = 5; // an unfinished game with a lead ≥ 5 counts as a win

  // Material balance from the child's side: her pieces minus the opponent's.
  function materialBalance(state, color) {
    const me = color === undefined ? CHILD_COLOR : color;
    let sum = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = state.board[sq];
      if (p === null || p === undefined) continue;
      const v = MATERIAL_VALUE[Engine.typeOf(p)] || 0;
      sum += Engine.colorOf(p) === me ? v : -v;
    }
    return sum;
  }

  // Asked right after HER move (game not over): does this opponent give up?
  // Only the beginner opponents ever do; Gizmo and stronger never resign.
  function shouldResign(opponent, state, childMovesPlayed) {
    if (!opponent || !opponent.resignKey) return false;
    if (!(opponent.minLevel <= RESIGN_MAX_MIN_LEVEL)) return false;
    if (!(childMovesPlayed >= RESIGN_MIN_CHILD_MOVES)) return false;
    return materialBalance(state) >= RESIGN_MATERIAL_LEAD;
  }

  // An unfinished game is judged by material only: "win" or "none".
  function judgeUnfinished(balance) {
    return typeof balance === "number" && balance >= UNFINISHED_WIN_LEAD ? "win" : "none";
  }

  // ---- Nudges and what she chose (Nov 22, 2026) ------------------------
  // Each nudge: { threat, choice }.
  //   threat: the piece in danger (p n b r q), "mate" or "other";
  //   choice: "kept"     she kept the flagged move (chose «Ich bleibe …», or took
  //                      the tip and then played the very same move) — a mistake;
  //           "followed" she took «bessere Idee» and played the suggested move;
  //           "changed"  she took «bessere Idee» and played another move;
  //           "open"     the game ended before she chose or moved.
  // Only "kept" counts against her in the level rules.
  const NUDGE_THREATS = ["p", "n", "b", "r", "q", "mate", "other"];
  const NUDGE_CHOICES = ["kept", "followed", "changed", "open"];

  function nudgeCounts(session) {
    const list = (session && session.nudges) || [];
    const out = { shown: list.length, followed: 0, kept: 0, changed: 0, open: 0 };
    for (const n of list) {
      if (n.choice === "kept") out.kept += 1;
      else if (n.choice === "followed") out.followed += 1;
      else if (n.choice === "changed") out.changed += 1;
      else out.open += 1;
    }
    return out;
  }

  // Nudges as stored / reported: pending choices become "open".
  function nudgesForRecord(session) {
    return ((session && session.nudges) || []).map((n) => ({
      threat: NUDGE_THREATS.includes(n.threat) ? n.threat : "other",
      choice: NUDGE_CHOICES.includes(n.choice) ? n.choice : "open",
    }));
  }

  function newGameId(rng) {
    try {
      if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") return "g-" + crypto.randomUUID();
    } catch {
      /* fall through */
    }
    const r = rng || Math.random;
    let hex = "";
    for (let i = 0; i < 32; i++) hex += Math.floor(r() * 16).toString(16);
    return "g-" + hex;
  }

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
      resignKey: "resign.pip",
      minLevel: 0,
      difficulty: { depth: 1, randomness: 1, blunder: 0.6 },
    },
    {
      id: "waffles",
      name: "Sir Waffel",
      emoji: "🧇",
      blurb: "Ein netter Ritter. Er ist oft vergesslich.",
      introKey: "intro.waffles",
      resignKey: "resign.waffles",
      minLevel: 1,
      difficulty: { depth: 1, randomness: 0.8, blunder: 0.4 },
    },
    {
      id: "bongo",
      name: "Bongo das Faultier",
      emoji: "🦥",
      blurb: "Langsam. Aber er frisst gern freie Figuren.",
      introKey: "intro.bongo",
      resignKey: "resign.bongo",
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
      unfinishedGames: 0,
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
      // Client-generated id: the server record and the once-only level rule key on it.
      gameId: options.gameId || newGameId(rng),
      startedAt: options.startedAt || null,
      opponentId: opponent.id,
      opponent,
      concept,
      childColor: CHILD_COLOR,
      checkpointsUsed: 0,
      // One entry per nudge shown: { threat, choice } (see NUDGE_CHOICES).
      nudges: [],
      hintsTaken: 0,
      movesPlayed: 0,
      capturesByChild: 0,
      activeSeconds: 0,
      startLevel: profile.level,
      // Report sequence for the server record (a later report replaces an earlier one).
      seq: 0,
      // Squares already checkpointed so we never re-nag the identical move.
      _checkpointedMoves: new Set(),
      // Set by a «bessere Idee» takeback: the child's NEXT move is accepted
      // whatever it is (no second nudge on the same turn — no try-again loop).
      _acceptNextMove: false,
      // The nudge waiting for that next move: { index, hint: {from,to}, playedKey }.
      _pendingBetter: null,
    };
  }

  function moveKeyOf(move) {
    return move.from + "-" + move.to + "-" + (move.promotion || "");
  }

  // Restore a session's counters from a persisted live-game blob. Blobs from
  // before Nov 22 carry only `blundersDetected` (every nudge) and `hintsTaken`
  // (every «bessere Idee»): those become followed nudges, the rest kept ones.
  function restoreSessionCounters(session, g) {
    session.checkpointsUsed = g.checkpointsUsed || 0;
    session.hintsTaken = g.hintsTaken || 0;
    session.movesPlayed = g.movesPlayed || 0;
    session.capturesByChild = g.capturesByChild || 0;
    session.activeSeconds = Math.max(0, Math.floor(g.activeSeconds || 0));
    session.seq = Math.max(0, Math.floor(g.seq || 0));
    if (typeof g.gameId === "string" && g.gameId) session.gameId = g.gameId;
    if (typeof g.startedAt === "string") session.startedAt = g.startedAt;
    if (Array.isArray(g.nudges)) {
      session.nudges = g.nudges
        .slice(0, MAX_CHECKPOINTS_PER_GAME)
        .map((n) => ({ threat: NUDGE_THREATS.includes(n && n.threat) ? n.threat : "other", choice: NUDGE_CHOICES.includes(n && n.choice) ? n.choice : "open" }));
    } else {
      const shown = Math.min(MAX_CHECKPOINTS_PER_GAME, Math.max(0, g.blundersDetected || 0));
      const followed = Math.min(shown, Math.max(0, g.hintsTaken || 0));
      session.nudges = [];
      for (let i = 0; i < shown; i++) session.nudges.push({ threat: "other", choice: i < followed ? "followed" : "kept" });
    }
    // A resume always starts on a clean turn: no half-finished «bessere Idee».
    session._acceptNextMove = false;
    session._pendingBetter = null;
    return session;
  }

  // Review a child move BEFORE it is committed. Returns a checkpoint to show,
  // or null to let the move stand. A checkpoint is only surfaced for a
  // meaningful blunder and only while the 3-per-game budget remains. This is
  // the single gate that guarantees "at most three" and "no unlimited guessing"
  // (each move is checkpointed at most once).
  function reviewChildMove(session, state, move) {
    if (session._acceptNextMove) {
      session._acceptNextMove = false;
      // The move she plays after «bessere Idee» decides what the nudge was:
      // the suggested move → followed; the very same flagged move → kept;
      // anything else → changed (not a mistake either).
      const pb = session._pendingBetter;
      session._pendingBetter = null;
      if (pb && session.nudges && session.nudges[pb.index]) {
        const played = moveKeyOf(move);
        let choice = "changed";
        if (move.from === pb.hint.from && move.to === pb.hint.to) choice = "followed";
        else if (played === pb.playedKey) choice = "kept";
        session.nudges[pb.index].choice = choice;
      }
      return null;
    }
    if (session.checkpointsUsed >= MAX_CHECKPOINTS_PER_GAME) return null;
    const moveKey = moveKeyOf(move);
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
    session._checkpointedMoves.add(moveKey);

    const riskKey = riskKeyFor(analysis);
    if (!session.nudges) session.nudges = [];
    session.nudges.push({ threat: riskKey.slice("nudge.".length), choice: "open" });
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
      nudgeIndex: session.nudges.length - 1,
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
    const idx = typeof checkpoint.nudgeIndex === "number" ? checkpoint.nudgeIndex : (session.nudges || []).length - 1;
    const nudge = session.nudges && session.nudges[idx];
    if (chosen === "better") {
      session.hintsTaken += 1;
      session._acceptNextMove = true;
      // Followed / kept / changed is decided by the move she plays next.
      session._pendingBetter = nudge
        ? { index: idx, hint: { from: checkpoint.betterMove.from, to: checkpoint.betterMove.to }, playedKey: moveKeyOf(checkpoint.playedMove) }
        : null;
      return {
        move: null,
        takeback: true,
        hint: { from: checkpoint.betterMove.from, to: checkpoint.betterMove.to },
        lineKey: "choice.better",
        comparison: lineText("choice.better"),
      };
    }
    if (nudge) nudge.choice = "kept";
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
  // result (child's view): "win" | "loss" | "draw" | "opponent-resigned" |
  // "unfinished". opts: { endReason, materialBalance, endedAt }.
  // endReason: "checkmate" | "stalemate" | "fifty-move" | "resignation" |
  // "time-out" | "new-game" | "page-left".
  //
  // Once per game id: if this game was already applied as UNFINISHED and is
  // still the latest game in the history (a resumed game, or the same unfinished
  // game reported twice), that judgement is reverted first and replaced, so the
  // game counts exactly once with its latest outcome. Any other repeat (a game
  // already finished for real, or no longer the latest) changes nothing.
  const RESULTS = ["win", "loss", "draw", "opponent-resigned", "unfinished"];
  const END_REASONS = ["checkmate", "stalemate", "fifty-move", "resignation", "time-out", "new-game", "page-left"];

  function levelOutcomeFor(result, judged) {
    if (result === "win" || result === "opponent-resigned") return "win";
    if (result === "loss") return "loss";
    if (result === "draw") return "draw";
    return judged === "win" ? "win" : "none";
  }

  // The profile as it was before `entry` (the latest history entry) was applied.
  function revertLatestEntry(profile, entry) {
    const out = { ...profile };
    out.gamesPlayed = Math.max(0, (profile.gamesPlayed || 0) - 1);
    if (entry.result === "unfinished") out.unfinishedGames = Math.max(0, (profile.unfinishedGames || 0) - 1);
    out.hintsUsed = Math.max(0, (profile.hintsUsed || 0) - (entry.hintsTaken || 0));
    const from = typeof entry.from === "number" ? entry.from : profile.level;
    out.level = clampLevel(from);
    out.estimatedLevelLabel = levelLabel(out.level);
    out.unlockedOpponents = unlockedOpponentIds(out.level);
    out.history = (profile.history || []).filter((h) => h.gameId !== entry.gameId);
    out.progressionLog = (profile.progressionLog || []).filter((p) => p.gameId !== entry.gameId);
    return out;
  }

  function finishGame(profile, session, result, dateISO, opts) {
    const options = opts || {};
    const res = RESULTS.includes(result) ? result : "draw";
    const counts = nudgeCounts(session);
    const balance = typeof options.materialBalance === "number" ? options.materialBalance : null;
    const judged = res === "unfinished" ? judgeUnfinished(balance) : null;

    // Once per game id.
    let base = profile;
    const gameId = session.gameId || null;
    const history = profile.history || [];
    const priorIdx = gameId ? history.findIndex((h) => h.gameId === gameId) : -1;
    if (priorIdx >= 0) {
      const prior = history[priorIdx];
      if (priorIdx === 0 && prior.result === "unfinished") {
        base = revertLatestEntry(profile, prior);
      } else {
        const change = { delta: 0, reason: "This game was already counted.", key: "already-counted" };
        return { profile, recap: buildRecap(session, res, change, []), levelChange: change, newlyUnlocked: [], alreadyCounted: true, judged };
      }
    }

    const updated = { ...base };
    updated.gamesPlayed = (base.gamesPlayed || 0) + 1;
    if (res === "win" || res === "opponent-resigned") updated.wins = (base.wins || 0) + 1;
    else if (res === "loss") updated.losses = (base.losses || 0) + 1;
    else if (res === "draw") updated.draws = (base.draws || 0) + 1;
    else updated.unfinishedGames = (base.unfinishedGames || 0) + 1;
    updated.hintsUsed = (base.hintsUsed || 0) + (session.hintsTaken || 0);

    // Concepts seen.
    const conceptsSeen = new Set(base.conceptsSeen || []);
    if (session.concept) conceptsSeen.add(session.concept.id);
    updated.conceptsSeen = Array.from(conceptsSeen);
    updated.recentConcepts = Array.from(new Set([session.concept ? session.concept.id : null, ...(base.recentConcepts || [])].filter(Boolean))).slice(0, 4);

    // Adaptive difficulty from the result AND the flagged moves she KEPT.
    const change = computeLevelChange(res, counts.kept, judged);
    const fromLevel = base.level;
    const newLevel = clampLevel(fromLevel + change.delta);
    updated.level = newLevel;
    updated.estimatedLevelLabel = levelLabel(newLevel);
    updated.unlockedOpponents = unlockedOpponentIds(newLevel);
    updated.lastOpponentId = session.opponentId;

    const newlyUnlocked = updated.unlockedOpponents.filter((id) => !(base.unlockedOpponents || []).includes(id));
    const endReason = END_REASONS.includes(options.endReason) ? options.endReason : null;

    updated.progressionLog = [
      {
        gameId,
        date: dateISO || null,
        result: res,
        // `blunders` keeps its old meaning for older readers: the mistakes that counted (kept flagged moves).
        blunders: counts.kept,
        from: fromLevel,
        to: newLevel,
        reason: change.reason,
        key: change.key,
      },
      ...(base.progressionLog || []),
    ].slice(0, HISTORY_LIMIT);

    const entry = {
      gameId,
      date: dateISO || null,
      startedAt: session.startedAt || null,
      opponentId: session.opponentId,
      result: res,
      endReason,
      judged,
      movesPlayed: session.movesPlayed,
      blunders: counts.kept,
      nudges: counts.shown,
      followed: counts.followed,
      kept: counts.kept,
      hintsTaken: session.hintsTaken,
      material: balance,
      from: fromLevel,
      to: newLevel,
      key: change.key,
    };
    updated.history = [entry, ...(base.history || [])].slice(0, HISTORY_LIMIT);

    const recap = buildRecap(session, res, change, newlyUnlocked);
    return { profile: updated, recap, levelChange: change, newlyUnlocked, alreadyCounted: false, judged };
  }

  // kept = flagged moves she kept (followed or changed nudges never count).
  // For an unfinished game, `judged` ("win" | "none") stands in for the result.
  function computeLevelChange(result, kept, judged) {
    const k = typeof kept === "number" ? kept : 0;
    if (result === "win") {
      if (k >= 3) {
        return { delta: 0, reason: "You won, but kept 3 risky moves the coach flagged — staying here to lock it in.", key: "win-wobbly" };
      }
      return { delta: 1, reason: "You won and played well — moving up to a slightly tougher friend.", key: "win-up" };
    }
    if (result === "opponent-resigned") {
      if (k >= 3) {
        return { delta: 0, reason: "The opponent gave up, but 3 risky moves the coach flagged were kept — staying here.", key: "resigned-wobbly" };
      }
      return { delta: 1, reason: "The opponent gave up because you were far ahead — moving up to a slightly tougher friend.", key: "resigned-up" };
    }
    if (result === "unfinished") {
      if (judged !== "win") {
        return { delta: 0, reason: "Not finished and nobody was clearly ahead — no level change.", key: "unfinished-even" };
      }
      if (k >= 3) {
        return { delta: 0, reason: "Not finished; clearly ahead, but 3 risky moves the coach flagged were kept — staying here.", key: "unfinished-wobbly" };
      }
      return { delta: 1, reason: "Not finished, but clearly ahead (5+ points) — counts as a win, moving up.", key: "unfinished-up" };
    }
    if (result === "loss") {
      if (k === 0) {
        return { delta: 0, reason: "A close game with no kept mistakes — staying at the same level.", key: "loss-clean" };
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
    "resigned-wobbly": "Gewonnen! Wir bleiben noch auf dieser Stufe.",
    "resigned-up": "Gewonnen! Nächstes Mal wird es ein bisschen schwerer.",
    "unfinished-wobbly": "Wir bleiben auf dieser Stufe.",
    "unfinished-up": "Nächstes Mal wird es ein bisschen schwerer.",
    "unfinished-even": "Wir bleiben auf dieser Stufe.",
    "loss-clean": "Knapp! Wir bleiben auf dieser Stufe.",
    "loss-down": "Das war schwer. Nächstes Mal wird es etwas leichter.",
    draw: "Unentschieden. Wir bleiben auf dieser Stufe.",
    "already-counted": "",
  };

  // One strength + one next idea (spoken lines). Always skippable in the UI.
  // A followed nudge is praised («Du hast auf den Tipp gehört»), never called a
  // mistake; only KEPT flagged moves count as mistakes.
  function buildRecap(session, result, change, newlyUnlocked) {
    const counts = nudgeCounts(session);
    let strengthKey;
    if (counts.followed > 0) strengthKey = "recap.listened";
    else if (result === "win") strengthKey = "recap.win";
    else if (counts.kept === 0) strengthKey = "recap.safe";
    else if (session.capturesByChild > 0) strengthKey = "recap.captures";
    else strengthKey = "recap.finished";

    let nextKey;
    if (counts.shown > 0) nextKey = "next.safe-square";
    else if (session.concept) nextKey = "next.idea";
    else nextKey = "next.develop";

    const unlocked =
      newlyUnlocked && newlyUnlocked.length ? opponentById(newlyUnlocked[newlyUnlocked.length - 1]) : null;
    const unlockNote = unlocked ? `Neuer Gegner freigeschaltet: ${unlocked.name}!` : null;
    const opponent = session.opponent || opponentById(session.opponentId);
    const resignKey = result === "opponent-resigned" && opponent && opponent.resignKey ? opponent.resignKey : null;

    return {
      resignKey,
      resignText: resignKey ? lineText(resignKey) : null,
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
        { date: null, result: "parent-set", blunders: 0, from: profile.level, to: newLevel, reason: reasonNote || "Adjusted by a grown-up.", key: "parent-set" },
        ...(profile.progressionLog || []),
      ].slice(0, HISTORY_LIMIT),
    };
  }

  // ---- Server records (Nov 22, 2026) ------------------------------------
  // Structured, bounded, no free text and no names beyond the child id. The
  // Companion App stores one row per game id; a later report (higher `seq`)
  // replaces an earlier one.
  const LEVEL_LABELS = ["Just starting out", "Getting the hang of it", "Playing real games", "Sharp player"];
  const REASON_KEYS = [
    "win-wobbly", "win-up", "resigned-wobbly", "resigned-up", "unfinished-wobbly", "unfinished-up", "unfinished-even",
    "loss-clean", "loss-down", "draw", "parent-set", "other",
  ];
  // Reason texts of entries written before Nov 22 (stored English sentences) → key.
  const LEGACY_REASON_KEYS = {
    "You won! You had a few wobbles, so let's stay here and lock it in.": "win-wobbly",
    "You won and played well — moving up to a slightly tougher friend.": "win-up",
    "A close game with no big mistakes — staying at the same level.": "loss-clean",
    "That was a tricky one — easing back a step so the next game is more fun.": "loss-down",
    "A draw — staying right where you are.": "draw",
  };
  const HISTORY_RESULTS = RESULTS;
  const LOG_RESULTS = RESULTS.concat(["parent-set"]);

  const int = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
  const isoOrNull = (v) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  const oppOrNull = (v) => (typeof v === "string" && opponentById(v) ? v : null);
  const gameIdOrNull = (v) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

  function reasonKeyOf(p) {
    if (p && typeof p.key === "string" && REASON_KEYS.includes(p.key)) return p.key;
    if (p && p.result === "parent-set") return "parent-set";
    if (p && typeof p.reason === "string" && LEGACY_REASON_KEYS[p.reason]) return LEGACY_REASON_KEYS[p.reason];
    return "other";
  }

  // The profile as the server keeps it: counters, level, unlocks, concepts, and
  // the history / progression log with reason KEYS instead of sentences.
  function profileSnapshot(profile) {
    const p = profile || {};
    const history = (Array.isArray(p.history) ? p.history : []).slice(0, HISTORY_LIMIT).map((h) => {
      const e = {
        gameId: gameIdOrNull(h && h.gameId),
        date: isoOrNull(h && h.date),
        opponentId: oppOrNull(h && h.opponentId),
        result: HISTORY_RESULTS.includes(h && h.result) ? h.result : null,
        movesPlayed: int(h && h.movesPlayed, 0, 1000),
        blunders: int(h && h.blunders, 0, 20),
        hintsTaken: int(h && h.hintsTaken, 0, 20),
      };
      // Entries from Nov 22 on also say what she chose; older ones don't have it.
      if (h && typeof h.nudges === "number") {
        e.nudges = int(h.nudges, 0, MAX_CHECKPOINTS_PER_GAME);
        e.followed = int(h.followed, 0, MAX_CHECKPOINTS_PER_GAME);
        e.kept = int(h.kept, 0, MAX_CHECKPOINTS_PER_GAME);
        e.endReason = END_REASONS.includes(h.endReason) ? h.endReason : null;
        e.from = int(h.from, 0, MAX_LEVEL);
        e.to = int(h.to, 0, MAX_LEVEL);
      }
      return e;
    });
    const progressionLog = (Array.isArray(p.progressionLog) ? p.progressionLog : []).slice(0, HISTORY_LIMIT).map((e) => ({
      gameId: gameIdOrNull(e && e.gameId),
      date: isoOrNull(e && e.date),
      result: LOG_RESULTS.includes(e && e.result) ? e.result : null,
      blunders: int(e && e.blunders, 0, 20),
      from: int(e && e.from, 0, MAX_LEVEL),
      to: int(e && e.to, 0, MAX_LEVEL),
      reasonKey: reasonKeyOf(e),
    }));
    const level = int(p.level, 0, MAX_LEVEL) ?? 0;
    return {
      level,
      label: LEVEL_LABELS.includes(p.estimatedLevelLabel) ? p.estimatedLevelLabel : levelLabel(level),
      gamesPlayed: int(p.gamesPlayed, 0, 100000) ?? 0,
      wins: int(p.wins, 0, 100000) ?? 0,
      losses: int(p.losses, 0, 100000) ?? 0,
      draws: int(p.draws, 0, 100000) ?? 0,
      unfinishedGames: int(p.unfinishedGames, 0, 100000) ?? 0,
      hintsUsed: int(p.hintsUsed, 0, 100000) ?? 0,
      unlockedOpponents: (Array.isArray(p.unlockedOpponents) ? p.unlockedOpponents : []).filter((id) => opponentById(id)).slice(0, OPPONENTS.length),
      conceptsSeen: (Array.isArray(p.conceptsSeen) ? p.conceptsSeen : []).filter((id) => conceptById(id)).slice(0, CONCEPTS.length),
      lastOpponentId: oppOrNull(p.lastOpponentId),
      history,
      progressionLog,
    };
  }

  // One game as reported to the server. `finished` is finishGame's return value.
  function gameRecord(input) {
    const s = input.session;
    const fin = input.finished;
    const counts = nudgeCounts(s);
    return {
      kind: "game",
      child: s.childId,
      gameId: s.gameId,
      seq: s.seq,
      startedAt: isoOrNull(s.startedAt),
      endedAt: isoOrNull(input.endedAt),
      opponentId: s.opponentId,
      levelBefore: clampLevel(s.startLevel),
      levelAfter: clampLevel(fin.profile.level),
      result: input.result,
      endReason: input.endReason,
      judged: fin.judged || null,
      movesPlayed: int(s.movesPlayed, 0, 1000) ?? 0,
      activeSeconds: int(s.activeSeconds, 0, 6 * 3600) ?? 0,
      nudgesShown: counts.shown,
      nudgesFollowed: counts.followed,
      nudgesKept: counts.kept,
      nudges: nudgesForRecord(s),
      materialBalance: int(input.materialBalance, -100, 100) ?? 0,
      levelReason: fin.alreadyCounted ? "already-counted" : fin.levelChange.key,
      profile: profileSnapshot(fin.profile),
    };
  }

  // The one-time import of a profile written before records existed.
  function importRecord(childId, profile) {
    return { kind: "import", child: childId, source: "imported-from-browser", profile: profileSnapshot(profile) };
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
    // Nov 22, 2026
    MATERIAL_VALUE,
    RESIGN_MAX_MIN_LEVEL,
    RESIGN_MATERIAL_LEAD,
    RESIGN_MIN_CHILD_MOVES,
    UNFINISHED_WIN_LEAD,
    NUDGE_THREATS,
    NUDGE_CHOICES,
    RESULTS,
    END_REASONS,
    REASON_KEYS,
    LEVEL_LABELS,
    HISTORY_LIMIT,
    materialBalance,
    shouldResign,
    judgeUnfinished,
    nudgeCounts,
    nudgesForRecord,
    newGameId,
    restoreSessionCounters,
    levelOutcomeFor,
    profileSnapshot,
    gameRecord,
    importRecord,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ChessCoach;
  if (typeof root !== "undefined") root.ChessCoach = ChessCoach;
})(typeof globalThis !== "undefined" ? globalThis : this);
