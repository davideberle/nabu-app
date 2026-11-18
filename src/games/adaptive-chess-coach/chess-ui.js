// ===========================================================================
// chess-ui.js — the touch board and screen flow. Wires chess-engine (rules),
// chess-ai (opponent + analysis) and chess-coach (product rules) to a
// portrait/landscape, tap-to-move interface with the concept, checkpoint and
// recap overlays. Persists the live game and the per-child profile in
// localStorage so a refresh resumes.
//
// Nov 18, 2026: all coach text is German and comes from the closed line set
// (chess-lines-de.js). The nudge is a card in the side panel BESIDE the board
// (never over it) while the board highlights the piece in danger and its
// attacker. «Zeig mir eine bessere Idee» takes the intended move back and
// highlights the suggested piece and its target; the child then moves herself.
// Spoken lines: when the Companion App injects `window.__CHESS_VOICE__`
// ({ clips: { key: url }, rate }), each line plays its PRERECORDED clip with
// HTMLAudio (slowed, pitch preserved), one clip at a time. No map → silent
// text. A missing clip → silence. Never the device's speech synthesis.
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

  const PIECE_NAME = { p: "Bauer", n: "Pferd", b: "Läufer", r: "Turm", q: "Dame", k: "König" };
  function describeSquare(sq, piece, isTarget) {
    let label = Engine.squareName(sq);
    if (piece !== null) {
      const side = Engine.colorOf(piece) === Engine.WHITE ? "Weiss" : "Schwarz";
      label += `, ${side}: ${PIECE_NAME[Engine.typeOf(piece)]}`;
    } else {
      label += ", leer";
    }
    if (isTarget) label += ", möglicher Zug";
    return label;
  }

  // ---- Spoken lines (prerecorded clips only) ----------------------------
  // The app injects { clips: { key: sameOriginUrl }, rate } before this script.
  const VOICE = (() => {
    try {
      const v = window.__CHESS_VOICE__;
      if (v && typeof v === "object" && v.clips && typeof v.clips === "object") return v;
    } catch {
      /* ignore */
    }
    return null;
  })();
  const VOICE_RATE = VOICE && typeof VOICE.rate === "number" && VOICE.rate > 0.5 && VOICE.rate <= 1 ? VOICE.rate : 0.85;
  let audioEl = null;
  let speakSeq = 0;
  let lastSpoken = [];
  let pendingSpeak = null; // keys asked for while the play guard is frozen
  const spokenLog = []; // keys the coach asked to say (verification aid)

  function guardFrozen() {
    try {
      const g = window.__familyPlayGuard;
      return !!(g && typeof g.isFrozen === "function" && g.isFrozen());
    } catch {
      return false;
    }
  }

  function applyRate(a) {
    a.defaultPlaybackRate = VOICE_RATE;
    a.playbackRate = VOICE_RATE;
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
    a.mozPreservesPitch = true;
  }

  function stopSpeaking() {
    speakSeq += 1;
    pendingSpeak = null;
    const a = audioEl;
    audioEl = null;
    if (a) {
      a.onended = null;
      a.onerror = null;
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      try {
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
    }
  }

  // Say these line keys, in order, superseding whatever was playing. Only
  // catalogued keys with an injected clip URL can sound; anything else is
  // silence (the text is on screen anyway).
  function speak(keys) {
    const list = (keys || []).filter((k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(Coach.LINES, k));
    lastSpoken = list;
    spokenLog.push(...list);
    stopSpeaking();
    if (!VOICE || !list.length) return;
    if (guardFrozen()) {
      pendingSpeak = list; // spoken when the guard lets the game run
      return;
    }
    const seq = speakSeq;
    const queue = list.filter((k) => typeof VOICE.clips[k] === "string" && VOICE.clips[k].startsWith("/"));
    const next = () => {
      if (seq !== speakSeq) return;
      const key = queue.shift();
      if (!key) {
        audioEl = null;
        return;
      }
      const a = new Audio();
      audioEl = a;
      a.preload = "auto";
      applyRate(a);
      a.onended = next;
      a.onerror = next; // not recorded (404) or failed: silence for this line
      a.src = VOICE.clips[key];
      applyRate(a);
      let p;
      try {
        p = a.play();
      } catch {
        p = null;
      }
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Autoplay refused or load failed: stay silent; «🔊» replays on a tap.
          if (seq === speakSeq && audioEl === a) audioEl = null;
        });
      }
    };
    next();
  }

  function replaySpoken() {
    speak(lastSpoken.slice());
  }

  // The play guard freezes the page by dispatching `blur` and thaws with
  // `focus`: a clip never keeps talking over a frozen game.
  window.addEventListener("blur", () => {
    if (guardFrozen()) {
      const keys = audioEl ? lastSpoken.slice() : null;
      stopSpeaking();
      pendingSpeak = keys;
    }
  });
  window.addEventListener("focus", () => {
    if (pendingSpeak && !guardFrozen()) {
      const keys = pendingSpeak;
      pendingSpeak = null;
      speak(keys);
    }
  });
  window.addEventListener("pagehide", stopSpeaking);

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
  const displayName = childId === "guest" ? null : childId[0].toUpperCase() + childId.slice(1);

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
  // While a nudge shows: the board previews the intended move (not applied to
  // the game) with the piece in danger and its attacker highlighted.
  let preview = null; // { state, move, threatSquare, attackerSquare }
  // After «bessere Idee»: the suggested piece and its target, until she moves.
  let hint = null; // { from, to }
  let pendingPromotion = null; // { from, to, resolve }
  let opponentRng = Math.random;
  // Bumped whenever the board is replaced (new game, resume, start screen): a
  // pending opponent reply from the previous board must never play on the new one.
  let boardEpoch = 0;

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
        d.setAttribute("role", "button");
        boardEl.appendChild(d);
        sqEls[sq] = d;
      }
    }
  }

  function render() {
    const view = preview ? preview.state : state;
    const kingInCheckSq =
      Engine.inCheck(view, view.turn) ? Engine.findKing(view.board, view.turn) : -1;
    const targetSquares = new Set(legalFromSelected.map((m) => m.to));
    const shownMove = preview ? null : lastMove;
    for (let sq = 0; sq < 64; sq++) {
      const d = sqEls[sq];
      const base = "sq " + ((Engine.fileOf(sq) + Engine.rankOf(sq)) % 2 === 0 ? "dark" : "light");
      let cls = base;
      if (sq === selected) cls += " sel";
      if (shownMove && (sq === shownMove.from || sq === shownMove.to)) cls += " last";
      if (preview && (sq === preview.move.from || sq === preview.move.to)) cls += " intended";
      if (preview && sq === preview.threatSquare) cls += " threat";
      if (preview && sq === preview.attackerSquare) cls += " attacker";
      if (hint && sq === hint.from) cls += " hint-from";
      if (hint && sq === hint.to) cls += " hint-to";
      if (sq === kingInCheckSq) cls += " check";
      d.className = cls;

      let html = "";
      const p = view.board[sq];
      if (p !== null) {
        const color = Engine.colorOf(p) === Engine.WHITE ? "w" : "b";
        html += `<span class="piece ${color}">${GLYPH[p]}</span>`;
      }
      if (targetSquares.has(sq)) {
        const isCapture = p !== null || legalFromSelected.some((m) => m.to === sq && m.flag === "ep");
        html += `<span class="dot${isCapture ? " capture" : ""}"></span>`;
      }
      d.innerHTML = html;
      d.setAttribute("aria-label", describeSquare(sq, p, targetSquares.has(sq)));
    }
    updatePanel();
  }

  function updatePanel() {
    el("opp-emoji").textContent = opponent.emoji;
    el("opp-name").textContent = opponent.name;
    el("opp-blurb").textContent = opponent.blurb;
    el("meta-level").textContent = "Stufe " + profile.level + " · " + Coach.levelLabelDe(profile.level);
    if (session) {
      const left = Coach.MAX_CHECKPOINTS_PER_GAME - session.checkpointsUsed;
      el("meta-checkpoints").textContent = "Tipps übrig: " + left;
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
    el("promo-cancel-btn").onclick = () => {
      // An accidental tap shouldn't force a promotion — back out, nothing played.
      hide("promo-overlay");
      pendingPromotion = null;
      render();
    };
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

  // The nudge: a card in the side panel; the board previews the intended move
  // and highlights the piece in danger (red) and its attacker (orange).
  function showCheckpoint(cp) {
    const previewState = Engine.parseFEN(Engine.toFEN(state));
    Engine.applyMove(previewState, cp.playedMove);
    preview = {
      state: previewState,
      move: cp.playedMove,
      threatSquare: cp.threatSquare,
      attackerSquare: cp.attackerSquare,
    };
    hint = null;
    inputLocked = true;
    el("coach-title").textContent = "Halt, schau mal! (Tipp " + cp.checkpointNumber + " von " + Coach.MAX_CHECKPOINTS_PER_GAME + ")";
    el("coach-text").textContent = cp.riskText;
    el("coach-legend").style.display = cp.threatSquare !== null ? "" : "none";
    el("coach-choices").style.display = "";
    el("coach-continue").style.display = "none";
    showCoachCard();
    setStatus("Was möchtest du tun?");
    render();
    speak([cp.riskKey]);
  }

  function resolveCheckpoint(choice) {
    const cp = pendingCheckpoint;
    if (!cp) return;
    const result = Coach.resolveCheckpoint(session, cp, choice);
    pendingCheckpoint = null;
    el("coach-choices").style.display = "none";
    el("coach-legend").style.display = "none";
    el("coach-text").textContent = result.comparison;
    speak([result.lineKey]);
    if (result.takeback) {
      // Take the intended move back: the board shows the real position again,
      // with the suggested piece and its target highlighted. Nothing is played;
      // the child moves herself and that move is accepted as it is.
      preview = null;
      hint = result.hint;
      el("coach-title").textContent = "Eine bessere Idee";
      el("coach-continue").style.display = "none";
      inputLocked = false;
      setStatus("Du bist dran");
      persistGame();
      render();
      return;
    }
    // «Ich bleibe bei meinem Zug»: as before — Continue plays her move.
    el("coach-title").textContent = "Dein Zug";
    el("coach-continue").style.display = "";
    el("cp-continue-btn").onclick = () => {
      preview = null;
      hideCoachCard();
      commitChildMove(result.move);
    };
    persistGame();
    render();
  }

  function showCoachCard() {
    el("coach-card").classList.add("show");
    el("app").classList.add("nudging");
    try {
      el("coach-card").scrollIntoView({ block: "nearest" });
    } catch {
      /* ignore */
    }
  }
  function hideCoachCard() {
    el("coach-card").classList.remove("show");
    el("app").classList.remove("nudging");
  }

  function commitChildMove(move) {
    if (hint) {
      hint = null;
      hideCoachCard();
    }
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
    setStatus(opponent.name + " denkt nach …");
    const epoch = boardEpoch;
    setTimeout(() => {
      if (epoch !== boardEpoch || state.turn === Coach.CHILD_COLOR) return;
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
      if (st.check) setStatus("Schach! Schütze deinen König.");
      else setStatus("Du bist dran");
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
      result === "win" ? "Gewonnen! 🎉" : result === "loss" ? "Gut gespielt!" : "Unentschieden!";
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
    speak([recap.strengthKey, recap.nextKey]);
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

  // Resume the persisted game. A corrupt blob (bad FEN, tampered storage) must
  // never strand the child on a broken board: discard it and stay on the start
  // screen instead.
  function resumeGame(g) {
    let resumedState;
    try {
      resumedState = Engine.parseFEN(g.fen);
      // A position without both kings is not a resumable game.
      if (
        Engine.findKing(resumedState.board, Engine.WHITE) < 0 ||
        Engine.findKing(resumedState.board, Engine.BLACK) < 0
      ) {
        throw new Error("kingless position");
      }
    } catch {
      clearPersistedGame();
      openStart();
      return;
    }
    state = resumedState;
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
    clearCoachState();
    hideAllOverlays();
    inputLocked = state.turn !== Coach.CHILD_COLOR;
    render();
    if (state.turn === Coach.CHILD_COLOR) {
      setStatus(Engine.inCheck(state, state.turn) ? "Schach! Schütze deinen König." : "Du bist dran");
    } else {
      opponentTurn();
    }
  }

  // ---- Game start flow --------------------------------------------------
  function openStart() {
    profile = Coach.loadProfile(storage, childId);
    opponent = Coach.opponentForLevel(profile.level);
    clearCoachState();
    inputLocked = true;
    el("start-title").textContent = "Schach ♟";
    el("start-intro").textContent = Coach.introScreenText(opponent, displayName);
    el("start-sub").textContent = "Stufe " + profile.level + " · " + Coach.levelLabelDe(profile.level);
    el("start-opp-emoji").textContent = opponent.emoji;
    el("start-opp-name").textContent = opponent.name;
    el("start-opp-blurb").textContent = opponent.blurb;
    const g = readPersistedGame();
    el("resume-wrap").style.display = g ? "" : "none";
    render();
    show("start-overlay");
    speak([opponent.introKey]);
  }

  // Leave no nudge, preview or hint behind (new game, resume, start screen).
  function clearCoachState() {
    boardEpoch += 1;
    pendingCheckpoint = null;
    preview = null;
    hint = null;
    hideCoachCard();
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
    clearCoachState();
    clearPersistedGame();
    // Show the one pre-game concept.
    el("concept-title").textContent = session.concept.title;
    el("concept-text").textContent = session.concept.text;
    render();
    show("concept-overlay");
    speak([session.concept.lineKey]);
  }

  function startPlaying() {
    hideAllOverlays();
    stopSpeaking();
    inputLocked = false;
    setStatus("Du bist dran");
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
    // «🔊» replays the last spoken line(s); hidden when no clips are available.
    for (const b of document.querySelectorAll("[data-replay]")) {
      if (!VOICE) b.style.display = "none";
      b.onclick = replaySpoken;
    }
  }

  // ---- Boot -------------------------------------------------------------
  buildBoard();
  wire();
  // The start screen offers "Resume last game" itself when one is persisted.
  openStart();

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
      ["start-overlay", "concept-overlay", "promo-overlay", "recap-overlay"].filter(
        (id) => el(id).classList.contains("show"),
      ),
    // The nudge card beside the board and the board highlights.
    coachCard: () => ({
      shown: el("coach-card").classList.contains("show"),
      title: el("coach-title").textContent,
      text: el("coach-text").textContent,
      choices: el("coach-choices").style.display !== "none",
    }),
    highlights: () => {
      const out = {};
      for (const c of ["threat", "attacker", "intended", "hint-from", "hint-to"]) {
        out[c] = sqEls.filter((d) => d.classList.contains(c)).map((d) => Engine.squareName(Number(d.dataset.sq)));
      }
      return out;
    },
    pendingCheckpoint: () => pendingCheckpoint,
    keep: () => resolveCheckpoint("keep"),
    better: () => resolveCheckpoint("better"),
    spoken: () => spokenLog.slice(),
    voice: () => (VOICE ? { rate: VOICE_RATE, keys: Object.keys(VOICE.clips).length } : null),
    playing: () => (audioEl ? { src: audioEl.getAttribute("src"), rate: audioEl.playbackRate, preservesPitch: audioEl.preservesPitch } : null),
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
      clearCoachState();
      inputLocked = state.turn !== Coach.CHILD_COLOR;
      if (!session) session = Coach.startGame(profile, { opponent, rng: Math.random });
      render();
    },
  };
})();
