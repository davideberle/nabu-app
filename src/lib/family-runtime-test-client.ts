// Only this boundary reads private responses; nothing is displayed before signature/binding validation.
export async function verifyPrivateReceipt(wire:unknown,publicKey:string,jti:string,bodyHash:string){
 const w=wire as {payload?:string;signature?:string};if(!w||typeof w.payload!=="string"||typeof w.signature!=="string"||w.payload.length>2*1024*1024)throw Error("Unverified private reply");
 const decode=(x:string)=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("spki",decode(publicKey),{name:"Ed25519"},false,["verify"]);
 const bytes=decode(w.payload);if(!await crypto.subtle.verify("Ed25519",key,decode(w.signature),bytes))throw Error("Unverified private reply");
 const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(result.jti!==jti||result.bodyHash!==bodyHash||!result.body||typeof result.body.ok!=="boolean")throw Error("Wrong reply binding");return result.body;
}
