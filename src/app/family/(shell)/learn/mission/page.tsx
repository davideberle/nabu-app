import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyMissionClient } from "./client";

export const metadata: Metadata = {
  title: "Expedition — Nabu",
  description: "The mission workspace: scene, tasks and the tutor panel",
};

// The mission workspace (family-assistant DESIGN §7.6, screen 2). The scene is
// central and the tutor panel collapses beside it. Every confirmed step is a
// server mutation with an idempotency key and the rendered revision, so
// refresh, exit and child switching preserve confirmed progress without ever
// sending an unfinished answer.
export default async function FamilyMissionPage() {
  await auth();
  return <FamilyMissionClient />;
}
