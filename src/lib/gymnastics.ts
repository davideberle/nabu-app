/**
 * Gymnastics skill-program projection.
 *
 * The program content (weeks, drills, safety rules, M60 scaling, videos) is
 * OWNED by the Health Dashboard domain. The canonical source lives at:
 *   projects/health-dashboard/gymnastics-program.json
 *
 * `src/data/gymnastics-program.json` in this repo is a byte-for-byte deployable
 * copy of that canonical file. Do not hand-edit the copy — edit the canonical
 * file and re-sync. `scripts/validate-gymnastics.mjs` enforces that the two
 * stay identical and that the program is structurally valid.
 *
 * Types, pure projections, and API payload validation live in
 * `gymnastics-core.ts` and are re-exported here, so app code has a single
 * import site. This module owns no training content and no DB access.
 */

import programData from "@/data/gymnastics-program.json";
import { sessionKeysOf, type GymnasticsProgram, type GymnasticsSessionKey } from "./gymnastics-core";

export * from "./gymnastics-core";

export const GYMNASTICS_PROGRAM = programData as GymnasticsProgram;

/**
 * Session slots used by the current program, in display order. Derived from the
 * program so the UI, API, and progress helpers never hard-code a slot count.
 */
export const GYMNASTICS_SESSION_KEYS: GymnasticsSessionKey[] = sessionKeysOf(GYMNASTICS_PROGRAM);
