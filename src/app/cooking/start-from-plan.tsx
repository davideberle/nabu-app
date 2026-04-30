"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StartFromPlanButton({ date }: { date: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cooking/session/from-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Could not create session");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-5 py-2.5 rounded-full text-sm font-medium bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50 transition-colors shadow-sm"
      >
        {loading ? "Starting..." : "Start from today\u2019s plan"}
      </button>
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
