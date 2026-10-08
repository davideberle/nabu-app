#!/usr/bin/env node
// Synthetic Game Studio UPSTREAM for the local self-check (October 8, 2026). Loopback only, in-memory, no provider,
// no real Studio data. Mirrors the upstream contract the child adapter consumes: projects, create, iterate → plan,
// clarify, approve → job, jobs, and a fixture game page. A `/__fixture/jobs/:id/status` POST lets the harness move a
// job between queued/running/done to exercise the attested build-only wait.
//   node scripts/fake-studio-upstream.mjs <port>   (prints the origin; writes <GAME_STUDIO_FAKE_PID_FILE> if set)
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] || 0);
const projects = new Map([
  ["fixture-paid-game", { id: "fixture-paid-game", title: "Fixture Paid Game", prompt: "p", status: "ready", currentVersionId: "v1", versionCount: 1, latestJobId: null, latestPlanId: null, updatedAt: "2026-10-01T00:00:00.000Z" }],
  ["adaptive-chess-coach", { id: "adaptive-chess-coach", title: "Adaptive Chess Coach", prompt: "p", status: "ready", currentVersionId: "canonical", versionCount: 1, latestJobId: null, latestPlanId: null, updatedAt: "2026-10-01T00:00:00.000Z" }],
]);
const jobs = new Map();
const plans = new Map();
let seq = 0;
const posts = [];
const game = `<!doctype html><html><head><title>Fixture game</title></head><body style="background:#123;color:#fff;font:16px system-ui"><h1>Fixture game</h1><p id="t">0</p><script>var n=0;function loop(){n+=1;document.getElementById('t').textContent=String(n);requestAnimationFrame(loop)}requestAnimationFrame(loop);</script></body></html>`;

function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  let m;
  if (req.method === "POST") posts.push(`${p}`);
  if (p === "/__fixture/posts") return send(200, { posts });
  if ((m = p.match(/^\/__fixture\/jobs\/([^/]+)\/status$/)) && req.method === "POST") { const body = await readBody(req); const job = jobs.get(m[1]); if (!job) return send(404, {}); job.status = body.status; if (body.status === "done") { job.completedAt = new Date().toISOString(); job.versionId = "v2"; const pr = projects.get(job.projectId); if (pr) { pr.status = "ready"; pr.currentVersionId = "v2"; } } return send(200, job); }
  if (p === "/api/projects" && req.method === "GET") return send(200, [...projects.values()]);
  if (p === "/api/projects" && req.method === "POST") {
    const body = await readBody(req);
    const id = `own-${(seq += 1)}`;
    const job = { id: `job-${seq}`, projectId: id, status: "queued", error: null, versionId: null, createdAt: new Date().toISOString(), completedAt: null };
    jobs.set(job.id, job);
    const project = { id, title: `Own game ${seq}`, prompt: body.prompt, status: "creating", currentVersionId: null, versionCount: 0, latestJobId: job.id, latestPlanId: null, updatedAt: new Date().toISOString() };
    projects.set(id, project);
    return send(201, { project, job });
  }
  if ((m = p.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "GET") { const pr = projects.get(m[1]); if (!pr) return send(404, { error: "not found" }); return send(200, { ...pr, latestJob: pr.latestJobId ? jobs.get(pr.latestJobId) ?? null : null }); }
  if ((m = p.match(/^\/api\/projects\/([^/]+)\/iterate$/)) && req.method === "POST") {
    const body = await readBody(req);
    const pr = projects.get(m[1]); if (!pr) return send(404, { error: "not found" });
    const plan = { id: `plan-${(seq += 1)}`, projectId: pr.id, kind: "semantic", request: body.prompt, analysisState: "ready", approvedAt: null, analysis: { requirements: ["Do it"], assumptions: [], questions: [{ text: "How much?", kind: "material" }] }, clarifications: [], steps: [{ title: "Change", instruction: "Change it", status: "pending" }], status: "awaiting_clarification", createdAt: "x", updatedAt: "x" };
    plans.set(plan.id, plan); pr.latestPlanId = plan.id;
    return send(200, { plan });
  }
  if ((m = p.match(/^\/api\/plans\/([^/]+)$/)) && req.method === "GET") { const plan = plans.get(m[1]); return plan ? send(200, plan) : send(404, { error: "not found" }); }
  if ((m = p.match(/^\/api\/plans\/([^/]+)\/clarify$/)) && req.method === "POST") { const body = await readBody(req); const plan = plans.get(m[1]); if (!plan) return send(404, {}); plan.clarifications = (body.answers || []).map((a) => ({ ...a, at: "y" })); plan.analysis.questions = plan.analysis.questions.filter((q) => q.kind !== "material"); plan.status = "awaiting_approval"; return send(200, { plan }); }
  if ((m = p.match(/^\/api\/plans\/([^/]+)\/approve$/)) && req.method === "POST") { const plan = plans.get(m[1]); if (!plan) return send(404, {}); if (plan.analysis.questions.some((q) => q.kind === "material")) return send(409, { error: "material questions open" }); plan.status = "running"; plan.approvedAt = "z"; const job = { id: `job-${(seq += 1)}`, projectId: plan.projectId, planId: plan.id, status: "running", error: null, versionId: null, createdAt: "z", completedAt: null }; jobs.set(job.id, job); const pr = projects.get(plan.projectId); if (pr) pr.latestJobId = job.id; return send(200, { plan, job }); }
  if ((m = p.match(/^\/api\/jobs\/([^/]+)$/)) && req.method === "GET") { const job = jobs.get(m[1]); return job ? send(200, job) : send(404, { error: "not found" }); }
  if ((m = p.match(/^\/games\/([^/]+)\/current\/index\.html$/))) return projects.has(m[1]) ? send(200, game, "text/html") : send(404, "no", "text/plain");
  send(404, { error: "not found" });
});
server.listen(port, "127.0.0.1", () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(origin);
  if (process.env.GAME_STUDIO_FAKE_PID_FILE) fs.writeFileSync(process.env.GAME_STUDIO_FAKE_PID_FILE, String(process.pid));
});
