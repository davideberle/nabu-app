// Centralized ingredient display normalization — prefer metric when both
// imperial and metric measurements are present. Pure function, safe for
// client and server components.

/**
 * Normalize an ingredient's amount + item for display, preferring metric
 * measurements when both imperial and metric are present in the source data.
 *
 * Common cookbook patterns handled:
 *   amount "2 ounces (50 g)"          → "50 g"
 *   amount "½ cup (120 ml)"           → "120 ml"
 *   amount "28 ounces/800 g"          → "800 g"
 *   item   "gallon (4 L) water"       → amount absorbs "4 L", item becomes "water"
 *   item   "ounces dried soba noodles" → unit merges into amount for further normalization
 */
export function normalizeIngredient(
  rawAmount: string,
  rawItem: string,
): { amount: string; item: string } {
  let a = (rawAmount ?? "").trim();
  let it = (rawItem ?? "").trim();

  // 1. If item starts with an imperial unit word, merge it into the amount.
  //    e.g. amount "9", item "ounces dried soba noodles" → "9 ounces" / "dried soba noodles"
  const itemUnitRe =
    /^(ounces?|oz\.?|pounds?|lbs?\.?|cups?|gallons?|pints?|quarts?|fl\.?\s*oz\.?)\b\s*(.*)/i;
  const itemUnitMatch = it.match(itemUnitRe);
  if (itemUnitMatch && /^[\d½¼¾⅓⅔⅛]/.test(a)) {
    a = `${a} ${itemUnitMatch[1]}`;
    it = itemUnitMatch[2].replace(/^[,\s*]+/, "");
    // If item now starts with "(M metric) rest", merge the parens into amount
    // so step 2 can extract the metric value.
    // e.g. amount "1 gallon", item "(4 L) water" → amount "1 gallon (4 L)", item "water"
    const leadingParens = it.match(/^(\([^)]*\d\s*(?:g|kg|ml|l|L)\b[^)]*\))\s*(.*)/i);
    if (leadingParens) {
      a = `${a} ${leadingParens[1]}`;
      it = leadingParens[2].trim();
    }
  }

  // 2. Amount: "N imperial (M metric)" → extract metric part.
  //    Matches patterns like "2 ounces (50 g)", "½ cup (120 ml)"
  const impMetricParens = a.match(
    /[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/–—.,\-]*\s*(?:ounces?|oz\.?|pounds?|lbs?\.?|cups?|gallons?|pints?|quarts?|fl\.?\s*oz\.?)\s*\(([^)]*\d\s*(?:g|kg|ml|l|L)\b[^)]*)\)/i,
  );
  if (impMetricParens) {
    a = impMetricParens[1].trim();
  }

  // 3. Amount: "N imperial/M metric" → extract metric part.
  //    Matches "28 ounces/800 g"
  if (!impMetricParens) {
    const impSlashMetric = a.match(
      /[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/–—.,\-]*\s*(?:ounces?|oz\.?|pounds?|lbs?\.?)\s*\/\s*([\d,.]+ *(?:g|kg|ml|l|L)\b)/i,
    );
    if (impSlashMetric) {
      a = impSlashMetric[1].trim();
    }
  }

  // 3b. Standalone ounces/oz (no metric alternative) → approximate grams.
  //     Handles "4 ounces", "8 oz", "½ ounce", "10½ oz." etc.
  //     1 oz ≈ 28 g. Skips fl oz (fluid ounces).
  if (
    /\b(?:ounces?|oz\.?)\s*$/i.test(a) &&
    !/\bfl\.?\s/i.test(a) &&
    !/\b(?:g|kg|ml|l|L)\b/.test(a)
  ) {
    const ozMatch = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:ounces?|oz\.?)$/i,
    );
    if (ozMatch) {
      const raw = ozMatch[1].trim();
      const VULGAR: Record<string, number> = {
        "½": 0.5, "¼": 0.25, "¾": 0.75,
        "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125,
      };
      let num = 0;
      let rest = raw;
      for (const [ch, val] of Object.entries(VULGAR)) {
        if (rest.includes(ch)) {
          const idx = rest.indexOf(ch);
          const before = rest.substring(0, idx).trim();
          num += (before ? parseFloat(before) || 0 : 0) + val;
          rest = rest.substring(idx + ch.length).trim();
        }
      }
      if (rest) {
        const n = parseFloat(rest);
        if (!isNaN(n)) num += n;
      }
      if (num > 0) {
        const grams = Math.round(num * 28);
        const rounded = grams > 50 ? Math.round(grams / 5) * 5 : grams;
        a = `${rounded} g`;
      }
    }
  }

  // 4. Item contains "imperial (M metric) rest" with a bare-number amount.
  //    e.g. amount "1", item "gallon (4 L) water" → "4 L" / "water"
  if (/^[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/–—\-]*$/.test(a)) {
    const itemInlineMetric = it.match(
      /^.*?(?:ounces?|oz\.?|pounds?|lbs?\.?|cups?|gallons?|pints?|quarts?)\s*\((\d[\d.,]*\s*(?:g|kg|ml|l|L))\)\s*(.*)/i,
    );
    if (itemInlineMetric) {
      a = itemInlineMetric[1].trim();
      it = itemInlineMetric[2].trim() || it;
    }
  }

  // 5. Strip parenthesized imperial from items: "(4 cm)" is fine, "(1½ in)" is not.
  it = it.replace(/\s*\([^)]*\b(?:inch|inches|in)\b[^)]*\)/gi, "");

  // 6. Abbreviate verbose metric unit words in the amount.
  a = a
    .replace(/\btablespoons?\b/gi, "tbsp")
    .replace(/\bteaspoons?\b/gi, "tsp")
    .replace(/\bkilograms?\b/gi, "kg")
    .replace(/\bgrams?\b(?!\w)/gi, "g")
    .replace(/\bmillilitres?\b/gi, "ml")
    .replace(/\blitres?\b/gi, "L")
    .replace(/\s+/g, " ")
    .trim();

  return { amount: a, item: it };
}
