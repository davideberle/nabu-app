// ---------------------------------------------------------------------------
// Browser client for the approved-game library and paid play.
//
// Two servers, two credentials, no shared authority:
//   - Family routes on this origin (`/api/family/games/*`, `/api/family/play/*`)
//     with the child games bearer — allowance, purchase, lease.
//   - The Game Studio child adapter on the tailnet (`studio.url`) with the
//     Studio credential — library, content, edit, and the play meter ticks.
//
// Pure fetch plumbing; no React. Testable through `fetchImpl`.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import type { PlayLease, PlayPhase } from "./family-play.ts";

export const GAMES_SESSION_PATH = "/api/family/games/session";
export const PLAY_STATE_PATH = "/api/family/play/state";
export const PLAY_PURCHASES_PATH = "/api/family/play/purchases";
export const PLAY_LEASES_PATH = "/api/family/play/leases";
export const SESSION_REFRESH_MARGIN_MS = 60_000;

export type StudioAccess = { url: string; token: string; expiresAt: number };
export type GamesSession = { child: ChildId; token: string; expiresAt: number; studio: StudioAccess | null };

export type ChessStateView = {
  gameId: string;
  dailySeconds: number;
  date: string;
  eligible: boolean;
  grantedSeconds: number;
  remainingSeconds: number;
  consumedSeconds: number;
  qualifiedBy: { week: string; routineId: string; day: number } | null;
};

export type PlayStateView = {
  child: ChildId;
  balance: number;
  remainingSeconds: number;
  price: { coins: number; seconds: number };
  freeGameIds: string[];
  warnSeconds: number;
  graceSeconds: number;
  activeLease: PlayLease | null;
  /** Today's chess status (server date and eligibility). */
  chess: ChessStateView;
};

export type LibraryGame = {
  gameId: string;
  title: string;
  tagline: string | null;
  /** "approved" = parent-approved library game; "own" = this child's own creation. */
  source: "approved" | "own";
  free: boolean;
  playable: boolean;
  status: string;
  artworkUrl: string | null;
  updatedAt: string | null;
};

export type LibraryView = { child: ChildId; games: LibraryGame[]; canCreate: boolean };

/** A studio heartbeat's wait claim: the plan analysis or build the editor is waiting on (verified upstream by the meter). */
export type WaitClaim = { kind: "plan" | "job"; id: string };

export type TickView = {
  leaseId: string;
  phase: PlayPhase;
  remainingSeconds: number;
  consumedSeconds: number;
  graceRemainingSeconds: number | null;
  warn: boolean;
  ended: boolean;
  endReason: string | null;
  /** How long (ms from this answer) play is authorized without a renewal; the wrapper and the frame freeze at that deadline. */
  authorizedForMs?: number;
  /** `running`: the meter is counting (between running reports); `armed`: a grant was handed, counting starts with the wrapper's running report; `stopped`: not counting. */
  billing?: "running" | "armed" | "stopped";
  /** Sequence number of the grant handed with this answer; the wrapper names it in its running reports. */
  grant?: number;
  /** Studio leases only: the meter's verdict on the heartbeat's wait claim (false = the editor must resume or pause). */
  waiting?: WaitClaim & { attested: boolean; status: string };
};

export type LeaseGrant = {
  child: ChildId;
  lease: PlayLease;
  replaced: string | null;
  remainingSeconds: number;
  warnSeconds: number;
  graceSeconds: number;
  studio: StudioAccess | null;
  /** Chess only: the same-origin gated bundle path for the frame (null for Studio games). */
  content?: { path: string; expiresAt: number } | null;
};

export type Failure = "no-session" | "network" | "unauthorized" | "unavailable" | "bad-response" | "insufficient" | "lease-held" | "no-allowance" | "chess-not-earned";
export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure; status?: number; detail?: unknown };

export type GamesClientDeps = { fetchImpl?: typeof fetch; now?: () => number };

export function createGamesClient(deps: GamesClientDeps = {}) {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? (() => Date.now());
  let cached: GamesSession | null = null;

  async function session(child: ChildId, signal?: AbortSignal): Promise<GamesSession | null> {
    if (cached && cached.child === child && cached.expiresAt - now() > SESSION_REFRESH_MARGIN_MS) return cached;
    cached = null;
    try {
      const res = await doFetch(GAMES_SESSION_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ childId: child }), signal });
      if (!res.ok) return null;
      const payload = (await res.json()) as GamesSession;
      if (payload?.child !== child || typeof payload.token !== "string") return null;
      cached = payload;
      return payload;
    } catch {
      return null;
    }
  }

  function failureFor(status: number): Failure {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 503 || status === 502 || status === 504) return "unavailable";
    return "bad-response";
  }

  async function familyCall<T>(child: ChildId, path: string, init: RequestInit & { signal?: AbortSignal }): Promise<Outcome<T>> {
    const info = await session(child, init.signal);
    if (!info) return { ok: false, failure: "no-session" };
    let res: Response;
    try {
      res = await doFetch(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${info.token}` }, cache: "no-store" });
    } catch {
      return { ok: false, failure: "network" };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) {
      if (res.status === 401) cached = null;
      const reason = typeof body === "object" && body !== null ? (body as { error?: unknown; reason?: unknown }).error ?? (body as { reason?: unknown }).reason : null;
      if (res.status === 409 && reason === "lease-held") return { ok: false, failure: "lease-held", status: 409, detail: body };
      if (reason === "chess-not-earned") return { ok: false, failure: "chess-not-earned", status: res.status, detail: body };
      if (res.status === 402 || reason === "no-allowance") return { ok: false, failure: "no-allowance", status: res.status, detail: body };
      if (res.status === 409) return { ok: false, failure: "insufficient", status: 409, detail: body };
      return { ok: false, failure: failureFor(res.status), status: res.status, detail: body };
    }
    return { ok: true, value: body as T };
  }

  async function studioCall<T>(studio: StudioAccess, path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Outcome<T>> {
    let res: Response;
    try {
      res = await doFetch(`${studio.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${studio.token}` }, cache: "no-store", mode: "cors" });
    } catch {
      return { ok: false, failure: "network" };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) return { ok: false, failure: res.status === 402 || res.status === 410 ? "no-allowance" : failureFor(res.status), status: res.status, detail: body };
    return { ok: true, value: body as T };
  }

  return {
    session,
    reset() {
      cached = null;
    },
    state: (child: ChildId, signal?: AbortSignal) => familyCall<PlayStateView>(child, PLAY_STATE_PATH, { signal }),
    purchase: (child: ChildId, idempotencyKey: string, signal?: AbortSignal) =>
      familyCall<{ purchase: unknown; replayed: boolean; remainingSeconds: number; balance: number }>(child, PLAY_PURCHASES_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
        signal,
      }),
    lease: (child: ChildId, input: { gameId?: string; mode: "play" | "edit"; takeover?: boolean; device?: string }, signal?: AbortSignal) =>
      familyCall<LeaseGrant>(child, PLAY_LEASES_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }),
    release: (child: ChildId, leaseId: string, reason: string, signal?: AbortSignal) =>
      familyCall<{ ok: true; ended: boolean }>(child, `${PLAY_LEASES_PATH}/${encodeURIComponent(leaseId)}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
        keepalive: true,
        signal,
      }),
    library: (studio: StudioAccess, signal?: AbortSignal) => studioCall<LibraryView>(studio, "/v1/library", { signal }),
    contentUrl: (studio: StudioAccess, leaseId: string, gameId: string) =>
      `${studio.url}/v1/play/${encodeURIComponent(leaseId)}/${encodeURIComponent(gameId)}/index.html?credential=${encodeURIComponent(studio.token)}`,
    tick: (studio: StudioAccess, leaseId: string, input: { active: boolean; hidden: boolean; paused: boolean; foreground?: boolean; grant?: number | null; runMs?: number | null; waiting?: WaitClaim | null }, signal?: AbortSignal) =>
      studioCall<TickView>(studio, `/v1/play/${encodeURIComponent(leaseId)}/tick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }),
    /** `frameStopped`: the wrapper attests the game frame was frozen/removed (guard acknowledgment received) BEFORE this request — the meter may then let a successor start without waiting out the handed deadline. */
    end: (studio: StudioAccess, leaseId: string, reason: string, frameStopped = false, observed: { grant: number | null; runMs: number } | null = null, signal?: AbortSignal) =>
      studioCall<TickView>(studio, `/v1/play/${encodeURIComponent(leaseId)}/end`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, frameStopped, grant: observed?.grant ?? null, runMs: observed?.runMs ?? null }), keepalive: true, signal }),
    projects: (studio: StudioAccess, signal?: AbortSignal) => studioCall<{ projects: StudioProject[] }>(studio, "/v1/studio/projects", { signal }),
    project: (studio: StudioAccess, id: string, signal?: AbortSignal) => studioCall<StudioProject>(studio, `/v1/studio/projects/${encodeURIComponent(id)}`, { signal }),
    createProject: (studio: StudioAccess, prompt: string) =>
      studioCall<{ project: StudioProject; job: StudioJob }>(studio, "/v1/studio/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }),
    iterateProject: (studio: StudioAccess, id: string, prompt: string) =>
      studioCall<{ plan: StudioPlan }>(studio, `/v1/studio/projects/${encodeURIComponent(id)}/iterate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }),
    plan: (studio: StudioAccess, id: string, signal?: AbortSignal) => studioCall<StudioPlan>(studio, `/v1/studio/plans/${encodeURIComponent(id)}`, { signal }),
    clarifyPlan: (studio: StudioAccess, id: string, answers: { question: string; answer: string }[]) =>
      studioCall<{ plan: StudioPlan }>(studio, `/v1/studio/plans/${encodeURIComponent(id)}/clarify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) }),
    approvePlan: (studio: StudioAccess, id: string) =>
      studioCall<{ plan: StudioPlan; job: StudioJob | null }>(studio, `/v1/studio/plans/${encodeURIComponent(id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmPlanId: id }) }),
    job: (studio: StudioAccess, id: string, signal?: AbortSignal) => studioCall<StudioJob>(studio, `/v1/studio/jobs/${encodeURIComponent(id)}`, { signal }),
  };
}

export type StudioProject = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  currentVersionId: string | null;
  versionCount: number;
  latestJobId: string | null;
  latestPlanId: string | null;
  updatedAt: string;
  latestJob?: StudioJob | null;
};

export type StudioPlan = {
  id: string;
  projectId: string;
  /** analyzing | analysis_failed | awaiting_clarification | awaiting_approval | running | failed | completed */
  status: string;
  request: string;
  approvedAt: string | null;
  planningError: string | null;
  requirements: string[];
  assumptions: string[];
  questions: { text: string; kind: "material" | "informational" }[];
  materialQuestionsOpen: boolean;
  clarifications: { question: string; answer: string }[];
  steps: { index: number; title: string | null; instruction: string | null; status: string }[];
};

export type StudioJob = { id: string; projectId: string; status: string; error: string | null; versionId: string | null; createdAt: string; completedAt: string | null };

export type GamesClient = ReturnType<typeof createGamesClient>;

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** A stable per-browser device label for lease hand-over messages; content-free. */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "device";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1)) return "tablet";
  if (/iPhone|Android/.test(ua)) return "phone";
  return "computer";
}
