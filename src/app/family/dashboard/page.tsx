import type { Metadata } from "next";
import { FamilyDashboardClient } from "./client";

export const metadata: Metadata = {
  title: "Family Routines — Nabu",
  description: "iPad family routines dashboard",
};

export default function FamilyDashboardPage() {
  return <FamilyDashboardClient />;
}
