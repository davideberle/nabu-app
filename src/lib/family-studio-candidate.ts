// ---------------------------------------------------------------------------
// Explicit import seam for the Game Studio child adapter under test (VR-01).
//
// The joined suite and the guard-mirror check must exercise the ADAPTER
// CANDIDATE that ships with this app commit — never the canonical live file on
// this machine, whose hash may differ. The candidate is named by
// `candidate-adapter.json` beside this file: an absolute path (or a path
// relative to the repo root) plus the SHA-256 the accepted candidate must have.
// A missing file skips the joined tests; a present file whose contents hash
// differently FAILS them — a passing run against the wrong adapter is not
// evidence. `FAMILY_STUDIO_ADAPTER` / `FAMILY_STUDIO_ADAPTER_SHA256` override
// the pointer for an independent verifier replaying on another checkout.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type StudioCandidate = { path: string; sha256: string; actualSha256: string; matches: boolean } | null;

export function resolveStudioCandidate(env: Record<string, string | undefined> = process.env): StudioCandidate {
  const root = resolve(new URL("../..", import.meta.url).pathname);
  let path = env.FAMILY_STUDIO_ADAPTER ?? null;
  let sha256 = env.FAMILY_STUDIO_ADAPTER_SHA256 ?? null;
  if (!path) {
    const pointer = resolve(root, "src", "lib", "candidate-adapter.json");
    if (!existsSync(pointer)) return null;
    const parsed = JSON.parse(readFileSync(pointer, "utf8")) as { path?: string; sha256?: string };
    path = parsed.path ?? null;
    sha256 = sha256 ?? parsed.sha256 ?? null;
  }
  if (!path || !sha256) return null;
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  if (!existsSync(absolute)) return null;
  const actualSha256 = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  return { path: absolute, sha256, actualSha256, matches: actualSha256 === sha256 };
}
