/**
 * Kitchen-owned reviewed planner evidence rule (Kitchen DESIGN.md §4.1,
 * "Reviewed planner evidence"). CANONICAL SOURCE: projects/kitchen/planner-evidence/
 * (staged under the audit's implementation/revision-2/kitchen-candidate/ until
 * adopted). Companion App carries a verbatim, parity-checked projection at
 * src/lib/kitchen/planner-evidence-rule.ts (scripts/sync-planner-evidence.mjs
 * --check fails the build on any difference) and binds it to its mirrored
 * ledger in src/lib/planner-evidence.ts. Edit the rule HERE, never in the app.
 *
 * Self-contained on purpose: no imports, so the same bytes type-check and run
 * in the Kitchen project, in `node --test`, in the build-time check and in the
 * Next.js runtime. SHA-256 is implemented here so no `node:crypto` reaches
 * shared app libraries.
 *
 * Trust model — an entry activates only when ALL of these hold:
 *   - the record's stable id matches;
 *   - the full projected record digest matches the attested digest
 *     (`canonicalRecipeDigest`: sorted-key compact JSON, SHA-256). Any content
 *     edit, a different extraction with the same id, or a My-Recipes override
 *     silently deactivates the entry;
 *   - the record's declared `category.meal_role` equals the reviewed role and
 *     no competing top-level `mealRole` says otherwise.
 * Nothing on the recipe itself (flags, titles, categories) can create an
 * exception: the ledger is the only source, and it is build-verified.
 *
 * What an entry may bypass is deliberately narrow (consumed by the app's
 * meals-core.ts / planner-roles.ts): the condiment-title guard and the
 * two-step method cardinality for a reviewed, completed plated main; and the
 * legacy salad-as-main path for a reviewed starter. Declared reject
 * categories, chapter exclusions, dessert / snack / bread / batch safeguards
 * and the ingredient minimum are never bypassed.
 *
 * Cooking availability is separate from semantic role: an entry whose
 * `cookingReady` is false records a reviewed main whose ingredient list is not
 * yet source-complete. Such an entry never unlocks the planner.
 */

export const PLANNER_EVIDENCE_RULE_VERSION = 2;

export type ReviewedPlannerRole = "main" | "starter";

export type ReviewedPlannerException = {
  id: string;
  reviewedRole: ReviewedPlannerRole;
  /** `canonicalRecipeDigest` of the full deployable record this review covers. */
  projectedRecipeSha256: string;
  /** SHA-256 of the immutable review record (adjudication) the entry is bound to. */
  reviewRecordSha256: string;
  /** Reviewed: the method produces a completed plated main (not a bottled sauce). */
  completedPlatedMain: boolean;
  /** Reviewed: several cooking actions live in one method paragraph (step count is not a structure defect). */
  multiActionSingleParagraph: boolean;
  /** False while the ingredient list is not source-complete: the planner stays blocked. */
  cookingReady: boolean;
  cookingBlockReason?: string;
  evidence: { pointer: string; quote: string }[];
};

export type ReviewedCategory = { dish_type: string[]; chapter?: string; meal_role: string };

export type ReviewedCategoryCorrection = { id: string; category: ReviewedCategory };

export type ReviewedCategoryHold = { id: string; decision: "keep" | "unresolved"; category: ReviewedCategory };

export type ReviewedPlannerEvidenceRegistry = {
  version: number;
  owner: string;
  reviewRecordSha256: string;
  canonicalization: string;
  categoryCorrections: ReviewedCategoryCorrection[];
  categoryHolds: ReviewedCategoryHold[];
  plannerExceptions: ReviewedPlannerException[];
};

/** The minimum a record must expose for the rule; the app's Recipe satisfies it structurally. */
export type EvidenceRecipeLike = {
  id: string;
  category?: { dish_type: string[]; chapter?: string; meal_role?: string };
  mealRole?: string;
};

// ---------------------------------------------------------------------------
// Canonical digest: ONE definition for build-time checks, the ledger
// generator and the runtime. Sorted keys at every depth, no whitespace,
// `undefined` members dropped (as JSON.stringify does), UTF-8, SHA-256.
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function canonicalRecipeDigest(recipe: unknown): string {
  return sha256Hex(canonicalJson(recipe));
}

// --- SHA-256 (FIPS 180-4), pure TypeScript -------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------
// Registry validation (fail closed on a malformed ledger)
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;

function isCategory(value: unknown): value is ReviewedCategory {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.dish_type) &&
    record.dish_type.every((item) => typeof item === "string") &&
    typeof record.meal_role === "string" &&
    (record.chapter === undefined || typeof record.chapter === "string")
  );
}

export function assertReviewedPlannerEvidenceRegistry(value: unknown): ReviewedPlannerEvidenceRegistry {
  const error = (message: string) => new Error(`reviewed planner evidence: ${message}`);
  if (!value || typeof value !== "object") throw error("registry is not an object");
  const registry = value as Record<string, unknown>;
  if (registry.version !== 1) throw error("unsupported version");
  if (typeof registry.owner !== "string") throw error("missing owner");
  const reviewRecordSha256 = registry.reviewRecordSha256;
  if (typeof reviewRecordSha256 !== "string" || !HEX64.test(reviewRecordSha256)) {
    throw error("reviewRecordSha256 is not a sha256 hex digest");
  }
  if (typeof registry.canonicalization !== "string") throw error("missing canonicalization");
  const corrections = registry.categoryCorrections;
  const holds = registry.categoryHolds;
  const exceptions = registry.plannerExceptions;
  if (!Array.isArray(corrections) || !Array.isArray(holds) || !Array.isArray(exceptions)) {
    throw error("sections must be arrays");
  }
  const ids = new Set<string>();
  for (const entry of [...corrections, ...holds] as unknown[]) {
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !id) throw error("entry without id");
    if (ids.has(id)) throw error(`duplicate id ${id}`);
    ids.add(id);
    if (!isCategory(record.category)) throw error(`entry ${id} has no category`);
  }
  for (const entry of holds as unknown[]) {
    const record = entry as Record<string, unknown>;
    if (record.decision !== "keep" && record.decision !== "unresolved") throw error(`hold ${String(record.id)} has no decision`);
  }
  const exceptionIds = new Set<string>();
  for (const entry of exceptions as unknown[]) {
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !id) throw error("exception without id");
    if (exceptionIds.has(id)) throw error(`duplicate exception ${id}`);
    exceptionIds.add(id);
    if (record.reviewedRole !== "main" && record.reviewedRole !== "starter") throw error(`exception ${id} has an unsupported role`);
    if (typeof record.projectedRecipeSha256 !== "string" || !HEX64.test(record.projectedRecipeSha256)) {
      throw error(`exception ${id} has no projected record digest`);
    }
    if (record.reviewRecordSha256 !== reviewRecordSha256) throw error(`exception ${id} is bound to a different review record`);
    for (const flag of ["completedPlatedMain", "multiActionSingleParagraph", "cookingReady"]) {
      if (typeof record[flag] !== "boolean") throw error(`exception ${id} is missing ${flag}`);
    }
    if (record.cookingReady === false && typeof record.cookingBlockReason !== "string") {
      throw error(`exception ${id} is blocked without a reason`);
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) throw error(`exception ${id} has no evidence`);
  }
  return value as ReviewedPlannerEvidenceRegistry;
}

// ---------------------------------------------------------------------------
// The shared rule (pure: record + registry in, verdict out)
// ---------------------------------------------------------------------------

function declaredMealRole(recipe: EvidenceRecipeLike): string | null {
  const role = recipe.category && typeof recipe.category === "object" ? recipe.category.meal_role : undefined;
  return typeof role === "string" ? role.toLowerCase().trim() : null;
}

/**
 * The reviewed exception that applies to exactly this record, or null.
 * Stale, forged, conflicting and user-editable signals all land on null.
 */
export function matchReviewedPlannerEvidence(
  recipe: EvidenceRecipeLike,
  registry: ReviewedPlannerEvidenceRegistry,
): ReviewedPlannerException | null {
  if (!recipe || typeof recipe.id !== "string") return null;
  const entry = registry.plannerExceptions.find((candidate) => candidate.id === recipe.id);
  if (!entry) return null;
  if (declaredMealRole(recipe) !== entry.reviewedRole) return null;
  if (typeof recipe.mealRole === "string" && recipe.mealRole.toLowerCase().trim() !== entry.reviewedRole) return null;
  if (canonicalRecipeDigest(recipe) !== entry.projectedRecipeSha256) return null;
  return entry;
}

/** A reviewed, completed plated main whose ingredient list is cooking-ready. */
export function hasReviewedPlatedMainEvidence(recipe: EvidenceRecipeLike, registry: ReviewedPlannerEvidenceRegistry): boolean {
  const entry = matchReviewedPlannerEvidence(recipe, registry);
  return Boolean(
    entry &&
      entry.reviewedRole === "main" &&
      entry.completedPlatedMain &&
      entry.multiActionSingleParagraph &&
      entry.cookingReady,
  );
}

/** A reviewed starter: outranks the legacy salad-as-main path. */
export function hasReviewedStarterEvidence(recipe: EvidenceRecipeLike, registry: ReviewedPlannerEvidenceRegistry): boolean {
  return matchReviewedPlannerEvidence(recipe, registry)?.reviewedRole === "starter";
}

/**
 * Why a reviewed main is still unavailable to the planner (ingredient
 * completeness), or null when no blocked main evidence applies.
 */
export function reviewedMainCookingBlock(recipe: EvidenceRecipeLike, registry: ReviewedPlannerEvidenceRegistry): string | null {
  const entry = matchReviewedPlannerEvidence(recipe, registry);
  if (!entry || entry.reviewedRole !== "main" || entry.cookingReady) return null;
  return entry.cookingBlockReason ?? "ingredient completeness not established";
}
