// Route-handler side of the access policy.
//
// The decisions themselves live in ./access.ts (session rules) and
// ./runtime-auth.ts (trusted-runtime token). This module only binds them to
// NextAuth and to a JSON error response, so every gated route reads the same
// single line and no route re-implements a rule.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { evaluateRuntimeWriteAccess, type RuntimeWriteAccess } from "@/lib/runtime-auth";

/**
 * Guard a mutation that both the browser and a trusted local runtime may
 * perform (Cooking Session writes, recipe-image writes).
 *
 * Returns a ready-to-return 401/403 response when the request is not
 * authorized, or the granted access when it is.
 */
export async function guardRuntimeWrite(
  request: Request,
): Promise<
  | { response: NextResponse; access: null }
  | { response: null; access: Extract<RuntimeWriteAccess, { allowed: true }> }
> {
  const access = evaluateRuntimeWriteAccess(
    await auth(),
    request.headers.get("authorization"),
  );
  if (!access.allowed) {
    return {
      response: NextResponse.json({ error: access.error }, { status: access.status }),
      access: null,
    };
  }
  return { response: null, access };
}
