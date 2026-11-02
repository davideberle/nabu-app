// Step 2 A (2026-11-02): the parent's level-based learning report. Mapping completeness against the objective ids that
// occur in both children's real records (ids only — the fixture holds no child text) and in every content version;
// the status rules (held ≥ 6 days, warm-up teachingReason, «I helped here» downgrade, shown answers, new situation);
// the reconciliation counts; and child isolation. Pure; no database, no network.
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import type { ChildId } from "./family-assistant-turn.ts";
import type { EvidenceAttempt } from "./family-learning-db.ts";
import { learningLadder, LADDER_LABEL, type LadderInput } from "./family-learning-skill-ladder.ts";
import { cycleContext, OBJECTIVE_MAP, resolveObjective, SKILL_ROWS } from "./family-learning-skill-map.ts";

type FixtureRow = { objective: string; languages: string[]; answers: number; visits: string[] };
const fixture = JSON.parse(readFileSync(new URL("./family-learning-skill-ladder.fixture.json", import.meta.url), "utf8")) as Record<ChildId, FixtureRow[]>;

/** Every objective id authored in a content version, per child (by the content file's name). */
function contentObjectives(): Record<ChildId, Set<string>> {
  const dir = new URL("../data/family-learning/content/", import.meta.url);
  const out: Record<ChildId, Set<string>> = { santiago: new Set(), isabel: new Set() };
  for (const f of readdirSync(dir)) {
    const child: ChildId | null = f.startsWith("santiago-") ? "santiago" : f.startsWith("isabel-") ? "isabel" : null;
    if (!child) continue;
    const json = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { missions?: { steps: { objective: string; kind: string; text?: { language?: string }; produce?: { language?: string } }[] }[] };
    for (const m of json.missions ?? []) for (const s of m.steps) out[child].add(s.objective);
  }
  return out;
}

let seq = 0;
const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 9, day, 9, minute)).toISOString();
function attempt(over: Partial<EvidenceAttempt> & Pick<EvidenceAttempt, "objective" | "visitId" | "taskId" | "createdAt">): EvidenceAttempt {
  seq += 1;
  return {
    id: `a${seq}`,
    taskVersion: 1,
    attemptNo: 1,
    answer: { raw: "x" },
    correct: true,
    evidence: "independent",
    support: [],
    exposureBefore: "shown",
    stimulusLanguage: "de",
    responseLanguage: "de",
    modality: "typed",
    uncertainty: null,
    teachingMove: null,
    teachingReason: null,
    secondsSinceTeaching: null,
    parentCorrection: null,
    ...over,
  };
}
const visits = (ids: string[], day0 = 1) => ids.map((id, i) => ({ id, label: `Visit ${i + 1}`, startedAt: at(day0 + i * 7), finishedAt: at(day0 + i * 7, 30) }));
const input = (child: ChildId, attempts: EvidenceAttempt[], visitIds: string[] = ["v1", "v2", "v4", "v5"]): LadderInput => ({ child, attempts, samples: [], visits: visits(visitIds), typing: null });
const rowOf = (l: ReturnType<typeof learningLadder>, id: string) => l.rows.find((r) => r.id === id)!;

describe("mapping completeness", () => {
  for (const child of ["santiago", "isabel"] as const) {
    it(`${child}: every objective id in the real records is mapped to a row or named as not a skill`, () => {
      const missing: string[] = [];
      for (const r of fixture[child]) {
        for (const lang of r.languages) {
          const res = resolveObjective(child, r.objective, lang);
          if (res.kind === "unmapped") missing.push(`${r.objective} (${lang})`);
          if (res.kind === "row") ok(SKILL_ROWS[child].some((d) => d.id === res.row), `${r.objective} → ${res.row} is ${child}'s own row`);
        }
      }
      deepStrictEqual(missing, []);
    });
    it(`${child}: every objective authored in a content version (and its -practice / -hint-check / -revision run-time ids) is mapped`, () => {
      const missing: string[] = [];
      for (const o of contentObjectives()[child]) {
        if (resolveObjective(child, o, child === "santiago" && o === "listening-for-information" ? "en" : "de").kind === "unmapped") missing.push(o);
        const base = resolveObjective(child, o, "en");
        if (base.kind === "row") for (const suffix of ["-practice", "-hint-check", "-revision"]) if (resolveObjective(child, `${o}${suffix}`, "en").kind !== "row") missing.push(`${o}${suffix}`);
      }
      deepStrictEqual(missing, []);
    });
  }
  it("a listening objective shared by English and Spanish lands on the row of the attempt's language", () => {
    const en = resolveObjective("santiago", "listening-for-information", "en");
    const es = resolveObjective("santiago", "listening-for-information", "es");
    equal(en.kind === "row" && en.row, "s-en-listen");
    equal(es.kind === "row" && es.row, "s-es-listen");
  });
  it("the reconciliation of the real ids adds up: found = mapped + not a skill + unmapped (unmapped = 0)", () => {
    for (const child of ["santiago", "isabel"] as const) {
      const attempts = fixture[child].flatMap((r) => r.languages.map((lang, i) => attempt({ objective: r.objective, visitId: r.visits[0], taskId: `T-${r.objective}-${i}`, createdAt: at(1), stimulusLanguage: lang })));
      const l = learningLadder(input(child, attempts, [...new Set(fixture[child].flatMap((r) => r.visits))].sort()));
      equal(l.reconciliation.found, fixture[child].length);
      equal(l.reconciliation.mapped + l.reconciliation.notASkill.length + l.reconciliation.unmapped.length, l.reconciliation.found);
      deepStrictEqual(l.reconciliation.unmapped, []);
    }
  });
  it("an unknown objective is listed as unmapped with its count — never dropped", () => {
    const l = learningLadder(input("santiago", [attempt({ objective: "brand-new-thing", visitId: "v1", taskId: "X", createdAt: at(1) }), attempt({ objective: "brand-new-thing", visitId: "v1", taskId: "X", createdAt: at(1, 2) })]));
    deepStrictEqual(l.reconciliation.unmapped, [{ objective: "brand-new-thing", answers: 2 }]);
    equal(l.reconciliation.found, 1);
    equal(l.reconciliation.mapped, 0);
  });
});

describe("status rules", () => {
  it("nothing → not seen; a wrong answer only → tried, not yet right; unscored only → seen, not scored", () => {
    let l = learningLadder(input("santiago", []));
    equal(rowOf(l, "s-share").status, "not-seen");
    l = learningLadder(input("santiago", [attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), correct: false, evidence: "incorrect" })]));
    equal(rowOf(l, "s-share").status, "tried");
    l = learningLadder(input("santiago", [attempt({ objective: "writing-review-revision", visitId: "v1", taskId: "WRITE-LOG", createdAt: at(1), correct: null, evidence: "unscored" })]));
    equal(rowOf(l, "s-de-write-mechanics").status, "observed");
  });
  it("right with recorded help → with help; right on own → on own once", () => {
    let l = learningLadder(input("santiago", [attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), evidence: "supported" })]));
    equal(rowOf(l, "s-share").status, "with-help");
    l = learningLadder(input("santiago", [attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1) })]));
    equal(rowOf(l, "s-share").status, "on-own-once");
  });
  it("a shown answer and a copy after it never count as success", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "quotient-full-rest-needed", visitId: "v1", taskId: "MISSION-A/S5", createdAt: at(1), evidence: "answer_exposed" }),
      attempt({ objective: "quotient-full-rest-needed-practice", visitId: "v1", taskId: "MISSION-A/S5", createdAt: at(1, 1), evidence: "independent", answer: { kind: "practice" } }),
    ]));
    equal(rowOf(l, "s-groups-needed").status, "observed");
  });
  it("«I helped here» downgrades an on-own answer to with help", () => {
    const helped = attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), parentCorrection: { evidence: "supported", note: "I helped here", by: "owner", at: at(2) } });
    const l = learningLadder(input("santiago", [helped]));
    const r = rowOf(l, "s-share");
    equal(r.status, "with-help");
    equal(r.evidence.parentHelped, 1);
    ok(r.meaning.includes("parent"));
  });
  it("a second, different task on own → on own in a new situation; the easier version never counts as the second task", () => {
    let l = learningLadder(input("santiago", [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1) }),
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-FRESH", createdAt: at(1, 5) }),
    ]));
    equal(rowOf(l, "s-share").status, "on-own-new");
    l = learningLadder(input("isabel", [
      attempt({ objective: "small-sums-visible-counters", visitId: "v1", taskId: "MISSION-W/W4-COUNT", createdAt: at(1) }),
      attempt({ objective: "add-within-10-easier", visitId: "v1", taskId: "MISSION-W/IH6E-SMALL", createdAt: at(1, 5) }),
    ], ["v1"]));
    equal(rowOf(l, "i-sums").status, "on-own-once");
  });
  it("held: a fresh task right on own ≥ 6 days after the last help — and not at 5 days", () => {
    const base = [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), evidence: "supported" }),
    ];
    let l = learningLadder(input("santiago", [...base, attempt({ objective: "equal-sharing", visitId: "v2", taskId: "EQ-RETURN", createdAt: at(7) })]));
    equal(rowOf(l, "s-share").status, "held");
    ok(rowOf(l, "s-share").meaning.includes("6 days"));
    l = learningLadder(input("santiago", [...base, attempt({ objective: "equal-sharing", visitId: "v2", taskId: "EQ-RETURN", createdAt: at(6) })]));
    equal(rowOf(l, "s-share").status, "on-own-once");
  });
  it("held needs a fresh task: the same task again days later is not retention", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), evidence: "supported" }),
      attempt({ objective: "equal-sharing", visitId: "v2", taskId: "EQ-ENTRY", createdAt: at(12) }),
    ]));
    equal(rowOf(l, "s-share").status, "on-own-once");
  });
  it("held is measured from the LAST help: help 3 days before the later task resets the clock", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1) }),
      attempt({ objective: "equal-sharing", visitId: "v2", taskId: "EQ-FRESH", createdAt: at(5), evidence: "supported" }),
      attempt({ objective: "equal-sharing", visitId: "v4", taskId: "EQ-RETURN", createdAt: at(8) }),
    ]));
    equal(rowOf(l, "s-share").status, "on-own-new");
  });
  it("a recorded teaching move without a score (a writing review) resets the clock for «held»", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "writing-spacing-transfer", visitId: "v1", taskId: "WRITE-TRANSFER-2", createdAt: at(1) }),
      attempt({ objective: "writing-review-revision", visitId: "v2", taskId: "WRITE-LOG-HARBOR", createdAt: at(12), correct: null, evidence: "unscored", teachingMove: "writing-review", teachingReason: "spacing,punctuation" }),
      attempt({ objective: "writing-own-sentence-spacing", visitId: "v4", taskId: "MISSION-B/G8-JOURNAL", createdAt: at(23) }),
    ]));
    const held = rowOf(l, "s-de-write-mechanics").attempts.find((a) => a.level === "held");
    equal(held?.daysLater, 11);
  });
  it("a warm-up: the stored teachingReason decides — delayed-retention → held, short-check → not held", () => {
    const warm = (reason: string, seconds: number) => attempt({ objective: "quotient-groups-leftover-warmup", visitId: "v10", taskId: "MISSION-WATER-PIPE/P2-PIPES/full", createdAt: at(20), teachingMove: "warmup", teachingReason: `groups-with-leftover:${reason}`, secondsSinceTeaching: seconds });
    let l = learningLadder(input("santiago", [warm("delayed-retention", 8 * 86_400)], ["v10"]));
    equal(rowOf(l, "s-remainder").status, "held");
    equal(rowOf(l, "s-remainder").attempts[0].daysLater, 8);
    l = learningLadder(input("santiago", [warm("short-check", 2 * 86_400)], ["v10"]));
    equal(rowOf(l, "s-remainder").status, "on-own-once");
    l = learningLadder(input("santiago", [{ ...warm("delayed-retention", 8 * 86_400), parentCorrection: { evidence: "supported", note: "I helped here", by: "owner", at: at(21) } }], ["v10"]));
    equal(rowOf(l, "s-remainder").status, "with-help");
  });
  it("a later wrong answer never erases an earlier success, and is flagged on the row", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "quotient-full-rest-needed", visitId: "v1", taskId: "MISSION-A/S5", createdAt: at(1) }),
      attempt({ objective: "quotient-full-rest-needed", visitId: "v2", taskId: "MISSION-B/G2", createdAt: at(3), correct: false, evidence: "incorrect" }),
    ]));
    const r = rowOf(l, "s-groups-needed");
    equal(r.status, "on-own-once");
    ok(r.latestNotYet);
    equal(r.evidence.notYet, 1);
    ok(r.meaning.includes("latest try was not right yet"));
  });
  it("trend: one dot per started visit; summary lines come from the ladder", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), evidence: "supported" }),
      attempt({ objective: "equal-sharing", visitId: "v4", taskId: "EQ-FRESH", createdAt: at(15) }),
    ], ["v1", "v2", "v4"]));
    deepStrictEqual(rowOf(l, "s-share").trend.map((t) => t.status), ["with-help", null, "held"]);
    ok(l.summary.movedUp.startsWith("Moved up in Visit 3: Sharing equally"));
    ok(l.summary.held.includes("Sharing equally"));
    ok(l.summary.teachNext.startsWith("Teach next:"));
    equal(l.label, LADDER_LABEL);
  });
  it("is deterministic: the same records in any order give the same ladder", () => {
    const xs = [
      attempt({ objective: "equal-sharing", visitId: "v1", taskId: "EQ-ENTRY", createdAt: at(1), evidence: "supported" }),
      attempt({ objective: "equal-sharing", visitId: "v2", taskId: "EQ-FRESH", createdAt: at(9) }),
      attempt({ objective: "language-es-recognition", visitId: "v2", taskId: "LANG-ES-AGUA/pick", createdAt: at(9, 3), stimulusLanguage: "es" }),
    ];
    deepStrictEqual(learningLadder(input("santiago", xs)), learningLadder(input("santiago", [...xs].reverse())));
  });
});

describe("CEFR steps are separate skills", () => {
  it("numbers heard on Oct 1 do not make following directions on Oct 12 «held»", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "listening-for-information", visitId: "v1", taskId: "MISSION-A/S3-RADIO/crew", createdAt: at(1), stimulusLanguage: "en" }),
      attempt({ objective: "listening-directions", visitId: "v4", taskId: "MISSION-B/H7-JUNE/a", createdAt: at(12), stimulusLanguage: "en" }),
    ]));
    const r = rowOf(l, "s-en-listen");
    equal(r.status, "on-own-once");
    ok(r.attempts.every((a) => a.level === "on-own-once"));
  });
});

describe("child isolation", () => {
  it("each child's table only points at that child's own rows", () => {
    for (const child of ["santiago", "isabel"] as const) {
      const own = new Set(SKILL_ROWS[child].map((r) => r.id));
      for (const [obj, m] of Object.entries(OBJECTIVE_MAP[child])) {
        if (m.kind === "row") ok(own.has(m.row), `${child}: ${obj}`);
        if (m.kind === "by-language") for (const r of Object.values(m.rows)) ok(own.has(r!.row), `${child}: ${obj}`);
      }
    }
  });
  it("Santiago's objectives never fill Isabel's ladder, and the reverse", () => {
    const s = fixture.santiago.map((r) => attempt({ objective: r.objective, visitId: "v1", taskId: `T-${r.objective}`, createdAt: at(1), stimulusLanguage: r.languages[0] }));
    const i = fixture.isabel.map((r) => attempt({ objective: r.objective, visitId: "v1", taskId: `T-${r.objective}`, createdAt: at(1) }));
    const isabelWithSantiago = learningLadder(input("isabel", s, ["v1"]));
    ok(isabelWithSantiago.rows.every((r) => r.status === "not-seen"));
    ok(isabelWithSantiago.rows.every((r) => r.id.startsWith("i-")));
    const santiagoWithIsabel = learningLadder(input("santiago", i, ["v1"]));
    ok(santiagoWithIsabel.rows.every((r) => r.status === "not-seen"));
    ok(santiagoWithIsabel.reconciliation.unmapped.length > 0);
  });
  it("Kumon is a parent-entered reference line per child, never a status", () => {
    equal(learningLadder(input("santiago", [])).kumon.level, "D");
    equal(learningLadder(input("isabel", [])).kumon.level, "A");
  });
});

describe("level context", () => {
  it("cycle text follows the official markers", () => {
    const ref = (cycles: number[], minimum: boolean, orientation: boolean) => ({ kind: "lp21" as const, code: "X", url: "u", cycles, minimum, orientation, bullet: "b" });
    equal(cycleContext(ref([2], false, true)), "Zyklus 2, by end of grade 4");
    equal(cycleContext(ref([2], true, false)), "Zyklus 2 minimum, by end of grade 6");
    equal(cycleContext(ref([1], true, false)), "Zyklus 1 minimum, by end of grade 2");
    equal(cycleContext(ref([1], false, false)), "Zyklus 1 (kindergarten to grade 2)");
    equal(cycleContext(ref([1, 2], false, false)), "Zyklus 1–2 (bridging level)");
  });
  it("CEFR rows show a step per descriptor, with the status of the tasks pitched there", () => {
    const l = learningLadder(input("santiago", [
      attempt({ objective: "language-es-completion", visitId: "v1", taskId: "LANG-ES-AGUA/produce", createdAt: at(1), stimulusLanguage: "es" }),
      attempt({ objective: "language-es-production", visitId: "v2", taskId: "LANG-ES-HARBOR/produce", createdAt: at(3), stimulusLanguage: "es", evidence: "supported" }),
    ]));
    const r = rowOf(l, "s-es-speak");
    ok(r.reference.kind === "cefr");
    if (r.reference.kind === "cefr") deepStrictEqual(r.reference.steps.map((s) => [s.step, s.status]), [["Pre-A1", "on-own-once"], ["A1", "with-help"]]);
  });
});
