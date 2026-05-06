import { NextResponse } from "next/server";
import { getCookingSessionForDate } from "@/lib/cooking";
import { todayInZurich } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET /api/cooking/today/story — read-only voice/app helper for today's dish story
export async function GET() {
  try {
    const date = todayInZurich();
    const session = await getCookingSessionForDate(date);

    if (!session) {
      return NextResponse.json({
        ok: false,
        date,
        message: "No cooking session found for today.",
      });
    }

    const story = session.story;
    if (!story?.text) {
      return NextResponse.json({
        ok: false,
        date,
        meal: session.anchor.title,
        message: `Today's dish is ${session.anchor.title}, but no story has been added yet.`,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      meal: session.anchor.title,
      story: {
        title: story.title || session.anchor.title,
        text: story.text,
        source: story.source ?? session.anchor.provenance.source,
        updatedAt: story.updatedAt ?? session.updatedAt,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load today's cooking story" },
      { status: 500 }
    );
  }
}
