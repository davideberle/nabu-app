import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getGymnasticsProgress } from "@/lib/health-db";
import { GYMNASTICS_PROGRAM, type GymnasticsProgressRow } from "@/lib/gymnastics";
import { GymnasticsClient } from "./client";

export const metadata: Metadata = {
  title: "Gymnastics — Health — Nabu",
  description: "10-week kipping, butterfly, and toes-to-bar skill program",
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
