import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/access";

// Legacy family board (UI-06): retired after its parent review queue moved to
// the compact parent tools. The owner lands there; everyone else in Family
// Home. The `?week=` context is dropped — the queue is cross-week now.
export default async function FamilyDashboardPage() {
  const session = await auth();
  redirect(isAdminEmail(session?.user?.email) ? "/family/parent" : "/family/home");
}
