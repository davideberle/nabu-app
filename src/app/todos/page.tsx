"use client";

import Link from "next/link";
import { useState } from "react";

type Todo = {
  id: string;
  title: string;
  description?: string;
  category: "family" | "home" | "work" | "personal";
  priority: "high" | "medium" | "low";
  dueDate?: string;
  completed: boolean;
  createdAt: string;
};

// Initial todos from David
const initialTodos: Todo[] = [
  {
    id: "1",
    title: "Check kids' next doctor checkup",
    description: "Find out when the next scheduled checkup is",
    category: "family",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-04T14:39:00Z",
  },
  {
    id: "2",
    title: "Call Gundeli Velos to fix e-bike",
    description: "E-bike needs repair",
    category: "home",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-04T14:39:00Z",
  },
];

const categoryEmoji = {
  family: "👨‍👩‍👧‍👦",
  home: "🏠",
  work: "💼",
  personal: "👤",
};

const priorityColor = {
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const activeTodos = todos.filter((t) => !t.completed).length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-20">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Todos
            </h1>
          </div>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {activeTodos} active
          </span>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="flex gap-2">
          {(["all", "active", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Todo List */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {filteredTodos.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
              No todos
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredTodos.map((todo) => (
                <li key={todo.id}>
                  <button
                    onClick={() => toggleTodo(todo.id)}
                    className="w-full px-4 py-4 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
                  >
                    <span
                      className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        todo.completed
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {todo.completed && "✓"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-medium ${
                            todo.completed
                              ? "line-through text-zinc-400 dark:text-zinc-500"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {todo.title}
                        </span>
                        <span className="text-sm">
                          {categoryEmoji[todo.category]}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            priorityColor[todo.priority]
                          }`}
                        >
                          {todo.priority}
                        </span>
                      </div>
                      {todo.description && (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                          {todo.description}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400 text-center">
          Tell Nabu to add todos via Telegram
        </p>
      </main>
    </div>
  );
}
