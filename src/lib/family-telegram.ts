import {
  dayLabels,
  familyMembers,
  routineDefinitions,
  type CompletionRecord,
} from "@/data/family-routines";

type ReviewNotificationInput = {
  week: string;
  record: CompletionRecord;
};

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    "https://app.davideberle.com"
  ).replace(/\/$/, "");
}

function reviewText({ week, record }: ReviewNotificationInput): string {
  const person = familyMembers.find((member) => member.id === record.personId);
  const routine = routineDefinitions.find((item) => item.id === record.routineId);
  const title = routine ? `${routine.icon} ${routine.title}` : record.routineId;
  const child = person?.displayName ?? record.personId;
  const transcript = record.note?.trim() || "(no transcript captured)";
  const coach = record.challenge?.trim();
  const link = `${appBaseUrl()}/family/dashboard/${record.personId}?week=${encodeURIComponent(week)}`;

  return [
    `Family review: ${child}`,
    `${title} · ${dayLabels[record.day]} · ${week}`,
    "",
    "Transcript:",
    truncate(transcript, 900),
    ...(coach ? ["", "Coach:", truncate(coach, 500)] : []),
    "",
    `Open: ${link}`,
    "",
    "Reply here with approve or hold, or use Parent controls in the app.",
  ].join("\n");
}

export async function notifyFamilyReviewSubmission(
  input: ReviewNotificationInput,
): Promise<{ sent: boolean; reason?: string }> {
  if (input.record.status !== "pending_review") {
    return { sent: false, reason: "not-pending-review" };
  }

  const token = process.env.FAMILY_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { sent: false, reason: "missing-token" };
  }

  const chatId = process.env.FAMILY_TELEGRAM_CHAT_ID || "-1003850400536";
  const threadId = process.env.FAMILY_TELEGRAM_THREAD_ID || "1981";
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_thread_id: Number(threadId),
      text: reviewText(input),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    return { sent: false, reason: `telegram-${response.status}` };
  }

  return { sent: true };
}
