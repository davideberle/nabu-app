"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { NabuBadge, cn } from "@/components/ui/nabu";
import {
  routineDefinitions,
  rewardDefinitions,
  weekPoints,
  nextRewardForPerson,
  type CompletionRecord,
  type RoutineDefinition,
  type RewardDefinition,
} from "@/data/family-routines";
import type { FamilyBoardConfig, RewardRedemption } from "@/lib/family-db";
import {
  assistantProfiles,
  assistantProfileById,
  dragonSongChoices,
  podcastChoices,
  ninjagoResume,
  parentSuggestion,
  starterPhrases,
  detectIntent,
  findUncertainWord,
  type AssistantChildId,
  type AssistantIntent,
  type AssistantProfile,
  type MediaCard,
} from "@/data/family-assistant";
import { AssistantAvatar, type AvatarState } from "./avatar";

// ---------------------------------------------------------------------------
// Browser speech recognition shims (same shape as the person board client)
// ---------------------------------------------------------------------------

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function speechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Resolve routines/rewards with config overrides (client-side mirror)
// ---------------------------------------------------------------------------

function resolveRoutinesClient(config: FamilyBoardConfig): RoutineDefinition[] {
  return routineDefinitions
    .map((r) => {
      const ov = config.routineOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...("weeklyTarget" in ov ? { weeklyTarget: ov.weeklyTarget } : {}),
        ...(ov.points !== undefined ? { points: ov.points } : {}),
      };
    })
    .filter((r): r is RoutineDefinition => r !== null);
}

function resolveRewardsClient(config: FamilyBoardConfig): RewardDefinition[] {
  return rewardDefinitions
    .map((r) => {
      const ov = config.rewardOverrides[r.id];
      if (!ov) return r;
      if (ov.enabled === false) return null;
      return {
        ...r,
        ...(ov.costPoints !== undefined ? { costPoints: ov.costPoints } : {}),
        ...(ov.targetPoints !== undefined ? { targetPoints: ov.targetPoints } : {}),
      };
    })
    .filter((r): r is RewardDefinition => r !== null);
}

// ---------------------------------------------------------------------------
// Conversation state machine
// ---------------------------------------------------------------------------

type ConfirmOption =
  | { kind: "intent"; intent: AssistantIntent; label: string; icon: string }
  | { kind: "music-choices"; label: string; icon: string }
  | { kind: "retry"; label: string }
  | { kind: "dismiss"; label: string };

type NowPlayingSource = "resume" | "music" | "podcast" | "parent";

type ShowingView =
  | { kind: "resume" }
  | { kind: "music-choices" }
  | { kind: "podcasts" }
  | { kind: "points" }
  | { kind: "parent-suggestion" }
  | { kind: "now-playing"; item: MediaCard; from: NowPlayingSource };

type Stage =
  | { kind: "ready" }
  | { kind: "listening"; transcript: string; simulated: boolean }
  | {
      kind: "confirming";
      transcript: string;
      uncertain?: string;
      prompt: string;
      options: ConfirmOption[];
    }
  | { kind: "thinking"; goal: string; transcript?: string }
  | { kind: "showing"; view: ShowingView }
  | { kind: "recovering"; message: string };

type PointsSnapshot = {
  live: boolean;
  earned: number;
  balance: number;
  next: { title: string; icon: string; target: number; missing: number } | null;
};

function avatarStateFor(stage: Stage, isSpeaking: boolean): AvatarState {
  switch (stage.kind) {
    case "ready":
      return "ready";
    case "listening":
      return "listening";
    case "confirming":
    case "recovering":
      return "confirming";
    case "thinking":
      return "thinking";
    case "showing":
      return isSpeaking ? "speaking" : "showing";
  }
}

function avatarStateLabel(state: AvatarState): string {
  switch (state) {
    case "ready":
      return "ready";
    case "listening":
      return "listening…";
    case "confirming":
      return "double-checking";
    case "thinking":
      return "thinking…";
    case "showing":
      return "showing you";
    case "speaking":
      return "speaking";
  }
}

// ---------------------------------------------------------------------------
// Shared tint classes
// ---------------------------------------------------------------------------

const tintSoftBg = {
  amber: "bg-amber-50 dark:bg-amber-950/30",
  emerald: "bg-emerald-50 dark:bg-emerald-950/30",
} as const;

const tintBorder = {
  amber: "border-amber-200 dark:border-amber-800",
  emerald: "border-emerald-200 dark:border-emerald-800",
} as const;

const tintText = {
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
} as const;

const tintSolid = {
  amber: "bg-amber-500 hover:bg-amber-600 focus-visible:outline-amber-600",
  emerald: "bg-emerald-500 hover:bg-emerald-600 focus-visible:outline-emerald-600",
} as const;

const tintBar = {
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
} as const;

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function TranscriptText({ text, uncertain }: { text: string; uncertain?: string }) {
  if (!uncertain) return <>&ldquo;{text}&rdquo;</>;
  const index = text.toLowerCase().indexOf(uncertain.toLowerCase());
  if (index === -1) return <>&ldquo;{text}&rdquo;</>;
  return (
    <>
      &ldquo;{text.slice(0, index)}
      <mark className="rounded bg-amber-200 px-1 text-inherit underline decoration-amber-500 decoration-wavy underline-offset-4 dark:bg-amber-500/30">
        {text.slice(index, index + uncertain.length)}
      </mark>
      {text.slice(index + uncertain.length)}&rdquo;
    </>
  );
}

function ChoiceCard({
  card,
  onSelect,
  actionLabel,
}: {
  card: MediaCard;
  onSelect: () => void;
  actionLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex min-w-0 flex-col gap-3 rounded-2xl border border-primary bg-primary p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
        focusRing,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-3xl">
          {card.icon}
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold leading-snug text-primary">
            {card.title}
          </span>
          <span className="mt-0.5 block text-sm text-tertiary">{card.subtitle}</span>
        </span>
      </div>
      <span className="flex items-center justify-between gap-2">
        <NabuBadge tone="stone">{card.meta}</NabuBadge>
        <span className="text-sm font-medium text-secondary transition-colors group-hover:text-primary">
          {actionLabel} →
        </span>
      </span>
    </button>
  );
}

function BigOptionButton({
  label,
  icon,
  primary,
  tint,
  onClick,
}: {
  label: string;
  icon?: string;
  primary?: boolean;
  tint: AssistantProfile["tint"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors",
        focusRing,
        primary
          ? cn("text-white", tintSolid[tint])
          : "border border-primary bg-primary text-primary hover:bg-secondary",
      )}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {label}
    </button>
  );
}

function DemoBadgeRow({ text }: { text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NabuBadge tone="amber">Prototype demo</NabuBadge>
      <span className="text-xs text-quaternary">{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push-to-talk dock (rendered in the side rail on landscape, footer on portrait)
// ---------------------------------------------------------------------------

function MicDock({
  className,
  tint,
  listening,
  speechSupported,
  typed,
  onTypedChange,
  onTypedSubmit,
  onMicToggle,
}: {
  className?: string;
  tint: AssistantProfile["tint"];
  listening: boolean;
  speechSupported: boolean;
  typed: string;
  onTypedChange: (value: string) => void;
  onTypedSubmit: () => void;
  onMicToggle: () => void;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center gap-3", className)}>
      <div className="relative">
        {listening && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping",
              tintBar[tint],
            )}
          />
        )}
        <button
          type="button"
          onClick={onMicToggle}
          aria-pressed={listening}
          aria-label={listening ? "Stop listening" : "Tap to talk"}
          className={cn(
            "relative grid h-20 w-20 place-items-center rounded-full text-3xl text-white shadow-md transition-transform active:scale-95",
            listening ? "bg-red-500 hover:bg-red-600 focus-visible:outline-red-600" : tintSolid[tint],
            focusRing,
          )}
        >
          {listening ? "◼" : "🎤"}
        </button>
      </div>
      <p className="text-sm font-medium text-secondary">
        {listening
          ? "Listening — tap to finish"
          : speechSupported
            ? "Tap to talk"
            : "Talking needs the microphone — tap an idea or type"}
      </p>
      <form
        className="flex w-full max-w-sm items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onTypedSubmit();
        }}
      >
        <input
          type="text"
          value={typed}
          onChange={(event) => onTypedChange(event.target.value)}
          aria-label="Type to your companion instead of talking"
          placeholder="…or type it here"
          className={cn(
            "h-12 min-w-0 flex-1 rounded-full border border-primary bg-primary px-4 text-base text-primary placeholder:text-quaternary",
            focusRing,
          )}
        />
        <button
          type="submit"
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-full border border-primary bg-primary text-lg text-secondary transition-colors hover:bg-secondary",
            focusRing,
          )}
          aria-label="Send typed message"
        >
          ↑
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile chooser
// ---------------------------------------------------------------------------

function ProfileChooser({
  trackerOnly,
  onPick,
}: {
  trackerOnly: boolean;
  onPick: (id: AssistantChildId) => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-secondary text-primary">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-secondary bg-primary/80 px-5 py-3 backdrop-blur-xl sm:px-8">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-quaternary">
            Family assistant · prototype
          </p>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">
            Who&rsquo;s listening today?
          </h1>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href="/family/dashboard"
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
              focusRing,
            )}
          >
            Family board
          </Link>
          {!trackerOnly && (
            <Link
              href="/"
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
                focusRing,
              )}
            >
              Nabu
            </Link>
          )}
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-3xl flex-1 content-center gap-5 px-5 py-8 sm:grid-cols-2 sm:px-8">
        {assistantProfiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => onPick(profile.id)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-4 rounded-3xl border-2 p-7 text-center transition-all hover:-translate-y-1 hover:shadow-lg",
              tintBorder[profile.tint],
              tintSoftBg[profile.tint],
              focusRing,
            )}
          >
            <AssistantAvatar
              state="ready"
              tint={profile.tint}
              crest={profile.crest}
              label={`${profile.companionName}, ${profile.displayName}'s companion`}
              className="h-40 w-40"
            />
            <span className="text-2xl font-semibold text-primary">
              {profile.displayName}
            </span>
            <span className={cn("text-sm font-medium", tintText[profile.tint])}>
              {profile.companionName} is ready for you
            </span>
          </button>
        ))}
      </main>

      <footer className="shrink-0 px-5 pb-6 text-center text-xs text-quaternary">
        Interaction prototype — nothing here plays on the speakers, remembers, or
        messages anyone for real yet.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversational workspace
// ---------------------------------------------------------------------------

function Workspace({
  profile,
  weekId,
  trackerOnly,
  onSwitchProfile,
}: {
  profile: AssistantProfile;
  weekId: string;
  trackerOnly: boolean;
  onSwitchProfile: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const [spokenLine, setSpokenLine] = useState<string>(profile.greeting);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [typed, setTyped] = useState("");
  const [points, setPoints] = useState<PointsSnapshot | null>(null);
  const [demoPaused, setDemoPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const timersRef = useRef<number[]>([]);
  const aliveRef = useRef(true);
  const speakSeqRef = useRef(0);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const listeningRef = useRef(false);
  const soundOnRef = useRef(true);

  const speechSupported = useMemo(() => speechRecognitionCtor() !== null, []);
  const tint = profile.tint;

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    listeningRef.current = false;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* already stopped */
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    speakSeqRef.current += 1;
    setIsSpeaking(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* not available */
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimers();
      stopRecognition();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* not available */
        }
      }
    };
  }, [clearTimers, stopRecognition]);

  const speak = useCallback(
    (text: string) => {
      setSpokenLine(text);
      setIsSpeaking(true);
      speakSeqRef.current += 1;
      const seq = speakSeqRef.current;
      const finish = () => {
        if (speakSeqRef.current === seq) setIsSpeaking(false);
      };
      if (
        soundOnRef.current &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = tint === "emerald" ? 1.15 : 1;
          utterance.onend = () => {
            if (aliveRef.current) finish();
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          /* browser TTS unavailable — timer below still ends the state */
        }
      }
      later(finish, Math.max(2400, text.length * 60));
    },
    [later, tint],
  );

  const present = useCallback(
    (view: ShowingView, spoken: string) => {
      setStage({ kind: "showing", view });
      speak(spoken);
    },
    [speak],
  );

  const think = useCallback((goal: string, transcript?: string) => {
    setStage({ kind: "thinking", goal, transcript });
  }, []);

  const recover = useCallback(
    (message: string) => {
      cancelSpeech();
      setStage({ kind: "recovering", message });
    },
    [cancelSpeech],
  );

  const backToReady = useCallback(() => {
    clearTimers();
    cancelSpeech();
    setSpokenLine(profile.greeting);
    setStage({ kind: "ready" });
  }, [cancelSpeech, clearTimers, profile.greeting]);

  // ------------------------------------------------------------------
  // Points scenario — reads the real family APIs, falls back to a
  // clearly-labeled demo snapshot when they are unreachable.
  // ------------------------------------------------------------------

  const loadPoints = useCallback(async () => {
    const wait = new Promise((resolve) => window.setTimeout(resolve, 900));
    let snapshot: PointsSnapshot;
    try {
      const [compRes, redRes, cfgRes] = await Promise.all([
        fetch(`/api/family/completions?week=${weekId}`),
        fetch(`/api/family/redemptions?week=${weekId}`),
        fetch("/api/family/config"),
      ]);
      if (!compRes.ok || !redRes.ok || !cfgRes.ok) throw new Error("family API error");
      const completions = (await compRes.json()) as CompletionRecord[];
      const redemptions = (await redRes.json()) as RewardRedemption[];
      const config = (await cfgRes.json()) as FamilyBoardConfig;
      const resolvedRoutines = resolveRoutinesClient(config);
      const resolvedRewards = resolveRewardsClient(config);
      const earned = weekPoints(profile.id, completions, resolvedRoutines);
      const spent = redemptions
        .filter((r) => r.personId === profile.id)
        .reduce((sum, r) => {
          const reward = resolvedRewards.find((x) => x.id === r.rewardId);
          return sum + (reward?.costPoints ?? 0);
        }, 0);
      const balance = earned - spent;
      const next = nextRewardForPerson(profile.id, balance, resolvedRewards);
      snapshot = {
        live: true,
        earned,
        balance,
        next: next
          ? {
              title: next.reward.title,
              icon: next.reward.icon,
              target: next.reward.targetPoints,
              missing: next.missing,
            }
          : null,
      };
    } catch {
      const demoBalance = 3;
      const next = nextRewardForPerson(profile.id, demoBalance);
      snapshot = {
        live: false,
        earned: 6,
        balance: demoBalance,
        next: next
          ? {
              title: next.reward.title,
              icon: next.reward.icon,
              target: next.reward.targetPoints,
              missing: next.missing,
            }
          : null,
      };
    }
    await wait;
    if (!aliveRef.current) return;
    setPoints(snapshot);
    const coinWord = snapshot.balance === 1 ? "coin" : "coins";
    const intro = snapshot.live
      ? `You have ${snapshot.balance} ${coinWord} to spend, ${profile.displayName}.`
      : `I couldn't reach your board, so here is a demo view.`;
    const nextPart = snapshot.next
      ? snapshot.next.missing === 0
        ? ` ${snapshot.next.title} is ready — redeem it on your board!`
        : ` Only ${snapshot.next.missing} more for ${snapshot.next.title}.`
      : "";
    present({ kind: "points" }, `${intro}${nextPart}`);
  }, [present, profile.displayName, profile.id, weekId]);

  // ------------------------------------------------------------------
  // Intent routing
  // ------------------------------------------------------------------

  const runIntent = useCallback(
    (intent: AssistantIntent, transcript?: string) => {
      switch (intent) {
        case "resume-series":
          think("Finding your Ninjago spot…", transcript);
          later(
            () =>
              present(
                { kind: "resume" },
                `You finished episode ${ninjagoResume.lastEpisode}, ${ninjagoResume.lastTitle}. Episode ${ninjagoResume.nextEpisode} is ready — want to hear it?`,
              ),
            1100,
          );
          break;
        case "fuzzy-music":
          think("Looking for dragon songs…", transcript);
          later(
            () =>
              present(
                { kind: "music-choices" },
                "I found three dragon songs. Tap the one you meant.",
              ),
            1000,
          );
          break;
        case "podcast":
          think("Hunting for great podcasts…", transcript);
          later(
            () =>
              present(
                { kind: "podcasts" },
                "I found three you might like. Tap one to try it.",
              ),
            1100,
          );
          break;
        case "points":
          think("Checking your family board…", transcript);
          void loadPoints();
          break;
        case "parent-suggestion":
          think("Getting Mum and Dad's idea…", transcript);
          later(
            () =>
              present(
                { kind: "parent-suggestion" },
                "Mum and Dad left this idea for you. You can always say no.",
              ),
            800,
          );
          break;
      }
    },
    [later, loadPoints, present, think],
  );

  const confirmOptionsForUnknown = useCallback((): ConfirmOption[] => {
    return [
      ...starterPhrases.map(
        (s): ConfirmOption => ({
          kind: "intent",
          intent: s.intent,
          label: s.phrase,
          icon: s.icon,
        }),
      ),
      { kind: "retry", label: "Say it again" },
      { kind: "dismiss", label: "Never mind" },
    ];
  }, []);

  const processUtterance = useCallback(
    (text: string) => {
      clearTimers();
      cancelSpeech();
      const trimmed = text.trim();
      if (!trimmed) {
        recover("I couldn't hear anything that time. Try again a bit closer, or tap an idea below.");
        return;
      }
      const intent = detectIntent(trimmed);
      if (!intent) {
        setStage({
          kind: "confirming",
          transcript: trimmed,
          uncertain: trimmed,
          prompt: "I'm not sure I got that right. Did you mean one of these?",
          options: confirmOptionsForUnknown(),
        });
        return;
      }
      if (intent === "fuzzy-music") {
        setStage({
          kind: "confirming",
          transcript: trimmed,
          uncertain: findUncertainWord(trimmed),
          prompt: "A song with a dragon — I know a few of those. Want to see them?",
          options: [
            { kind: "music-choices", label: "Show me the dragon songs", icon: "🐉" },
            { kind: "retry", label: "Say it again" },
            { kind: "dismiss", label: "Never mind" },
          ],
        });
        return;
      }
      runIntent(intent, trimmed);
    },
    [cancelSpeech, clearTimers, confirmOptionsForUnknown, recover, runIntent],
  );

  // ------------------------------------------------------------------
  // Voice input
  // ------------------------------------------------------------------

  const startListening = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      recover(
        "My ears don't work in this browser without microphone access. Tap an idea below or type instead — everything still works.",
      );
      return;
    }
    clearTimers();
    cancelSpeech();
    stopRecognition();
    finalTranscriptRef.current = "";
    setStage({ kind: "listening", transcript: "", simulated: false });
    try {
      const recognition = new Ctor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        let interim = "";
        let finalText = finalTranscriptRef.current;
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            finalText = `${finalText} ${text}`.trim();
          } else {
            interim = `${interim} ${text}`.trim();
          }
        }
        finalTranscriptRef.current = finalText;
        if (aliveRef.current && listeningRef.current) {
          setStage({
            kind: "listening",
            transcript: `${finalText} ${interim}`.trim(),
            simulated: false,
          });
        }
      };
      recognition.onerror = () => {
        recognitionRef.current = null;
        if (!listeningRef.current) return;
        listeningRef.current = false;
        if (aliveRef.current) {
          recover(
            "I couldn't listen just now — the microphone said no. Tap an idea below or type instead.",
          );
        }
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (!listeningRef.current) return;
        listeningRef.current = false;
        if (!aliveRef.current) return;
        const heard = finalTranscriptRef.current.trim();
        if (heard) {
          processUtterance(heard);
        } else {
          recover(
            "I couldn't hear anything that time. Try again a bit closer, or tap an idea below.",
          );
        }
      };
      recognitionRef.current = recognition;
      listeningRef.current = true;
      recognition.start();
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      recover("Something went wrong with the microphone. Tap an idea below or type instead.");
    }
  }, [cancelSpeech, clearTimers, processUtterance, recover, stopRecognition]);

  const finishListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop(); // onend fires and processes what was heard
        return;
      } catch {
        /* fall through to abort path */
      }
    }
    stopRecognition();
    backToReady();
  }, [backToReady, stopRecognition]);

  const isLiveListening = stage.kind === "listening" && !stage.simulated;

  const onMicToggle = useCallback(() => {
    if (isLiveListening) {
      finishListening();
    } else {
      startListening();
    }
  }, [finishListening, isLiveListening, startListening]);

  // ------------------------------------------------------------------
  // Simulated voice turn for the starter chips (works without any mic)
  // ------------------------------------------------------------------

  const simulatePhrase = useCallback(
    (phrase: string) => {
      clearTimers();
      cancelSpeech();
      stopRecognition();
      if (reducedMotion) {
        setStage({ kind: "listening", transcript: phrase, simulated: true });
        later(() => processUtterance(phrase), 550);
        return;
      }
      setStage({ kind: "listening", transcript: "", simulated: true });
      let shown = 0;
      const step = () => {
        shown += 1;
        setStage({ kind: "listening", transcript: phrase.slice(0, shown), simulated: true });
        if (shown < phrase.length) {
          later(step, 36);
        } else {
          later(() => processUtterance(phrase), 500);
        }
      };
      later(step, 260);
    },
    [cancelSpeech, clearTimers, later, processUtterance, reducedMotion, stopRecognition],
  );

  const onTypedSubmit = useCallback(() => {
    const value = typed.trim();
    if (!value) return;
    setTyped("");
    stopRecognition();
    processUtterance(value);
  }, [processUtterance, stopRecognition, typed]);

  const onConfirmOption = useCallback(
    (option: ConfirmOption) => {
      switch (option.kind) {
        case "intent":
          if (option.intent === "fuzzy-music") {
            runIntent("fuzzy-music");
          } else {
            runIntent(option.intent);
          }
          break;
        case "music-choices":
          runIntent("fuzzy-music");
          break;
        case "retry":
          if (speechSupported) {
            startListening();
          } else {
            recover("Talking needs the microphone here — tap an idea below or type instead.");
          }
          break;
        case "dismiss":
          backToReady();
          break;
      }
    },
    [backToReady, recover, runIntent, speechSupported, startListening],
  );

  const playDemo = useCallback(
    (item: MediaCard, from: NowPlayingSource) => {
      setDemoPaused(false);
      present({ kind: "now-playing", item, from }, `Starting ${item.title}!`);
    },
    [present],
  );

  const reopenSource = useCallback(
    (from: NowPlayingSource) => {
      cancelSpeech();
      switch (from) {
        case "resume":
          setStage({ kind: "showing", view: { kind: "resume" } });
          break;
        case "music":
          setStage({ kind: "showing", view: { kind: "music-choices" } });
          break;
        case "podcast":
          setStage({ kind: "showing", view: { kind: "podcasts" } });
          break;
        case "parent":
          setStage({ kind: "showing", view: { kind: "parent-suggestion" } });
          break;
      }
    },
    [cancelSpeech],
  );

  // ------------------------------------------------------------------
  // Derived presentation
  // ------------------------------------------------------------------

  const avatarState = avatarStateFor(stage, isSpeaking);

  const announcement = useMemo(() => {
    switch (stage.kind) {
      case "ready":
        return `${profile.companionName} is ready. ${profile.greeting}`;
      case "listening":
        return stage.transcript ? `Heard so far: ${stage.transcript}` : "Listening";
      case "confirming":
        return `I heard: ${stage.transcript}. ${stage.prompt}`;
      case "thinking":
        return stage.goal;
      case "showing":
        return spokenLine;
      case "recovering":
        return stage.message;
    }
  }, [profile.companionName, profile.greeting, spokenLine, stage]);

  const boardHref = `/family/dashboard/${profile.id}?week=${weekId}`;

  // ------------------------------------------------------------------
  // Stage content
  // ------------------------------------------------------------------

  let stageContent: React.ReactNode = null;

  if (stage.kind === "ready") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-6">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-primary">
            {profile.greeting}
          </h2>
          <p className="mt-1 text-base text-tertiary">{profile.greetingHint}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {starterPhrases.map((s) => (
            <button
              key={s.intent}
              type="button"
              onClick={() => simulatePhrase(s.phrase)}
              className={cn(
                "flex min-h-16 items-center gap-3 rounded-2xl border border-primary bg-primary px-4 py-3 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
                focusRing,
              )}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-2xl">
                {s.icon}
              </span>
              <span className="min-w-0 text-base font-medium text-primary">
                &ldquo;{s.phrase}&rdquo;
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => runIntent("parent-suggestion")}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-violet-800 dark:bg-violet-950/30",
            focusRing,
          )}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/70 text-2xl dark:bg-white/10">
            💌
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
              {parentSuggestion.label}
            </span>
            <span className="block truncate text-base font-medium text-primary">
              There&rsquo;s an idea waiting for you
            </span>
          </span>
        </button>
      </div>
    );
  } else if (stage.kind === "listening") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <p className={cn("text-sm font-semibold uppercase tracking-[0.14em]", tintText[tint])}>
          {stage.simulated ? "Pretend voice demo" : "Listening…"}
        </p>
        <p className="min-h-24 text-3xl font-medium leading-snug text-primary">
          {stage.transcript ? (
            <>&ldquo;{stage.transcript}&rdquo;</>
          ) : (
            <span className="text-quaternary">Say what you&rsquo;d like…</span>
          )}
        </p>
        {!stage.simulated && (
          <div>
            <BigOptionButton
              label="Stop and think about it"
              icon="◼"
              tint={tint}
              onClick={finishListening}
            />
          </div>
        )}
      </div>
    );
  } else if (stage.kind === "confirming") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            I heard
          </p>
          <p className="mt-2 text-2xl font-medium leading-snug text-primary">
            <TranscriptText text={stage.transcript} uncertain={stage.uncertain} />
          </p>
        </div>
        <p className="text-lg text-secondary">{stage.prompt}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {stage.options.map((option, index) => (
            <BigOptionButton
              key={`${option.kind}-${index}`}
              label={option.label}
              icon={"icon" in option ? option.icon : option.kind === "retry" ? "🎤" : undefined}
              primary={index === 0}
              tint={tint}
              onClick={() => onConfirmOption(option)}
            />
          ))}
        </div>
      </div>
    );
  } else if (stage.kind === "thinking") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-4">
        {stage.transcript ? (
          <p className="text-sm text-quaternary">
            You said: <TranscriptText text={stage.transcript} />
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-2.5 w-2.5 rounded-full motion-safe:animate-bounce",
                  tintBar[tint],
                )}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <p className="text-2xl font-medium text-primary">{stage.goal}</p>
        </div>
      </div>
    );
  } else if (stage.kind === "recovering") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <p className="text-2xl font-medium leading-snug text-primary">{stage.message}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {speechSupported && (
            <BigOptionButton
              label="Try talking again"
              icon="🎤"
              primary
              tint={tint}
              onClick={startListening}
            />
          )}
          {starterPhrases.map((s) => (
            <BigOptionButton
              key={s.intent}
              label={s.phrase}
              icon={s.icon}
              tint={tint}
              onClick={() => runIntent(s.intent)}
            />
          ))}
          <BigOptionButton label="Never mind" tint={tint} onClick={backToReady} />
        </div>
      </div>
    );
  } else if (stage.kind === "showing") {
    const view = stage.view;
    let body: React.ReactNode = null;

    if (view.kind === "resume") {
      body = (
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            Continue listening · {ninjagoResume.series}
          </p>
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-secondary bg-secondary px-4 py-3">
            <span className="text-2xl" aria-hidden="true">
              ✅
            </span>
            <p className="min-w-0 text-base text-secondary">
              Episode {ninjagoResume.lastEpisode} — {ninjagoResume.lastTitle}
              <span className="ml-2 text-sm text-quaternary">finished</span>
            </p>
          </div>
          <div
            className={cn(
              "rounded-2xl border-2 p-5",
              tintBorder[tint],
              tintSoftBg[tint],
            )}
          >
            <p className={cn("text-sm font-semibold", tintText[tint])}>Up next</p>
            <p className="mt-1 text-2xl font-semibold text-primary">
              Episode {ninjagoResume.nextEpisode} — {ninjagoResume.nextTitle}
            </p>
            <p className="mt-1 text-sm text-tertiary">{ninjagoResume.nextDuration}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <BigOptionButton
                label={`Play episode ${ninjagoResume.nextEpisode}`}
                icon="▶"
                primary
                tint={tint}
                onClick={() =>
                  playDemo(
                    {
                      id: "ninjago-next",
                      title: `Episode ${ninjagoResume.nextEpisode} — ${ninjagoResume.nextTitle}`,
                      subtitle: ninjagoResume.series,
                      icon: "🥷",
                      meta: ninjagoResume.nextDuration,
                    },
                    "resume",
                  )
                }
              />
              <BigOptionButton
                label={`Hear ${ninjagoResume.lastEpisode} again`}
                icon="↻"
                tint={tint}
                onClick={() =>
                  playDemo(
                    {
                      id: "ninjago-last",
                      title: `Episode ${ninjagoResume.lastEpisode} — ${ninjagoResume.lastTitle}`,
                      subtitle: ninjagoResume.series,
                      icon: "🥷",
                      meta: "Listened before",
                    },
                    "resume",
                  )
                }
              />
            </div>
          </div>
        </div>
      );
    } else if (view.kind === "music-choices") {
      body = (
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            Dragon songs — tap the one you meant
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {dragonSongChoices.map((card) => (
              <ChoiceCard
                key={card.id}
                card={card}
                actionLabel="Play"
                onSelect={() => playDemo(card, "music")}
              />
            ))}
          </div>
          <BigOptionButton
            label="None of these — let me say it again"
            icon="🎤"
            tint={tint}
            onClick={() => onConfirmOption({ kind: "retry", label: "retry" })}
          />
        </div>
      );
    } else if (view.kind === "podcasts") {
      body = (
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            Podcasts picked for you
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {podcastChoices.map((card) => (
              <ChoiceCard
                key={card.id}
                card={card}
                actionLabel="Try it"
                onSelect={() => playDemo(card, "podcast")}
              />
            ))}
          </div>
        </div>
      );
    } else if (view.kind === "points") {
      const snapshot = points;
      body = (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {snapshot?.live ? (
              <NabuBadge tone="green">Live from your family board</NabuBadge>
            ) : (
              <NabuBadge tone="amber">Demo data — board not reachable</NabuBadge>
            )}
            <span className="text-xs text-quaternary">Week {weekId}</span>
          </div>
          {snapshot ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-primary bg-primary p-5">
                  <p className="text-sm text-tertiary">Earned this week</p>
                  <p className="mt-1 text-4xl font-semibold text-primary">
                    🪙 {snapshot.earned}
                  </p>
                </div>
                <div className="rounded-2xl border border-primary bg-primary p-5">
                  <p className="text-sm text-tertiary">Ready to spend</p>
                  <p className="mt-1 text-4xl font-semibold text-primary">
                    🪙 {snapshot.balance}
                  </p>
                </div>
              </div>
              {snapshot.next && (
                <div
                  className={cn(
                    "rounded-2xl border-2 p-5",
                    tintBorder[tint],
                    tintSoftBg[tint],
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 text-lg font-semibold text-primary">
                      {snapshot.next.icon} {snapshot.next.title}
                    </p>
                    <p className={cn("shrink-0 text-sm font-semibold", tintText[tint])}>
                      {snapshot.next.missing === 0
                        ? "Ready!"
                        : `${snapshot.next.missing} more to go`}
                    </p>
                  </div>
                  <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                    <div
                      className={cn("h-full rounded-full", tintBar[tint])}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (Math.max(0, snapshot.balance) / snapshot.next.target) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <Link
                href={boardHref}
                className={cn(
                  "inline-flex min-h-12 items-center gap-2 rounded-full border border-primary bg-primary px-5 text-base font-semibold text-primary transition-colors hover:bg-secondary",
                  focusRing,
                )}
              >
                Open my board →
              </Link>
            </>
          ) : (
            <p className="text-base text-tertiary">Loading your board…</p>
          )}
        </div>
      );
    } else if (view.kind === "parent-suggestion") {
      body = (
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 p-5 dark:border-violet-800 dark:bg-violet-950/30">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
              💌 {parentSuggestion.label}
            </p>
            <p className="mt-2 text-base text-secondary">{parentSuggestion.reason}</p>
            <div className="mt-4 flex min-w-0 items-start gap-3 rounded-xl border border-primary bg-primary p-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-3xl">
                {parentSuggestion.item.icon}
              </span>
              <div className="min-w-0">
                <p className="text-lg font-semibold text-primary">
                  {parentSuggestion.item.title}
                </p>
                <p className="text-sm text-tertiary">{parentSuggestion.item.subtitle}</p>
                <NabuBadge tone="stone" className="mt-2">
                  {parentSuggestion.item.meta}
                </NabuBadge>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <BigOptionButton
                label="Give it a try"
                icon="▶"
                primary
                tint={tint}
                onClick={() => playDemo(parentSuggestion.item, "parent")}
              />
              <BigOptionButton
                label="Keep Ninjago instead"
                icon="🥷"
                tint={tint}
                onClick={() => runIntent("resume-series")}
              />
            </div>
          </div>
        </div>
      );
    } else if (view.kind === "now-playing") {
      body = (
        <div className="space-y-4">
          <DemoBadgeRow text="Nothing is really playing on the speakers — this shows what would happen." />
          <div
            className={cn(
              "rounded-2xl border-2 p-6",
              tintBorder[tint],
              tintSoftBg[tint],
            )}
          >
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-white/80 text-5xl dark:bg-white/10">
                {view.item.icon}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold", tintText[tint])}>
                  {demoPaused ? "Paused (demo)" : "Now playing (demo)"}
                </p>
                <p className="mt-0.5 text-2xl font-semibold leading-snug text-primary">
                  {view.item.title}
                </p>
                <p className="text-sm text-tertiary">
                  {view.item.subtitle} · {view.item.meta}
                </p>
              </div>
            </div>
            <div className="mt-5 flex h-8 items-end gap-1" aria-hidden="true">
              {[14, 26, 18, 30, 22, 12, 28, 20, 16, 24].map((h, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-2 rounded-full",
                    tintBar[tint],
                    !demoPaused && "motion-safe:animate-pulse",
                  )}
                  style={{ height: `${h}px`, animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <BigOptionButton
                label={demoPaused ? "Resume" : "Pause"}
                icon={demoPaused ? "▶" : "⏸"}
                primary
                tint={tint}
                onClick={() => setDemoPaused((p) => !p)}
              />
              <BigOptionButton
                label="Back to choices"
                icon="↩"
                tint={tint}
                onClick={() => reopenSource(view.from)}
              />
            </div>
          </div>
        </div>
      );
    }

    stageContent = (
      <div className="flex min-h-full flex-col gap-5">
        <div className="flex-1">{body}</div>
        <div>
          <button
            type="button"
            onClick={backToReady}
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-full border border-primary bg-primary px-5 text-base font-medium text-secondary transition-colors hover:bg-secondary",
              focusRing,
            )}
          >
            ✨ Ask something else
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-secondary text-primary">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-secondary bg-primary/80 px-4 py-2.5 backdrop-blur-xl sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <AssistantAvatar
            state="ready"
            tint={tint}
            crest={profile.crest}
            label=""
            className="h-9 w-9"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-primary">
              {profile.companionName}
              <span className="ml-2 font-normal text-quaternary">
                with {profile.displayName}
              </span>
            </p>
            <p className="text-[11px] uppercase tracking-[0.12em] text-quaternary">
              Prototype · no real playback
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (soundOn) cancelSpeech();
              setSoundOn((s) => !s);
            }}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Turn voice sound off" : "Turn voice sound on"}
            className={cn(
              "grid h-11 w-11 place-items-center rounded-full border border-primary bg-primary text-lg transition-colors hover:bg-secondary",
              focusRing,
            )}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <Link
            href={boardHref}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
              focusRing,
            )}
          >
            My board
          </Link>
          <button
            type="button"
            onClick={onSwitchProfile}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
              focusRing,
            )}
          >
            Switch
          </button>
          {!trackerOnly && (
            <Link
              href="/"
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-secondary",
                focusRing,
              )}
            >
              Nabu
            </Link>
          )}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Companion rail */}
        <section
          aria-label={`${profile.companionName}, your companion`}
          className="flex shrink-0 flex-col items-center gap-2 px-4 pb-1 pt-4 lg:w-[340px] lg:justify-center lg:gap-5 lg:border-r lg:border-secondary lg:px-6 lg:py-8"
        >
          <AssistantAvatar
            state={avatarState}
            tint={tint}
            crest={profile.crest}
            label={`${profile.companionName} is ${avatarStateLabel(avatarState)}`}
            className="h-32 w-32 lg:h-52 lg:w-52"
          />
          <p className="text-sm font-medium text-tertiary">
            {profile.companionName} · {avatarStateLabel(avatarState)}
          </p>
          {(stage.kind === "showing" || isSpeaking) && spokenLine ? (
            <div className="max-w-xs rounded-2xl border border-primary bg-primary px-4 py-3 text-center text-sm leading-relaxed text-secondary">
              {spokenLine}
            </div>
          ) : null}
          <MicDock
            className="hidden lg:flex"
            tint={tint}
            listening={isLiveListening}
            speechSupported={speechSupported}
            typed={typed}
            onTypedChange={setTyped}
            onTypedSubmit={onTypedSubmit}
            onMicToggle={onMicToggle}
          />
        </section>

        {/* Stage */}
        <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:py-6">
            {stageContent}
          </div>
          <div className="shrink-0 border-t border-secondary bg-primary/60 px-4 py-3 lg:hidden">
            <MicDock
              tint={tint}
              listening={isLiveListening}
              speechSupported={speechSupported}
              typed={typed}
              onTypedChange={setTyped}
              onTypedSubmit={onTypedSubmit}
              onMicToggle={onMicToggle}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry — profile chooser, then the workspace for the picked child
// ---------------------------------------------------------------------------

export function FamilyAssistantClient({
  weekId,
  initialChild,
  trackerOnly,
}: {
  weekId: string;
  initialChild: AssistantChildId | null;
  trackerOnly: boolean;
}) {
  const [childId, setChildId] = useState<AssistantChildId | null>(initialChild);
  const profile = assistantProfileById(childId);

  const pickProfile = useCallback((id: AssistantChildId) => {
    setChildId(id);
    try {
      window.history.replaceState(null, "", `/family/assistant?child=${id}`);
    } catch {
      /* history not writable — selection still works */
    }
  }, []);

  const switchProfile = useCallback(() => {
    setChildId(null);
    try {
      window.history.replaceState(null, "", "/family/assistant");
    } catch {
      /* ignore */
    }
  }, []);

  if (!profile) {
    return <ProfileChooser trackerOnly={trackerOnly} onPick={pickProfile} />;
  }

  return (
    <Workspace
      key={profile.id}
      profile={profile}
      weekId={weekId}
      trackerOnly={trackerOnly}
      onSwitchProfile={switchProfile}
    />
  );
}
