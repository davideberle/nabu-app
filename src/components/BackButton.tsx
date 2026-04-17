"use client";

import { useRouter } from "next/navigation";

/**
 * Back button that uses browser history when available (e.g. user came from
 * a cookbook page, search, etc.), falling back to /recipes for direct links.
 */
export default function BackButton({ fallback = "/recipes" }: { fallback?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => {
        // If there's a previous page in the session history, go back to it.
        // window.history.length > 1 is true even for direct navigations in
        // some browsers, but the Next.js router handles back() gracefully:
        // if there really is no prior app page it navigates to the fallback.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallback);
        }
      }}
      className="flex items-center justify-center w-10 h-10 rounded-full bg-white/95 dark:bg-stone-900/95 shadow-lg backdrop-blur text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 transition-colors"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
