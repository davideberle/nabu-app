import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getGymnasticsProgress } from "@/lib/health-db";
import { GYMNASTICS_PROGRAM, type GymnasticsProgressRow } from "@/lib/gymnastics";
import { GymnasticsClient } from "./client";

export const metadata: Metadata = {
  title: `${GYMNASTICS_PROGRAM.title} — Health — Nabu`,
  description: GYMNASTICS_PROGRAM.subtitle,
};

export default async function GymnasticsPage() {
  const session = await auth();
  const restricted = isTrackerOnlyEmail(session?.user?.email);

  let initialProgress: GymnasticsProgressRow[] = [];
  if (!restricted && session?.user) {
    const rows = await getGymnasticsProgress(GYMNASTICS_PROGRAM.programId);
    initialProgress = rows.map((r) => ({
      week: r.week,
      session: r.session,
      completed: r.completed,
      completedAt: r.completedAt,
      ...(r.note ? { note: r.note } : {}),
    }));
  }

  return (
    <GymnasticsClient
      program={GYMNASTICS_PROGRAM}
      initialProgress={initialProgress}
      restricted={restricted}
    />
  );
}
