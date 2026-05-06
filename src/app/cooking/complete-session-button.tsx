"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NabuButton } from "@/components/ui/nabu";

export function CompleteSessionButton({
  sessionId,
  completed,
}: {
  sessionId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (completed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cooking/session/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not mark complete");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
      <NabuButton
        onClick={handleClick}
        disabled={completed || saving}
        tone={completed ? "secondary" : "primary"}
        size="sm"
        className="w-full justify-center sm:w-auto"
      >
        {completed ? "Completed" : saving ? "Saving..." : "Mark complete"}
      </NabuButton>
      {error ? <p className="text-xs text-red-500 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
