"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The travel-owned document stays server-side behind the same session gate. */
export function TripGuide() {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(1100);
  const resize = useCallback(() => {
    observer.current?.disconnect();
    const document = frame.current?.contentDocument;
    if (!document?.body) return;
    const measure = () => setHeight(Math.ceil(document.body.getBoundingClientRect().height) + 32);
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(document.body);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  return <iframe ref={frame} src="/travel/alpnach-2026/guide" title="Alpnach trip guide and interactive walking map"
    onLoad={resize} className="w-full rounded-2xl border border-secondary bg-white" style={{ height }} />;
}
