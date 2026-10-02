import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";
import { alpnachGuideHtml } from "@/data/travel/alpnach-guide";

export const dynamic = "force-dynamic";

/** Never publish the private trip document as an unauthenticated static asset. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  if (!isAdminEmail(session.user.email)) return new Response("Forbidden", { status: 403 });
  return new Response(alpnachGuideHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
