import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllTodos, createTodo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const todos = await getAllTodos();
  return NextResponse.json(todos, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.title || !body.category || !body.priority) {
    return NextResponse.json(
      { error: "title, category, and priority are required" },
      { status: 400 }
    );
  }

  const todo = await createTodo({
    title: body.title,
    description: body.description,
    category: body.category,
    priority: body.priority,
    dueDate: body.dueDate,
  });

  return NextResponse.json(todo, { status: 201 });
}
