// ===========================================================================
// chess-engine.js — complete, rules-correct chess core.
//
// Pure logic: no DOM, no timers, no storage. Loadable both as a browser
// <script> (attaches window.ChessEngine) and as a CommonJS module (Node tests
// require() it). The single source of truth for legality — the UI, AI and
// coach never re-derive rules.
//
// Board representation: mailbox array of 64, index = rank*8 + file, with
// rank 0 = rank 1 and file 0 = file a (so a1 = 0, h1 = 7, a8 = 56, h8 = 63).
// Pieces: uppercase = White (P N B R Q K), lowercase = Black, null = empty.
//
// Move generation is pseudo-legal + make/unmake king-safety filtering. This is
// the representation that perft (the move-generation correctness proof) is run
// against, so castling, en passant, promotion, check, checkmate and stalemate
// are all decided here rather than approximated in the UI.
// ===========================================================================

(function (root) {
  "use strict";

  const WHITE = "w";
  const BLACK = "b";

  const isWhitePiece = (p) => p !== null && p >= "A" && p <= "Z";
  const isBlackPiece = (p) => p !== null && p >= "a" && p <= "z";
  const colorOf = (p) => (p === null ? null : isWhitePiece(p) ? WHITE : BLACK);
  const typeOf = (p) => (p === null ? null : p.toLowerCase());

  const fileOf = (sq) => sq & 7;
  const rankOf = (sq) => sq >> 3;
  const squareIndex = (file, rank) => rank * 8 + file;
  const onBoard = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8;

  const FILES = "abcdefgh";
  function squareName(sq) {
    return FILES[fileOf(sq)] + (rankOf(sq) + 1);
  }
  function squareFromName(name) {
    if (typeof name !== "string" || name.length < 2) return -1;
    const file = FILES.indexOf(name[0]);
    const rank = parseInt(name[1], 10) - 1;
    if (file < 0 || Number.isNaN(rank) || rank < 0 || rank > 7) return -1;
    return squareIndex(file, rank);
  }

  // Knight and king relative moves as (df, dr) pairs.
  const KNIGHT_DELTAS = [
    [1, 2], [2, 1], [2, -1], [1, -2],
    [-1, -2], [-2, -1], [-2, 1], [-1, 2],
  ];
  const KING_DELTAS = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // ---- FEN --------------------------------------------------------------
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  function parseFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    const [placement, active, castling, ep, half, full] = parts;
    const board = new Array(64).fill(null);
    const rows = placement.split("/");
    if (rows.length !== 8) throw new Error("Bad FEN placement: " + placement);
    // FEN lists rank 8 first.
    for (let r = 0; r < 8; r++) {
      const rank = 7 - r;
      let file = 0;
      for (const ch of rows[r]) {
        if (ch >= "1" && ch <= "8") {
          file += parseInt(ch, 10);
        } else {
          board[squareIndex(file, rank)] = ch;
          file += 1;
        }
      }
      if (file !== 8) throw new Error("Bad FEN rank width: " + rows[r]);
    }
    return {
      board,
      turn: active === BLACK ? BLACK : WHITE,
      castling: {
        K: castling.includes("K"),
        Q: castling.includes("Q"),
        k: castling.includes("k"),
        q: castling.includes("q"),
      },
      ep: ep && ep !== "-" ? squareFromName(ep) : -1,
      halfmove: half ? parseInt(half, 10) : 0,
      fullmove: full ? parseInt(full, 10) : 1,
    };
  }

  function toFEN(state) {
    let placement = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = state.board[squareIndex(f, r)];
        if (p === null) {
          empty += 1;
        } else {
          if (empty) {
            placement += empty;
            empty = 0;
          }
          placement += p;
        }
      }
      if (empty) placement += empty;
      if (r > 0) placement += "/";
    }
    let castling = "";
    if (state.castling.K) castling += "K";
    if (state.castling.Q) castling += "Q";
    if (state.castling.k) castling += "k";
    if (state.castling.q) castling += "q";
    if (!castling) castling = "-";
    const ep = state.ep >= 0 ? squareName(state.ep) : "-";
    return `${placement} ${state.turn} ${castling} ${ep} ${state.halfmove} ${state.fullmove}`;
  }

  // ---- State construction ----------------------------------------------
  function cloneState(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      castling: { ...state.castling },
      ep: state.ep,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
    };
  }

  function initialState(fen) {
    return parseFEN(fen || START_FEN);
  }

  // ---- Attack detection -------------------------------------------------
  // Is `sq` attacked by a piece of color `by`? Used for check and for
  // castling legality (king may not pass through an attacked square).
  function isSquareAttacked(board, sq, by) {
    const f = fileOf(sq);
    const r = rankOf(sq);

    // Pawns. A white pawn on (f-1|f+1, r-1) attacks (f,r); black from r+1.
    if (by === WHITE) {
      for (const df of [-1, 1]) {
        const af = f + df;
        const ar = r - 1;
        if (onBoard(af, ar) && board[squareIndex(af, ar)] === "P") return true;
      }
    } else {
      for (const df of [-1, 1]) {
        const af = f + df;
        const ar = r + 1;
        if (onBoard(af, ar) && board[squareIndex(af, ar)] === "p") return true;
      }
    }

    // Knights.
    const knight = by === WHITE ? "N" : "n";
    for (const [df, dr] of KNIGHT_DELTAS) {
      const af = f + df;
      const ar = r + dr;
      if (onBoard(af, ar) && board[squareIndex(af, ar)] === knight) return true;
    }

    // King (adjacency).
    const king = by === WHITE ? "K" : "k";
    for (const [df, dr] of KING_DELTAS) {
      const af = f + df;
      const ar = r + dr;
      if (onBoard(af, ar) && board[squareIndex(af, ar)] === king) return true;
    }

    // Bishops / queens (diagonals).
    const bishop = by === WHITE ? "B" : "b";
    const queen = by === WHITE ? "Q" : "q";
    for (const [df, dr] of BISHOP_DIRS) {
      let af = f + df;
      let ar = r + dr;
      while (onBoard(af, ar)) {
        const p = board[squareIndex(af, ar)];
        if (p !== null) {
          if (p === bishop || p === queen) return true;
          break;
        }
        af += df;
        ar += dr;
      }
    }

    // Rooks / queens (orthogonals).
    const rook = by === WHITE ? "R" : "r";
    for (const [df, dr] of ROOK_DIRS) {
      let af = f + df;
      let ar = r + dr;
      while (onBoard(af, ar)) {
        const p = board[squareIndex(af, ar)];
        if (p !== null) {
          if (p === rook || p === queen) return true;
          break;
        }
        af += df;
        ar += dr;
      }
    }

    return false;
  }

  function findKing(board, color) {
    const king = color === WHITE ? "K" : "k";
    for (let sq = 0; sq < 64; sq++) {
      if (board[sq] === king) return sq;
    }
    return -1;
  }

  function inCheck(state, color) {
    const kingSq = findKing(state.board, color);
    if (kingSq < 0) return false;
    return isSquareAttacked(state.board, kingSq, color === WHITE ? BLACK : WHITE);
  }

  // ---- Pseudo-legal move generation ------------------------------------
  // Each move: { from, to, piece, captured, promotion, flag }
  // flag ∈ { "normal", "double", "ep", "castleK", "castleQ", "promo" }
  function makeMoveObj(from, to, piece, captured, promotion, flag) {
    return { from, to, piece, captured: captured ?? null, promotion: promotion ?? null, flag: flag || "normal" };
  }

  function generatePseudoMoves(state) {
    const { board, turn } = state;
    const moves = [];
    const forward = turn === WHITE ? 1 : -1;
    const startRank = turn === WHITE ? 1 : 6;
    const promoRank = turn === WHITE ? 7 : 0;
    const own = turn === WHITE ? isWhitePiece : isBlackPiece;
    const enemy = turn === WHITE ? isBlackPiece : isWhitePiece;

    for (let sq = 0; sq < 64; sq++) {
      const piece = board[sq];
      if (piece === null || !own(piece)) continue;
      const f = fileOf(sq);
      const r = rankOf(sq);
      const t = typeOf(piece);

      if (t === "p") {
        // Single push.
        const oneR = r + forward;
        if (onBoard(f, oneR)) {
          const oneSq = squareIndex(f, oneR);
          if (board[oneSq] === null) {
            if (oneR === promoRank) {
              for (const promo of ["q", "r", "b", "n"]) {
                moves.push(makeMoveObj(sq, oneSq, piece, null, sidePromo(turn, promo), "promo"));
              }
            } else {
              moves.push(makeMoveObj(sq, oneSq, piece, null, null, "normal"));
            }
            // Double push.
            if (r === startRank) {
              const twoR = r + forward * 2;
              const twoSq = squareIndex(f, twoR);
              if (board[twoSq] === null) {
                moves.push(makeMoveObj(sq, twoSq, piece, null, null, "double"));
              }
            }
          }
        }
        // Captures (incl. promotion captures) and en passant.
        for (const df of [-1, 1]) {
          const cf = f + df;
          const cr = r + forward;
          if (!onBoard(cf, cr)) continue;
          const cSq = squareIndex(cf, cr);
          const target = board[cSq];
          if (target !== null && enemy(target)) {
            if (cr === promoRank) {
              for (const promo of ["q", "r", "b", "n"]) {
                moves.push(makeMoveObj(sq, cSq, piece, target, sidePromo(turn, promo), "promo"));
              }
            } else {
              moves.push(makeMoveObj(sq, cSq, piece, target, null, "normal"));
            }
          } else if (cSq === state.ep && state.ep >= 0) {
            // En passant: captured pawn sits behind the target square.
            const capSq = squareIndex(cf, r);
            moves.push(makeMoveObj(sq, cSq, piece, board[capSq], null, "ep"));
          }
        }
      } else if (t === "n") {
        for (const [df, dr] of KNIGHT_DELTAS) {
          const nf = f + df;
          const nr = r + dr;
          if (!onBoard(nf, nr)) continue;
          const nSq = squareIndex(nf, nr);
          const target = board[nSq];
          if (target === null || enemy(target)) {
            moves.push(makeMoveObj(sq, nSq, piece, target, null, "normal"));
          }
        }
      } else if (t === "b" || t === "r" || t === "q") {
        const dirs =
          t === "b" ? BISHOP_DIRS : t === "r" ? ROOK_DIRS : BISHOP_DIRS.concat(ROOK_DIRS);
        for (const [df, dr] of dirs) {
          let nf = f + df;
          let nr = r + dr;
          while (onBoard(nf, nr)) {
            const nSq = squareIndex(nf, nr);
            const target = board[nSq];
            if (target === null) {
              moves.push(makeMoveObj(sq, nSq, piece, null, null, "normal"));
            } else {
              if (enemy(target)) moves.push(makeMoveObj(sq, nSq, piece, target, null, "normal"));
              break;
            }
            nf += df;
            nr += dr;
          }
        }
      } else if (t === "k") {
        for (const [df, dr] of KING_DELTAS) {
          const nf = f + df;
          const nr = r + dr;
          if (!onBoard(nf, nr)) continue;
          const nSq = squareIndex(nf, nr);
          const target = board[nSq];
          if (target === null || enemy(target)) {
            moves.push(makeMoveObj(sq, nSq, piece, target, null, "normal"));
          }
        }
        // Castling. Squares must be empty; king not in check, and does not
        // pass through or land on an attacked square. Rook presence is implied
        // by the castling right (rights are cleared when a rook moves/is taken).
        const enemyColor = turn === WHITE ? BLACK : WHITE;
        if (turn === WHITE && r === 0 && f === 4) {
          if (
            state.castling.K &&
            board[squareIndex(5, 0)] === null &&
            board[squareIndex(6, 0)] === null &&
            !isSquareAttacked(board, squareIndex(4, 0), enemyColor) &&
            !isSquareAttacked(board, squareIndex(5, 0), enemyColor) &&
            !isSquareAttacked(board, squareIndex(6, 0), enemyColor)
          ) {
            moves.push(makeMoveObj(sq, squareIndex(6, 0), piece, null, null, "castleK"));
          }
          if (
            state.castling.Q &&
            board[squareIndex(3, 0)] === null &&
            board[squareIndex(2, 0)] === null &&
            board[squareIndex(1, 0)] === null &&
            !isSquareAttacked(board, squareIndex(4, 0), enemyColor) &&
            !isSquareAttacked(board, squareIndex(3, 0), enemyColor) &&
            !isSquareAttacked(board, squareIndex(2, 0), enemyColor)
          ) {
            moves.push(makeMoveObj(sq, squareIndex(2, 0), piece, null, null, "castleQ"));
          }
        } else if (turn === BLACK && r === 7 && f === 4) {
          if (
            state.castling.k &&
            board[squareIndex(5, 7)] === null &&
            board[squareIndex(6, 7)] === null &&
            !isSquareAttacked(board, squareIndex(4, 7), enemyColor) &&
            !isSquareAttacked(board, squareIndex(5, 7), enemyColor) &&
            !isSquareAttacked(board, squareIndex(6, 7), enemyColor)
          ) {
            moves.push(makeMoveObj(sq, squareIndex(6, 7), piece, null, null, "castleK"));
          }
          if (
            state.castling.q &&
            board[squareIndex(3, 7)] === null &&
            board[squareIndex(2, 7)] === null &&
            board[squareIndex(1, 7)] === null &&
            !isSquareAttacked(board, squareIndex(4, 7), enemyColor) &&
            !isSquareAttacked(board, squareIndex(3, 7), enemyColor) &&
            !isSquareAttacked(board, squareIndex(2, 7), enemyColor)
          ) {
            moves.push(makeMoveObj(sq, squareIndex(2, 7), piece, null, null, "castleQ"));
          }
        }
      }
    }
    return moves;
  }

  // Promotion piece with correct side casing.
  function sidePromo(turn, promoLower) {
    return turn === WHITE ? promoLower.toUpperCase() : promoLower;
  }

  // ---- Make / unmake ----------------------------------------------------
  // applyMove mutates and returns an undo record; undoMove reverses it. Used
  // both by legality filtering and by the search in chess-ai.js.
  function applyMove(state, move) {
    const undo = {
      move,
      captured: move.captured,
      castling: { ...state.castling },
      ep: state.ep,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
      turn: state.turn,
      // For en passant we also remember the captured pawn's square.
      epCaptureSq: -1,
      // For castling we remember the rook move.
      rookFrom: -1,
      rookTo: -1,
      rookPiece: null,
    };

    const board = state.board;
    const piece = move.piece;
    const movingColor = state.turn;

    board[move.from] = null;

    if (move.flag === "ep") {
      const capRank = rankOf(move.from);
      const capSq = squareIndex(fileOf(move.to), capRank);
      undo.epCaptureSq = capSq;
      undo.captured = board[capSq];
      board[capSq] = null;
      board[move.to] = piece;
    } else if (move.flag === "castleK") {
      board[move.to] = piece;
      const rank = rankOf(move.from);
      const rookFrom = squareIndex(7, rank);
      const rookTo = squareIndex(5, rank);
      undo.rookFrom = rookFrom;
      undo.rookTo = rookTo;
      undo.rookPiece = board[rookFrom];
      board[rookTo] = board[rookFrom];
      board[rookFrom] = null;
    } else if (move.flag === "castleQ") {
      board[move.to] = piece;
      const rank = rankOf(move.from);
      const rookFrom = squareIndex(0, rank);
      const rookTo = squareIndex(3, rank);
      undo.rookFrom = rookFrom;
      undo.rookTo = rookTo;
      undo.rookPiece = board[rookFrom];
      board[rookTo] = board[rookFrom];
      board[rookFrom] = null;
    } else if (move.flag === "promo") {
      board[move.to] = move.promotion;
    } else {
      board[move.to] = piece;
    }

    // Update castling rights.
    const c = state.castling;
    // King moved.
    if (typeOf(piece) === "k") {
      if (movingColor === WHITE) {
        c.K = false;
        c.Q = false;
      } else {
        c.k = false;
        c.q = false;
      }
    }
    // Rook moved from its home square.
    if (move.from === squareIndex(0, 0)) c.Q = false;
    if (move.from === squareIndex(7, 0)) c.K = false;
    if (move.from === squareIndex(0, 7)) c.q = false;
    if (move.from === squareIndex(7, 7)) c.k = false;
    // Rook captured on its home square (destination of the move, or ep square
    // can never be a rook home, so only `to` matters).
    if (move.to === squareIndex(0, 0)) c.Q = false;
    if (move.to === squareIndex(7, 0)) c.K = false;
    if (move.to === squareIndex(0, 7)) c.q = false;
    if (move.to === squareIndex(7, 7)) c.k = false;

    // En passant target: set only on a double pawn push.
    if (move.flag === "double") {
      state.ep = squareIndex(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2);
    } else {
      state.ep = -1;
    }

    // Halfmove clock.
    if (typeOf(piece) === "p" || undo.captured !== null) {
      state.halfmove = 0;
    } else {
      state.halfmove += 1;
    }
    if (movingColor === BLACK) state.fullmove += 1;

    state.turn = movingColor === WHITE ? BLACK : WHITE;
    return undo;
  }

  function undoMove(state, undo) {
    const board = state.board;
    const move = undo.move;
    state.turn = undo.turn;
    state.castling = undo.castling;
    state.ep = undo.ep;
    state.halfmove = undo.halfmove;
    state.fullmove = undo.fullmove;

    // Restore moving piece to origin.
    board[move.from] = move.piece;

    if (move.flag === "ep") {
      board[move.to] = null;
      board[undo.epCaptureSq] = undo.captured;
    } else if (move.flag === "castleK" || move.flag === "castleQ") {
      board[move.to] = null;
      board[undo.rookFrom] = undo.rookPiece;
      board[undo.rookTo] = null;
    } else {
      board[move.to] = undo.captured; // null if it was a quiet move
    }
  }

  // ---- Legal move generation -------------------------------------------
  function generateLegalMoves(state) {
    const pseudo = generatePseudoMoves(state);
    const legal = [];
    const movingColor = state.turn;
    for (const move of pseudo) {
      const undo = applyMove(state, move);
      if (!isSquareAttacked(state.board, findKing(state.board, movingColor), state.turn)) {
        legal.push(move);
      }
      undoMove(state, undo);
    }
    return legal;
  }

  // ---- Terminal state ---------------------------------------------------
  function status(state) {
    const legal = generateLegalMoves(state);
    const check = inCheck(state, state.turn);
    if (legal.length === 0) {
      if (check) return { over: true, result: "checkmate", winner: state.turn === WHITE ? BLACK : WHITE };
      return { over: true, result: "stalemate", winner: null };
    }
    if (state.halfmove >= 100) return { over: true, result: "fifty-move", winner: null };
    return { over: false, result: null, winner: null, check };
  }

  // ---- Perft (move-generation correctness) ------------------------------
  function perft(state, depth) {
    if (depth === 0) return 1;
    const moves = generateLegalMoves(state);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const move of moves) {
      const undo = applyMove(state, move);
      nodes += perft(state, depth - 1);
      undoMove(state, undo);
    }
    return nodes;
  }

  // Convenience: find a legal move matching from/to (+ optional promotion
  // type char, lowercase). Returns the move object or null.
  function findMove(state, from, to, promoType) {
    const legal = generateLegalMoves(state);
    for (const m of legal) {
      if (m.from === from && m.to === to) {
        if (m.flag === "promo") {
          if (promoType && typeOf(m.promotion) === promoType) return m;
        } else {
          return m;
        }
      }
    }
    return null;
  }

  const ChessEngine = {
    WHITE,
    BLACK,
    START_FEN,
    isWhitePiece,
    isBlackPiece,
    colorOf,
    typeOf,
    fileOf,
    rankOf,
    squareIndex,
    squareName,
    squareFromName,
    parseFEN,
    toFEN,
    cloneState,
    initialState,
    isSquareAttacked,
    findKing,
    inCheck,
    generatePseudoMoves,
    generateLegalMoves,
    applyMove,
    undoMove,
    status,
    perft,
    findMove,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ChessEngine;
  if (typeof root !== "undefined") root.ChessEngine = ChessEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
