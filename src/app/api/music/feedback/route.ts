import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";

const FEEDBACK_PATH =
  "/Users/claweberle/.openclaw/workspace/projects/companion-app/app/music-feedback.json";

interface FeedbackEntry {
  room: string;
  track: string;
  artist: string;
  album: string;
  action: "like" | "dislike";
  timestamp: string;
}

async function readFeedback(): Promise<FeedbackEntry[]> {
  if (!existsSync(FEEDBACK_PATH)) {
    return [];
  }
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeFeedback(entries: FeedbackEntry[]): Promise<void> {
  await writeFile(FEEDBACK_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

export async function GET() {
  const entries = await readFeedback();
  return NextResponse.json(entries);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { room, track, artist, album, action } = body;

    if (!room || !track || !action) {
      return NextResponse.json(
        { error: "Missing required fields: room, track, action" },
        { status: 400 }
      );
    }

    if (action !== "like" && action !== "dislike") {
      return NextResponse.json(
        { error: 'Action must be "like" or "dislike"' },
        { status: 400 }
      );
    }

    const entries = await readFeedback();
    const entry: FeedbackEntry = {
      room,
      track,
      artist: artist || "",
      album: album || "",
      action,
      timestamp: new Date().toISOString(),
    };
    entries.push(entry);
    await writeFeedback(entries);

    return NextResponse.json({ ok: true, entry });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
