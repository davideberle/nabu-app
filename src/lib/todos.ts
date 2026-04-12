export type Todo = {
  id: string;
  title: string;
  description?: string;
  category: "family" | "home" | "work" | "personal";
  priority: "high" | "medium" | "low";
  dueDate?: string;
  completed: boolean;
  createdAt: string;
};

// Initial todos from David
export const initialTodos: Todo[] = [
  {
    id: "1",
    title: "Check kids' next doctor checkup",
    description: "Find out when the next scheduled checkup is",
    category: "family",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-04T14:39:00Z",
  },
  {
    id: "2",
    title: "Call Gundeli Velos to fix e-bike",
    description: "E-bike needs repair",
    category: "home",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-04T14:39:00Z",
  },
  {
    id: "3",
    title: "Review deeper backup strategy",
    description:
      "Decide whether to back up nested project repos and other state beyond the nightly root-workspace backup.",
    category: "work",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-08T06:10:00Z",
  },
  {
    id: "4",
    title: "Document macOS Local Network permission root cause",
    description:
      "Write down that denying Local Network access for Terminal/Homebrew Node on the Mac mini broke Node LAN access, Sonos discovery, and the voice assistant debugging path.",
    category: "work",
    priority: "medium",
    completed: false,
    createdAt: "2026-04-08T17:36:00Z",
  },
];
