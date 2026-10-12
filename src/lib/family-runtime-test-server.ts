import { auth } from "@/auth";
import { evaluateParentLearningAccess } from "./access";
import { createPrivateKey, createPublicKey, createHash, randomBytes, sign } from "node:crypto";
import fixtures from "@/data/family-runtime-test/fixtures.v1.json";
export const NO_STORE = {"Cache-Control":"no-store, private, max-age=0",Pragma:"no-cache","Referrer-Policy":"no-referrer"};
export const ENDPOINT="https://dae-macmini.tail4f656e.ts.net:9449/operation";
export const APP_ORIGIN="https://app.davideberle.com";
export function localTest(){return process.env.NODE_ENV === "development" && process.env.NABU_RUNTIME_LOCAL_TEST === "1";}
export function enabled(){return process.env.FAMILY_RUNTIME_TEST_ENABLED === "1";}
export async function ownerAccess(){return evaluateParentLearningAccess(await auth());}
const keys:Record<string,string[]>={open:["op","profile","surface","page"],switch:["op","handle","profile","surface","page"],revoke:["op","handle"],view:["op","handle"],prepare:["op","handle","revision","text","fixtureHash"],accept:["op","handle","turn","receipt"],discard:["op","handle","turn","receipt"],status:["op","handle","turn","receipt"],correct:["op","handle","key","value"],delete:["op","handle","key","value"]};
export function validCommand(value:unknown):value is Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;const c=value as Record<string,unknown>,op=c.op;if(typeof op!=="string"||!keys[op]||Object.keys(c).sort().join(",")!==[...keys[op]].sort().join(","))return false;
 if(["open","switch"].includes(op)&&(!["avery","rowan"].includes(String(c.profile))||!["Family:home","Learning:lesson","Learning:reading"].includes(c.surface+":"+c.page)))return false;
 if("handle"in c&&(typeof c.handle!=="string"||c.handle.length>100||!c.handle))return false;
 if(op==="prepare"&&(typeof c.revision!=="number"||!Number.isSafeInteger(c.revision)||c.revision<1||c.fixtureHash!==fixtures.fixtureHash||typeof c.text!=="string"||!c.text.trim()||c.text.length>2000))return false;
 if(["accept","discard","status"].includes(op)&&(typeof c.turn!=="string"||c.turn.length>80||typeof c.receipt!=="string"||!/^[a-f0-9]{64}$/.test(c.receipt)))return false;
 if(["correct","delete"].includes(op)&&(typeof c.key!=="string"||!c.key.trim()||c.key.length>80||typeof c.value!=="string"||c.value.length>1000))return false;return true;
}
export function issuePermit(command:Record<string,unknown>){
 if(!enabled()||!validCommand(command))throw Error("Test lane unavailable");
 const pk=process.env.FAMILY_RUNTIME_TEST_PERMIT_PRIVATE_B64,pub=process.env.FAMILY_RUNTIME_TEST_RECEIPT_PUBLIC_B64;
 if(!pk||!pub)throw Error("Dedicated keys unavailable");
 const key=createPrivateKey({key:Buffer.from(pk,"base64"),format:"der",type:"pkcs8"}),receiptKey=createPublicKey({key:Buffer.from(pub,"base64"),format:"der",type:"spki"});if(key.asymmetricKeyType!=="ed25519"||receiptKey.asymmetricKeyType!=="ed25519")throw Error("Dedicated Ed25519 keys required");
 const now=Math.floor(Date.now()/1000),claims={iss:"family-runtime-test",aud:"family-runtime-test",sub:"info@davideberle.com",origin:APP_ORIGIN,purpose:command.op,iat:now,exp:now+30,jti:randomBytes(24).toString("hex"),bodyHash:createHash("sha256").update(JSON.stringify(command)).digest("hex")};const bytes=Buffer.from(JSON.stringify(claims));
 return {ok:true,transport:"private-signed",permit:bytes.toString("base64url")+"."+sign(null,bytes,key).toString("base64url"),jti:claims.jti,bodyHash:claims.bodyHash,endpoint:localTest()?"https://localhost:9451/operation":ENDPOINT,receiptPublic:pub,fixtureHash:fixtures.fixtureHash};
}
