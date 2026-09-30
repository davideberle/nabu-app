"use client";

import { useEffect } from "react";
import { retireAllDrafts } from "@/lib/family-learning-draft-store";

/**
 * R5-3: the sign-in page is where every sign-out / auth-loss path lands (the
 * Auth.js sign-out endpoint, the app's sign-out form, an expired session).
 * Any completed learning draft still in this tab belongs to the sign-in that
 * just ended and is retired here, before anyone signs in again. Only the
 * learning draft keys are touched.
 */
export function RetireLearningDrafts() {
  useEffect(() => {
    retireAllDrafts(typeof window !== "undefined" ? window.sessionStorage : null);
  }, []);
  return null;
}
