// Centralized ingredient display normalization — prefer metric when both
// imperial and metric measurements are present. Pure function, safe for
// client and server components.

const VULGAR: Record<string, number> = {
  "½": 0.5, "¼": 0.25, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125,
};

/** Parse a string like "1½", "3.5", "10½" into a number. Returns 0 on failure. */
function parseNum(raw: string): number {
  let num = 0;
  let rest = raw.trim();
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
  return num;
}

// Regex fragment matching imperial weight unit words
const IMP_WT = "ounces?|oz\\.?|pounds?|lbs?\\.?";
// Regex fragment matching imperial volume unit words
const IMP_VOL = "cups?|gallons?|pints?|quarts?|fl\\.?\\s*oz\\.?";
// Combined imperial units
const IMP_ALL = `${IMP_WT}|${IMP_VOL}`;
// Metric units (includes common misspelling "gr" for grams)
const METRIC_U = "g|gr|kg|ml|l|L|dl";

/**
 * Normalize an ingredient's amount + item for display, preferring metric
 * measurements when both imperial and metric are present in the source data.
 */
export function normalizeIngredient(
  rawAmount: string,
  rawItem: string,
): { amount: string; item: string } {
  let a = (rawAmount ?? "").trim();
  let it = (rawItem ?? "").trim();

  // ── 1. If item starts with an imperial unit word, merge it into the amount.
  //    e.g. amount "9", item "ounces dried soba noodles" → "9 ounces" / "dried soba noodles"
  const itemUnitRe = new RegExp(
    `^(${IMP_ALL})\\b\\s*(.*)`, "i",
  );
  const itemUnitMatch = it.match(itemUnitRe);
  if (itemUnitMatch && /^[\d½¼¾⅓⅔⅛]/.test(a)) {
    a = `${a} ${itemUnitMatch[1]}`;
    it = itemUnitMatch[2].replace(/^[,\s*]+/, "");
    // If item now starts with "(M metric) rest", merge the parens into amount
    // so step 2 can extract the metric value.
    const leadingParens = it.match(
      new RegExp(`^(\\([^)]*\\d\\s*(?:${METRIC_U})\\b[^)]*\\))\\s*(.*)`, "i"),
    );
    if (leadingParens) {
      a = `${a} ${leadingParens[1]}`;
      it = leadingParens[2].trim();
    }
  }

  // ── 1b. After merging unit, if item starts with "/Mg rest" (slash-metric
  //    leftover), pull the metric value into amount and strip from item.
  //    e.g. amount "9 oz", item "/250g spaghetti" → amount "250 g", item "spaghetti"
  {
    const slashMetricLead = it.match(
      new RegExp(`^/\\s*([\\d.,]+\\s*(?:${METRIC_U}))\\b\\s*(.*)`, "i"),
    );
    if (slashMetricLead && new RegExp(`\\b(?:${IMP_ALL})`, "i").test(a)) {
      a = slashMetricLead[1].trim();
      it = slashMetricLead[2].replace(/^[,\s]+/, "").trim();
    }
  }

  // ── 2. Amount: "N imperial (M metric)" → extract metric part.
  //    Matches patterns like "2 ounces (50 g)", "½ cup (120 ml)"
  const impMetricParens = a.match(
    new RegExp(
      `[\\d½¼¾⅓⅔⅛][\\d\\s½¼¾⅓⅔⅛/–—.,\\-]*\\s*(?:${IMP_ALL})\\s*\\(([^)]*\\d\\s*(?:${METRIC_U})\\b[^)]*)\\)`,
      "i",
    ),
  );
  if (impMetricParens) {
    a = impMetricParens[1].trim();
  }

  // ── 3. Amount: "N imperial/M metric" → extract metric part.
  //    Matches "28 ounces/800 g", "1½ oz / 40 g"
  if (!impMetricParens) {
    const impSlashMetric = a.match(
      new RegExp(
        `[\\d½¼¾⅓⅔⅛][\\d\\s½¼¾⅓⅔⅛/–—.,\\-]*\\s*(?:${IMP_WT})\\s*/\\s*([\\d,.]+\\s*(?:${METRIC_U})\\b)`,
        "i",
      ),
    );
    if (impSlashMetric) {
      a = impSlashMetric[1].trim();
    }
  }

  // ── 3a-pre. Compound "N lb" amount + "M oz/Xkg rest" item → extract metric.
  //    e.g. amount "2 lb", item "2 oz/1kg potatoes" → "1 kg" / "potatoes"
  //    Must run before standalone lb conversion (3c) would consume the amount.
  {
    const compoundLbOz = it.match(
      new RegExp(
        `^[\\d½¼¾⅓⅔⅛][\\d\\s½¼¾⅓⅔⅛/.,-]*\\s*(?:${IMP_WT})\\s*[/–—]\\s*([\\d.,]+\\s*(?:${METRIC_U}))\\b\\s*(.*)`,
        "i",
      ),
    );
    if (compoundLbOz && /\b(?:lbs?|pounds?)\b/i.test(a)) {
      a = compoundLbOz[1].trim();
      it = compoundLbOz[2].replace(/^[,\s]+/, "").trim();
    }
  }

  // ── 3a2. Amount range with imperial: "4 to 5 oz" or "2–3 pounds" → convert to metric range.
  {
    const rangeOz = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:to|–|—|-)\s*([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(ounces?|oz\.?|pounds?|lbs?\.?)$/i,
    );
    if (rangeOz && !/\bfl\.?\s/i.test(a)) {
      const lo = parseNum(rangeOz[1]);
      const hi = parseNum(rangeOz[2]);
      const unit = rangeOz[3].toLowerCase();
      const factor = /^(?:pound|lb)/i.test(unit) ? 454 : 28;
      if (lo > 0 && hi > 0) {
        const gLo = Math.round(lo * factor);
        const gHi = Math.round(hi * factor);
        const rLo = gLo > 50 ? Math.round(gLo / 5) * 5 : gLo;
        const rHi = gHi > 50 ? Math.round(gHi / 5) * 5 : gHi;
        if (rHi >= 1000) {
          a = `${(rLo / 1000).toFixed(1).replace(/\.0$/, "")}–${(rHi / 1000).toFixed(1).replace(/\.0$/, "")} kg`;
        } else {
          a = `${rLo}–${rHi} g`;
        }
      }
    }
  }

  // ── 3a3. Amount "N lb (N cups)" → convert lb to grams, keep cups in parens.
  //    e.g. "1 lb (3 cups)" → "455 g (3 cups)"
  {
    const lbCups = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:lbs?|pounds?)\s*(\(.*cups?\s*\))$/i,
    );
    if (lbCups) {
      const num = parseNum(lbCups[1]);
      if (num > 0) {
        const grams = Math.round(num * 454);
        const rounded = grams > 50 ? Math.round(grams / 5) * 5 : grams;
        a = `${rounded} g ${lbCups[2]}`;
      }
    }
  }

  // ── 3b. Standalone ounces/oz (no metric alternative) → approximate grams.
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
      const num = parseNum(ozMatch[1]);
      if (num > 0) {
        const grams = Math.round(num * 28);
        const rounded = grams > 50 ? Math.round(grams / 5) * 5 : grams;
        a = `${rounded} g`;
      }
    }
  }

  // ── 3c. Standalone pounds/lb (no metric alternative) → approximate grams/kg.
  //     Handles "2 pounds", "1½ lb" etc.
  if (
    /\b(?:pounds?|lbs?\.?)\s*$/i.test(a) &&
    !/\b(?:g|kg|ml|l|L)\b/.test(a)
  ) {
    const lbMatch = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:pounds?|lbs?\.?)$/i,
    );
    if (lbMatch) {
      const num = parseNum(lbMatch[1]);
      if (num > 0) {
        const grams = Math.round(num * 454);
        if (grams >= 1000) {
          const kg = (grams / 1000).toFixed(1).replace(/\.0$/, "");
          a = `${kg} kg`;
        } else {
          const rounded = grams > 50 ? Math.round(grams / 5) * 5 : grams;
          a = `${rounded} g`;
        }
      }
    }
  }

  // ── 4. Item contains parenthesized "(imperial / metric)" → extract metric,
  //    strip the parenthetical. Handles:
  //      "block (14 ounces/400 g) firm tofu"
  //      "medium eggplants (2 lb/900 g)"
  //      "whole chicken (about 3 lb/1.4kg)"
  //      "white bread slices, crusts removed (3 oz / 80 g in total)"
  {
    const parenImpMetric = it.match(
      new RegExp(
        `\\(([^)]*?)\\b(?:${IMP_WT})\\s*[/,]?\\s*([\\d.,]+\\s*(?:${METRIC_U}))\\b([^)]*)\\)`,
        "i",
      ),
    );
    if (parenImpMetric) {
      const metricVal = parenImpMetric[2].trim();
      const suffix = parenImpMetric[3].replace(/\bin total\b/i, "").trim();
      // Replace the parenthetical with just the metric value if useful
      it = it.replace(parenImpMetric[0], suffix ? `(${metricVal} ${suffix})` : `(${metricVal})`).trim();
      // Clean up empty parens or parens with just metric value when amount is bare number
      if (/^[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/–—\-]*$/.test(a)) {
        // Absorb metric into amount if it's the only useful info
        it = it.replace(new RegExp(`\\(\\s*${metricVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`), "").trim();
        a = metricVal;
      }
    }
  }

  // ── 4b. Item contains parenthesized "(N lb/kg)" with only lb+metric (no oz).
  //    e.g. "whole chicken (about 3 lb/1.4kg)" → extract 1.4kg
  {
    const parenLbMetric = it.match(
      new RegExp(
        `\\([^)]*?\\b(?:pounds?|lbs?\\.?)\\s*[/,]?\\s*([\\d.,]+\\s*(?:${METRIC_U}))\\b[^)]*\\)`,
        "i",
      ),
    );
    if (parenLbMetric) {
      const metricVal = parenLbMetric[1].trim();
      it = it.replace(parenLbMetric[0], "").replace(/\s{2,}/g, " ").trim();
      // Only absorb into amount if amount is a bare count (no unit)
      if (/^[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/–—\-]*$/.test(a)) {
        // Keep the count and add metric as context — but if it's a descriptive
        // count (like "3 medium eggplants"), the metric is weight context.
        // We leave amount as-is and add metric info as parenthetical in item.
        it = it.replace(/,?\s*$/, "") + ` (${metricVal})`;
      }
    }
  }

  // ── 5. Item: embedded "N oz / M g" or "N oz/Mg" NOT in parentheses.
  //    e.g. item "scant 1 oz / 25 g chives, chopped" → amount "25 g", item "chives, chopped"
  //    Only when amount is empty or a bare number/descriptor.
  {
    const inlineImpMetric = it.match(
      new RegExp(
        `^(.*?)(?:scant\\s+|about\\s+|roughly\\s+)?[\\d½¼¾⅓⅔⅛][\\d\\s½¼¾⅓⅔⅛/.,-]*\\s*(?:${IMP_WT})\\s*[/–—]\\s*([\\d.,]+\\s*(?:${METRIC_U}))\\b\\s*(.*)`,
        "i",
      ),
    );
    if (inlineImpMetric && (!a || /^[\d½¼¾⅓⅔⅛\s.,-]*$/.test(a))) {
      const prefix = inlineImpMetric[1].trim();
      const metricVal = inlineImpMetric[2].trim();
      const rest = inlineImpMetric[3].replace(/^[,\s]+/, "").trim();
      if (!a) {
        a = metricVal;
        it = prefix ? `${prefix} ${rest}`.trim() : rest;
      } else {
        // Amount has a number already — append metric there
        a = metricVal;
        it = prefix ? `${prefix} ${rest}`.trim() : rest;
      }
    }
  }

  // ── 6. N-ounce/oz can/tin/jar → convert to metric can size.
  //    e.g. "15-ounce can kidney beans" → "425 g can kidney beans"
  //    Also handles mid-item: "or 1 8-ounce can corn" and "(10.5 oz.) can"
  //    and "One 13½-ounce can coconut milk"
  {
    const CONTAINERS = "cans?|tins?|jars?|bottles?|bags?|cartons?|containers?|boxes?|packs?";
    // At start of item: "15-ounce can ..."
    it = it.replace(
      new RegExp(`(^|\\b(?:one|two|three|1|2|3|4)\\s+)(\\d+[½¼¾⅓⅔]?)-(ounces?|oz)\\.?\\s+(${CONTAINERS})\\b`, "gi"),
      (_m, pre, num, _unit, container) => {
        const n = parseNum(num);
        const g = n > 0 ? (Math.round(n * 28) > 50 ? Math.round(Math.round(n * 28) / 5) * 5 : Math.round(n * 28)) : 0;
        return g > 0 ? `${pre}${g} g ${container}` : _m;
      },
    );
    // Parenthesized: "(10.5 oz.) can"
    it = it.replace(
      new RegExp(`\\((\\d+\\.?\\d*)\\s*(?:oz\\.?|ounces?)\\)\\s+(${CONTAINERS})\\b`, "gi"),
      (_m, num, container) => {
        const n = parseFloat(num);
        const g = n > 0 ? (Math.round(n * 28) > 50 ? Math.round(Math.round(n * 28) / 5) * 5 : Math.round(n * 28)) : 0;
        return g > 0 ? `(${g} g) ${container}` : _m;
      },
    );
  }

  // ── 6a2. Parenthesized can size: "(28-ounce) can" or "(13.5-oz) can"
  {
    const CONTAINERS = "cans?|tins?|jars?|bottles?|bags?|cartons?|containers?|boxes?|packs?";
    it = it.replace(
      new RegExp(`\\((\\d+\\.?\\d*)[- ](?:ounces?|oz\\.?)\\)\\s*(${CONTAINERS})\\b`, "gi"),
      (_m, num, container) => {
        const n = parseFloat(num);
        const g = n > 0 ? (Math.round(n * 28) > 50 ? Math.round(Math.round(n * 28) / 5) * 5 : Math.round(n * 28)) : 0;
        return g > 0 ? `(${g} g) ${container}` : _m;
      },
    );
  }

  // ── 6a3. "can (N ounces / M ml)" or "can (13.5 to 14 ounces / 400 to 414 ml)"
  //    → "can (M ml)" — keep metric, strip imperial within can description.
  it = it.replace(
    new RegExp(
      `((?:cans?|tins?|jars?)\\s*)\\([^)]*?\\b(?:${IMP_WT})\\b[^)]*?\\b(\\d[\\d.,]*\\s*(?:${METRIC_U}))\\b[^)]*\\)`,
      "gi",
    ),
    "$1($2)",
  );

  // ── 6a4. Parenthesized imperial-only in item: "(¼ lb)" → convert to "(115 g)"
  //    Only for weight units, not volumes.
  it = it.replace(
    /\(\s*(?:about\s+)?([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:lbs?|pounds?)\s*\)/gi,
    (_m, num) => {
      const n = parseNum(num);
      if (n <= 0) return _m;
      const g = Math.round(n * 454);
      if (g >= 1000) {
        const kg = (g / 1000).toFixed(1).replace(/\.0$/, "");
        return `(${kg} kg)`;
      }
      return `(${Math.round(g / 5) * 5} g)`;
    },
  );
  it = it.replace(
    /\(\s*(?:about\s+)?([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(?:oz\.?|ounces?)\s*\)/gi,
    (_m, num) => {
      const n = parseNum(num);
      if (n <= 0) return _m;
      const g = Math.round(n * 28);
      return `(${g > 50 ? Math.round(g / 5) * 5 : g} g)`;
    },
  );

  // ── 6a5. Parenthesized "N pounds, or M g" → keep metric.
  //    e.g. "(12/3 pounds, or 750 g)" → "(750 g)"
  it = it.replace(
    new RegExp(
      `\\([^)]*?\\b(?:${IMP_WT})\\b[^)]*?,\\s*(?:or\\s+)?(\\d[\\d.,]*\\s*(?:${METRIC_U}))\\b[^)]*\\)`,
      "gi",
    ),
    "($1)",
  );

  // ── 6b. Item: "about N pounds (M kg)" or "N pounds (M kg)" inline text
  //    → strip the imperial part, keep metric in parens.
  it = it.replace(
    new RegExp(
      `(?:about\\s+)?[\\d½¼¾⅓⅔⅛][\\d\\s½¼¾⅓⅔⅛/.,-]*\\s*(?:${IMP_WT})\\s*(\\([\\d.,]+\\s*(?:${METRIC_U})\\))`,
      "gi",
    ),
    "$1",
  );

  // ── 6c. Item: bracket-notation metric "[225 g]" after imperial → keep metric, strip brackets.
  //    e.g. "(about ½ lb [225 g])" → "(225 g)"
  it = it.replace(
    /\([^)]*?\b(?:lbs?|pounds?|oz|ounces?)\b[^)]*?\[(\d[\d.,]*\s*(?:g|gr|kg|ml|l|L))\][^)]*\)/gi,
    "($1)",
  );

  // ── 7. Strip parenthesized imperial dimensions from items: "(4 cm)" is fine, "(1½ in)" is not.
  it = it.replace(/\s*\([^)]*\b(?:inch|inches|in)\b[^)]*\)/gi, "");

  // ── 7b. Strip remaining imperial dimension text: "¾-inch/2-cm" → "2 cm"
  it = it.replace(
    /[\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*-?(?:inch|in)\s*[/–—]\s*([\d.,]+\s*cm)\b/gi,
    "$1",
  );

  // ── 8. Amount: strip parenthesized imperial when metric already leads.
  //    e.g. "800g (1lb 12oz)" → "800g"
  if (/\b(?:g|kg|ml|l|L|dl)\b/.test(a)) {
    a = a.replace(
      new RegExp(`\\s*\\([^)]*\\b(?:${IMP_ALL})\\b[^)]*\\)`, "gi"),
      "",
    );
  }

  // ── 9. Abbreviate verbose metric unit words in the amount.
  a = a
    .replace(/\btablespoons?\b/gi, "tbsp")
    .replace(/\bteaspoons?\b/gi, "tsp")
    .replace(/\bkilograms?\b/gi, "kg")
    .replace(/\bgrams?\b(?!\w)/gi, "g")
    .replace(/\bgr\b/gi, "g")
    .replace(/\bmillilitres?\b/gi, "ml")
    .replace(/\blitres?\b/gi, "L")
    .replace(/\bdecilitres?\b/gi, "dl")
    .replace(/\s+/g, " ")
    .trim();

  // Final cleanup: remove stray leading commas/slashes, collapse spaces, fix ", ," etc.
  it = it
    .replace(/^[/,\s]+/, "")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { amount: a, item: it };
}
