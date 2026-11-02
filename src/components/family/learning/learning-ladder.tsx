// ---------------------------------------------------------------------------
// Step 2 A (2026-11-02): the parent's level-based learning report — the main view of /family/learn/parent, in English.
// Renders the server-computed ladder (lib/family-learning-skill-ladder.ts) only: one row per skill with its status on
// the five-step ladder, the official level it belongs to, a dot per visit, the evidence count and a plain-English line.
// Parent surface only; the children's screens never import this.
// ---------------------------------------------------------------------------

import { cn } from "@/components/ui/nabu";
import { LADDER_STEPS, STATUS_EN, statusRank, type LadderRow, type LadderStatus, type LearningLadder } from "@/lib/family-learning-skill-ladder";

const SUBJECTS: { id: LadderRow["subject"]; label: string; scale: string }[] = [
  { id: "math", label: "Math", scale: "Lehrplan 21 Basel-Stadt" },
  { id: "german", label: "German", scale: "Lehrplan 21 Basel-Stadt" },
  { id: "english", label: "English", scale: "CEFR (Council of Europe), per skill" },
  { id: "spanish", label: "Spanish", scale: "CEFR (Council of Europe), per skill" },
];

/** Fill per ladder rank (0 = not seen … 4 = held). */
const FILL = ["#e7e5e4", "#f2c94c", "#a7d7b0", "#4fae7b", "#1f6f4a"];
const TONE: Record<LadderStatus, { bg: string; fg: string }> = {
  "not-seen": { bg: "#f5f5f4", fg: "#57534e" },
  observed: { bg: "#eef2f7", fg: "#334155" },
  tried: { bg: "#fbe4e0", fg: "#7a2e22" },
  "with-help": { bg: "#fdf1c7", fg: "#6b4e00" },
  "on-own-once": { bg: "#dff1e3", fg: "#1f5130" },
  "on-own-new": { bg: "#c4e6d0", fg: "#14432a" },
  held: { bg: "#1f6f4a", fg: "#ffffff" },
};

function day(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Europe/Zurich" });
  } catch {
    return iso.slice(0, 10);
  }
}

function StatusChip({ status }: { status: LadderStatus }) {
  const t = TONE[status];
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: t.bg, color: t.fg }} data-status={status}>
      {STATUS_EN[status]}
    </span>
  );
}

/** Five small steps, filled up to the row's rank. */
function Steps({ status }: { status: LadderStatus }) {
  const rank = statusRank(status);
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {LADDER_STEPS.map((s) => (
        <span key={s.rank} title={s.label} className="inline-block w-2.5 rounded-sm" style={{ height: 6 + s.rank * 3, background: s.rank === 0 ? (status === "tried" ? "#e8a39b" : FILL[0]) : s.rank <= rank ? FILL[s.rank] : "#f1efed", outline: s.rank <= rank && s.rank > 0 ? "none" : "1px solid #e7e5e4" }} />
      ))}
    </span>
  );
}

/** One dot per visit at the height of what that visit showed; a dash where the skill had no task. */
function Trend({ trend }: { trend: LadderRow["trend"] }) {
  const w = 13;
  const h = 26;
  const y = (s: LadderStatus) => h - 4 - statusRank(s) * 4.5;
  return (
    <svg width={Math.max(trend.length * w, w)} height={h} role="img" aria-label={trend.map((t) => `${t.label}: ${t.status ? STATUS_EN[t.status] : "no task"}`).join("; ")}>
      <line x1={0} x2={trend.length * w} y1={h - 4} y2={h - 4} stroke="#e7e5e4" strokeWidth={1} />
      {trend.map((t, i) => {
        const cx = i * w + w / 2;
        if (!t.status) return <line key={t.visit} x1={cx - 2} x2={cx + 2} y1={h - 4} y2={h - 4} stroke="#a8a29e" strokeWidth={1.5}><title>{`${t.label}: no task`}</title></line>;
        const r = statusRank(t.status);
        return (
          <circle key={t.visit} cx={cx} cy={y(t.status)} r={3.6} fill={t.status === "tried" ? "#fff" : r === 0 ? "#cbd5e1" : FILL[r]} stroke={t.status === "tried" ? "#c2410c" : "#57534e"} strokeWidth={t.status === "tried" ? 1.4 : 0.6}>
            <title>{`${t.label}: ${STATUS_EN[t.status]}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

const CEFR_TRACK = ["Pre-A1", "A1.1", "A1.2", "A2"] as const;

function Reference({ row }: { row: LadderRow }) {
  if (row.reference.kind === "lp21") {
    return (
      <div className="min-w-0">
        <a href={row.reference.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-primary underline decoration-dotted" title={row.reference.bullet}>
          {row.reference.code}
        </a>
        <span className="ml-1 text-[11px] text-tertiary">· {row.fit}</span>
        <div className="text-xs text-tertiary">{row.reference.cycle}</div>
      </div>
    );
  }
  const steps = row.reference.steps;
  const statusAt = (mark: (typeof CEFR_TRACK)[number]) => {
    const s = steps.find((x) => (mark === "Pre-A1" ? x.step === "Pre-A1" : mark === "A2" ? x.step === "A2" : x.step === "A1"));
    return s ? { pitched: true, status: s.status, d: s } : { pitched: false, status: null, d: null };
  };
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-0.5" data-testid={`cefr-${row.id}`}>
        {CEFR_TRACK.map((mark, i) => {
          const s = statusAt(mark);
          const r = s.status ? statusRank(s.status) : -1;
          return (
            <span key={mark} className="flex items-center">
              {i > 0 ? <span className="mx-0.5 text-[10px] text-tertiary">→</span> : null}
              <span
                className="rounded px-1 text-[11px] font-semibold"
                title={s.d ? `${s.d.scale}, ${s.d.step}, p. ${s.d.page}: «${s.d.text}»${s.status ? ` — ${STATUS_EN[s.status]}` : " — no answer yet"}` : "No task is pitched at this step."}
                style={{ background: r > 0 ? FILL[r] : s.pitched ? "#f5f5f4" : "transparent", color: r >= 3 ? "#fff" : s.pitched ? "#292524" : "#a8a29e", border: s.pitched ? "1px solid #d6d3d1" : "1px dashed #e7e5e4" }}
              >
                {mark}
              </span>
            </span>
          );
        })}
      </div>
      <div className="text-xs text-tertiary">
        {row.noTaskYet ? `reference: ${steps.map((s) => s.step).join(", ")} descriptor (no task yet)` : `tasks pitched at ${[...new Set(steps.map((s) => s.step))].join(" and ")} descriptors · ${row.fit}`}
      </div>
    </div>
  );
}

function Row({ row }: { row: LadderRow }) {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return (
    <li className={cn("grid items-center gap-x-4 border-t border-primary py-2", "grid-cols-[minmax(0,2fr)_15.5rem_auto_minmax(0,1.4fr)_minmax(0,1.15fr)]")} data-testid={`ladder-row-${row.id}`} data-status={row.status}>
      <div className="col-start-1 row-start-1 min-w-0 text-[15px] font-semibold leading-tight text-primary" title={row.observes}>
        {row.label}
      </div>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Steps status={row.status} />
        {row.noTaskYet ? <span className="text-xs text-tertiary">no task yet</span> : <StatusChip status={row.status} />}
        {row.headlineStep && !row.noTaskYet ? <span className="text-[11px] text-tertiary" title="The chip shows the highest CEFR step attempted; lower steps are on the track.">at {row.headlineStep}</span> : null}
        {row.thin ? (
          <span className="cursor-help rounded-full border border-dashed px-1.5 text-[10px] font-semibold" style={{ borderColor: "#b45309", color: "#92400e" }} title={row.thin.reason} data-testid={`ladder-thin-${row.id}`}>
            thin evidence
          </span>
        ) : null}
      </div>
      <div className="col-start-3 row-start-1">
        <Trend trend={row.trend} />
      </div>
      <div className="col-start-4 row-span-2 row-start-1 self-center">
        <Reference row={row} />
      </div>
      <div className="col-start-5 row-span-2 row-start-1 self-center text-right text-xs text-tertiary">
        {row.observedOnly ? null : row.evidence.answers ? (
          <>
            <div>
              <span className="font-semibold text-primary">{plural(row.evidence.answers, "answer")}</span> · {plural(row.evidence.tasks, "task")}
            </div>
            <div>last {day(row.evidence.lastAt)}{row.evidence.notYet ? ` · ${row.evidence.notYet} not yet` : ""}</div>
          </>
        ) : (
          <div>no answers</div>
        )}
      </div>
      <p className="col-span-3 col-start-1 row-start-2 text-xs leading-snug text-tertiary" data-testid={`ladder-meaning-${row.id}`}>
        {row.meaning}
      </p>
    </li>
  );
}

function TypingBlock({ typing }: { typing: NonNullable<LearningLadder["typing"]> }) {
  const bar = (values: (number | null)[], max: number) => (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="inline-block w-2 rounded-sm" style={{ height: v === null ? 2 : 4 + Math.round((Math.min(v, max) / max) * 18), background: v === null ? "#e7e5e4" : "#78716c" }} />
      ))}
    </span>
  );
  return (
    <section className="mt-3" data-testid="ladder-typing">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-tertiary">
        Typing <span className="font-normal normal-case tracking-normal">· {typing.reference.code} ({typing.reference.cycle})</span>
      </h3>
      <ul className="mt-1 grid grid-cols-3 gap-3">
        <li className="rounded-xl bg-secondary px-3 py-2">
          <div className="text-xs text-tertiary">Course lesson</div>
          <div className="text-lg font-semibold text-primary">{typing.lesson ? `${typing.lesson.current} of ${typing.lesson.total}` : "—"}</div>
          <div className="text-xs text-tertiary">{typing.lesson ? `${typing.lesson.completed} lessons met the step-up rule · ${typing.rounds} rounds` : ""}</div>
        </li>
        <li className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2">
          <div>
            <div className="text-xs text-tertiary">Accuracy (latest round)</div>
            <div className="text-lg font-semibold text-primary">{typing.accuracy.latest === null ? "—" : `${typing.accuracy.latest}% of keys right`}</div>
          </div>
          {bar(typing.accuracy.trend.map((t) => t.value), 100)}
        </li>
        <li className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2">
          <div>
            <div className="text-xs text-tertiary">Speed (latest round)</div>
            <div className="text-lg font-semibold text-primary">{typing.speed.latest === null ? "—" : `${typing.speed.latest} characters/min`}</div>
          </div>
          {bar(typing.speed.trend.map((t) => t.value), 120)}
        </li>
      </ul>
      <p className="mt-1 text-xs text-tertiary">{typing.note}</p>
    </section>
  );
}

export function LearningLadderView({ ladder, childName }: { ladder: LearningLadder; childName: string }) {
  const unmapped = [...ladder.reconciliation.notASkill.map((x) => ({ ...x, known: true })), ...ladder.reconciliation.unmapped.map((x) => ({ ...x, reason: "Not in the reviewed map yet — needs a decision.", known: false }))];
  const visits = ladder.rows[0]?.trend ?? [];
  return (
    <section className="rounded-3xl border border-primary bg-primary p-5" lang="en" data-testid="learning-ladder">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-[-0.01em] text-primary">{childName}: skills ladder</h2>
        <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "#fff3cd", color: "#5c4400" }} data-testid="ladder-label">
          {ladder.label}
        </span>
      </div>
      <ul className="mt-3 grid gap-1 text-[15px] text-primary" data-testid="ladder-summary">
        <li><span className="mr-2 inline-block w-24 text-xs font-semibold uppercase tracking-wide text-tertiary">Moved up</span>{ladder.summary.movedUp.replace(/^Moved up in /, "In ")}</li>
        <li><span className="mr-2 inline-block w-24 text-xs font-semibold uppercase tracking-wide text-tertiary">Held</span>{ladder.summary.held.replace(/^Held: /, "")}</li>
        <li><span className="mr-2 inline-block w-24 text-xs font-semibold uppercase tracking-wide text-tertiary">Teach next</span>{ladder.summary.teachNext.replace(/^Teach next: /, "")}</li>
      </ul>
      <p className="mt-2 text-sm text-tertiary" data-testid="ladder-kumon">{ladder.kumon.line}</p>

      <div className="mt-3 grid grid-cols-[minmax(0,2fr)_15.5rem_auto_minmax(0,1.4fr)_minmax(0,1.15fr)] gap-x-4 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        <span>Skill · what it means</span>
        <span>Status (not seen → held)</span>
        <span style={{ minWidth: Math.max(visits.length * 13, 13) }}>Visits {visits.length ? `1–${visits.length}` : ""}</span>
        <span>Official level (cycle / step)</span>
        <span className="text-right">Evidence</span>
      </div>
      {SUBJECTS.map((s) => {
        const rows = ladder.rows.filter((r) => r.subject === s.id);
        if (!rows.length) return null;
        return (
          <section key={s.id} className="mt-2" data-testid={`ladder-${s.id}`}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-tertiary">
              {s.label} <span className="font-normal normal-case tracking-normal">· {s.scale}</span>
            </h3>
            <ul>{rows.map((r) => <Row key={r.id} row={r} />)}</ul>
          </section>
        );
      })}
      {ladder.typing ? <TypingBlock typing={ladder.typing} /> : null}

      <footer className="mt-4 space-y-1 border-t border-primary pt-3 text-xs text-tertiary" data-testid="ladder-footnote">
        <p>
          Each row is a chance to observe one narrow skill toward the official description shown — not a grade, and never «is at level X». Held = a fresh task right on own at least 6 days after it was last taught or helped. «I helped here» in Visit details turns that answer into «with help». CEFR A1.1 / A1.2 are not separated by the descriptors used here, so A1 tasks light both; a language row's chip shows the highest step attempted. «Thin evidence» marks a «held» or «new situation» that rests only on picks from given options or on a single task (hover for why). Children&apos;s screens never show any of this.
        </p>
        <p data-testid="ladder-reconciliation">
          Objective ids in {childName}&apos;s records: <b>{ladder.reconciliation.found}</b> found · <b>{ladder.reconciliation.mapped}</b> mapped to a skill row · <b>{unmapped.length}</b> unmapped
          {unmapped.length ? ":" : "."}
        </p>
        {unmapped.length ? (
          <ul className="ml-4 list-disc" data-testid="ladder-unmapped">
            {unmapped.map((u) => (
              <li key={u.objective} className={cn(!u.known && "font-semibold text-primary")}>
                <span className="font-mono">{u.objective}</span> ({u.answers}×) — {u.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </section>
  );
}
