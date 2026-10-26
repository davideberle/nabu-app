// Visit 8 privacy check: no private child record in the tracked source of this checkout.
//   node scripts/visit8-privacy-scan.mjs <private-evidence.json>
// The private file lives OUTSIDE the repository. Every string value of at least 10 characters in it (answers, sentences,
// timestamps, ids) is searched in the tracked files; the output carries counts and file names only — never the strings.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("usage: visit8-privacy-scan.mjs <private-evidence.json>");
  process.exit(2);
}
// Only what the CHILD produced or what dates/identifies his session: his raw answers, his sentence, interest words, ids and
// timestamps. A value that is verbatim reviewed content (a button label he tapped, a task id) is public, not a record.
const PRIVATE_KEYS = new Set(["raw", "original", "text", "id", "at", "openedAt", "finishedAt", "startedAt", "completedAt", "retrievedAt", "stateUpdatedAt"]);
const reviewed = fs.readdirSync("src/data/family-learning/content").map((f) => fs.readFileSync(`src/data/family-learning/content/${f}`, "utf8")).join("\n");
const strings = new Set();
(function walk(v, key) {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length >= 10 && PRIVATE_KEYS.has(key) && !reviewed.includes(JSON.stringify(t).slice(1, -1))) strings.add(t);
  } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
})(JSON.parse(fs.readFileSync(file, "utf8")), "");
const tracked = execFileSync("git", ["ls-files", "src", "scripts"], { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => !f.startsWith("src/data/family-learning/"));
let hits = 0;
const where = new Set();
for (const f of tracked) {
  let body;
  try {
    body = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const s of strings) if (body.includes(s)) {
    hits += 1;
    where.add(f);
  }
}
console.log(`${hits === 0 ? "PASS" : "FAIL"} privacy.private-strings-in-tracked-source ${JSON.stringify({ privateStrings: strings.size, filesScanned: tracked.length, hits, files: [...where] })}`);
const reader = tracked.filter((f) => f !== "scripts/visit8-privacy-scan.mjs" && fs.readFileSync(f, "utf8").includes("parent-review/actual"));
console.log(`${reader.length === 0 ? "PASS" : "FAIL"} privacy.no-reader-of-the-private-review ${JSON.stringify({ files: reader })}`);
process.exit(hits === 0 && reader.length === 0 ? 0 : 1);
