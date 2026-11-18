import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireOwnerOrReleaseKey, requireParentOwner } from "@/lib/family-learning-auth";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { parseNarrationPost, recordAudition } from "@/lib/family-narration-audition";
import { budgetSpent, isPublicSafeScript, narrationBudget, narrationReadiness, prepareNarration } from "@/lib/family-narration-store";

/**
 * Owner only (Isabel Visit 2, I2-06): the prerecorded German narration.
 *
 * GET  — readiness, read-only: is a narration voice configured, is the store/provider key present (names only, never values),
 *        how many catalogued lines and characters exist and how many are still missing. No provider call, no write.
 * POST `{ confirm: "prepare-narration", maxCharacters }` — PAID, explicit: records the missing catalogued lines once, with the
 *        configured voice, never more than `maxCharacters` characters in this call; existing clips are skipped; the first
 *        upstream failure stops it (no retries). Only reviewed catalogue text is sent — never a child's answer or record.
 *        Needs the owner budget `FAMILY_NARRATION_BUDGET`; every request counts against it across calls (failed ones too).
 * POST `{ confirm: "record-audition", maxCharacters }` — PAID, explicit, owner/release key (Nov 18): records the FIXED voice
 *        audition (`family-narration-audition.ts`: 4 compiled voices × 2 compiled lines) under its own store prefix, with the
 *        same key, lock and budget ledger; existing clips are skipped. Returns label + line + base64 MP3 per clip, never a key.
 */
export async function GET() {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  const catalog = servedNarrationCatalog();
  const { missingLines, ...readiness } = await narrationReadiness(catalog);
  const missing = new Set(missingLines);
  // The owner's spend budget for recordings (approval id and limit are not secret): what is already reserved under it.
  const b = narrationBudget(process.env);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const spent = b && token ? await budgetSpent(b.approval, token) : null;
  const budget = b ? { approval: b.approval, limit: b.characters, spent: spent?.characters ?? null, requests: spent?.requests ?? null } : null;
  // The reviewed catalogue itself (fixed scripts, no child data) so the owner can audition every line on the real device.
  // `sources`: a line spoken as a reviewed variant names the displayed line(s) it stands for.
  return NextResponse.json({ readiness, budget, lines: catalog.map((l) => ({ id: l.id, slot: l.slot ?? null, child: l.child ?? null, text: l.text, where: l.where ?? [], sources: l.sources ?? [], recorded: !missing.has(l), personal: !isPublicSafeScript(l.text) })) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const access = await requireOwnerOrReleaseKey(request, "narration-recording");
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  const parsed = parseNarrationPost(body);
  if (!parsed.ok) return refuse(400, parsed.error);
  const { mode, maxCharacters } = parsed.value;
  const status = { "not-configured": 503, "no-budget": 503, "budget-unavailable": 503, "upstream-failed": 502, "store-failed": 502, busy: 409 } as Record<string, number>;
  if (mode === "record-audition") {
    // The fixed voice audition (4 voices × 2 lines, compiled in): nothing from the request but the cap reaches it.
    const audition = await recordAudition(maxCharacters);
    console.info(`[family/learning/parent/narration] audition by ${access.via}: ${audition.status}, recorded ${audition.recorded}, existing ${audition.existing}, characters ${audition.charactersSent}, budget ${audition.budget ? `${audition.budget.spent}/${audition.budget.limit} (${audition.budget.requests} requests)` : "none"}`);
    return NextResponse.json({ audition }, { status: status[audition.status] ?? 200, headers: NO_STORE });
  }
  const result = await prepareNarration(servedNarrationCatalog(), maxCharacters);
  // Counts only: no text, key or voice id in the log or the response.
  console.info(`[family/learning/parent/narration] prepare by ${access.via}: ${result.status}, recorded ${result.recorded}, characters ${result.charactersSent}, remaining ${result.remaining}, personal lines skipped ${result.personalSkipped}, budget ${result.budget ? `${result.budget.spent}/${result.budget.limit} (${result.budget.requests} requests)` : "none"}`);
  return NextResponse.json({ result }, { status: status[result.status] ?? 200, headers: NO_STORE });
}
