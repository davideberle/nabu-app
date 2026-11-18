// ---------------------------------------------------------------------------------------------------------------------
// Isabel's narrated scene — what ONE tap on «Weiter» does (Nov 18 review, Visit 4 «Bauen wir ihnen ein Haus?» was never heard).
//
// The rule: no spoken line may be skipped and nothing may advance before its narration ends; only the child's own tap moves on.
// A tap may cause several writes (finish a beat, leave it, open the next), but every state the screen passes through WITHOUT a
// new tap must have nothing to say — otherwise its line would start and be superseded at once. So:
//  - an unfinished story, craft or outcome beat: the tap finishes it and STAYS — its done line(s) are shown and spoken there, and
//    «Weiter» waits for them (before Nov 18 the same tap also left the beat, which cut the done line off);
//  - a finished beat: the tap leaves it; the scene then opens the next beat (the in-between state has no beat, so nothing to say);
//  - no beat open: open the next one.
// Isomorphic and dependency-free (node --test covers it with the real engine and every bundled narrated mission).
// ---------------------------------------------------------------------------------------------------------------------

export type BeatTap = "finish-beat" | "leave" | "open-next";

export function narratedBeatTap(active: { kind: string; status: string } | null | undefined): BeatTap {
  if (!active) return "open-next";
  if (active.status === "active" && (active.kind === "story" || active.kind === "outcome" || active.kind === "craft")) return "finish-beat";
  return "leave";
}
