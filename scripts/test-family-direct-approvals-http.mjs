// Isolated built-app acceptance: fictional records and credentials, no provider calls.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import assert from 'node:assert/strict';
const root = process.cwd();
const dir = mkdtempSync(`${tmpdir()}/family-direct-http-`);
const port = 4297;
const base = `http://127.0.0.1:${port}`;
const token = 'fictional-direct-approval-http-credential';
// Serialize the existing app-wide schema migration before the first parallel queue read.
const bootstrap=spawnSync(process.execPath,['--input-type=module','-e',"const {getDb}=await import('./src/lib/db.ts'); (await getDb()).close();"],{cwd:root,env:{...process.env,NABU_DB_DIR:dir,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:''},encoding:'utf8'});
assert.equal(bootstrap.status,0,bootstrap.stderr);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{
 cwd:root,env:{...process.env,NABU_DB_DIR:dir,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',TRUSTED_RUNTIME_TOKEN:token,AUTH_SECRET:'fictional-local-only-auth-secret-1234567890',AUTH_TRUST_HOST:'true'},stdio:['ignore','pipe','pipe']
});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
let db;
async function request(path,method='GET',body,credential=token){
 const r=await fetch(`${base}${path}`,{method,headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json()};
}
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`Server not ready: ${output.slice(-2000)}`)),30000);server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${output.slice(-2000)}`));});server.stdout.on('data',d=>{if(String(d).includes('Ready in')){clearTimeout(timeout);resolve();}});});
 assert.equal((await request('/api/family/review-approvals','POST',{},null)).status,401);
 assert.equal((await request('/api/family/review-approvals','POST',{},'wrong')).status,401);
 assert.equal((await request('/api/family/review-queue')).status,200);
 db=createClient({url:`file:${dir}/nabu.db`});
 for(const [person,routine] of [['santiago','s-kumon'],['isabel','i-kumon']])await db.execute({sql:`INSERT INTO family_completions (person_id,routine_id,week,day,status,note,normalized_summary,challenge,credit_count,created_at) VALUES (?,?,'2026-W46',6,'pending_review','Four sheets: 6,11,12,13','Four sheets: 6,11,12,13','Fictional test',5,'2026-11-15T12:40:48.638Z')`,args:[person,routine]});
 const queue=await request('/api/family/review-queue');assert.equal(queue.body.count,2);
 const target=queue.body.items.find(i=>i.personId==='santiago');assert.equal(target.pointsPerUnit,1);assert.match(target.approvalHash,/^[a-f0-9]{64}$/);
 const input={week:target.week,personId:target.personId,routineId:target.routineId,day:target.day,submissionHash:target.approvalHash,approvedCreditCount:4,expectedPoints:4,approvalReference:'clavus:fictional-http-acceptance'};
 assert.equal((await request('/api/family/review-approvals','POST',{...input,action:'delete'})).status,400);
 assert.equal((await request('/api/family/review-approvals','POST',{...input,submissionHash:'0'.repeat(64)})).status,409);
 assert.equal((await request('/api/family/completions','PATCH',{week:target.week,personId:target.personId,routineId:target.routineId,day:target.day,action:'approve'})).status,401);
 const approved=await request('/api/family/review-approvals','POST',input);assert.equal(approved.status,200);assert.equal(approved.body.updated,true);assert.equal(approved.body.walletAfter-approved.body.walletBefore,4);assert.equal(approved.body.completion.creditCount,4);assert.equal(approved.body.completion.awardedPoints,4);assert.equal(approved.body.completion.note,target.note);assert.equal(approved.body.completion.submittedAt,target.submittedAt);
 const retry=await request('/api/family/review-approvals','POST',input);assert.equal(retry.status,200);assert.equal(retry.body.updated,false);assert.equal(retry.body.walletAfter,4);assert.equal(retry.body.receiptId,approved.body.receiptId);
 const after=await request('/api/family/review-queue');assert.equal(after.body.count,1);assert.equal(after.body.items[0].personId,'isabel');assert.equal(after.body.items[0].creditCount,5);
 console.log(JSON.stringify({ok:true,checks:['anonymous-denied','wrong-token-denied','queue-contract','closed-body','stale-denied','legacy-admin-boundary','atomic-four-point-credit','idempotent-retry','sibling-preserved'],recordCount:2,creditedCount:1,creditedPoints:4}));
}catch(error){console.error(output.slice(-4000));throw error;}finally{db?.close();server.kill('SIGTERM');}
