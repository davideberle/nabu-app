// ===========================================================================
// chess-ui.js — the touch board and screen flow. Wires chess-engine (rules),
// chess-ai (opponent + analysis) and chess-coach (product rules) to a
// portrait/landscape, tap-to-move interface with the concept, checkpoint and
// recap overlays. Persists the live game and the per-child profile in
// localStorage so a refresh resumes.
//
// The child plays White at the bottom. A small window.__chess hook is exposed
// for automated verification (drive taps, read state, load positions); it does
// nothing on its own.
// ===========================================================================

(function () {
  "use strict";

  const Engine = window.ChessEngine;
  const AI = window.ChessAI;
  const Coach = window.ChessCoach;

  const GLYPH = {
    P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
    p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  };

  // ---- Child identity from the launch URL (validated) -------------------
  const ALLOWED_CHILDREN = ["santiago", "isabel"];
  function readChildId() {
    try {
      const p = new URLSearchParams(window.location.search).get("child");
      if (p && ALLOWED_CHILDREN.includes(p)) return p;
    } catch {
      /* ignore */
    }
    return "guest";
  }
  const childId = readChildId();
  const displayName = childId === "guest" ? "Player" : childId[0].toUpperCase() + childId.slice(1);

  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const GAME_KEY = Coach.STORAGE_PREFIX + childId + ":game";

  // ---- Mutable app state ------------------------------------------------
  let profile = Coach.loadProfile(storage, childId);
  let state = Engine.initialState();
  let session = null;
  let opponent = Coach.opponentForLevel(profile.level);
  let selected = -1;
  let legalFromSelected = [];
  let lastMove = null;
  let inputLocked = true; // locked until a game begins
  let pendingCheckpoint = null;
  let pendingPromotion = null; // { from, to, resolve }
  let opponentRng = Math.random;

  // ---- DOM refs ---------------------------------------------------------
  const boardEl = document.getElementById("board");
  const sqEls = new Array(64);
  const el = (id) => document.getElementById(id);

  // Build the 64 squares once (top row = rank 8).
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const sq = Engine.squareIndex(f, r);
        const d = document.createElement("div");
        d.className = "sq " + ((f + r) % 2 === 0 ? "dark" : "light");
        d.dataset.sq = String(sq);
        boardEl.appendChild(d);
        sqEls[sq] = d;
      }
    }
  }

  function render() {
    const kingInCheckSq =
      Engine.inCheck(state, state.turn) ? Engine.findKing(state.board, state.turn) : -1;
    const targetSquares = new Set(legalFromSelected.map((m) => m.to));
    for (let sq = 0; sq < 64; sq++) {
      const d = sqEls[sq];
      const base = "sq " + ((Engine.fileOf(sq) + Engine.rankOf(sq)) % 2 === 0 ? "dark" : "light");
      let cls = base;
      if (sq === selected) cls += " sel";
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cls += " last";
      if (sq === kingInCheckSq) cls += " check";
      d.className = cls;

      let html = "";
      const p = state.board[sq];
      if (p !== null) {
        const color = Engine.colorOf(p) === Engine.WHITE ? "w" : "b";
        html += `<span class="piece ${color}">${GLYPH[p]}</span>`;
      }
      if (targetSquares.has(sq)) {
        const isCapture = p !== null || legalFromSelected.some((m) => m.to === sq && m.flag === "ep");
        html += `<span class="dot${isCapture ? " capture" : ""}"></span>`;
      }
      d.innerHTML = html;
    }
    updatePanel();
  }

  function updatePanel() {
    el("opp-emoji").textContent = opponent.emoji;
    el("opp-name").textContent = opponent.name;
    el("opp-blurb").textContent = opponent.blurb;
    el("meta-level").textContent = "Level: " + profile.level + " · " + profile.estimatedLevelLabel;
    if (session) {
      const left = Coach.MAX_CHECKPOINTS_PER_GAME - session.checkpointsUsed;
      el("meta-checkpoints").textContent = "Coach nudges left: " + left;
    } else {
      el("meta-checkpoints").textContent = "";
    }
  }

  function setStatus(text, good) {
    const s = el("status-line");
    s.textContent = text;
    s.className = "status-line" + (good ? " good" : "");
  }

  // ---- Selection & move input -------------------------------------------
  function legalMovesFrom(sq) {
    return Engine.generateLegalMoves(state).filter((m) => m.from === sq);
  }

  function onSquareTap(sq) {
    if (inputLocked || state.turn !== Coach.CHILD_COLOR) return;
    const piece = state.board[sq];
    if (selected === -1) {
      if (piece !== null && Engine.colorOf(piece) === Coach.CHILD_COLOR) {
        selected = sq;
        legalFromSelected = legalMovesFrom(sq);
        render();
      }
      return;
    }
    // A square is already selected.
    if (sq === selected) {
      clearSelection();
      return;
    }
    const targets = legalFromSelected.filter((m) => m.to === sq);
    if (targets.length > 0) {
      const from = selected;
      clearSelection();
      if (targets[0].flag === "promo") {
        askPromotion(from, sq);
      } else {
        beginChildMove(targets[0]);
      }
      return;
    }
    // Re-select another own piece, or clear.
    if (piece !== null && Engine.colorOf(piece) === Coach.CHILD_COLOR) {
      selected = sq;
      legalFromSelected = legalMovesFrom(sq);
      render();
    } else {
      clearSelection();
    }
  }

  function clearSelection() {
    selected = -1;
    legalFromSelected = [];
    render();
  }

  // Promotion picker.
  function askPromotion(from, to) {
    pendingPromotion = { from, to };
    const row = el("promo-row");
    row.innerHTML = "";
    for (const t of ["q", "r", "b", "n"]) {
      const b = document.createElement("button");
      b.className = "promo-btn";
      b.textContent = GLYPH[t.toUpperCase()]; // child is White
      b.dataset.promo = t;
      b.onclick = () => {
        hide("promo-overlay");
        const move = Engine.findMove(state, from, to, t);
        pendingPromotion = null;
        if (move) beginChildMove(move);
      };
      row.appendChild(b);
    }
    show("promo-overlay");
  }

  // A child move first passes the coach checkpoint gate.
  function beginChildMove(move) {
    const checkpoint = Coach.reviewChildMove(session, state, move);
    if (checkpoint) {
      pendingCheckpoint = checkpoint;
      showCheckpoint(checkpoint);
    } else {
      commitChildMove(move);
    }
  }

  function showCheckpoint(cp) {
    el("checkpoint-title").textContent = "Are you sure? (nudge " + cp.checkpointNumber + ")";
    el("checkpoint-risk").textContent = cp.riskText;
    el("checkpoint-compare").textContent = "";
    el("checkpoint-continue").style.display = "none";
    el("cp-keep-btn").style.display = "";
    el("cp-better-btn").style.display = "";
    show("checkpoint-overlay");
  }

  function resolveCheckpoint(choice) {
    const cp = pendingCheckpoint;
    if (!cp) return;
    const result = Coach.resolveCheckpoint(session, cp, choice);
    el("checkpoint-compare").textContent = result.comparison;
    el("cp-keep-btn").style.display = "none";
    el("cp-better-btn").style.display = "none";
    el("checkpoint-continue").style.display = "";
    pendingCheckpoint = null;
    // Stash the move to play on Continue (single, final — no re-guessing).
    el("cp-continue-btn").onclick = () => {
      hide("checkpoint-overlay");
      commitChildMove(result.move);
    };
  }

  function commitChildMove(move) {
    if (move.captured || move.flag === "ep") session.capturesByChild += 1;
    Engine.applyMove(state, move);
    lastMove = move;
    session.movesPlayed += 1;
    persistGame();
    render();
    const st = Engine.status(state);
    if (st.over) {
      finishFromStatus(st);
      return;
    }
    inputLocked = true;
    opponentTurn();
  }

  function opponentTurn() {
    setStatus(opponent.name + " is thinking…");
    setTimeout(() => {
      const move = AI.pickMove(state, opponent.difficulty, opponentRng);
      if (!move) {
        const st = Engine.status(state);
        finishFromStatus(st);
        return;
      }
      Engine.applyMove(state, move);
      lastMove = move;
      persistGame();
      render();
      const st = Engine.status(state);
      if (st.over) {
        finishFromStatus(st);
        return;
      }
      inputLocked = false;
      if (st.check) setStatus("Check! Protect your king.");
      else setStatus("Your move");
    }, 420);
  }

  // ---- End of game ------------------------------------------------------
  function finishFromStatus(st) {
    inputLocked = true;
    let result;
    if (st.result === "checkmate") {
      result = st.winner === Coach.CHILD_COLOR ? "win" : "loss";
    } else {
      result = "draw";
    }
    endGame(result);
  }

  function endGame(result) {
    const dateISO = safeNowISO();
    const res = Coach.finishGame(profile, session, result, dateISO);
    profile = res.profile;
    Coach.saveProfile(storage, profile);
    clearPersistedGame();
    opponent = Coach.opponentForLevel(profile.level);
    showRecap(result, res.recap);
  }

  function showRecap(result, recap) {
    el("recap-title").textContent =
      result === "win" ? "You won! 🎉" : result === "loss" ? "Good game!" : "A draw — well played!";
    el("recap-strength").textContent = recap.strength;
    el("recap-next").textContent = recap.nextIdea;
    el("recap-level").textContent = recap.levelReason;
    const unlock = el("recap-unlock");
    if (recap.unlockNote) {
      unlock.textContent = recap.unlockNote;
      unlock.style.display = "";
    } else {
      unlock.style.display = "none";
    }
    show("recap-overlay");
  }

  // ---- Persistence of the live game -------------------------------------
  function persistGame() {
    if (!storage || !session) return;
    try {
      storage.setItem(
        GAME_KEY,
        JSON.stringify({
          fen: Engine.toFEN(state),
          opponentId: session.opponentId,
          conceptId: session.concept ? session.concept.id : null,
          checkpointsUsed: session.checkpointsUsed,
          blundersDetected: session.blundersDetected,
          hintsTaken: session.hintsTaken,
          movesPlayed: session.movesPlayed,
          capturesByChild: session.capturesByChild,
          startLevel: session.startLevel,
          lastMove: lastMove ? { from: lastMove.from, to: lastMove.to } : null,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function clearPersistedGame() {
    if (!storage) return;
    try {
      storage.removeItem(GAME_KEY);
    } catch {
      /* ignore */
    }
  }

  function readPersistedGame() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(GAME_KEY);
      if (!raw) return null;
      const g = JSON.parse(raw);
      if (!g || !g.fen) return null;
      return g;
    } catch {
      return null;
    }
  }

  function resumeGame(g) {
    state = Engine.parseFEN(g.fen);
    opponent = Coach.opponentById(g.opponentId) || Coach.opponentForLevel(profile.level);
    const concept = g.conceptId ? Coach.conceptById(g.conceptId) : null;
    session = Coach.startGame(profile, { opponent, concept: concept || undefined, rng: Math.random });
    session.checkpointsUsed = g.checkpointsUsed || 0;
    session.blundersDetected = g.blundersDetected || 0;
    session.hintsTaken = g.hintsTaken || 0;
    session.movesPlayed = g.movesPlayed || 0;
    session.capturesByChild = g.capturesByChild || 0;
    session.startLevel = g.startLevel ?? profile.level;
    lastMove =
      g.lastMove && typeof g.lastMove.from === "number"
        ? { from: g.lastMove.from, to: g.lastMove.to }
        : null;
    selected = -1;
    legalFromSelected = [];
    hideAllOverlays();
    inputLocked = state.turn !== Coach.CHILD_COLOR;
    render();
    if (state.turn === Coach.CHILD_COLOR) {
      setStatus(Engine.inCheck(state, state.turn) ? "Check! Protect your king." : "Your move");
    } else {
      opponentTurn();
    }
  }

  // ---- Game start flow --------------------------------------------------
  function openStart() {
    profile = Coach.loadProfile(storage, childId);
    opponent = Coach.opponentForLevel(profile.level);
    el("start-title").textContent = "Hi " + displayName + "!";
    el("start-sub").textContent = "Ready for a game of chess? Level " + profile.level + " · " + profile.estimatedLevelLabel;
    el("start-opp-emoji").textContent = opponent.emoji;
    el("start-opp-name").textContent = "Today: " + opponent.name;
    el("start-opp-blurb").textContent = opponent.blurb;
    const g = readPersistedGame();
    el("resume-wrap").style.display = g ? "" : "none";
    render();
    show("start-overlay");
  }

  function beginNewGame() {
    hideAllOverlays();
    profile = Coach.loadProfile(storage, childId);
    opponent = Coach.opponentForLevel(profile.level);
    session = Coach.startGame(profile, { opponent, rng: Math.random });
    state = Engine.initialState();
    selected = -1;
    legalFromSelected = [];
    lastMove = null;
    clearPersistedGame();
    // Show the one pre-game concept.
    el("concept-title").textContent = session.concept.title;
    el("concept-text").textContent = session.concept.text;
    render();
    show("concept-overlay");
  }

  function startPlaying() {
    hideAllOverlays();
    inputLocked = false;
    setStatus("Your move");
    render();
  }

  // ---- Overlay helpers --------------------------------------------------
  function show(id) {
    el(id).classList.add("show");
  }
  function hide(id) {
    el(id).classList.remove("show");
  }
  function hideAllOverlays() {
    for (const id of [
      "start-overlay",
      "concept-overlay",
      "promo-overlay",
      "checkpoint-overlay",
      "recap-overlay",
    ]) {
      hide(id);
    }
  }

  function safeNowISO() {
    try {
      return new Date().toISOString();
    } catch {
      return null;
    }
  }

  // ---- Wire events ------------------------------------------------------
  function wire() {
    boardEl.addEventListener("pointerup", (e) => {
      const cell = e.target.closest(".sq");
      if (!cell) return;
      onSquareTap(Number(cell.dataset.sq));
    });
    el("start-play-btn").onclick = beginNewGame;
    el("resume-btn").onclick = () => {
      const g = readPersistedGame();
      if (g) resumeGame(g);
    };
    el("concept-go-btn").onclick = startPlaying;
    el("new-game-btn").onclick = openStart;
    el("cp-keep-btn").onclick = () => resolveCheckpoint("keep");
    el("cp-better-btn").onclick = () => resolveCheckpoint("better");
    el("recap-again-btn").onclick = beginNewGame;
    el("recap-skip-btn").onclick = () => {
      hide("recap-overlay");
      openStart();
    };
  }

  // ---- Boot -------------------------------------------------------------
  buildBoard();
  wire();
  const persisted = readPersistedGame();
  if (persisted) {
    // Offer resume from the start screen (also playable immediately).
    openStart();
  } else {
    openStart();
  }

  // ---- Verification hook (no-op unless driven) --------------------------
  window.__chess = {
    engine: Engine,
    ai: AI,
    coach: Coach,
    childId,
    fen: () => Engine.toFEN(state),
    profile: () => profile,
    session: () => session,
    opponent: () => opponent,
    turn: () => state.turn,
    inputLocked: () => inputLocked,
    tap: (nameOrIdx) =>
      onSquareTap(typeof nameOrIdx === "number" ? nameOrIdx : Engine.squareFromName(nameOrIdx)),
    overlayShown: () =>
      ["start-overlay", "concept-overlay", "promo-overlay", "checkpoint-overlay", "recap-overlay"].filter(
        (id) => el(id).classList.contains("show"),
      ),
    startNewGame: beginNewGame,
    play: startPlaying,
    // Testing aids: seed the opponent RNG, force its difficulty, or set up a
    // position. Harmless in normal play (never called).
    seedRng: (n) => {
      opponentRng = AI.createRng(n);
    },
    setOpponentDifficulty: (d) => {
      opponent = { ...opponent, difficulty: d };
      if (session) session.opponent = opponent;
    },
    loadFEN: (fen) => {
      state = Engine.parseFEN(fen);
      selected = -1;
      legalFromSelected = [];
      lastMove = null;
      inputLocked = state.turn !== Coach.CHILD_COLOR;
      if (!session) session = Coach.startGame(profile, { opponent, rng: Math.random });
      render();
    },
  };
})();
