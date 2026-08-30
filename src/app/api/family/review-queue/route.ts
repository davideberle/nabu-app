import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import {
  extractBearerToken,
  getTrustedRuntimeToken,
  tokensMatch,
} from "@/lib/runtime-auth";
import { getReviewQueueCompletions, getBoardConfig, resolveRoutines } from "@/lib/family-db";
import { buildReviewQueueSnapshot, isReviewQueueStatus } from "@/lib/family-review-queue";
import { familyMembers, dayLabels } from "@/data/family-routines";

/**
 * GET /api/family/review-queue
 *
 * The canonical Family parent-review queue (Family DESIGN.md Phase R7,
 * projects/family/REVIEW-QUEUE.md): the ordered, numbered projection of every
 * completion awaiting review, across all weeks, with a deterministic
 * `snapshotId`. This is the one read contract behind the app's parent
 * controls, ad-hoc Nabu review, and the morning briefing.
 *
 * Read-only, and deliberately narrow about who may read it:
 *  - the admin household session (parent controls in the app), or
 *  - the fail-closed trusted-runtime bearer token (the local briefing/Nabu
 *    runtime — read-only here; review mutations remain session-admin-only).
 * A signed-in non-admin session (the shared-iPad child account) is refused:
 * the queue spans both children and exists for parents.
 *
 * Consumers act on items by identity (`week`, `personId`, `routineId`, `day`)
 * plus `expectedStatus` via PATCH /api/family/completions — never by bare
 * number — so a stale numbered reply fails closed instead of mutating a
 * different submission.
 */
export async function GET(request: Request) {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  const configured = getTrustedRuntimeToken();
  const viaRuntimeToken = Boolean(configured && tokensMatch(bearer, configured));

  if (!viaRuntimeToken) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const [rows, config] = await Promise.all([
    getReviewQueueCompletions(),
    getBoardConfig(),
  ]);
  const routines = resolveRoutines(config);
  const snapshot = buildReviewQueueSnapshot(
    rows.flatMap((row) =>
      isReviewQueueStatus(row.status)
        ? [
            {
              week: row.week,
              personId: row.personId,
              routineId: row.routineId,
              day: row.day,
              status: row.status,
              ...(row.note ? { note: row.note } : {}),
              ...(row.normalizedSummary
                ? { normalizedSummary: row.normalizedSummary }
                : {}),
              ...(row.challenge ? { challenge: row.challenge } : {}),
              ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
            },
          ]
        : [],
    ),
  );

  const items = snapshot.items.map((item) => {
    const routine = routines.find((r) => r.id === item.routineId);
    const person = familyMembers.find((p) => p.id === item.personId);
    return {
      ...item,
      childName: person?.displayName ?? item.personId,
      activity: routine?.title ?? item.routineId,
      icon: routine?.icon ?? "",
      dayLabel: dayLabels[item.day] ?? String(item.day),
    };
  });

  return NextResponse.json(
    {
      snapshotId: snapshot.snapshotId,
      generatedAt: new Date().toISOString(),
      count: items.length,
      items,
    },
    {
      headers: {
        "Cache-Control": "no-store, private, max-age=0, must-revalidate",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
