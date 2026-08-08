import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getAllRecipeFeedback, setRecipeFeedback } from "@/lib/db";

/** GET — return all recipe feedback entries as a map { recipeId: feedback }. */
export async function GET() {
  const entries = await getAllRecipeFeedback();
  const map: Record<string, "up" | "down"> = {};
  for (const e of entries) map[e.recipeId] = e.feedback;
  return NextResponse.json(map);
}

/** POST — set or clear feedback for a recipe.
 *  Body: { recipeId: string, feedback: "up" | "down" | null }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isTrackerOnlyEmail(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { recipeId, feedback } = (await request.json()) as {
    recipeId: string;
    feedback: "up" | "down" | null;
  };

  if (!recipeId || (feedback !== "up" && feedback !== "down" && feedback !== null)) {
    return NextResponse.json(
      { error: "recipeId required; feedback must be 'up', 'down', or null" },
      { status: 400 }
    );
  }

  await setRecipeFeedback(recipeId, feedback);
  return NextResponse.json({ ok: true });
}
