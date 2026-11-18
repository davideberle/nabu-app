// ---------------------------------------------------------------------------------------------------------------------
// Where a learning visit ends (Nov 18 review): on the learning Home screen — the child's map at `/family/learn` — never on
// Family Home (`/family/home`), which leaves the learning app. Both end paths use this: Isabel's spoken goodbye («Nach Hause»)
// and Santiago's look back («Fertig»). Isomorphic and dependency-free (node --test).
// ---------------------------------------------------------------------------------------------------------------------

export const LEARNING_HOME_PATH = "/family/learn";

/** The learning Home screen (the map) of a child. */
export function learningHomeHref(child: string): string {
  return `${LEARNING_HOME_PATH}?child=${encodeURIComponent(child)}`;
}
