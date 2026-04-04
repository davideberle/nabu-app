"use client";

import { useEffect } from "react";

// Mock data - will be replaced with real data
const items = [
  { name: "Milch", qty: "2L" },
  { name: "Eier", qty: "12 Stück" },
  { name: "Pasta", qty: "500g" },
  { name: "Äpfel", qty: "1kg" },
  { name: "Butter", qty: "250g" },
];

export default function PrintKidsPage() {
  useEffect(() => {
    // Auto-trigger print dialog
    window.print();
  }, []);

  return (
    <div className="p-8 max-w-md mx-auto">
      <style jsx global>{`
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">🛒 Einkaufsliste</h1>
        <p className="text-zinc-500">
          {new Date().toLocaleDateString("de-CH", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      {/* Items */}
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-center gap-4 text-xl border-b border-zinc-200 pb-3"
          >
            <span className="w-6 h-6 rounded border-2 border-zinc-300 flex-shrink-0"></span>
            <span className="flex-1 font-medium">{item.name}</span>
            <span className="text-zinc-500">{item.qty}</span>
          </li>
        ))}
      </ul>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-zinc-200 text-center text-sm text-zinc-400">
        Danke fürs Einkaufen! 🙏
      </div>

      {/* Back button (hidden in print) */}
      <div className="mt-8 text-center print:hidden">
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-700"
        >
          ← Back to Shopping
        </button>
      </div>
    </div>
  );
}
