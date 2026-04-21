// Centralized ingredient display normalization — prefer metric when both
// imperial and metric measurements are present. Pure function, safe for
// client and server components.

const VULGAR: Record<string, number> = {
  "½": 0.5, "¼": 0.25, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125,
};

/** Map of spelled-out number words to their numeric values (0–20). */
const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

/** Try to parse a leading spelled-out number word. Returns [value, rest] or null. */
function parseWordNum(s: string): [number, string] | null {
  const m = s.match(/^(\w+)\b\s*(.*)/);
  if (!m) return null;
  const val = WORD_NUMS[m[1].toLowerCase()];
  return val !== undefined && val > 0 ? [val, m[2]] : null;
}

/** Convert ounces to display grams string (rounded to nearest 5 above 50). */
function ozToG(n: number): string {
  const g = Math.round(n * 28);
  const r = g > 50 ? Math.round(g / 5) * 5 : g;
  return `${r} g`;
}

/** Convert pounds to display grams/kg string. */
function lbToMetric(n: number): string {
  const g = Math.round(n * 454);
  if (g >= 1000) return `${(g / 1000).toFixed(1).replace(/\.0$/, "")} kg`;
  return `${g > 50 ? Math.round(g / 5) * 5 : g} g`;
}

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

  // ── 1c. Amount: "One N-ounce/pound [descriptor]" → convert to metric, move descriptor to item.
  //    e.g. "One 4-ounce Fuji apple" → amount "115 g", item "Fuji apple, ..."
  //    Also handles "One 15-ounce can" when item has more info.
  {
    const oneUnitRe = /^(one|two|three|four|1|2|3|4)\s+(\d+[½¼¾⅓⅔⅛]?)[\s-]*(ounces?|oz\.?|pounds?|lbs?\.?)\s*(.*)/i;
    const oneMatch = a.match(oneUnitRe);
    if (oneMatch) {
      const count = WORD_NUMS[oneMatch[1].toLowerCase()] ?? parseInt(oneMatch[1]);
      const weightNum = parseNum(oneMatch[2]);
      const unitWord = oneMatch[3].toLowerCase();
      const trailing = oneMatch[4].trim();
      if (weightNum > 0) {
        const isLb = /^(?:pound|lb)/i.test(unitWord);
        const metricStr = isLb ? lbToMetric(weightNum) : ozToG(weightNum);
        const prefix = count > 1 ? `${count} × ` : "";
        a = `${prefix}${metricStr}`;
        // Move trailing descriptor to beginning of item if present
        if (trailing) {
          it = trailing + (it ? (it.length <= 2 ? it : `, ${it}`) : "");
        }
      }
    }
  }

  // ── 1d. Item-only: "One pound of chickpeas" / "Salmon filet, one pound" / "Eight ounces of feta"
  //    When amount is empty and item contains spelled-out imperial weight.
  if (!a || /^\s*$/.test(a)) {
    // Leading: "One pound of X" / "Eight ounces of X"
    const leadSpelled = it.match(
      /^(\w+)\s+(pounds?|ounces?)\s+(?:of\s+)?(.+)/i,
    );
    if (leadSpelled) {
      const parsed = WORD_NUMS[leadSpelled[1].toLowerCase()];
      if (parsed && parsed > 0) {
        const unitW = leadSpelled[2].toLowerCase();
        const isLb = /^pound/i.test(unitW);
        a = isLb ? lbToMetric(parsed) : ozToG(parsed);
        it = leadSpelled[3].trim();
      }
    }
    // Trailing: "Salmon filet, one pound"
    if (!a || /^\s*$/.test(a)) {
      const trailSpelled = it.match(
        /^(.+?),?\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+(pounds?|ounces?)\s*$/i,
      );
      if (trailSpelled) {
        const parsed = WORD_NUMS[trailSpelled[2].toLowerCase()];
        if (parsed && parsed > 0) {
          const unitW = trailSpelled[3].toLowerCase();
          const isLb = /^pound/i.test(unitW);
          a = isLb ? lbToMetric(parsed) : ozToG(parsed);
          it = trailSpelled[1].trim();
        }
      }
    }
    // Leading: "One N-ounce/pound descriptor" in item when amount empty
    if (!a || /^\s*$/.test(a)) {
      const oneItemRe = it.match(
        /^(one|two|three|four|1|2|3|4)\s+(\d+[½¼¾⅓⅔⅛]?)[\s-]*(ounces?|oz\.?|pounds?|lbs?\.?)\s+(.*)/i,
      );
      if (oneItemRe) {
        const count = WORD_NUMS[oneItemRe[1].toLowerCase()] ?? parseInt(oneItemRe[1]);
        const weightNum = parseNum(oneItemRe[2]);
        const unitWord = oneItemRe[3].toLowerCase();
        const rest = oneItemRe[4].trim();
        if (weightNum > 0) {
          const isLb = /^(?:pound|lb)/i.test(unitWord);
          const metricStr = isLb ? lbToMetric(weightNum) : ozToG(weightNum);
          const prefix = count > 1 ? `${count} × ` : "";
          a = `${prefix}${metricStr}`;
          it = rest;
        }
      }
    }
  }

  // ── 1e. Item-only container: "14.5 ounces can diced tomatoes" / "8-oz. cream cheese"
  //    / "15-ounce can black beans" / "28-ounce can crushed fire-roasted tomatoes"
  //    When amount is empty or just a count, and item leads with imperial size + container.
  {
    const CONTAINERS = "cans?|tins?|jars?|bottles?|bags?|cartons?|containers?|boxes?|packs?|packages?|packets?";
    // "N ounces can X" or "N-ounce can X" or "N oz. can X" or "N-oz. X" (product like cream cheese)
    const itemLeadImp = it.match(
      new RegExp(
        `^(\\d+\\.?\\d*)[\\s-]*(ounces?|oz\\.?|pounds?|lbs?\\.?)\\s+(?:(${CONTAINERS})\\b\\s*)?(.*)`,
        "i",
      ),
    );
    if (itemLeadImp && (!a || /^(1|2|3|4|one|two|three|four)?\s*$/i.test(a))) {
      const sizeNum = parseFloat(itemLeadImp[1]);
      const unitW = itemLeadImp[2].toLowerCase();
      const container = itemLeadImp[3] || "";
      const rest = itemLeadImp[4].trim();
      if (sizeNum > 0 && !/\bfl\.?\s/i.test(unitW)) {
        const isLb = /^(?:pound|lb)/i.test(unitW);
        const metricStr = isLb ? lbToMetric(sizeNum) : ozToG(sizeNum);
        const countPre = a && /\d/.test(a) ? `${a.trim()} ` : "";
        if (container) {
          a = countPre ? countPre.trim() : "";
          it = `${metricStr} ${container} ${rest}`.trim();
        } else {
          // Product without container: "8-oz. cream cheese" → amount "225 g", item "cream cheese"
          a = `${countPre}${metricStr}`.trim();
          it = rest;
        }
      }
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
      if (num > 0) a = ozToG(num);
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
      if (num > 0) a = lbToMetric(num);
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
    // At start of item: "15-ounce can ..." or "15 ounce can ..." or "15 oz. can ..."
    it = it.replace(
      new RegExp(`(^|\\b(?:one|two|three|1|2|3|4)\\s+)(\\d+\\.?\\d*[½¼¾⅓⅔]?)[\\s-]+(ounces?|oz)\\.?\\s+(${CONTAINERS})\\b`, "gi"),
      (_m, pre, num, _unit, container) => {
        const n = parseNum(num);
        return n > 0 ? `${pre}${ozToG(n)} ${container}` : _m;
      },
    );
    // Parenthesized: "(10.5 oz.) can"
    it = it.replace(
      new RegExp(`\\((\\d+\\.?\\d*)\\s*(?:oz\\.?|ounces?)\\)\\s+(${CONTAINERS})\\b`, "gi"),
      (_m, num, container) => {
        const n = parseFloat(num);
        return n > 0 ? `(${ozToG(n)}) ${container}` : _m;
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
  //    e.g. "800g (1lb 12oz)" → "800g", "100g (3½ oz)" → "100g"
  if (/(?:^|\d)\s*(?:g|kg|ml|l|L|dl)\b/.test(a)) {
    a = a.replace(
      new RegExp(`\\s*\\([^)]*\\b(?:${IMP_ALL})\\b[^)]*\\)`, "gi"),
      "",
    );
  }

  // ── 8a2. Amount: "½ lb (1 medium)" → convert lb to metric, keep descriptor.
  //    Handles cases where parens contain a count/descriptor, not a metric value.
  {
    const lbDescriptor = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(lbs?\.?|pounds?)\s*(\(.*\))$/i,
    );
    if (lbDescriptor && !/\b(?:g|kg|ml|l|L|dl)\b/.test(lbDescriptor[3])) {
      const num = parseNum(lbDescriptor[1]);
      if (num > 0) {
        a = `${lbToMetric(num)} ${lbDescriptor[3]}`;
      }
    }
  }
  // Same for oz: "4 oz (1 small)" etc.
  {
    const ozDescriptor = a.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(oz\.?|ounces?)\s*(\(.*\))$/i,
    );
    if (ozDescriptor && !/\bfl\.?\s/i.test(a) && !/\b(?:g|kg|ml|l|L|dl)\b/.test(ozDescriptor[3])) {
      const num = parseNum(ozDescriptor[1]);
      if (num > 0) {
        a = `${ozToG(num)} ${ozDescriptor[3]}`;
      }
    }
  }

  // ── 8b. Amount: "N (M oz.)" or "N (M lb)" — count + parenthesized imperial size for containers.
  //    e.g. "1 (14.5 oz.)" + "can tomatoes" → "1" amount with item "405 g can tomatoes"
  //    or  "1 (8 oz.)" + "pkg. manicotti" → "225 g pkg. manicotti"
  {
    const countParenImp = a.match(
      /^(\d+)\s*\(\s*([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(oz\.?|ounces?|lbs?\.?|pounds?)\s*\)$/i,
    );
    if (countParenImp && !/\bfl\.?\s/i.test(a)) {
      const count = parseInt(countParenImp[1]);
      const sizeNum = parseNum(countParenImp[2]);
      const unitW = countParenImp[3].toLowerCase();
      if (sizeNum > 0) {
        const isLb = /^(?:pound|lb)/i.test(unitW);
        const metricStr = isLb ? lbToMetric(sizeNum) : ozToG(sizeNum);
        a = count > 1 ? `${count}` : "";
        it = `${metricStr} ${it}`.trim();
      }
    }
  }

  // ── 8c. Item: "½ lb. ground beef" when amount is a count like "1"
  //    → merge: amount "455 g", item "ground beef"
  if (/^\d+$/.test(a)) {
    const itemLeadFrac = it.match(
      /^([\d½¼¾⅓⅔⅛][\d\s½¼¾⅓⅔⅛/.,-]*)\s*(lbs?\.?|pounds?|oz\.?|ounces?)\s+(.*)/i,
    );
    if (itemLeadFrac && !/\bfl\.?\s/i.test(it)) {
      const sizeNum = parseNum(itemLeadFrac[1]);
      const unitW = itemLeadFrac[2].toLowerCase();
      const rest = itemLeadFrac[3].trim();
      if (sizeNum > 0) {
        const isLb = /^(?:pound|lb)/i.test(unitW);
        a = isLb ? lbToMetric(sizeNum) : ozToG(sizeNum);
        it = rest;
      }
    }
  }

  // ── 8d. Item-only: "Generous/About N ounces ..." when amount is empty.
  //    e.g. "" + "Generous 8 ounces white bread" → "225 g" + "white bread ..."
  if (!a || /^\s*$/.test(a)) {
    const qualImp = it.match(
      /^(?:generous|about|roughly|approximately|scant)\s+(\d+\.?\d*)\s*(ounces?|oz\.?|pounds?|lbs?\.?)\s+(.*)/i,
    );
    if (qualImp && !/\bfl\.?\s/i.test(it)) {
      const n = parseFloat(qualImp[1]);
      const unitW = qualImp[2].toLowerCase();
      if (n > 0) {
        const isLb = /^(?:pound|lb)/i.test(unitW);
        a = isLb ? lbToMetric(n) : ozToG(n);
        it = qualImp[3].trim();
      }
    }
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
