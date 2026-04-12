import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTodo, updateTodo, deleteTodo } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json();

  const existing = getTodo(id);
  if (!existing) {
    return NextResponse.json({ error: "Todo not found" }, { status: 404 });
  }

  const updated = updateTodo(id, body);
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const deleted = deleteTodo(id);
  if (!deleted) {
    return NextResponse.json({ error: "Todo not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
