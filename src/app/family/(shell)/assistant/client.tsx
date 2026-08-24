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
  assistantProfileById,
  avatarStyleById,
  avatarStyles,
  dragonSongChoices,
  podcastChoices,
  ninjagoResume,
  parentSuggestion,
  starterPhrases,
  type AssistantIntent,
  type AssistantProfile,
  type AvatarStyleId,
  type MediaCard,
} from "@/data/family-assistant";
import {
  createChildTurnClient,
  type ChildTurnClient,
} from "@/lib/family-assistant-client";
import {
  MAX_CHILD_TURN_CHARS,
  childFacingRecovery,
  envelopeSpokenText,
  isRetryable,
  type AssistantBlock,
} from "@/lib/family-assistant-turn";
import {
  checkChildUtterance,
  startPushToTalk,
  voiceCaptureSupported,
  type PushToTalkSession,
  type RecorderControl,
  type RecorderHandlers,
} from "@/lib/family-voice";
import {
  createChildSpeechPlayer,
  type ChildSpeechPlayer,
} from "@/lib/family-speech";
import {
  PRIMARY_INPUT_HEIGHT_CLASS,
  SEND_BUTTON_SIZE_CLASS,
  TALK_BUTTON_SIZE_CLASS,
} from "@/lib/family-assistant-layout";
import { childShellDestinationHref } from "@/lib/family-child-shell";
import { useChildShell } from "@/components/family/child-shell-provider";
import { AssistantAvatar, type AvatarState } from "./avatar";

// ---------------------------------------------------------------------------
// Voice input/output
//
// Speech-to-text: push-to-talk records real audio with MediaRecorder and posts
// it to the authenticated `/api/family/transcribe` (ElevenLabs Scribe v2). The
// returned transcript is the source of truth — browser SpeechRecognition is
// not used on this surface any more. The recording is transient: an in-memory
// blob that exists only between "tap to finish" and the transcription reply.
//
// Text-to-speech: replies are spoken through the authenticated
// `/api/family/assistant/tts` (ElevenLabs, per-child voice) via
// `createChildSpeechPlayer`, falling back to browser `speechSynthesis` when the
// request or playback fails. The visible reply never depends on audio.
// ---------------------------------------------------------------------------

/** Transcription endpoint (shared with the person board's voice memos). */
const TRANSCRIBE_PATH = "/api/family/transcribe";

/**
 * Wraps a real `MediaRecorder` in the small control surface
 * `startPushToTalk` drives.
 *
 * The lifecycle itself lives in `lib/family-voice.ts` so `node --test` can run
 * it; this is the only place DOM event types touch it.
 */
function adaptMediaRecorder(
  recorder: MediaRecorder,
  handlers: RecorderHandlers,
): RecorderControl {
  recorder.ondataavailable = (event) => handlers.onData(event.data);
  recorder.onstop = () => handlers.onStop();
  recorder.onerror = () => handlers.onError();
  return {
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    mimeType: () => recorder.mimeType || null,
    detach: () => {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    },
  };
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

/**
 * The conversation is **free-form end to end**.
 *
 * Nothing in this component classifies what a child said. Every utterance —
 * typed, spoken, or produced by tapping a starter chip — is sent verbatim to
 * that child's own OpenClaw agent through the tailnet bridge, and the reply is
 * whatever the agent actually answered.
 *
 * The five prototype scenarios that used to *be* the assistant are now two
 * separate, clearly-labelled things:
 *
 *  - the four starter phrases are **starter prompts**: buttons that send real
 *    text, exactly as if the child had typed it;
 *  - the scripted card flows are **UI regression fixtures**, reachable only
 *    from the explicit "Prototype demos" panel and marked as demos there.
 *
 * There is no code path in which the wording of an utterance selects a view.
 * That is what closes the Goku/Dragon Ball regression: "edit my avatar so it
 * looks like Goku from Dragon Ball" is a question for the agent, not a phrase
 * for a matcher.
 */
type ConfirmOption =
  | { kind: "ask"; label: string; icon: string }
  | { kind: "retry"; label: string }
  | { kind: "dismiss"; label: string };

type NowPlayingSource = "resume" | "music" | "podcast" | "parent";

type DemoView =
  | { kind: "resume" }
  | { kind: "music-choices" }
  | { kind: "podcasts" }
  | { kind: "points" }
  | { kind: "parent-suggestion" }
  | { kind: "avatar-styles" }
  | { kind: "now-playing"; item: MediaCard; from: NowPlayingSource };

type ShowingView =
  /** The real thing: what the child's agent answered. */
  | { kind: "assistant-reply"; question: string; blocks: AssistantBlock[] }
  | DemoView;

/** Sub-phase of `thinking`, so the child sees the turn leave before it lands. */
type ThinkingPhase = "sending" | "thinking";

type Stage =
  | { kind: "ready" }
  /**
   * `live` is false while the microphone is still opening. Nothing on screen
   * may claim to be listening until it flips: `getUserMedia` takes a moment
   * (longer behind a permission prompt), and a child told "Listening…" too
   * early speaks into a recorder that does not exist yet.
   */
  | { kind: "listening"; transcript: string; simulated: boolean; live: boolean }
  /** Recording finished; the audio is at the transcription service. */
  | { kind: "transcribing" }
  | {
      kind: "confirming";
      transcript: string;
      uncertain?: string;
      prompt: string;
      options: ConfirmOption[];
    }
  | { kind: "thinking"; goal: string; phase: ThinkingPhase; transcript?: string }
  | { kind: "showing"; view: ShowingView }
  /** `retryQuestion` is set when re-sending the same words could still work. */
  | { kind: "recovering"; message: string; retryQuestion?: string };

type PointsSnapshot = {
  live: boolean;
  earned: number;
  balance: number;
  next: { title: string; icon: string; target: number; missing: number } | null;
};

/**
 * Options shown after a spoken turn, before it is sent.
 *
 * Voice is the one input where the child did not see their words before
 * committing them, and child speech recognition is the original failure this
 * product exists to fix. So a spoken turn gets one confirmation step: the
 * transcript comes back **editable** — the child can fix a word, send it,
 * re-record, or drop it. There is no uncertainty *highlight* any more — that
 * used to come from the keyword classifier, and nothing here inspects the
 * words.
 */
function voiceConfirmOptions(): ConfirmOption[] {
  return [
    { kind: "ask", label: "Yes, ask that", icon: "✨" },
    { kind: "retry", label: "Say it again" },
    { kind: "dismiss", label: "Never mind" },
  ];
}

/**
 * Surface name for the shared-iPad session, per child.
 *
 * Stable on purpose: the Gateway session key becomes `agent:<child>:ipad`, so
 * a child picking their profile again — tomorrow, or after a reload — lands in
 * the same conversation rather than a fresh one. It is sent to the mint route,
 * validated there, and baked into the token; the browser cannot widen it.
 */
const ASSISTANT_SESSION_SUFFIX = "ipad";

/**
 * Renders the agent's reply blocks.
 *
 * Unknown block types are skipped rather than rendered or thrown on: a Phase 3
 * bridge that starts sending Sonos cards must not break an iPad still running
 * this build (see `lib/family-assistant-turn.ts`).
 */
function AssistantReply({ blocks }: { blocks: AssistantBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "text") {
          return (
            <p
              key={index}
              // `whitespace-pre-wrap` renders the agent's own paragraphs and
              // lists as plain text. Nothing here interprets markup, so the
              // reply can never inject elements into this page.
              className="whitespace-pre-wrap text-xl leading-relaxed text-primary"
            >
              {block.text}
            </p>
          );
        }
        if (block.type === "card") {
          return (
            <div key={index} className="rounded-2xl border border-primary bg-primary p-4">
              {block.imageUrl ? (
                // Catalog artwork from the bridge, not a build-time asset, so
                // next/image's optimizer has nothing to do here. `alt` is empty
                // on purpose: the title below says the same thing, and a screen
                // reader should not hear it twice.
                <img
                  src={block.imageUrl}
                  alt=""
                  className="mb-3 aspect-square w-24 rounded-xl object-cover"
                />
              ) : null}
              <p className="text-base font-semibold text-primary">{block.title}</p>
              {block.subtitle ? <p className="text-sm text-tertiary">{block.subtitle}</p> : null}
              {block.meta ? (
                <NabuBadge tone="stone" className="mt-2">
                  {block.meta}
                </NabuBadge>
              ) : null}
            </div>
          );
        }
        if (block.type === "image") {
          return (
            // A plain <img>: the source is a bridge-supplied artifact, not a
            // build-time asset, so next/image's optimizer has nothing to do here.
            <img key={index} src={block.url} alt={block.alt} className="rounded-2xl" />
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * The prototype scenarios, kept as UI regression fixtures.
 *
 * Collapsed by default and explicitly labelled. Nothing a child says can open
 * it, and nothing inside it is reachable from the conversation path — that
 * separation is the point: the fixtures exercise layouts Phase 3 will fill
 * with real Sonos and family data, and they are never the assistant's meaning.
 */
function PrototypeDemoPanel({
  open,
  onToggle,
  onRun,
}: {
  open: boolean;
  onToggle: () => void;
  onRun: (intent: AssistantIntent) => void;
}) {
  const demos: { intent: AssistantIntent; label: string; icon: string }[] = [
    { intent: "resume-series", label: "Resume an audiobook", icon: "🥷" },
    { intent: "fuzzy-music", label: "Music choices", icon: "🎶" },
    { intent: "podcast", label: "Podcast choices", icon: "🎧" },
    { intent: "points", label: "Coins and rewards", icon: "🪙" },
    { intent: "parent-suggestion", label: parentSuggestion.label, icon: "💌" },
  ];
  return (
    <div className="rounded-2xl border border-dashed border-secondary p-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-2 text-left",
          focusRing,
        )}
      >
        <span className="flex items-center gap-2">
          <NabuBadge tone="amber">Prototype demos</NabuBadge>
          <span className="text-sm text-quaternary">Not the assistant — fixed example screens</span>
        </span>
        <span aria-hidden="true" className="text-tertiary">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {demos.map((demo) => (
            <button
              key={demo.intent}
              type="button"
              onClick={() => onRun(demo.intent)}
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-xl border border-primary bg-primary px-3 text-left text-sm font-medium text-secondary transition-colors hover:bg-secondary",
                focusRing,
              )}
            >
              <span aria-hidden="true">{demo.icon}</span>
              {demo.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function avatarStateFor(stage: Stage, isSpeaking: boolean): AvatarState {
  switch (stage.kind) {
    case "ready":
      return "ready";
    case "listening":
      // Still opening the microphone: the avatar is busy, not listening.
      return stage.live ? "listening" : "thinking";
    case "transcribing":
      return "thinking";
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
// Push-to-talk dock — the primary control surface.
//
// One component, two compositions. `variant="dock"` is the portrait footer: a
// full-width bar with the big talk button beside the typed input, sitting
// under the child's thumbs on a held iPad. `variant="rail"` is the landscape
// side rail: the same controls stacked under the avatar. The button itself is
// the whole visible circle (sizes from `family-assistant-layout.ts`), and it
// announces its state with an icon *and* a word, never color alone.
// ---------------------------------------------------------------------------

/**
 * Three states, not two: `starting` is the window where the microphone is
 * being opened. It looks and reads like Stop — tapping it does stop the turn —
 * but it never says "Listening", because nothing is being recorded yet.
 */
type MicState = "idle" | "starting" | "live";

function MicDock({
  className,
  variant,
  tint,
  micState,
  speechSupported,
  typed,
  onTypedChange,
  onTypedSubmit,
  onMicToggle,
}: {
  className?: string;
  variant: "dock" | "rail";
  tint: AssistantProfile["tint"];
  micState: MicState;
  speechSupported: boolean;
  typed: string;
  onTypedChange: (value: string) => void;
  onTypedSubmit: () => void;
  onMicToggle: () => void;
}) {
  const listening = micState !== "idle";
  const talkButton = (
    <div className="relative shrink-0">
      {micState === "live" && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping",
            tintBar[tint],
          )}
        />
      )}
      <button
        type="button"
        onClick={onMicToggle}
        aria-pressed={listening}
        aria-label={
          micState === "live"
            ? "Stop listening"
            : micState === "starting"
              ? "Stop — the microphone is still turning on"
              : "Tap to talk"
        }
        className={cn(
          "relative flex flex-col items-center justify-center gap-1 rounded-full text-white shadow-lg transition-transform active:scale-95",
          TALK_BUTTON_SIZE_CLASS,
          listening ? "bg-red-500 hover:bg-red-600 focus-visible:outline-red-600" : tintSolid[tint],
          focusRing,
        )}
      >
        <span aria-hidden="true" className="text-4xl leading-none">
          {listening ? "◼" : "🎤"}
        </span>
        <span className="text-lg font-semibold leading-none">
          {listening ? "Stop" : "Talk"}
        </span>
      </button>
    </div>
  );
  const caption =
    micState === "live"
      ? "Listening — tap Stop when you're done"
      : micState === "starting"
        ? "Turning the microphone on…"
        : speechSupported
          ? "Tap the big button and talk"
          : "Talking needs the microphone — tap an idea or type";
  const typedForm = (
    <form
      className="flex w-full items-center gap-2"
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
          "min-w-0 flex-1 rounded-full border border-primary bg-primary px-5 text-lg text-primary placeholder:text-quaternary",
          PRIMARY_INPUT_HEIGHT_CLASS,
          focusRing,
        )}
      />
      <button
        type="submit"
        className={cn(
          "grid shrink-0 place-items-center rounded-full border border-primary bg-primary text-xl text-secondary transition-colors hover:bg-secondary",
          SEND_BUTTON_SIZE_CLASS,
          focusRing,
        )}
        aria-label="Send typed message"
      >
        ↑
      </button>
    </form>
  );
  if (variant === "rail") {
    return (
      <div className={cn("w-full flex-col items-center gap-3", className)}>
        {talkButton}
        <p className="text-center text-sm font-medium text-secondary">{caption}</p>
        <div className="w-full max-w-sm">{typedForm}</div>
      </div>
    );
  }
  return (
    <div className={cn("mx-auto flex w-full max-w-3xl items-center gap-4 sm:gap-6", className)}>
      {talkButton}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium text-secondary">{caption}</p>
        {typedForm}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversational workspace
// ---------------------------------------------------------------------------

function Workspace({
  profile,
  weekId,
}: {
  profile: AssistantProfile;
  weekId: string;
}) {
  // Shell chrome (avatar, tabs, switcher) lives in the persistent `(shell)`
  // layout provider. Picking the other child there changes the Workspace
  // `key`, so the whole conversation subtree unmounts and its cleanup
  // discards any in-flight turn, recording and speech before the sibling's
  // workspace mounts.
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const [spokenLine, setSpokenLine] = useState<string>(profile.greeting);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [typed, setTyped] = useState("");
  const [points, setPoints] = useState<PointsSnapshot | null>(null);
  const [demoPaused, setDemoPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** Session-only dress-up; resets when the workspace unmounts. */
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyleId | null>(null);
  /** The scripted prototype flows, kept as explicit UI regression fixtures. */
  const [demosOpen, setDemosOpen] = useState(false);

  const timersRef = useRef<number[]>([]);
  const aliveRef = useRef(true);
  const speakSeqRef = useRef(0);
  const turnSeqRef = useRef(0);
  /** The in-progress push-to-talk session, if any. */
  const recordSessionRef = useRef<PushToTalkSession | null>(null);
  /** Bumped on every start/stop/cancel so a stale recording is discarded. */
  const recordSeqRef = useRef(0);
  const soundOnRef = useRef(true);
  /**
   * ElevenLabs playback, one controller per mounted profile. Created lazily so
   * server rendering never constructs an Audio element; `unlock()` is called
   * from tap handlers, which is what lets iPad Safari play the reply later.
   */
  const speechPlayerRef = useRef<ChildSpeechPlayer | null>(null);
  const speechPlayer = useCallback(() => {
    if (speechPlayerRef.current === null) speechPlayerRef.current = createChildSpeechPlayer();
    return speechPlayerRef.current;
  }, []);
  /** Aborts the in-flight turn when the child leaves, retries, or asks again. */
  const turnAbortRef = useRef<AbortController | null>(null);
  /**
   * One transport client per mounted profile.
   *
   * It caches the child-scoped bridge session, so switching profiles must
   * create a new one — which the `key={profile.id}` on `<Workspace>` already
   * guarantees, and `reset()` on unmount makes explicit.
   */
  const turnClientRef = useRef<ChildTurnClient | null>(null);
  if (turnClientRef.current === null) turnClientRef.current = createChildTurnClient();

  /**
   * Microphone availability, resolved after mount.
   *
   * Deliberately not a `useMemo`: the capability check reads `window` and
   * `navigator`, which differ between server rendering and Safari, so computing
   * it during render made the server and the first client render disagree about
   * the mic dock's caption and React discarded the tree on hydration. Starting
   * at `false` and setting it in an effect means both renders agree, and the
   * caption updates a tick later.
   */
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => {
    setSpeechSupported(voiceCaptureSupported(window));
  }, []);
  /**
   * The editable confirm-before-send control for a spoken turn. `confirmDraft`
   * starts as the ElevenLabs transcript and tracks the child's edits;
   * `confirmIssue` is the age-appropriate refusal for an empty/overlong draft.
   */
  const [confirmDraft, setConfirmDraft] = useState("");
  const [confirmIssue, setConfirmIssue] = useState<string | null>(null);
  const tint = profile.tint;
  const avatarLook = useMemo(() => {
    const style = avatarStyleById(avatarStyle);
    return style ? { id: style.id, colors: style.colors } : null;
  }, [avatarStyle]);

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
    // Every flow that clears pending transitions also invalidates any in-flight
    // turn, so a late reply can never replace the stage the child is now on.
    turnSeqRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  /**
   * Discards any recording in progress: cancels the session, which detaches the
   * recorder and releases the microphone even if permission is still pending.
   * Bumping the sequence first means a late outcome cannot post stale audio.
   */
  const discardRecording = useCallback(() => {
    recordSeqRef.current += 1;
    const session = recordSessionRef.current;
    recordSessionRef.current = null;
    session?.cancel();
  }, []);

  const cancelSpeech = useCallback(() => {
    speakSeqRef.current += 1;
    setIsSpeaking(false);
    speechPlayerRef.current?.cancel();
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
      discardRecording();
      speechPlayerRef.current?.cancel();
      // Drop the cached child-scoped token rather than leaving it in memory
      // for a profile that is no longer on screen.
      turnClientRef.current?.reset();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* not available */
        }
      }
    };
  }, [clearTimers, discardRecording]);

  /**
   * Browser `speechSynthesis`, the fallback voice. Runs when ElevenLabs TTS
   * fails or its playback is blocked, so the child still hears the reply.
   */
  const browserSpeak = useCallback(
    (text: string, finish: () => void) => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
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

  /**
   * Speaks a line in the child's ElevenLabs voice, and always shows it.
   *
   * The visible line (`spokenLine`) is set before any audio work starts, so no
   * audio outcome can lose the reply. With sound on, the ElevenLabs request is
   * attempted first; `"fallback"` routes to `browserSpeak`; `"cancelled"` means
   * a newer turn owns the stage and this one stays silent. The spoken text is
   * always exactly the text shown.
   */
  const speak = useCallback(
    (text: string) => {
      setSpokenLine(text);
      setIsSpeaking(true);
      speakSeqRef.current += 1;
      const seq = speakSeqRef.current;
      const finish = () => {
        if (speakSeqRef.current === seq) setIsSpeaking(false);
      };
      if (!soundOnRef.current) {
        // Sound off: the "speaking" state is purely visual pacing.
        later(finish, Math.max(2400, text.length * 60));
        return;
      }
      // Safety net for a stuck `ended` event: generous enough to almost never
      // cut real audio, and it only flips the avatar out of "speaking".
      later(finish, Math.max(12_000, text.length * 150));
      void (async () => {
        const result = await speechPlayer().speak({ childId: profile.id, text });
        if (!aliveRef.current || speakSeqRef.current !== seq) return;
        if (result === "played") {
          finish();
        } else if (result === "fallback") {
          browserSpeak(text, finish);
        }
        // "cancelled": whatever cancelled it owns the stage; stay silent.
      })();
    },
    [browserSpeak, later, profile.id, speechPlayer],
  );

  const present = useCallback(
    (view: ShowingView, spoken: string) => {
      setStage({ kind: "showing", view });
      speak(spoken);
    },
    [speak],
  );

  const think = useCallback((goal: string, phase: ThinkingPhase, transcript?: string) => {
    setStage({ kind: "thinking", goal, phase, ...(transcript !== undefined ? { transcript } : {}) });
  }, []);

  const recover = useCallback(
    (message: string, retryQuestion?: string) => {
      cancelSpeech();
      setStage({
        kind: "recovering",
        message,
        ...(retryQuestion !== undefined ? { retryQuestion } : {}),
      });
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
  // Prototype demo flows — UI regression fixtures only
  //
  // Reachable ONLY from the "Prototype demos" panel, never from anything a
  // child says. They exercise the card/choice/now-playing layouts that Phase 3
  // will render from real Sonos and family data, and they are labelled as
  // demos wherever they appear.
  // ------------------------------------------------------------------

  const runDemo = useCallback(
    (intent: AssistantIntent, transcript?: string) => {
      switch (intent) {
        case "resume-series":
          think("Finding your Ninjago spot…", "thinking", transcript);
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
          think("Looking for dragon songs…", "thinking", transcript);
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
          think("Hunting for great podcasts…", "thinking", transcript);
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
          think("Checking your family board…", "thinking", transcript);
          void loadPoints();
          break;
        case "parent-suggestion":
          think("Getting Mum and Dad's idea…", "thinking", transcript);
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

  // ------------------------------------------------------------------
  // The real conversation: free-form text to the child's own agent
  // ------------------------------------------------------------------

  /**
   * Sends one utterance to the selected child agent and renders the answer.
   *
   * The whole function is transport and presentation. It does not look at the
   * words: no matching, no classification, no keyword fallback. Whatever the
   * child said goes to `family.childTurn` through the scoped bridge, and
   * whatever the agent answered comes back as envelope blocks.
   *
   * The states a child sees, in order: sending → thinking → the answer, or a
   * recovery message with a retry that re-sends the same words.
   */
  const askChild = useCallback(
    (text: string) => {
      clearTimers();
      cancelSpeech();
      const question = text.trim().slice(0, MAX_CHILD_TURN_CHARS);
      if (!question) {
        recover("I couldn't hear anything that time. Try again a bit closer, or type it instead.");
        return;
      }

      const seq = turnSeqRef.current;
      const controller = new AbortController();
      turnAbortRef.current = controller;
      const client = turnClientRef.current;
      if (!client) {
        recover("I can't reach my brain right now. Tell a grown-up, and try again in a bit.", question);
        return;
      }

      think("Sending your question…", "sending", question);

      void (async () => {
        // Flip to "thinking" as soon as the request is actually on its way, so
        // the two states mean something distinct rather than being decoration.
        const pending = client.ask(
          { childId: profile.id, sessionSuffix: ASSISTANT_SESSION_SUFFIX, message: question },
          { signal: controller.signal },
        );
        if (aliveRef.current && seq === turnSeqRef.current) {
          think(`${profile.companionName} is thinking…`, "thinking", question);
        }

        const outcome = await pending;
        // A reply that arrives after the child moved on is dropped, never
        // rendered over whatever they are looking at now.
        if (!aliveRef.current || seq !== turnSeqRef.current) return;
        turnAbortRef.current = null;

        if (outcome.ok) {
          const spoken = envelopeSpokenText(outcome.envelope);
          present(
            { kind: "assistant-reply", question, blocks: outcome.envelope.blocks },
            spoken || "Here you go!",
          );
          return;
        }
        recover(
          childFacingRecovery(outcome.envelope),
          isRetryable(outcome.envelope) ? question : undefined,
        );
      })();
    },
    [cancelSpeech, clearTimers, present, profile.companionName, profile.id, recover, think],
  );

  // ------------------------------------------------------------------
  // Voice input
  // ------------------------------------------------------------------

  /**
   * Shows the spoken words back for the child to edit, send, redo, or drop.
   * The editable draft starts as exactly what the transcription heard.
   */
  const enterConfirming = useCallback((heard: string) => {
    setConfirmDraft(heard);
    setConfirmIssue(null);
    setStage({
      kind: "confirming",
      transcript: heard,
      prompt: "Is that what you meant? You can fix any word.",
      options: voiceConfirmOptions(),
    });
  }, []);

  /**
   * The finished recording: let ElevenLabs Scribe turn it into the transcript
   * the child reviews. The route pins no language — Scribe v2 detects it per
   * utterance — so a turn in German or Spanish comes back in the words the
   * child actually said. `seq` guards every step: a recording superseded by a
   * newer one, a profile switch, or unmount is silently discarded, never posted
   * or rendered late.
   */
  const transcribeRecording = useCallback(
    (seq: number, blob: Blob, fileName: string) => {
      if (!aliveRef.current || seq !== recordSeqRef.current) return;
      setStage({ kind: "transcribing" });
      void (async () => {
        try {
          const form = new FormData();
          form.append("audio", blob, fileName);
          const response = await fetch(TRANSCRIBE_PATH, { method: "POST", body: form });
          if (!aliveRef.current || seq !== recordSeqRef.current) return;
          if (!response.ok) {
            recover(
              response.status === 503
                ? "My ears aren't working right now. Type it instead, or tell a grown-up."
                : "I couldn't work out what you said. Try again, or type it instead.",
            );
            return;
          }
          const data = (await response.json()) as { transcript?: string };
          if (!aliveRef.current || seq !== recordSeqRef.current) return;
          const heard = (data.transcript ?? "").trim();
          if (!heard) {
            recover(
              "I couldn't hear anything that time. Try again a bit closer, or tap an idea below.",
            );
            return;
          }
          // Voice gets one editable read-back step before the words leave the
          // iPad. Nothing here inspects what was heard.
          enterConfirming(heard);
        } catch {
          if (!aliveRef.current || seq !== recordSeqRef.current) return;
          recover("I couldn't work out what you said. Try again, or type it instead.");
        }
      })();
    },
    [enterConfirming, recover],
  );

  /**
   * Opens the microphone and starts a push-to-talk session.
   *
   * The lifecycle — startup vs. live, a Stop tapped during startup, the minimum
   * capture floor, chunk assembly, the 60-second bound — belongs to
   * `startPushToTalk`; this handler only maps its one outcome onto the stage.
   * `seq` still guards every callback, so a session the child has moved on from
   * cannot paint over what they are looking at now.
   */
  const startListening = useCallback(() => {
    if (!voiceCaptureSupported(window)) {
      recover(
        "My ears don't work in this browser without microphone access. Tap an idea below or type instead — everything still works.",
      );
      return;
    }
    clearTimers();
    cancelSpeech();
    discardRecording();
    // A tap started this: the moment iPad Safari lets audio be unlocked.
    speechPlayer().unlock();
    const seq = recordSeqRef.current;
    // Not "Listening" yet — the microphone is still opening.
    setStage({ kind: "listening", transcript: "", simulated: false, live: false });
    const session = startPushToTalk({
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
      createRecorder: (stream, mimeType, handlers) =>
        adaptMediaRecorder(
          new MediaRecorder(stream, mimeType ? { mimeType } : undefined),
          handlers,
        ),
      onLive: () => {
        if (!aliveRef.current || seq !== recordSeqRef.current) return;
        setStage({ kind: "listening", transcript: "", simulated: false, live: true });
      },
      onSettle: (outcome) => {
        if (recordSessionRef.current === session) recordSessionRef.current = null;
        if (!aliveRef.current || seq !== recordSeqRef.current) return;
        switch (outcome.kind) {
          case "recorded":
            transcribeRecording(seq, outcome.blob, outcome.fileName);
            break;
          case "empty":
            recover(
              "I couldn't hear anything that time. Try again a bit closer, or tap an idea below.",
            );
            break;
          case "denied":
            recover(
              "I couldn't listen just now — the microphone said no. Tap an idea below or type instead.",
            );
            break;
          case "failed":
            recover(
              "Something went wrong with the microphone. Tap an idea below or type instead.",
            );
            break;
          case "cancelled":
            // Whatever cancelled this owns the stage; stay silent.
            break;
        }
      },
    });
    recordSessionRef.current = session;
  }, [cancelSpeech, clearTimers, discardRecording, recover, speechPlayer, transcribeRecording]);

  /**
   * Stop. During startup the session remembers the tap and applies it as soon
   * as capture is live, so the utterance survives instead of vanishing.
   */
  const finishListening = useCallback(() => {
    const session = recordSessionRef.current;
    if (session) {
      session.stop();
      return;
    }
    discardRecording();
    backToReady();
  }, [backToReady, discardRecording]);

  const micState: MicState =
    stage.kind !== "listening" || stage.simulated ? "idle" : stage.live ? "live" : "starting";
  const isRecording = micState !== "idle";

  const onMicToggle = useCallback(() => {
    if (isRecording) {
      finishListening();
    } else {
      startListening();
    }
  }, [finishListening, isRecording, startListening]);

  // ------------------------------------------------------------------
  // Starter chips: type out the phrase, then send it as a real turn
  //
  // The animation is presentation only. What reaches the agent is the same
  // free-form string a child could have typed, so a starter prompt and a typed
  // question take exactly one code path.
  // ------------------------------------------------------------------

  const simulatePhrase = useCallback(
    (phrase: string) => {
      clearTimers();
      cancelSpeech();
      discardRecording();
      // Tapping a starter chip is a user gesture: unlock audio now so the
      // reply a few seconds later is allowed to play.
      speechPlayer().unlock();
      if (reducedMotion) {
        setStage({ kind: "listening", transcript: phrase, simulated: true, live: true });
        later(() => askChild(phrase), 550);
        return;
      }
      setStage({ kind: "listening", transcript: "", simulated: true, live: true });
      let shown = 0;
      const step = () => {
        shown += 1;
        setStage({
          kind: "listening",
          transcript: phrase.slice(0, shown),
          simulated: true,
          live: true,
        });
        if (shown < phrase.length) {
          later(step, 36);
        } else {
          later(() => askChild(phrase), 500);
        }
      };
      later(step, 260);
    },
    [askChild, cancelSpeech, clearTimers, discardRecording, later, reducedMotion, speechPlayer],
  );

  const onTypedSubmit = useCallback(() => {
    const value = typed.trim();
    if (!value) return;
    setTyped("");
    discardRecording();
    // Submitting is a user gesture: unlock audio for the reply.
    speechPlayer().unlock();
    askChild(value);
  }, [askChild, discardRecording, speechPlayer, typed]);

  const onConfirmOption = useCallback(
    (option: ConfirmOption) => {
      switch (option.kind) {
        case "ask": {
          // The child may have edited the words; what they see in the box is
          // exactly what is sent. Empty and overlong drafts are refused with
          // the same bound the bridge enforces.
          const checked = checkChildUtterance(confirmDraft);
          if (!checked.ok) {
            setConfirmIssue(
              checked.reason === "empty"
                ? "There's nothing to ask yet — say it again or type some words."
                : `That's very long! Keep it under ${checked.limit} letters.`,
            );
            return;
          }
          speechPlayer().unlock();
          askChild(checked.text);
          break;
        }
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
    [askChild, backToReady, confirmDraft, recover, speechPlayer, speechSupported, startListening],
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
        if (stage.transcript) return `Heard so far: ${stage.transcript}`;
        // Truthful for a screen reader too: nothing is being recorded until
        // the recorder is live.
        return stage.live ? "Listening" : "Turning the microphone on";
      case "transcribing":
        return "Working out what you said";
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

  // The routine-progress fixture links into the shell's own Plan destination,
  // which renders the same person board without leaving the child shell.
  const boardHref = childShellDestinationHref("plan", profile.id, weekId);

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

        {/* The Listening Library (DESIGN §7.4.2) is reached from here rather
            than adding a fourth shell destination. The link carries the
            selected child so a deep link stays on the same profile. */}
        <Link
          href={`/family/listen?child=${profile.id}`}
          className={cn(
            "flex min-h-16 items-center gap-3 rounded-2xl border border-primary bg-primary px-4 py-3 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
            focusRing,
          )}
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-2xl" aria-hidden>
            🎧
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-primary">Stories</span>
            <span className="block text-sm text-tertiary">Your Hörspiel library — browse, play and continue</span>
          </span>
        </Link>

        <div>
          <p className="mb-2 text-sm text-quaternary">
            Ask me anything — or start with one of these:
          </p>
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
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-2xl">
                {s.icon}
              </span>
              <span className="min-w-0 text-base font-medium text-primary">
                &ldquo;{s.phrase}&rdquo;
              </span>
            </button>
          ))}
          </div>
        </div>

        <PrototypeDemoPanel
          open={demosOpen}
          onToggle={() => setDemosOpen((value) => !value)}
          onRun={runDemo}
        />
      </div>
    );
  } else if (stage.kind === "listening") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <p className={cn("text-sm font-semibold uppercase tracking-[0.14em]", tintText[tint])}>
          {stage.simulated ? "Pretend voice demo" : stage.live ? "Listening…" : "Getting ready…"}
        </p>
        <p className="min-h-24 text-3xl font-medium leading-snug text-primary">
          {stage.transcript ? (
            <>&ldquo;{stage.transcript}&rdquo;</>
          ) : stage.simulated ? (
            <span className="text-quaternary">Say what you&rsquo;d like…</span>
          ) : stage.live ? (
            <span className="text-quaternary">
              Say what you&rsquo;d like — I&rsquo;ll show you the words when you tap stop.
            </span>
          ) : (
            <span className="text-quaternary">
              Turning the microphone on — wait for &ldquo;Listening&rdquo; before you start.
            </span>
          )}
        </p>
        {!stage.simulated && (
          <div>
            {/* Live or not, this button stops the turn: a tap during startup is
                remembered and applied the moment the recorder is live. */}
            <BigOptionButton
              label={
                stage.live
                  ? "Done talking — show me the words"
                  : "Stop — I'll catch what you say"
              }
              icon="◼"
              tint={tint}
              onClick={finishListening}
            />
          </div>
        )}
      </div>
    );
  } else if (stage.kind === "transcribing") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-4">
        <p className={cn("text-sm font-semibold uppercase tracking-[0.14em]", tintText[tint])}>
          Listening back
        </p>
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
          <p className="text-2xl font-medium text-primary">Working out what you said…</p>
        </div>
      </div>
    );
  } else if (stage.kind === "confirming") {
    stageContent = (
      <div className="flex min-h-full flex-col justify-center gap-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            I heard
          </p>
          {/* The transcript comes back editable: the ElevenLabs words are the
              starting point, and whatever is in this box is exactly what gets
              sent. Child speech recognition is the original failure this
              product exists to fix, so the fix stays one tap away. */}
          <textarea
            value={confirmDraft}
            onChange={(event) => {
              setConfirmDraft(event.target.value);
              setConfirmIssue(null);
            }}
            rows={3}
            aria-label="What I heard — you can fix any word before sending"
            className={cn(
              "mt-2 w-full resize-none rounded-2xl border border-primary bg-primary p-4 text-2xl font-medium leading-snug text-primary",
              focusRing,
            )}
          />
          {confirmIssue ? (
            <p className="mt-2 text-base font-medium text-amber-700 dark:text-amber-300">
              {confirmIssue}
            </p>
          ) : null}
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
        <p className={cn("text-sm font-semibold uppercase tracking-[0.14em]", tintText[tint])}>
          {stage.phase === "sending" ? "Sending" : "Thinking"}
        </p>
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
          {stage.retryQuestion !== undefined && (
            <BigOptionButton
              label="Ask that again"
              icon="↻"
              primary
              tint={tint}
              onClick={() => askChild(stage.retryQuestion as string)}
            />
          )}
          {speechSupported && (
            <BigOptionButton
              label="Try talking again"
              icon="🎤"
              primary={stage.retryQuestion === undefined}
              tint={tint}
              onClick={startListening}
            />
          )}
          <BigOptionButton label="Never mind" tint={tint} onClick={backToReady} />
        </div>
      </div>
    );
  } else if (stage.kind === "showing") {
    const view = stage.view;
    let body: React.ReactNode = null;

    if (view.kind === "assistant-reply") {
      body = (
        <div className="space-y-4">
          <p className="text-sm text-quaternary">
            You asked: <TranscriptText text={view.question} />
          </p>
          <AssistantReply blocks={view.blocks} />
        </div>
      );
    } else if (view.kind === "resume") {
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
            onClick={startListening}
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
                onClick={() => runDemo("resume-series")}
              />
            </div>
          </div>
        </div>
      );
    } else if (view.kind === "avatar-styles") {
      body = (
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-quaternary">
            Dress-up — pick {profile.companionName}&rsquo;s look
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {avatarStyles.map((style) => {
              const wearing = avatarStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => {
                    setAvatarStyle(style.id);
                    speak(`Ta-da — ${style.label}!`);
                  }}
                  aria-pressed={wearing}
                  className={cn(
                    "flex min-w-0 items-center gap-3 rounded-2xl border-2 bg-primary p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
                    wearing ? tintBorder[tint] : "border-primary",
                    focusRing,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-2xl"
                    style={{
                      background: `radial-gradient(circle at 35% 30%, ${style.colors.from}, ${style.colors.to})`,
                    }}
                  >
                    {style.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-primary">
                      {style.label}
                    </span>
                    <span className="block text-sm text-tertiary">{style.tagline}</span>
                    {wearing && (
                      <NabuBadge tone="green" className="mt-1.5">
                        Wearing it now
                      </NabuBadge>
                    )}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setAvatarStyle(null);
                speak("Back to my usual look!");
              }}
              aria-pressed={avatarStyle === null}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-2xl border-2 bg-primary p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:shadow-none",
                avatarStyle === null ? tintBorder[tint] : "border-primary",
                focusRing,
              )}
            >
              <span
                className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-secondary text-2xl"
                aria-hidden="true"
              >
                🙂
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-primary">My usual look</span>
                <span className="block text-sm text-tertiary">Back to normal</span>
                {avatarStyle === null && (
                  <NabuBadge tone="green" className="mt-1.5">
                    Wearing it now
                  </NabuBadge>
                )}
              </span>
            </button>
          </div>
          <p className="text-xs text-quaternary">
            Dress-up is just for now — {profile.companionName} goes back to normal next time, and
            nothing is remembered.
          </p>
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
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-secondary text-primary">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Portrait — both iPad sizes included — is one conversation column with
          the talk dock under the child's thumbs. The avatar-rail split exists
          only where landscape width genuinely pays for it (contract:
          family-assistant-layout.ts). */}
      <div className="flex min-h-0 flex-1 flex-col lg:landscape:flex-row">
        {/* Companion rail */}
        <section
          aria-label={`${profile.companionName}, your companion`}
          className="flex shrink-0 flex-col items-center gap-2 px-4 pb-1 pt-4 lg:landscape:w-[380px] lg:landscape:justify-center lg:landscape:gap-5 lg:landscape:border-r lg:landscape:border-secondary lg:landscape:px-6 lg:landscape:py-8"
        >
          <AssistantAvatar
            state={avatarState}
            tint={tint}
            crest={profile.crest}
            look={avatarLook}
            label={`${profile.companionName} is ${avatarStateLabel(avatarState)}`}
            className="h-24 w-24 lg:landscape:h-44 lg:landscape:w-44"
          />
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-tertiary">
              {profile.companionName} · {avatarStateLabel(avatarState)}
            </p>
            <button
              type="button"
              onClick={() => {
                if (soundOn) {
                  cancelSpeech();
                } else {
                  // Turning sound on is a tap: unlock audio right here so the
                  // next reply is allowed to play.
                  speechPlayer().unlock();
                }
                setSoundOn((s) => !s);
              }}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Turn voice sound off" : "Turn voice sound on"}
              className={cn(
                "grid h-12 w-12 place-items-center rounded-full border border-primary bg-primary text-lg transition-colors hover:bg-secondary",
                focusRing,
              )}
            >
              {soundOn ? "🔊" : "🔇"}
            </button>
          </div>
          {(stage.kind === "showing" || isSpeaking) && spokenLine ? (
            <div className="max-w-md rounded-2xl border border-primary bg-primary px-4 py-3 text-center text-sm leading-relaxed text-secondary">
              {spokenLine}
            </div>
          ) : null}
          <MicDock
            className="hidden lg:landscape:flex"
            variant="rail"
            tint={tint}
            micState={micState}
            speechSupported={speechSupported}
            typed={typed}
            onTypedChange={setTyped}
            onTypedSubmit={onTypedSubmit}
            onMicToggle={onMicToggle}
          />
        </section>

        {/* Stage */}
        <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:landscape:py-6">
            {stageContent}
          </div>
          <div className="shrink-0 border-t border-secondary bg-primary/60 px-4 py-3 sm:px-6 lg:landscape:hidden">
            <MicDock
              variant="dock"
              tint={tint}
              micState={micState}
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
// Entry — the workspace for the shell's selected child
// ---------------------------------------------------------------------------

export function FamilyAssistantClient({ weekId }: { weekId: string }) {
  // The selected child is owned by the persistent `(shell)` layout provider;
  // while no child is selected the provider shows the non-dismissable
  // switcher, so this surface simply renders nothing behind it.
  const { child } = useChildShell();
  const profile = assistantProfileById(child);

  if (!profile) return null;

  return <Workspace key={profile.id} profile={profile} weekId={weekId} />;
}
