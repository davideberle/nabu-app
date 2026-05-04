import { NextResponse } from "next/server";
import { setTrackFeedback } from "@/lib/music-domain";

export const runtime = "nodejs";

type FeedbackEntry = {
  room: string;
  track: string;
  artist: string;
  album: string;
  action: "like" | "dislike";
  timestamp: string;
};

export async function GET() {
  // Legacy route retained for old clients. Canonical reads live in sonos-music/preferences.json.
  return NextResponse.json([] as FeedbackEntry[]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const track = typeof body.track === "string" ? body.track : typeof body.title === "string" ? body.title : "";
    const artist = typeof body.artist === "string" ? body.artist : "";
    const album = typeof body.album === "string" ? body.album : "";
    const action = body.action === "dislike" ? "dislike" : body.action === "like" || body.action === "love" ? "love" : "";

    if (!track || !action) {
      return NextResponse.json(
        { error: "Missing required fields: track, action" },
        { status: 400 }
      );
    }

    const result = await setTrackFeedback({ title: track, artist, album, action });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body" },
      { status: 400 }
    );
  }
}
