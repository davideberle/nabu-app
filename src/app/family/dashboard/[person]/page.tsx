import type { Metadata } from "next";
import { familyMembers } from "@/data/family-routines";
import { PersonBoardClient } from "./client";

type Props = { params: Promise<{ person: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { person: personId } = await params;
  const person = familyMembers.find((p) => p.id === personId);
  return {
    title: person
      ? `${person.displayName} — Routines — Nabu`
      : "Routines — Nabu",
  };
}

export default async function PersonBoardPage({ params }: Props) {
  const { person: personId } = await params;
  return <PersonBoardClient personId={personId} />;
}
