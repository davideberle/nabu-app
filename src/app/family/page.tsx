import { redirect } from "next/navigation";

// October 8, 2026: the separate milestones page is retired. The root "Today"
// card still projects the canonical dates and the parent tools list them;
// this URL lands in Family Home so nothing bookmarked breaks.
export default function FamilyPage() {
  redirect("/family/home");
}
