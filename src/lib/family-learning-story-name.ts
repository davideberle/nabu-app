// Nov 21 (Isabel Visit 6 «Das Küken schlüpft»): the name field for her chick. Isomorphic and dependency-free, so the child's
// screen can use it without the mission engine. The server still decides (`sanitizeStoryName`: letters only, 2–12).

/** What the name field keeps while she types: letters only (any alphabet, umlauts included), at most `max`. */
export function cleanStoryNameInput(raw: string, max = 12): string {
  return raw.normalize("NFC").replace(/[^\p{L}]/gu, "").slice(0, max);
}
