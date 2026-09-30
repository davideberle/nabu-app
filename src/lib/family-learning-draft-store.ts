// ---------------------------------------------------------------------------
// Bounded recovery of COMPLETED, explicitly submitted drafts whose request
// failed (independent repair R4-2): the fresh transfer sentence and the
// reflection answers. Nothing else is ever stored — no keystroke autosave,
// no second progress store.
//
// A draft is written only when the child has pressed the submit control, is
// keyed by child and op, and is bound to the exact identity the server view
// stated at that moment (mission content version, visit instance, erasure
// generation, stage, sign-in fingerprint). It is restored only into the same
// identity; any mismatch retires it before its content is exposed or sent.
// It is retired when the request is reconciled (applied, replayed or stale),
// when the child discards it deliberately, when the workspace is left, on a
// child switch / sign-out (fingerprint), and after erasure (generation).
// Storage is the tab's sessionStorage (same origin, closed with the tab).
// ---------------------------------------------------------------------------

export type DraftIdentity = {
  child: string;
  contentVersion: number;
  visitId: string;
  visitStartedAt: string;
  erasureGeneration: number;
  stage: string;
  /** Content-free fingerprint of the current sign-in (server-provided); null when unknown. */
  session: string | null;
};

export type DraftOp = "write-transfer" | "reflect";

export type StoredDraft = {
  v: 1;
  identity: DraftIdentity;
  op: DraftOp;
  payload: Record<string, unknown>;
  payloadKey: string;
  idempotencyKey: string;
  savedAt: number;
};

export type DraftStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };

const PREFIX = "family-learning-draft";
const OPS: DraftOp[] = ["write-transfer", "reflect"];
const MAX_BYTES = 4096;

export const draftKey = (child: string, op: DraftOp): string => `${PREFIX}:${child}:${op}`;

export function identityMatches(stored: DraftIdentity, current: DraftIdentity): boolean {
  if (stored.child !== current.child || stored.contentVersion !== current.contentVersion) return false;
  if (stored.visitId !== current.visitId || stored.visitStartedAt !== current.visitStartedAt) return false;
  if (stored.erasureGeneration !== current.erasureGeneration || stored.stage !== current.stage) return false;
  // A different sign-in (or an unknown one on either side) never restores private content.
  if (stored.session === null || current.session === null || stored.session !== current.session) return false;
  return true;
}

export function saveDraft(storage: DraftStorage | null, draft: StoredDraft): boolean {
  if (!storage) return false;
  const text = JSON.stringify(draft);
  if (text.length > MAX_BYTES) return false;
  try {
    storage.setItem(draftKey(draft.identity.child, draft.op), text);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null, child: string, op: DraftOp): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(child, op));
  } catch {
    /* storage unavailable */
  }
}

export function clearChildDrafts(storage: DraftStorage | null, child: string): void {
  for (const op of OPS) clearDraft(storage, child, op);
}

/**
 * R5-3: retire every completed draft in this storage (all children, both ops) — the sign-in is gone
 * (real sign-out, expired session, sign-in page shown, 401 answered). Only this module's keys are
 * touched; unrelated storage is never cleared.
 */
export function retireAllDrafts(storage: (DraftStorage & { length?: number; key?: (index: number) => string | null }) | null): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    if (typeof storage.key === "function" && typeof storage.length === "number") {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(PREFIX + ":")) keys.push(k);
      }
      for (const k of keys) {
        storage.removeItem(k);
        removed += 1;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return removed;
}

/** The stored draft for this exact identity and op, or null; a stored draft that does not match is retired. */
export function loadDraft(storage: DraftStorage | null, identity: DraftIdentity, op: DraftOp): StoredDraft | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(draftKey(identity.child, op));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft(storage, identity.child, op);
    return null;
  }
  if (!isStoredDraft(parsed) || parsed.op !== op || !identityMatches(parsed.identity, identity)) {
    clearDraft(storage, identity.child, op);
    return null;
  }
  return parsed;
}

/** Retire every draft of this child whose identity is not the current one (stage moved on, visit changed, erased, other sign-in). */
export function retireMismatched(storage: DraftStorage | null, identity: DraftIdentity): void {
  if (!storage) return;
  for (const op of OPS) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(draftKey(identity.child, op));
    } catch {
      return;
    }
    if (!raw) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      clearDraft(storage, identity.child, op);
      continue;
    }
    if (!isStoredDraft(parsed) || !identityMatches(parsed.identity, identity)) clearDraft(storage, identity.child, op);
  }
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const id = v.identity as Record<string, unknown> | undefined;
  return (
    v.v === 1 &&
    (v.op === "write-transfer" || v.op === "reflect") &&
    typeof v.payload === "object" &&
    v.payload !== null &&
    typeof v.payloadKey === "string" &&
    typeof v.idempotencyKey === "string" &&
    typeof v.savedAt === "number" &&
    !!id &&
    typeof id.child === "string" &&
    typeof id.contentVersion === "number" &&
    typeof id.visitId === "string" &&
    typeof id.visitStartedAt === "string" &&
    typeof id.erasureGeneration === "number" &&
    typeof id.stage === "string" &&
    (id.session === null || typeof id.session === "string")
  );
}
