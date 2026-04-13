import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllTodos, createTodo } from "@/lib/db";

export async function GET() {
  const todos = getAllTodos();
  return NextResponse.json(todos);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.title || !body.category || !body.priority) {
    return NextResponse.json(
      { error: "title, category, and priority are required" },
      { status: 400 }
    );
  }

  const todo = createTodo({
    title: body.title,
    description: body.description,
    category: body.category,
    priority: body.priority,
    dueDate: body.dueDate,
  });

  return NextResponse.json(todo, { status: 201 });
}
