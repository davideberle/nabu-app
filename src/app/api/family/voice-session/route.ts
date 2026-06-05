import { NextResponse } from "next/server";

/**
 * POST /api/family/voice-session
 *
 * Mints an OpenAI Realtime ephemeral session for the voice coach.
 * When OPENAI_API_KEY is set, calls the OpenAI Realtime sessions endpoint
 * and returns the ephemeral client secret. When the key is absent, returns
 * a clear unavailable/demo response so the UI can use its local fallback.
 *
 * Request body:
 * {
 *   personId: string;
 *   routineId: string;
 *   routineTitle: string;
 *   day: number;
 *   date: string;
 * }
 */

type SessionRequest = {
  personId: string;
  routineId: string;
  routineTitle: string;
  day: number;
  date: string;
};

function isSessionRequest(value: unknown): value is SessionRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SessionRequest>;
  return (
    typeof body.personId === "string" &&
    body.personId.length > 0 &&
    typeof body.routineId === "string" &&
    body.routineId.length > 0 &&
    typeof body.routineTitle === "string" &&
    body.routineTitle.length > 0 &&
    typeof body.day === "number" &&
    Number.isInteger(body.day) &&
    body.day >= 0 &&
    body.day <= 6 &&
    typeof body.date === "string" &&
    body.date.length > 0
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSessionRequest(body)) {
    return NextResponse.json(
      { error: "Expected personId, routineId, routineTitle, day, and date" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        available: false,
        reason: "demo",
        message:
          "Voice coach runs in local demo mode. Set OPENAI_API_KEY to enable the real-time assistant.",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": `family-${body.personId}`,
        },
        body: JSON.stringify({
          model: "gpt-realtime",
          modalities: ["audio"],
          instructions: [
            `You are a friendly voice coach for a child named ${body.personId}.`,
            `The child is completing the task "${body.routineTitle}" for day ${body.day}.`,
            `Ask what they did. If the answer is vague, ask one short follow-up.`,
            `Keep it child-friendly. No lectures. One acknowledgement, one optional question, then accept or flag for parent review.`,
            `Use a tool call to finish: accept_completion, ask_one_followup, or needs_parent_review.`,
            `Do not discuss unrelated topics.`,
          ].join(" "),
          tools: [
            {
              type: "function",
              name: "accept_completion",
              description: "Accept the child's completion after a plausible explanation.",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                },
                required: ["summary"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "ask_one_followup",
              description: "Ask one short follow-up when the child's explanation is too vague.",
              parameters: {
                type: "object",
                properties: {
                  question: { type: "string" },
                },
                required: ["question"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "needs_parent_review",
              description: "Send the completion to a parent when it remains unclear or conflicting.",
              parameters: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                },
                required: ["reason"],
                additionalProperties: false,
              },
            },
          ],
          tool_choice: "auto",
          turn_detection: { type: "server_vad" },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          available: false,
          reason: "upstream_error",
          message: `OpenAI returned ${response.status}: ${text.slice(0, 200)}`,
        },
        { status: 502 },
      );
    }

    const data = await response.json();

    return NextResponse.json({
      available: true,
      clientSecret: data.client_secret?.value ?? null,
      expiresAt: data.client_secret?.expires_at ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: false,
        reason: "fetch_error",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
