// New replacement probe, not recovered original. Synthetic isolated DB only.
import fs from 'node:fs';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {encode} from '@auth/core/jwt';
import {chromium} from '/Users/claweberle/.npm-global/lib/node_modules/playwright/index.mjs';
import {audioSafeChromiumLaunchOptions,installBrowserAudioGuard} from './lib/browser-audio-guard.mjs';
const args=process.argv.slice(2),opt=n=>args[args.indexOf(n)+1];
const BASE=opt('--base'),DB=opt('--db'),OUT=opt('--out');
if(!BASE?.startsWith('http://127.0.0.1:')||!DB?.includes('/visual-final-art-r4/db/'))throw Error('synthetic local fixture required');
fs.mkdirSync(OUT,{recursive:true});
const db=createClient({url:'file:'+DB});
const original=String((await db.execute("SELECT state_json FROM family_learning_missions WHERE child_id='santiago'")).rows[0].state_json);
const cookie=await encode({token:{email:'assistant@davideberle.com',sub:'assistant@davideberle.com'},secret:process.env.AUTH_SECRET,salt:'authjs.session-token',maxAge:3600});
const browser=await chromium.launch(audioSafeChromiumLaunchOptions({headless:true}));
const results=[],images=new Set(),errors=[];
try {
 for(const [name,location,theme,lamp,tent] of [['shore','shore','turtles',true,false],['forest','forest','turtles',false,false],['crater','crater','waves',true,false],['ice','ice','waves',false,false],['tent','shore','turtles',false,true]]){
  const state=JSON.parse(original);state.base.locationId=location;state.station.theme=theme;state.station.lampLit=lamp;
  if(tent){state.visits.find(v=>v.id==='v1').finishedAt=null;}
  await db.execute({sql:"UPDATE family_learning_missions SET state_json=? WHERE child_id='santiago'",args:[JSON.stringify(state)]});
  for(const [device,width,height] of [['desktop',1280,900],['tablet',820,1180]]){
   const c=await browser.newContext({viewport:{width,height},hasTouch:device==='tablet',reducedMotion:'reduce'});
   await installBrowserAudioGuard(c);
   await c.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==BASE||/\/api\/family\/(assistant|transcribe)/.test(u.pathname)?r.abort():r.continue();});
   await c.addCookies([{name:'authjs.session-token',value:cookie,url:BASE}]);
   const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));
   await p.goto(BASE+'/family/learn?child=santiago');
   await p.locator('[data-part="location-overlay"]').waitFor({state:'attached'});
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const assets=await p.locator('svg image').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')).filter(Boolean));
   for(const asset of new Set(assets)){const r=await c.request.get(new URL(asset,BASE).href);if(!r.ok())throw Error('asset failed '+asset);images.add(asset);}
   const overlay=await p.locator('[data-part="location-overlay"]').getAttribute('data-location');
   const lit=await p.locator('[data-part="station-lamp"]').count();
   const sprite=location==='shore'?true:await p.locator(`[data-sprite="overlay-${location}"]`).count()>0;
   const base=await p.locator('[data-part="base"]').getAttribute('data-base');
   const ok=overlay===location&&Boolean(lit)===lamp&&sprite&&(!tent||base==='tent');
   results.push({name,device,ok,overlay,lit,base,assets:assets.length});
   await p.screenshot({path:path.join(OUT,`${name}-${device}.png`),fullPage:true});
   await c.close();
  }
 }
} finally {
 await db.execute({sql:"UPDATE family_learning_missions SET state_json=? WHERE child_id='santiago'",args:[original]});db.close();await browser.close();
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({scope:'replacement visual state probe, not independent acceptance or recovered original',results,errors,loadedAssets:images.size},null,2));
}
console.log(JSON.stringify({passed:results.filter(x=>x.ok).length,total:results.length,errors}));
if(results.some(x=>!x.ok)||errors.length)process.exitCode=1;
