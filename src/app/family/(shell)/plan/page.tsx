import { redirect } from "next/navigation";
import { normalizeChildId } from "@/lib/family-child-shell";

type Props = { searchParams?: Promise<{ week?: string; child?: string }> };

// Legacy "This week's plan" (UI-05): the weekly grid is retired; the dated
// Activity history is the child's view of what they did. A valid child is
// kept, an unknown one falls back to the chooser, and the old `?week=`
// context is dropped (it never gates access and nothing loops back here).
export default async function FamilyPlanPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const child = normalizeChildId(params.child);
  redirect(child ? `/family/activity?child=${encodeURIComponent(child)}` : "/family/activity");
}
