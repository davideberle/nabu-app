import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFamilyWalletProjection } from "@/lib/family-wallet-server";

/** Authenticated, bounded projection of the permanent family coin wallets. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getFamilyWalletProjection());
}
