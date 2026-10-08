// ---------------------------------------------------------------------------
// MIRROR of the Game Studio child adapter's `guardScript` (October 8, 2026).
//
// The chess bundle is served from THIS origin (so the game's per-child saves
// stay where they are) but metered by the Game Studio child adapter, whose
// injected guard freezes the page without the wrapper's heartbeats, hands the
// authority deadline to the frame, measures the real running time and beacons
// it to the meter. The adapter is the single source of this script; this file
// is a byte-for-byte mirror of its `guardScript` function and the joined test
// suite asserts both produce identical output for identical arguments
// (`family-play-joined.test.ts` → "guard mirror"). Do not edit here: change the
// adapter, then re-mirror.
// ---------------------------------------------------------------------------

/* eslint-disable */
// @ts-nocheck
export function guardScript({ allowedOrigin, leaseId, beaconBase = '' }) {
  return `<script data-family-play-guard>(function(){
var ORIGIN=${JSON.stringify(allowedOrigin)};var LEASE=${JSON.stringify(leaseId)};var last=0;var overlay=null;var dead=false;
/* Authority deadline: every live heartbeat from the wrapper carries how long play is authorized (the Family-granted
   window as relayed by the meter). Without a renewal before that instant the page freezes itself — fail-closed —
   so a lease that was ended elsewhere stops running at its fence, not at the next slow heartbeat. */
var deadline=0;var deadlineTimer=null;
/* Observed running time (round 12): the guard — the only party that sees the real thaw and freeze — accumulates how
   long the game has actually run under the wrapper's current session ('session' in alive messages; a new session
   resets the counter) and reports it with every reply and on every self-freeze (deadline, orphan). */
var sessionKey=null;var ranMs=0;var runSince=0;var lastGrant=null;var replyTo=null;var replyOrigin=null;
/* Frame beacons (round 13): the guard also reports its measured running time straight to the meter — on thaw, every
   second while running, on every freeze and on pagehide — with the lease credential this page was served with. A
   lost wrapper report or a crashed tab therefore loses at most the running time since the last beacon. */
var CRED=(function(){try{return new URLSearchParams(location.search).get('credential')||'';}catch(x){return '';}})();var FRAME_PATH=${JSON.stringify(beaconBase)}+'/v1/play/'+encodeURIComponent(LEASE)+'/frame';var lastBeaconMs=-1;var lastBeaconRunning=null;
/* A beacon is DELIVERED only when the meter answered 2xx; until then the latest observation stays pending and is
   re-sent on the next beat (every second, frozen or not) — a failed fetch, a refused answer or a sendBeacon the
   browser declined is never silently dropped. What the meter did not receive is not billed; what it received is. */
var beaconPending=null;var beaconInFlight=false;
function deliver(body){if(beaconInFlight)return;beaconInFlight=true;var mine=body;
  try{fetch(FRAME_PATH,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+CRED},body:mine,keepalive:true}).then(function(r){beaconInFlight=false;if(r&&r.ok){if(beaconPending===mine)beaconPending=null;}else if(beaconPending===null)beaconPending=mine;},function(){beaconInFlight=false;if(beaconPending===null)beaconPending=mine;});}
  catch(x){beaconInFlight=false;beaconPending=mine;}}
function beacon(final){accrue();if(runningNow())runSince=Date.now();var running=runningNow();if(ranMs===lastBeaconMs&&running===lastBeaconRunning&&beaconPending===null)return;lastBeaconMs=ranMs;lastBeaconRunning=running;var body=JSON.stringify({grant:sessionKey,session:sessionKey,ranMs:ranMs,running:running});beaconPending=body;
  if(final){var sent=false;try{if(navigator.sendBeacon)sent=navigator.sendBeacon(FRAME_PATH+'?credential='+encodeURIComponent(CRED),new Blob([body],{type:'application/json'}));}catch(x){sent=false;}if(sent){beaconPending=null;return;}}
  deliver(body);}
function runningNow(){return !frozen&&!dead;}
function accrue(){if(runSince){ranMs+=Math.max(0,Date.now()-runSince);runSince=0;}}
function report(){accrue();if(runningNow())runSince=Date.now();try{if(replyTo&&replyTo.postMessage)replyTo.postMessage({type:'family-play:running',leaseId:LEASE,grant:lastGrant,session:sessionKey,running:runningNow(),ranMs:ranMs},replyOrigin);}catch(x){}}
function armDeadline(){if(deadlineTimer!==null){realCT(deadlineTimer);deadlineTimer=null;}if(!deadline)return;deadlineTimer=realST(function(){deadlineTimer=null;if(!dead&&!frozen&&Date.now()>=deadline){freeze('Checking your play time…');report();}},Math.max(0,deadline-Date.now()));}
/* The page starts FROZEN: no game loop, timer, audio or input runs until the Companion App wrapper's first
   heartbeat says play is live. Freeze/thaw are idempotent transitions; handles stay cancellable while frozen;
   deferred timers keep their remaining delay; only audio the guard itself suspended is resumed. */
var frozen=true;var realRAF=window.requestAnimationFrame.bind(window);var realCAF=window.cancelAnimationFrame.bind(window);
var realST=window.setTimeout.bind(window);var realCT=window.clearTimeout.bind(window);var realSI=window.setInterval.bind(window);var realCI=window.clearInterval.bind(window);
var rafs={};var rafNext=1;var timers={};var tNext=1;var nowMs=function(){return Date.now();};var audioAll=[];
window.requestAnimationFrame=function(cb){var id=rafNext++;var e={cb:cb,real:null};rafs[id]=e;if(!frozen){e.real=realRAF(function(ts){delete rafs[id];cb(ts);});}return id;};
window.cancelAnimationFrame=function(id){var e=rafs[id];if(!e)return;if(e.real!==null)realCAF(e.real);delete rafs[id];};
function arm(id){var e=timers[id];if(!e)return;if(e.due===null){e.due=nowMs()+e.remaining;e.remaining=null;}var delay=Math.max(0,e.due-nowMs());e.real=realST(function(){var cur=timers[id];if(!cur)return;if(frozen){cur.real=null;cur.remaining=0;cur.due=null;return;}delete timers[id];cur.cb.apply(null,cur.args);},delay);}
/* A timer scheduled while frozen has not started: its full delay runs from the thaw, not from scheduling. */
window.setTimeout=function(cb,ms){var id=tNext++;var args=[].slice.call(arguments,2);var fn=typeof cb==='function'?cb:function(){};var d=Math.max(0,Number(ms)||0);timers[id]={cb:fn,args:args,due:frozen?null:nowMs()+d,real:null,remaining:frozen?d:null};if(!frozen)arm(id);return id;};
window.clearTimeout=function(id){var e=timers[id];if(!e)return;if(e.real!==null)realCT(e.real);delete timers[id];};
window.setInterval=function(cb,ms){var args=[].slice.call(arguments,2);var fn=typeof cb==='function'?cb:function(){};return realSI(function(){if(frozen)return;fn.apply(null,args);},ms);};
window.clearInterval=function(id){realCI(id);};
/* Audio: while frozen no context may run. Every context created after the guard loads is wrapped per instance
   (so games that stub or subclass AudioContext are covered too): resume() records the game's intent and is held
   while frozen; suspend() records the opposite intent; a context created while frozen is held immediately. Thaw
   resumes only contexts the guard held whose last game intent was "running"; a game-suspended context stays so. */
function wrapContext(c){var rs=typeof c.resume==='function'?c.resume:null;var ss=typeof c.suspend==='function'?c.suspend:null;
  c.__fpRealResume=function(){return rs?rs.call(c):Promise.resolve();};c.__fpRealSuspend=function(){return ss?ss.call(c):Promise.resolve();};
  c.__fpWants=true;c.__fpHeld=false;
  c.resume=function(){c.__fpWants=true;if(frozen){c.__fpHeld=true;return Promise.resolve();}c.__fpHeld=false;return c.__fpRealResume();};
  c.suspend=function(){c.__fpWants=false;c.__fpHeld=false;return c.__fpRealSuspend();};
  audioAll.push(c);if(frozen){c.__fpHeld=true;try{c.__fpRealSuspend();}catch(x){}}return c;}
['AudioContext','webkitAudioContext'].forEach(function(name){var RealAC=window[name];if(!RealAC)return;var Wrapped=function(){var c=new RealAC(arguments[0]);return wrapContext(c);};Wrapped.prototype=RealAC.prototype;window[name]=Wrapped;});
function swallow(e){if(frozen){e.stopImmediatePropagation();e.preventDefault();}}
['keydown','keyup','keypress','pointerdown','pointerup','pointermove','touchstart','touchend','touchmove','mousedown','mouseup','click','wheel'].forEach(function(t){window.addEventListener(t,swallow,true);});
function show(msg){if(!overlay){overlay=document.createElement('div');overlay.setAttribute('role','alert');overlay.setAttribute('data-family-play-overlay','');overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:rgba(20,18,16,.96);color:#fff;font:600 20px/1.4 system-ui,sans-serif;';(document.body||document.documentElement).appendChild(overlay);}overlay.textContent=msg;overlay.style.display='flex';}
function freeze(msg){if(frozen){show(msg);return;}accrue();frozen=true;show(msg);beacon(false);
  Object.keys(rafs).forEach(function(id){var e=rafs[id];if(e.real!==null){realCAF(e.real);e.real=null;}});
  Object.keys(timers).forEach(function(id){var e=timers[id];if(e.real!==null){realCT(e.real);e.real=null;}e.remaining=Math.max(0,e.due-nowMs());});
  audioAll.forEach(function(c){try{if(c.state==='running'){c.__fpHeld=true;c.__fpRealSuspend();}}catch(x){}});
  try{window.dispatchEvent(new Event('blur'));}catch(x){}}
function thaw(){if(dead||!frozen)return;frozen=false;runSince=Date.now();beacon(false);if(overlay)overlay.style.display='none';
  Object.keys(timers).forEach(function(id){var e=timers[id];if(e.remaining!==null){e.due=nowMs()+e.remaining;e.remaining=null;}arm(id);});
  Object.keys(rafs).forEach(function(id){var e=rafs[id];if(e.real===null){e.real=realRAF(function(ts){delete rafs[id];e.cb(ts);});}});
  audioAll.forEach(function(c){try{if(c.__fpHeld&&c.__fpWants!==false){c.__fpHeld=false;c.__fpRealResume();}else{c.__fpHeld=false;}}catch(x){}});
  try{window.dispatchEvent(new Event('focus'));}catch(x){}}
window.__familyPlayGuard={isFrozen:function(){return frozen;},isDead:function(){return dead;},deadline:function(){return deadline;},ranMs:function(){accrue();if(runningNow())runSince=Date.now();return ranMs;}};
document.addEventListener('DOMContentLoaded',function(){if(window.top===window){dead=true;freeze('Open this game from your Games page.');}else if(frozen&&!last)show('Starting…');});
window.addEventListener('message',function(e){if(e.origin!==ORIGIN||!e.data||e.data.type!=='family-play:alive'||e.data.leaseId!==LEASE)return;last=Date.now();replyTo=e.source;replyOrigin=e.origin;lastGrant=e.data.grant===undefined?null:e.data.grant;
  /* The wrapper names the running session; a different name — or none while the page is frozen (the wrapper closed the
     previous session) — means the next thaw starts a fresh counter. */
  var sess=e.data.session===undefined?null:e.data.session;if(sess!==null&&sess!==sessionKey){accrue();sessionKey=sess;ranMs=0;if(runningNow())runSince=Date.now();}else if(sess===null&&!runningNow()&&sessionKey!==null){accrue();sessionKey=null;}
  if(e.data.phase==='exhausted'||e.data.ended){dead=true;freeze("Time's up — go back to your Games page.");accrue();try{if(e.source&&e.source.postMessage){e.source.postMessage({type:'family-play:running',leaseId:LEASE,grant:lastGrant,session:sessionKey,running:false,ranMs:ranMs},e.origin);e.source.postMessage({type:'family-play:stopped',leaseId:LEASE,frozen:true,dead:true,ranMs:ranMs},e.origin);}}catch(x){}return;}
  var grant=Number(e.data.authorizedForMs);deadline=(isFinite(grant)&&grant>0)?Date.now()+grant:0;armDeadline();
  if(e.data.paused)freeze(e.data.reason==='offline'?'Reconnecting to Game Studio…':'Paused');else if(deadline>Date.now()){if(sessionKey===null&&lastGrant!==null){sessionKey=lastGrant;ranMs=0;lastBeaconMs=-1;}thaw();}else freeze('Checking your play time…');
  /* Tell the wrapper what the frame is ACTUALLY doing and for how long it has run under this session. */
  report();});
realSI(function(){if(dead)return;if(window.top===window)return;if(!frozen&&Date.now()>=deadline){freeze('Checking your play time…');report();}if(last&&Date.now()-last>20000&&!frozen){freeze('Paused — waiting for your Games page…');report();}},100);
realSI(function(){if(dead)return;if(runningNow())beacon(false);else if(beaconPending!==null&&!beaconInFlight)deliver(beaconPending);},1000);
window.addEventListener('pagehide',function(){accrue();frozen=true;beacon(true);});/* the page is going away: nothing runs after this word */
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){accrue();beacon(true);}});
})();</script>`;
}
