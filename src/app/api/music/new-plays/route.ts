import { NextResponse } from "next/server";
import { guardNewPlaysRoute } from "@/lib/api-guards";
import {
  listNewPlays,
  normalizeNewPlayRow,
  upsertNewPlays,
  type NewPlayRow,
} from "@/lib/music-new-plays";

export const runtime = "nodejs";

/**
 * GET /api/music/new-plays?limit=100
 *
 * The mirrored "New plays" projection, newest first, each row joined with its
 * pending/failed queued actions. `syncedAt` is the newest push timestamp so
 * the page can say how fresh the mirror is.
 *
 * Gated like the other trusted-runtime surfaces: an authorized household
 * session or the fail-closed runtime token.
 */
export async function GET(request: Request) {
  const guard = await guardNewPlaysRoute(request, "list");
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);

  try {
    const { items, syncedAt } = await listNewPlays(Number.isFinite(limit) ? limit : 100);
    return NextResponse.json({ items, syncedAt });
  } catch (error) {
    return NextResponse.json(
      { items: [], syncedAt: null, error: error instanceof Error ? error.message : "New plays unavailable" },
      { status: 502 },
    );
  }
}

/**
 * PUT /api/music/new-plays
 * Body: { items: unknown[], syncedAt: string }
 *
 * Mirror push from `projects/sonos-music` (`new-plays-sync.js`). Every row is
 * normalized before it is stored; rows without identity are reported back by
 * index and skipped rather than failing the whole push. The app never
 * interprets the rows beyond what the page renders.
 */
export async function PUT(request: Request) {
  const guard = await guardNewPlaysRoute(request, "mirror-put");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { items, syncedAt } = body as { items?: unknown; syncedAt?: unknown };
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }
  if (typeof syncedAt !== "string" || !Number.isFinite(Date.parse(syncedAt))) {
    return NextResponse.json({ error: "syncedAt must be an ISO timestamp" }, { status: 400 });
  }

  const rows: NewPlayRow[] = [];
  const rejected: { index: number; error: string }[] = [];
  items.forEach((item, index) => {
    try {
      rows.push(normalizeNewPlayRow(item));
    } catch (error) {
      rejected.push({ index, error: error instanceof Error ? error.message : "Invalid row" });
    }
  });

  try {
    const upserted = await upsertNewPlays(rows, new Date(syncedAt).toISOString());
    return NextResponse.json({ ok: true, upserted, rejected });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to store new plays" },
      { status: 500 },
    );
  }
}
