import type { Metadata } from "next";
import { auth } from "@/auth";
import { FamilyGamesClient } from "./client";

export const metadata: Metadata = {
  title: "Games — Nabu",
  description: "Chess: 15 free minutes a day after a parent approves something you did today. Game Studio: coins buy time for making, changing and playing",
};

// The approved-game library (Game Studio DESIGN G1; Family DESIGN "Game
// Studio entitlements" G2). Lives inside the `(shell)` route group so the
// persistent profile/wallet header owns the selected child.
export default async function FamilyGamesPage() {
  await auth();
  return <FamilyGamesClient />;
}
