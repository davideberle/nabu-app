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
import archiveData from "@/data/gymnastics-archive.json";
import {
  archivedProgramIds,
  sessionKeysOf,
  type GymnasticsArchive,
  type GymnasticsProgram,
  type GymnasticsSessionKey,
} from "./gymnastics-core";

export * from "./gymnastics-core";

export const GYMNASTICS_PROGRAM = programData as GymnasticsProgram;

/**
 * Session slots used by the current program, in display order. Derived from the
 * program so the UI, API, and progress helpers never hard-code a slot count.
 */
export const GYMNASTICS_SESSION_KEYS: GymnasticsSessionKey[] = sessionKeysOf(GYMNASTICS_PROGRAM);

/**
 * Titles and session labels for blocks that came before the current one. Also a
 * byte-for-byte copy of a health-owned canonical file
 * (`projects/health-dashboard/gymnastics-archive.json`) and validated by
 * `scripts/validate-gymnastics.mjs`. It records no completions of its own —
 * whether a session happened is only ever read from Turso.
 */
export const GYMNASTICS_ARCHIVE = archiveData as GymnasticsArchive;

/** Retired program ids the history read may query. Never the current one. */
export const GYMNASTICS_ARCHIVED_PROGRAM_IDS: string[] = archivedProgramIds(
  GYMNASTICS_ARCHIVE,
  GYMNASTICS_PROGRAM.programId,
);
