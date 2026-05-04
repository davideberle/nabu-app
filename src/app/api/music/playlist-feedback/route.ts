import { NextResponse } from "next/server";
import { setPlaylistFeedback } from "@/lib/music-domain";

export const runtime = "nodejs";

const RATINGS = new Set(["love", "like", "skip", "occasional"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name : "";
    const rating = typeof body.rating === "string" && RATINGS.has(body.rating) ? body.rating : "";
    const notes = typeof body.notes === "string" ? body.notes : "";

    if (!name || !rating) {
      return NextResponse.json({ error: "Missing required fields: name, rating" }, { status: 400 });
    }

    const result = await setPlaylistFeedback({
      name,
      rating: rating as "love" | "like" | "skip" | "occasional",
      notes,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid playlist feedback" },
      { status: 400 }
    );
  }
}
