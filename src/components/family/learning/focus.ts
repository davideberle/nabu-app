"use client";

// ---------------------------------------------------------------------------
// Deliberate keyboard focus for the learning workspace (world-first
// 2026-10-03; UX-3). Focus moves to the active answer field exactly at an
// intentional task transition (a stage, item, line or lesson change) — never
// on every render — and never while another control was deliberately chosen:
// the tutor panel, a dialog, the child switcher, or any focused interactive
// element outside the workspace. Composition (IME) is respected: Enter during
// composition neither submits nor commits.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type FocusGate = () => boolean;

function focusIsFree(root: HTMLElement | null, within: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;
  // Inside the task's own form (e.g. the second number field of the same item) a phase transition may move focus to its first field.
  if (within && within.contains(active)) return true;
  // Anything deliberately focused outside the workspace (tutor panel, shell bar, dialogs) keeps focus.
  if (root && !root.contains(active)) return false;
  // A focused button/link inside the workspace is a deliberate choice too (the child is navigating with Tab).
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return false;
  return true;
}

/**
 * Focus `ref` when `key` changes (mount, stage/item/line transition) if nothing
 * else is deliberately focused and the gate allows it (e.g. tutor panel
 * closed, no dialog). Returns nothing; the element keeps its own focus
 * afterwards (typing does not re-trigger).
 */
export function useDeliberateFocus<T extends HTMLElement>(ref: React.RefObject<T | null>, key: string | number | boolean | null, options: { gate?: FocusGate; root?: React.RefObject<HTMLElement | null>; within?: React.RefObject<HTMLElement | null>; enabled?: boolean } = {}) {
  const last = useRef<string | number | boolean | null | undefined>(undefined);
  useEffect(() => {
    if (options.enabled === false) return;
    if (last.current === key) return;
    last.current = key;
    const el = ref.current;
    if (!el) return;
    if (options.gate && !options.gate()) return;
    if (!focusIsFree(options.root?.current ?? null, options.within?.current ?? null)) return;
    // Defer one frame so the element exists after a stage swap and so a focus-visible ring is not shown for a programmatic move.
    const id = window.requestAnimationFrame(() => {
      try {
        el.focus({ preventScroll: false });
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [key, ref, options.gate, options.root, options.within, options.enabled]);
}

/** True while an IME composition is active for this key event (Enter must not submit then). */
export function isComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
  return native.isComposing === true || native.keyCode === 229;
}

/** Remember the element focused before a panel opened and restore it deliberately when the panel closes. */
export function useRestoreFocus(open: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      previous.current = (document.activeElement as HTMLElement | null) ?? null;
      return;
    }
    const target = previous.current;
    previous.current = null;
    if (target && document.contains(target)) {
      const id = window.requestAnimationFrame(() => target.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);
}
