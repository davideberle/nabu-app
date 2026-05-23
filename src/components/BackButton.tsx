"use client";

import { useRouter } from "next/navigation";

const ALLOWED_FALLBACKS = [
  "/recipes",
  "/recipes/cookbooks",
  "/recipes/cookbook/",
  "/recipes/cuisine/",
  "/recipes/dietary/",
  "/meals",
  "/cooking",
];

function safeInternalPath(value: string | null): string | null {
  if (!value) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original value if decoding fails; the checks below still apply.
  }

  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//")) return null;
  if (decoded.includes("://")) return null;
  if (!ALLOWED_FALLBACKS.some((path) => decoded === path || decoded.startsWith(path))) {
    return null;
  }

  return decoded;
}

function getBackTarget(fallback: string): string {
  const safeFallback = safeInternalPath(fallback) ?? "/recipes";

  if (typeof window === "undefined") return safeFallback;

  const search = new URLSearchParams(window.location.search);
  const from = safeInternalPath(search.get("from"));
  return from && from !== window.location.pathname ? from : safeFallback;
}

/**
 * Deterministic back button for deep recipe pages.
 *
 * Browser back is unreliable here because in-page actions like chapter-nav
 * scrolling can create history entries, so the button may just jump around the
 * same recipe/list page. Recipe links can pass ?from=/recipes/... to return to
 * the exact parent; otherwise we fall back to /recipes.
 */
export default function BackButton({ fallback = "/recipes" }: { fallback?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => router.push(getBackTarget(fallback))}
      className="flex items-center justify-center w-10 h-10 rounded-full bg-white/95 dark:bg-stone-900/95 shadow-lg backdrop-blur text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
