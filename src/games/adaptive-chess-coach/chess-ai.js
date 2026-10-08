// ===========================================================================
// chess-ai.js — evaluation, a small negamax search, opponent move selection at
// tunable strength, and the blunder analysis the coach turns into advice.
//
// Deliberately modest: this is a friendly coach, not a competitor. Strength is
// a knob (search depth + how often it wanders off the best move), so the
// difficulty ladder in chess-coach.js can range from "barely tries" to "plays
// a sensible game". Pure logic; depends only on chess-engine.js.
// ===========================================================================

(function (root) {
  "use strict";

  const Engine =
    typeof module !== "undefined" && module.exports ? require("./chess-engine.js") : root.ChessEngine;

  const { WHITE, BLACK, typeOf, colorOf, fileOf, rankOf } = Engine;

  const MATE = 100000;

  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // Piece-square tables (white perspective, a1 = index 0). They nudge the
  // opponent toward natural development and center control so a weak game still
  // *looks* like chess. Mirrored vertically for Black.
  // prettier-ignore
  const PST = {
    p: [
       0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10,-20,-20, 10, 10,  5,
       5, -5,-10,  0,  0,-10, -5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5,  5, 10, 25, 25, 10,  5,  5,
      10, 10, 20, 30, 30, 20, 10, 10,
      50, 50, 50, 50, 50, 50, 50, 50,
       0,  0,  0,  0,  0,  0,  0,  0,
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    r: [
       0,  0,  0,  5,  5,  0,  0,  0,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       5, 10, 10, 10, 10, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0,
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -10,  5,  5,  5,  5,  5,  0,-10,
        0,  0,  5,  5,  5,  5,  0, -5,
       -5,  0,  5,  5,  5,  5,  0, -5,
      -10,  0,  5,  5,  5,  5,  0,-10,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    k: [
       20, 30, 10,  0,  0, 10, 30, 20,
       20, 20,  0,  0,  0,  0, 20, 20,
      -10,-20,-20,-20,-20,-20,-20,-10,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
    ],
  };

  function mirror(sq) {
    // Flip rank for the Black perspective lookup.
    return (7 - rankOf(sq)) * 8 + fileOf(sq);
  }

  // Absolute evaluation in centipawns, positive = good for White.
  function evaluateAbsolute(state) {
    let score = 0;
    const board = state.board;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (p === null) continue;
      const t = typeOf(p);
      const val = VALUE[t];
      if (colorOf(p) === WHITE) {
        score += val + PST[t][sq];
      } else {
        score -= val + PST[t][mirror(sq)];
      }
    }
    return score;
  }

  // Evaluation from the side-to-move perspective (negamax convention).
  function evaluate(state) {
    const abs = evaluateAbsolute(state);
    return state.turn === WHITE ? abs : -abs;
  }

  // MVV-LVA-ish ordering: try captures of valuable pieces by cheap pieces first.
  function orderMoves(moves) {
    return moves.slice().sort((a, b) => scoreForOrder(b) - scoreForOrder(a));
  }
  function scoreForOrder(m) {
    let s = 0;
    if (m.captured) s += 10 * VALUE[typeOf(m.captured)] - VALUE[typeOf(m.piece)];
    if (m.flag === "promo") s += VALUE[typeOf(m.promotion)];
    return s;
  }

  function negamax(state, depth, alpha, beta, ply) {
    const moves = Engine.generateLegalMoves(state);
    if (moves.length === 0) {
      // Checkmate (worse the sooner) or stalemate.
      if (Engine.inCheck(state, state.turn)) return -(MATE - ply);
      return 0;
    }
    if (depth === 0) return evaluate(state);
    let best = -Infinity;
    for (const m of orderMoves(moves)) {
      const undo = Engine.applyMove(state, m);
      const v = -negamax(state, depth - 1, -beta, -alpha, ply + 1);
      Engine.undoMove(state, undo);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Score of a single move from the mover's perspective.
  function scoreMove(state, move, depth) {
    const undo = Engine.applyMove(state, move);
    const v = -negamax(state, Math.max(0, depth - 1), -Infinity, Infinity, 1);
    Engine.undoMove(state, undo);
    return v;
  }

  // All legal root moves scored from the side-to-move perspective, best first.
  function analyzePosition(state, depth) {
    const moves = Engine.generateLegalMoves(state);
    const scored = moves.map((move) => ({ move, score: scoreMove(state, move, depth) }));
    scored.sort((a, b) => b.score - a.score);
    return {
      moves: scored,
      bestMove: scored.length ? scored[0].move : null,
      bestScore: scored.length ? scored[0].score : 0,
    };
  }

  // The strong reply (used for "show me a better idea" and for the opponent's
  // top play). Deterministic.
  function bestMove(state, depth) {
    return analyzePosition(state, depth).bestMove;
  }

  // ---- Opponent move selection at tunable strength ----------------------
  // difficulty: { depth, randomness (0..1), blunder (0..1) }
  //  - blunder: chance of ignoring analysis and playing a random legal move.
  //  - randomness: widens the pool of "acceptable" moves around the best score.
  function pickMove(state, difficulty, rng) {
    const random = rng || Math.random;
    const legal = Engine.generateLegalMoves(state);
    if (legal.length === 0) return null;

    const blunder = clamp01(difficulty.blunder ?? 0);
    if (blunder > 0 && random() < blunder) {
      return legal[Math.floor(random() * legal.length)];
    }

    const depth = Math.max(1, difficulty.depth ?? 1);
    const { moves } = analyzePosition(state, depth);
    if (moves.length === 0) return null;
    const best = moves[0].score;
    // Never *throw away* a mate-in-1 or hang into mate even when wandering:
    // if the best move mates, take it.
    if (best >= MATE - 10) return moves[0].move;

    const randomness = clamp01(difficulty.randomness ?? 0);
    const margin = randomness * 250; // centipawns of acceptable slack (0 = best-scoring only)
    const pool = moves.filter((m) => best - m.score <= margin);
    const chosen = pool[Math.floor(random() * pool.length)];
    return chosen.move;
  }

  // ---- Blunder analysis for the coach -----------------------------------
  // Compares the child's played move against the best available. Returns the
  // material the opponent can win right after the played move (the concrete,
  // child-legible risk) and whether it counts as a meaningful blunder.
  //
  // threshold is in centipawns of evaluation drop vs. the best move.
  function analyzeMove(state, playedMove, opts) {
    const options = opts || {};
    const depth = options.depth ?? 2;
    const threshold = options.threshold ?? 180;

    const analysis = analyzePosition(state, depth);
    const best = analysis.bestScore;
    const played = analysis.moves.find(
      (m) => m.move.from === playedMove.from && m.move.to === playedMove.to && samePromo(m.move, playedMove),
    );
    const playedScore = played ? played.score : scoreMove(state, playedMove, depth);
    const drop = best - playedScore;

    const threat = biggestThreatAfter(state, playedMove);

    // A meaningful blunder: the move loses real value versus the best, AND
    // either it hangs material or it walks into mate. This keeps checkpoints
    // for genuine mistakes rather than every imperfect move.
    const walksIntoMate = playedScore <= -(MATE - 50);
    const meaningful =
      (drop >= threshold && threat && threat.net >= 150) || walksIntoMate;

    return {
      meaningful: !!meaningful,
      drop,
      playedScore,
      bestScore: best,
      betterMove: analysis.bestMove,
      betterMoves: analysis.moves,
      threat,
      walksIntoMate,
    };
  }

  function samePromo(a, b) {
    const pa = a.flag === "promo" ? typeOf(a.promotion) : null;
    const pb = b.flag === "promo" ? typeOf(b.promotion) : null;
    return pa === pb;
  }

  // After `move`, what is the most material the opponent can win on their reply?
  // `net` accounts for an immediate recapture on the landing square. Returns
  // the mover's piece that is most in danger, or null.
  function biggestThreatAfter(state, move) {
    const moverColor = state.turn;
    const undo = Engine.applyMove(state, move);
    const board = state.board;
    const enemyMoves = Engine.generateLegalMoves(state); // opponent to move now
    let best = null;
    for (const em of enemyMoves) {
      if (!em.captured) continue;
      const capturedVal = VALUE[typeOf(em.captured)];
      if (capturedVal <= 0) continue;
      // Can the mover recapture on the landing square?
      const defended = Engine.isSquareAttacked(board, em.to, moverColor);
      const net = defended ? capturedVal - VALUE[typeOf(em.piece)] : capturedVal;
      if (!best || net > best.net) {
        best = {
          capturedType: typeOf(em.captured),
          capturedSquare: em.to,
          byType: typeOf(em.piece),
          defended,
          net,
        };
      }
    }
    Engine.undoMove(state, undo);
    return best;
  }

  function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  // Deterministic RNG (LCG) so tests and replays are reproducible.
  function createRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  const ChessAI = {
    MATE,
    VALUE,
    evaluateAbsolute,
    evaluate,
    negamax,
    scoreMove,
    analyzePosition,
    bestMove,
    pickMove,
    analyzeMove,
    biggestThreatAfter,
    createRng,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ChessAI;
  if (typeof root !== "undefined") root.ChessAI = ChessAI;
})(typeof globalThis !== "undefined" ? globalThis : this);
