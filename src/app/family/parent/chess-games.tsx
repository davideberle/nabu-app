"use client";

// ---------------------------------------------------------------------------------------------------------------------
// Parent tools · Chess games (Nov 22, 2026). Per child: the current chess level and opponent (from the latest profile the
// coach reported), the last games (date, opponent, result and how it ended, moves, minutes, tips and what she chose, level
// change) and the games imported once from the browser profile. English, read-only, owner session only (the page gates).
// ---------------------------------------------------------------------------------------------------------------------

import {
  CHESS_OPPONENT_NAMES,
  CHESS_REASON_LABELS,
  chessNudgeLabel,
  chessResultLabel,
  type ChessChildView,
  type ChessHistoryEntry,
} from "@/lib/family-chess-records";
import { CHILD_IDS, type ChildId } from "@/lib/family-assistant-turn";

const card = "flex flex-col gap-3 rounded-3xl border border-primary bg-primary p-5";

export function chessWhen(iso: string | null): string {
  if (!iso) return "date unknown";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function minutes(seconds: number): string {
  if (seconds <= 0) return "0 min";
  return seconds < 60 ? "<1 min" : `${Math.round(seconds / 60)} min`;
}

function levelChange(from: number, to: number): string {
  return from === to ? `level ${to}` : `level ${from} → ${to}`;
}

function ImportedRow({ h }: { h: ChessHistoryEntry }) {
  const opp = h.opponentId ? CHESS_OPPONENT_NAMES[h.opponentId] : "unknown opponent";
  const knowsChoices = typeof h.nudges === "number";
  return (
    <li className="text-sm">
      <span className="font-semibold">{chessWhen(h.date)}</span> <span className="text-tertiary">· vs {opp} · {chessResultLabel(h.result, h.endReason ?? null, null, h.opponentId)} · {h.movesPlayed ?? "?"} moves · </span>
      <span className="text-tertiary">
        {knowsChoices
          ? chessNudgeLabel(h.nudges ?? 0, h.followed ?? 0, h.kept ?? 0)
          : `${h.blunders ?? 0} tip${h.blunders === 1 ? "" : "s"} shown, «better idea» taken ${h.hintsTaken ?? 0}× (old record: which move she then played is not known)`}
      </span>
    </li>
  );
}

export function ChessGamesSection({ views }: { views: Record<ChildId, ChessChildView> | null | undefined }) {
  return (
    <section aria-label="Chess games" className={card} data-chess-games>
      <h2 className="text-lg font-semibold">Chess games</h2>
      {views === undefined ? <p className="text-sm text-tertiary">…</p> : views === null ? <p className="text-sm text-tertiary">The chess records could not be read right now.</p> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {CHILD_IDS.map((child) => {
            const v = views[child];
            return (
              <div key={child} className="flex flex-col gap-2 rounded-2xl border border-secondary bg-secondary px-4 py-3" data-chess-games-child={child} data-chess-level={v?.current?.level ?? ""}>
                <p className="text-base font-semibold">{child === "isabel" ? "Isabel" : "Santiago"}</p>
                {!v?.current ? (
                  <p className="text-sm text-tertiary">No chess game reported yet. Games are saved here from Nov 22, 2026 on; the browser&rsquo;s earlier games arrive the next time chess is opened.</p>
                ) : (
                  <p className="text-sm">
                    Level {v.current.level} · {v.current.label} · plays {v.current.opponentName}
                    <span className="text-tertiary"> · {v.current.gamesPlayed} games: {v.current.wins} won, {v.current.losses} lost, {v.current.draws} drawn, {v.current.unfinishedGames} unfinished</span>
                  </p>
                )}
                {v && v.games.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {v.games.map((g) => (
                      <li key={g.gameId} className="text-sm" data-chess-game={g.gameId}>
                        <span className="font-semibold">{chessWhen(g.endedAt ?? g.startedAt ?? g.updatedAt)}</span>
                        <span className="text-tertiary"> · vs {CHESS_OPPONENT_NAMES[g.opponentId]}</span>
                        <br />
                        {chessResultLabel(g.result, g.endReason, g.judged, g.opponentId)}
                        <span className="text-tertiary"> · {g.movesPlayed} moves · {minutes(g.activeSeconds)} · {chessNudgeLabel(g.nudgesShown, g.nudgesFollowed, g.nudgesKept)} · {levelChange(g.levelBefore, g.levelAfter)} ({CHESS_REASON_LABELS[g.levelReason] ?? g.levelReason})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {v?.imported && v.imported.history.length > 0 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-tertiary">Earlier games from the browser ({v.imported.history.length}, imported {chessWhen(v.imported.receivedAt)})</summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {v.imported.history.map((h, i) => (
                        <ImportedRow key={i} h={h} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-tertiary">
        The level lives in the chess game on the device. From Nov 22: a tip she follows is not a mistake; only flagged moves she keeps count. Pip, Sir Waffles and Bongo give up when she is 9 points ahead after 10 moves (counts as a win). A game that stops early (time ran out, new game, page left) counts as a win if she was 5 or more points ahead, otherwise it changes nothing. Points: pawn 1, knight and bishop 3, rook 5, queen 9.
      </p>
    </section>
  );
}
