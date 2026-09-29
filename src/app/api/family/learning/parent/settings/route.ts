import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isChildId } from "@/lib/family-assistant-turn";
import { NO_STORE, refuse, requireParentOwner } from "@/lib/family-learning-auth";
import { isKeyboardLayoutId } from "@/lib/family-learning-content";
import { readParentSettingsSnapshot, StaleErasureGenerationError, writeParentSettings, type SettingKey } from "@/lib/family-learning-db";

/**
 * GET /api/family/learning/parent/settings?child=…
 * PUT /api/family/learning/parent/settings
 *   `{ child, expectedErasureGeneration, keyboardLayout?, missionTitle?, missionHook?, languageVarietyEn?, languageVarietyEs? }`
 *   — each present field is written; `null` clears it. `expectedErasureGeneration`
 *   is the fence value the parent's view was loaded with (evidence or GET here);
 *   a request prepared before a deletion answers 409 `stale-after-deletion`.
 *
 * `keyboardLayout` is the parent's confirmation of the physical keyboard and
 * macOS input layout; positional typing drills stay unavailable until it is
 * set (family-assistant DESIGN §7.6).
 */

const FIELDS: Record<string, { key: SettingKey; max: number; validate?: (v: string) => boolean }> = {
  keyboardLayout: { key: "keyboard_layout", max: 20, validate: isKeyboardLayoutId },
  missionTitle: { key: "mission_title", max: 60 },
  missionHook: { key: "mission_hook", max: 160 },
  languageVarietyEn: { key: "language_variety_en", max: 40 },
  languageVarietyEs: { key: "language_variety_es", max: 40 },
};

export async function GET(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  const child = new URL(request.url).searchParams.get("child");
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  // Content and generation from one coherent snapshot (never an old value
  // labelled with a newer generation).
  const { settings, erasureGeneration } = await readParentSettingsSnapshot(await getDb(), child);
  return NextResponse.json({ child, settings, erasureGeneration }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const parent = await requireParentOwner();
  if (!parent.ok) return parent.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null) return refuse(400, "Body must be an object");
  const record = body as Record<string, unknown>;
  const child = record.child;
  if (!isChildId(child)) return refuse(400, "child must be santiago or isabel");
  const changes: { key: SettingKey; value: string | null }[] = [];
  for (const [field, spec] of Object.entries(FIELDS)) {
    if (!(field in record)) continue;
    const value = record[field];
    if (value === null || value === "") {
      changes.push({ key: spec.key, value: null });
      continue;
    }
    if (typeof value !== "string") return refuse(400, `${field} must be a string or null`);
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > spec.max) return refuse(400, `${field} is empty or too long`);
    if (spec.validate && !spec.validate(trimmed)) return refuse(400, `${field} has an unknown value`);
    changes.push({ key: spec.key, value: trimmed });
  }
  if (changes.length === 0) return refuse(400, "No settings given");
  const expected = record.expectedErasureGeneration;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) return refuse(400, "expectedErasureGeneration is required");
  // Settings and their audit row commit together (or not at all), behind the
  // erasure fence, so neither a concurrent nor an earlier-prepared request can
  // restore deleted content.
  const db = await getDb();
  try {
    const settings = await writeParentSettings(db, child, changes, parent.adminEmail, expected);
    return NextResponse.json({ child, settings, erasureGeneration: expected }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof StaleErasureGenerationError) {
      return refuse(409, "These settings were prepared before the records were deleted; reload and decide again", { code: "stale-after-deletion", erasureGeneration: error.current });
    }
    throw error;
  }
}
