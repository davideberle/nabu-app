"use client";

import { useState, useEffect, useCallback } from "react";
import type { Todo } from "@/lib/todos";
import {
  NabuPageShell,
  NabuHeader,
  NabuMain,
  NabuSurface,
  NabuButton,
  NabuBadge,
  NabuEmptyState,
} from "@/components/ui/nabu";

const categoryEmoji: Record<string, string> = {
  family: "👨‍👩‍👧‍👦",
  home: "🏠",
  work: "💼",
  personal: "👤",
};

const priorityTone = {
  high: "red",
  medium: "amber",
  low: "green",
} as const;

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch("/api/todos");
      if (!res.ok) throw new Error("Failed to load todos");
      const data = await res.json();
      setTodos(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const toggleTodo = async (id: string) => {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return;

    // Optimistic update
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );

    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !todo.completed }),
      });
      if (!res.ok) throw new Error("Failed to update todo");
    } catch {
      // Revert on failure
      setTodos((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, completed: todo.completed } : t
        )
      );
    }
  };

  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const activeTodos = todos.filter((t) => !t.completed).length;

  return (
    <NabuPageShell>
      <NabuHeader
        title="Todos"
        backHref="/"
        subtitle={!loading ? `${activeTodos} active` : undefined}
        action={
          <div className="flex gap-1.5">
            {(["all", "active", "completed"] as const).map((f) => (
              <NabuButton
                key={f}
                tone={filter === f ? "primary" : "ghost"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </NabuButton>
            ))}
          </div>
        }
      />

      <NabuMain>
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <NabuEmptyState title="Loading…" />
        ) : filteredTodos.length === 0 ? (
          <NabuEmptyState
            icon="✅"
            title="No todos"
            description="Tell Nabu to add todos via Telegram"
          />
        ) : (
          <>
            <NabuSurface as="div">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredTodos.map((todo) => (
                  <li key={todo.id}>
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className="w-full px-4 py-4 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <span
                        className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                          todo.completed
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-zinc-300 dark:border-zinc-600"
                        }`}
                      >
                        {todo.completed && "✓"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm font-medium ${
                              todo.completed
                                ? "line-through text-quaternary"
                                : "text-primary"
                            }`}
                          >
                            {todo.title}
                          </span>
                          <span className="text-sm">
                            {categoryEmoji[todo.category]}
                          </span>
                          <NabuBadge tone={priorityTone[todo.priority]}>
                            {todo.priority}
                          </NabuBadge>
                        </div>
                        {todo.description && (
                          <p className="mt-1 text-sm text-tertiary">
                            {todo.description}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </NabuSurface>
            <p className="mt-4 text-center text-sm text-quaternary">
              Tell Nabu to add todos via Telegram
            </p>
          </>
        )}
      </NabuMain>
    </NabuPageShell>
  );
}
