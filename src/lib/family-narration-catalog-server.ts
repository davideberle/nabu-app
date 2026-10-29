// Server-only: the narration catalogue of every child's SERVED content (Isabel Visit 2, 2026-10-29). Only these reviewed lines
// can be fetched as clips or prepared; a capped/switched-off content contributes nothing.
import { loadLearningContentFor } from "./family-learning-content-server";
import { narrationCatalog, type NarrationLine } from "./family-learning-narration";

export function servedNarrationCatalog(): NarrationLine[] {
  const out = new Map<string, NarrationLine>();
  for (const child of ["isabel", "santiago"] as const) {
    let content = null;
    try {
      content = loadLearningContentFor(child);
    } catch {
      content = null;
    }
    if (content) for (const l of narrationCatalog(content)) out.set(l.id, l);
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
