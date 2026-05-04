import { NextResponse } from "next/server";
import { setTrackFeedback } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title : typeof body.track === "string" ? body.track : "";
    const artist = typeof body.artist === "string" ? body.artist : "";
    const album = typeof body.album === "string" ? body.album : "";
    const action = body.action === "dislike" ? "dislike" : body.action === "love" || body.action === "like" ? "love" : "";

    if (!title || !action) {
      return NextResponse.json({ error: "Missing required fields: title, action" }, { status: 400 });
    }

    const result = await setTrackFeedback({ artist, title, album, action });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid track feedback" },
      { status: 400 }
    );
  }
}
