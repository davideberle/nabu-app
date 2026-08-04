import type { Metadata } from "next";
import { auth } from "@/auth";
import { isTrackerOnlyEmail } from "@/lib/access";
import { getCompletedGymnasticsHistory, getGymnasticsProgress } from "@/lib/health-db";
import {
  GYMNASTICS_ARCHIVE,
  GYMNASTICS_ARCHIVED_PROGRAM_IDS,
  GYMNASTICS_PROGRAM,
  summarizeHistory,
  type GymnasticsHistoryBlock,
  type GymnasticsProgressRow,
} from "@/lib/gymnastics";
import { GymnasticsClient } from "./client";

export const metadata: Metadata = {
  title: `${GYMNASTICS_PROGRAM.title} — Health — Nabu`,
  description: GYMNASTICS_PROGRAM.subtitle,
};

export default async function GymnasticsPage() {
  const session = await auth();
  const restricted = isTrackerOnlyEmail(session?.user?.email);

  let initialProgress: GymnasticsProgressRow[] = [];
  let history: GymnasticsHistoryBlock[] = [];
  if (!restricted && session?.user) {
    const [rows, historyRows] = await Promise.all([
      getGymnasticsProgress(GYMNASTICS_PROGRAM.programId),
      getCompletedGymnasticsHistory(GYMNASTICS_ARCHIVED_PROGRAM_IDS),
    ]);
    initialProgress = rows.map((r) => ({
      week: r.week,
      session: r.session,
      completed: r.completed,
      completedAt: r.completedAt,
      ...(r.note ? { note: r.note } : {}),
    }));
    history = summarizeHistory(GYMNASTICS_ARCHIVE, historyRows, GYMNASTICS_PROGRAM.programId);
  }

  return (
    <GymnasticsClient
      program={GYMNASTICS_PROGRAM}
      initialProgress={initialProgress}
      history={history}
      restricted={restricted}
    />
  );
}
