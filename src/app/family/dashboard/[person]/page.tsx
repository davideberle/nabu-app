import { redirect } from "next/navigation";
import { normalizeChildId } from "@/lib/family-child-shell";

type Props = { params: Promise<{ person: string }> };

// Legacy person weekly grid (UI-07): retired. A child bookmark maps to that
// child's Family Home; a parent or unknown person bookmark lands on the
// chooser. Permission is never inferred from the selected person.
export default async function PersonBoardPage({ params }: Props) {
  const { person } = await params;
  const child = normalizeChildId(person);
  redirect(child ? `/family/home?child=${encodeURIComponent(child)}` : "/family/home");
}
