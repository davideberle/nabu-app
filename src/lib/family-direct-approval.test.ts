import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { approveDirectSubmission, canDirectlyApprove, directApprovalHash, parseDirectApproval } from './family-direct-approval.ts';
import { isTrustedRuntimeApiRoute } from './access.ts';

const row = {week:'2026-W46',personId:'santiago' as const,routineId:'s-kumon',day:6,status:'pending_review',note:'Four sheets: 6, 11, 12, 13',normalizedSummary:'Four sheets: 6, 11, 12, 13',challenge:'Kumon',creditCount:5,submittedAt:'2026-11-15T12:40:48.638Z'};
const input = {week:row.week,personId:row.personId,routineId:row.routineId,day:row.day,submissionHash:directApprovalHash(row,1),approvedCreditCount:4,expectedPoints:4,approvalReference:'clavus:test-explicit-owner-approval'};
const routine={id:'s-kumon',points:1,assignedTo:['santiago']};
const fixtureUrls = new WeakMap<object,string>();
async function fixture(){
 const url=`file:${mkdtempSync(`${tmpdir()}/family-direct-test-`)}/test.db`;
 const db=createClient({url}); fixtureUrls.set(db,url);
 await db.execute('CREATE TABLE family_completions (week TEXT, person_id TEXT, routine_id TEXT, day INTEGER, status TEXT, note TEXT, normalized_summary TEXT, challenge TEXT, credit_count INTEGER, created_at TEXT, reviewed_at TEXT, awarded_points INTEGER, approval_source TEXT, PRIMARY KEY(week,person_id,routine_id,day))');
 await db.execute('CREATE TABLE family_reward_redemptions (person_id TEXT, week TEXT, charged_points INTEGER)');
 await db.execute('CREATE TABLE family_board_config (id TEXT PRIMARY KEY, data TEXT)');
 await db.execute({sql:'INSERT INTO family_completions (week,person_id,routine_id,day,status,note,normalized_summary,challenge,credit_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[row.week,row.personId,row.routineId,row.day,row.status,row.note,row.normalizedSummary,row.challenge,row.creditCount,row.submittedAt]});
 await db.execute("INSERT INTO family_completions (week,person_id,routine_id,day,status,awarded_points,credit_count) VALUES ('2026-W45','isabel','i-kumon',1,'done',9,9)");
 return db;
}

test('authorization fails closed; exact endpoint and method only',()=>{
 const token='fictional-token-only-not-a-real-secret';
 assert.equal(canDirectlyApprove(`Bearer ${token}`,{TRUSTED_RUNTIME_TOKEN:token}),true);
 for(const header of [null,'Bearer wrong',`Basic ${token}`]) assert.equal(canDirectlyApprove(header,{TRUSTED_RUNTIME_TOKEN:token}),false);
 assert.equal(canDirectlyApprove(`Bearer ${token}`,{}),false);
 assert.equal(canDirectlyApprove('Bearer short',{TRUSTED_RUNTIME_TOKEN:'short'}),false);
 assert.equal(isTrustedRuntimeApiRoute('POST','/api/family/review-approvals'),true);
 for(const method of ['GET','PATCH','PUT','DELETE']) assert.equal(isTrustedRuntimeApiRoute(method,'/api/family/review-approvals'),false);
 for(const path of ['/api/family/completions','/api/family/config','/api/family/parent/records','/api/family/review-approvals/other']) assert.equal(isTrustedRuntimeApiRoute('POST',path),false);
 const route=readFileSync(new URL('../app/api/family/review-approvals/route.ts',import.meta.url),'utf8');
 assert.match(route,/canDirectlyApprove\(request.headers.get\("authorization"\)\)/);
 assert.doesNotMatch(route,/export async function (GET|PATCH|DELETE|PUT)/);
 const old=readFileSync(new URL('../app/api/family/completions/route.ts',import.meta.url),'utf8');
 assert.match(old,/export async function PATCH\(request: Request\) \{\n  const session = await auth\(\)/);
});

test('closed schema, real child, whole quantity and required reference',()=>{
 assert.ok(parseDirectApproval(input));
 for(const extra of [{action:'delete'},{admin:true},{points:99}]) assert.equal(parseDirectApproval({...input,...extra}),null);
 for(const value of [{...input,day:0.5},{...input,approvedCreditCount:0},{...input,approvedCreditCount:21},{...input,approvedCreditCount:1.1},{...input,expectedPoints:'4'},{...input,personId:'other'},{...input,approvalReference:''},{...input,submissionHash:'bad'},{...input,week:'2026-W99'}]) assert.equal(parseDirectApproval(value),null);
 for(const key of Object.keys(input)){const v={...input} as Record<string,unknown>;delete v[key];assert.equal(parseDirectApproval(v),null);}
});

test('fingerprint covers every submission field, timestamp and price',()=>{
 for(const [key,value] of Object.entries({week:'2026-W45',personId:'isabel',routineId:'other',day:5,status:'on_hold',note:'changed',normalizedSummary:'changed',challenge:'changed',creditCount:4,submittedAt:'later'})) assert.notEqual(directApprovalHash({...row,[key]:value},1),input.submissionHash,key);
 assert.notEqual(directApprovalHash(row,2),input.submissionHash);
});

test('corrects mistaken five to approved four atomically, preserves transcript and sibling; retry cannot credit twice',async()=>{
 const db=await fixture();try{
 const sibling=JSON.stringify((await db.execute("SELECT * FROM family_completions WHERE person_id='isabel'")).rows);
 const r=await approveDirectSubmission(db,input,routine);
 assert.equal(r.updated,true);assert.equal(r.walletBefore,0);assert.equal(r.walletAfter,4);assert.equal(r.awardedPoints,4);
 const stored=(await db.execute("SELECT * FROM family_completions WHERE person_id='santiago'")).rows[0];
 assert.equal(stored.credit_count,4);assert.equal(stored.awarded_points,4);assert.equal(stored.status,'done');assert.equal(stored.note,row.note);assert.equal(stored.created_at,row.submittedAt);assert.equal(stored.challenge,row.challenge);assert.equal(stored.normalized_summary,row.normalizedSummary);
 assert.equal(JSON.stringify((await db.execute("SELECT * FROM family_completions WHERE person_id='isabel'")).rows),sibling);
 assert.equal((await db.execute('SELECT COUNT(*) AS n FROM family_completions')).rows[0].n,2);
 const again=await approveDirectSubmission(db,input,routine);assert.equal(again.updated,false);assert.equal(again.walletAfter,4);assert.equal(again.walletBefore,4);assert.equal(again.receiptId,r.receiptId);
 await assert.rejects(approveDirectSubmission(db,{...input,approvedCreditCount:5,expectedPoints:5},routine));
 assert.equal((await db.execute('SELECT COUNT(*) AS n FROM family_reward_redemptions')).rows[0].n,0);
 }finally{db.close();}
});

for(const [field,value] of Object.entries({note:'changed',normalized_summary:'changed',challenge:'changed',credit_count:6,created_at:'later',status:'redo',awarded_points:9})) test(`stale ${field} rejected with zero writes`,async()=>{
 const db=await fixture();try{await db.execute({sql:`UPDATE family_completions SET ${field}=? WHERE person_id='santiago'`,args:[value]});const before=JSON.stringify((await db.execute('SELECT * FROM family_completions')).rows);await assert.rejects(approveDirectSubmission(db,input,routine));assert.equal(JSON.stringify((await db.execute('SELECT * FROM family_completions')).rows),before);}finally{db.close();}
});

test('changed pricing, disabled activity, wrong expected points and missing identity fail closed',async()=>{
 for(const config of [{routineOverrides:{'s-kumon':{points:2}}},{routineOverrides:{'s-kumon':{enabled:false}}}]){const db=await fixture();try{await db.execute({sql:"INSERT INTO family_board_config VALUES('default',?)",args:[JSON.stringify(config)]});await assert.rejects(approveDirectSubmission(db,input,routine));assert.equal((await db.execute("SELECT status FROM family_completions WHERE person_id='santiago'")).rows[0].status,'pending_review');}finally{db.close();}}
 const db=await fixture();try{await assert.rejects(approveDirectSubmission(db,{...input,expectedPoints:5},routine));await assert.rejects(approveDirectSubmission(db,{...input,day:1},routine));await assert.rejects(approveDirectSubmission(db,input,{...routine,assignedTo:['isabel']}));}finally{db.close();}
});

test('separate approvals serialized by write transactions; no second award',async()=>{
 const db=await fixture();try{
 const second=createClient({url:fixtureUrls.get(db)!});
 const results=await Promise.allSettled([approveDirectSubmission(db,input,routine),approveDirectSubmission(second,input,routine)]);
 second.close();
 assert.ok(results.some(r=>r.status==='fulfilled'));
 assert.equal((await db.execute("SELECT SUM(awarded_points) AS n FROM family_completions WHERE person_id='santiago'")).rows[0].n,4);
 assert.equal((await approveDirectSubmission(db,input,routine)).updated,false);
 }finally{db.close();}
});
