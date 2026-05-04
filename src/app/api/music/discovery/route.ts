import { NextResponse } from "next/server";
import { getDiscovery, transitionDiscoveryCandidate } from "@/lib/music-domain";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "8", 10);

  try {
    const discovery = await getDiscovery(Number.isFinite(limit) ? limit : 8);
    return NextResponse.json(discovery);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Music discovery unavailable" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!id || !action) {
      return NextResponse.json({ error: "Missing required fields: id, action" }, { status: 400 });
    }

    const result = await transitionDiscoveryCandidate(id, action);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid discovery action" },
      { status: 400 }
    );
  }
}
