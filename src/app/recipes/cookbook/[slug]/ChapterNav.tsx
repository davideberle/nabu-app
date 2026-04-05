"use client";

import { useEffect, useState, useRef } from "react";

interface ChapterNavProps {
  chapters: { name: string; count: number }[];
}

export function ChapterNav({ chapters }: ChapterNavProps) {
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  useEffect(() => {
    // Set up intersection observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveChapter(entry.target.id);
          }
        });
      },
      { rootMargin: '-120px 0px -70% 0px' }
    );
    
    // Observe all chapter sections
    chapters.forEach(({ name }) => {
      const id = `chapter-${name.replace(/\s+/g, '-').toLowerCase()}`;
      const element = document.getElementById(id);
      if (element) {
        observerRef.current?.observe(element);
      }
    });
    
    return () => observerRef.current?.disconnect();
  }, [chapters]);
  
  const scrollToChapter = (chapterName: string) => {
    const id = `chapter-${chapterName.replace(/\s+/g, '-').toLowerCase()}`;
    const element = document.getElementById(id);
    if (element) {
      const offset = 120;
      const y = element.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  if (chapters.length <= 1) return null;

  return (
    <nav className="sticky top-0 z-40 bg-white/95 dark:bg-stone-900/95 backdrop-blur-sm border-b border-stone-200 dark:border-stone-800 shadow-sm">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex gap-1 py-2 overflow-x-auto scrollbar-hide">
          {chapters.map(({ name, count }) => {
            const id = `chapter-${name.replace(/\s+/g, '-').toLowerCase()}`;
            return (
              <button
                key={name}
                onClick={() => scrollToChapter(name)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeChapter === id
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-400 dark:hover:text-stone-200 dark:hover:bg-stone-800'
                }`}
              >
                {name}
                <span className="ml-1.5 text-[10px] opacity-60">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
