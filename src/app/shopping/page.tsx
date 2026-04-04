"use client";

import Link from "next/link";
import { useState } from "react";

// Mock data - will be replaced with real data from JSON files
const mockLists = {
  kids: {
    name: "Kids List",
    emoji: "🧒",
    items: [
      { id: 1, name: "Milch", qty: "2L", checked: false },
      { id: 2, name: "Eier", qty: "12", checked: false },
      { id: 3, name: "Pasta", qty: "500g", checked: false },
      { id: 4, name: "Äpfel", qty: "1kg", checked: false },
      { id: 5, name: "Butter", qty: "250g", checked: false },
    ],
  },
  david: {
    name: "David's List",
    emoji: "👨",
    items: [
      { id: 1, name: "Salmon", qty: "400g", checked: false },
      { id: 2, name: "Fresh herbs", qty: "", checked: false },
      { id: 3, name: "Avocados", qty: "3", checked: false },
    ],
  },
  bulk: {
    name: "Bulk",
    emoji: "📦",
    items: [
      { id: 1, name: "Olive oil", qty: "1L", checked: false },
      { id: 2, name: "Rice", qty: "5kg", checked: false },
    ],
  },
};

type ListId = keyof typeof mockLists;

export default function ShoppingPage() {
  const [activeList, setActiveList] = useState<ListId>("kids");
  const [lists, setLists] = useState(mockLists);

  const toggleItem = (listId: ListId, itemId: number) => {
    setLists((prev) => ({
      ...prev,
      [listId]: {
        ...prev[listId],
        items: prev[listId].items.map((item) =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
      },
    }));
  };

  const clearChecked = (listId: ListId) => {
    setLists((prev) => ({
      ...prev,
      [listId]: {
        ...prev[listId],
        items: prev[listId].items.filter((item) => !item.checked),
      },
    }));
  };

  const currentList = lists[activeList];
  const checkedCount = currentList.items.filter((i) => i.checked).length;

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
            <span className="text-2xl">🛒</span>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Shopping
            </h1>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
          {(Object.keys(lists) as ListId[]).map((listId) => {
            const list = lists[listId];
            const isActive = listId === activeList;
            return (
              <button
                key={listId}
                onClick={() => setActiveList(listId)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                {list.emoji} {list.name}
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  {list.items.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {currentList.items.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
              No items in this list
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {currentList.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => toggleItem(activeList, item.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
                  >
                    <span
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                        item.checked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {item.checked && "✓"}
                    </span>
                    <span
                      className={`flex-1 ${
                        item.checked
                          ? "line-through text-zinc-400 dark:text-zinc-500"
                          : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.qty && (
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {item.qty}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-3">
          {activeList === "kids" && (
            <Link
              href="/shopping/print/kids"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
            >
              🖨️ Print List
            </Link>
          )}
          {checkedCount > 0 && (
            <button
              onClick={() => clearChecked(activeList)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors"
            >
              Clear {checkedCount} checked
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
