// Only this boundary reads private responses; nothing is displayed before signature/binding validation.
export async function verifyPrivateReceipt(wire:unknown,publicKey:string,jti:string,bodyHash:string){
 const w=wire as {payload?:string;signature?:string};if(!w||typeof w.payload!=="string"||typeof w.signature!=="string"||w.payload.length>2*1024*1024)throw Error("Unverified private reply");
 const decode=(x:string)=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("spki",decode(publicKey),{name:"Ed25519"},false,["verify"]);
 const bytes=decode(w.payload);if(!await crypto.subtle.verify("Ed25519",key,decode(w.signature),bytes))throw Error("Unverified private reply");
 const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(result.jti!==jti||result.bodyHash!==bodyHash||!result.body||typeof result.body.ok!=="boolean")throw Error("Wrong reply binding");return result.body;
}

// Reject even when a browser permission prompt or response reader ignores abort.
// No retry is automatic: a timed-out model attempt still counts in the Mini ledger.
export function withOperationDeadline<T>(run:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal|undefined,milliseconds:number,timeoutMessage:()=>string):Promise<T>{
 const controller=new AbortController(),deadline=Date.now()+milliseconds;
 return new Promise<T>((resolve,reject)=>{
  let done=false;
  const finish=(error:unknown,value?:T)=>{if(done)return;if(!error&&Date.now()>=deadline){controller.abort();error=new Error(timeoutMessage());}done=true;clearTimeout(timer);signal?.removeEventListener("abort",cancel);if(typeof document!=="undefined")document.removeEventListener("visibilitychange",check);if(error)reject(error);else resolve(value as T);};
  const cancel=()=>{controller.abort();finish(new DOMException("Canceled","AbortError"));};
  const expire=()=>{controller.abort();finish(new Error(timeoutMessage()));};
  const check=()=>{if(Date.now()>=deadline)expire();};
  const timer=setTimeout(expire,milliseconds);
  signal?.addEventListener("abort",cancel,{once:true});if(typeof document!=="undefined")document.addEventListener("visibilitychange",check);
  if(signal?.aborted){cancel();return;}
  Promise.resolve().then(()=>run(controller.signal)).then(value=>finish(null,value),error=>finish(error));
 });
}
