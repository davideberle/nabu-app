import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { withoutSessionRefresh } from "@/lib/access";

// Auth.js actions and their cookie writers (independent privacy reviews,
// 2026-09-29). The `session` action — GET (read) and POST (client
// `update()`) — re-signs the JWT session cookie on every call (sliding
// expiry). A session call that completes after a sign-out or account switch
// would re-install the previous identity, so BOTH methods of the session
// action answer without any session-cookie write; the JSON body is unchanged
// (its `expires` is Auth.js's sliding projection, not the enforced expiry —
// the JWT `exp` in the cookie is). Every other action is passed through
// untouched: GET/POST `callback` writes the real session cookie at sign-in,
// POST `signout` writes the clearing cookie, `csrf`/`signin`/`providers`/
// `error`/`verify-request` never write a session cookie.
const SESSION_ACTION = /\/api\/auth\/session\/?$/;

async function withoutSessionActionRefresh(handler: (request: NextRequest) => Promise<Response>, request: NextRequest): Promise<Response> {
  const response = await handler(request);
  if (!SESSION_ACTION.test(request.nextUrl.pathname)) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: withoutSessionRefresh(response.headers) });
}

export async function GET(request: NextRequest): Promise<Response> {
  return withoutSessionActionRefresh(handlers.GET, request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return withoutSessionActionRefresh(handlers.POST, request);
}
