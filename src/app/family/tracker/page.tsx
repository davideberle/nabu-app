import { redirect } from "next/navigation";

// Legacy iPad milestone tracker (UI-08/UI-09): the destination is retired, the
// bookmark/installed shortcut lands safely in Family Home. Tracker-only
// sessions get exactly the surfaces the middleware already allows them — no
// wider access is granted by this redirect.
export default function FamilyTrackerPage() {
  redirect("/family/home");
}
