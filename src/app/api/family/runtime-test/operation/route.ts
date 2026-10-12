import { NextRequest,NextResponse } from "next/server";
import { ownerAccess,enabled,localTest,validCommand,issuePermit,NO_STORE,APP_ORIGIN } from "@/lib/family-runtime-test-server";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const access=await ownerAccess();if(!access.allowed)return NextResponse.json({ok:false,error:access.error},{status:access.status,headers:NO_STORE});
 if(!enabled())return NextResponse.json({ok:false,error:"Test lane disabled"},{status:404,headers:NO_STORE});
 const allowed=localTest()?"http://127.0.0.1:9450":APP_ORIGIN;
 if(req.headers.get("Origin")!==allowed)return NextResponse.json({ok:false,error:"Origin refused"},{status:403,headers:NO_STORE});
 try{if(Number(req.headers.get("Content-Length")||0)>12000)throw Error("Body bound");const raw=await req.text();if(raw.length>12000)throw Error("Body bound");const command=JSON.parse(raw);if(!validCommand(command))return NextResponse.json({ok:false,error:"Scope refused"},{status:400,headers:NO_STORE});return NextResponse.json(issuePermit(command),{headers:NO_STORE});}
 catch{return NextResponse.json({ok:false,error:"Test lane unavailable"},{status:503,headers:NO_STORE});}
}
