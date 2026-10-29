import { NextResponse } from "next/server";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { servedNarrationCatalog } from "@/lib/family-narration-catalog-server";
import { MAX_PREPARE_CHARACTERS, narrationReadiness, prepareNarration } from "@/lib/family-narration-store";

/**
 * Owner only (Isabel Visit 2, I2-06): the prerecorded German narration.
 *
 * GET  — readiness, read-only: is a narration voice configured, is the store/provider key present (names only, never values),
 *        how many catalogued lines and characters exist and how many are still missing. No provider call, no write.
 * POST `{ confirm: "prepare-narration", maxCharacters }` — PAID, explicit: records the missing catalogued lines once, with the
 *        configured voice, never more than `maxCharacters` characters in this call; existing clips are skipped; the first
 *        upstream failure stops it (no retries). Only reviewed catalogue text is sent — never a child's answer or record.
 */
export async function GET() {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  const catalog = servedNarrationCatalog();
  const { missingLines, ...readiness } = await narrationReadiness(catalog);
  const missing = new Set(missingLines.map((l) => l.id));
  // The reviewed catalogue itself (fixed scripts, no child data) so the owner can audition every line on the real device.
  return NextResponse.json({ readiness, lines: catalog.map((l) => ({ id: l.id, text: l.text, where: l.where ?? [], recorded: !missing.has(l.id) })) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "confirm" && k !== "maxCharacters")) return refuse(400, "Body accepts exactly confirm and maxCharacters (no text: only the reviewed catalogue is ever recorded)");
  const { confirm, maxCharacters } = body as Record<string, unknown>;
  if (confirm !== "prepare-narration") return refuse(400, "confirm must be \"prepare-narration\"");
  if (typeof maxCharacters !== "number" || !Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > MAX_PREPARE_CHARACTERS) return refuse(400, `maxCharacters must be an integer between 1 and ${MAX_PREPARE_CHARACTERS}`);
  const result = await prepareNarration(servedNarrationCatalog(), maxCharacters);
  // Counts only: no text, key or voice id in the log or the response.
  console.info(`[family/learning/parent/narration] prepare by owner: ${result.status}, recorded ${result.recorded}, characters ${result.charactersSent}, remaining ${result.remaining}`);
  return NextResponse.json({ result }, { status: result.status === "not-configured" ? 503 : result.status === "upstream-failed" ? 502 : result.status === "busy" ? 409 : result.status === "refused-private" ? 422 : 200, headers: NO_STORE });
}
