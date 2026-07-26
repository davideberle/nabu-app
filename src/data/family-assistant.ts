// ---------------------------------------------------------------------------
// Family Assistant — prototype-only content for the /family/assistant
// interaction prototype. Mock media/continuity data lives here so the UI
// stays free of hard-coded copy. Nothing in this file triggers real playback,
// memory, or messaging; the future runtime is owned by projects/family-assistant.
// ---------------------------------------------------------------------------

export type AssistantChildId = "santiago" | "isabel";

export type AssistantTint = "amber" | "emerald";

export type AssistantProfile = {
  id: AssistantChildId;
  displayName: string;
  /** Placeholder companion name — final naming is an open design question. */
  companionName: string;
  tint: AssistantTint;
  /** Drives the avatar silhouette + chest mark so the two feel distinct. */
  crest: "bolt" | "leaf";
  greeting: string;
  greetingHint: string;
};

export const assistantProfiles: AssistantProfile[] = [
  {
    id: "santiago",
    displayName: "Santiago",
    companionName: "Ziggy",
    tint: "amber",
    crest: "bolt",
    greeting: "Hey Santiago!",
    greetingHint: "Episode 108 is waiting — or ask me something else.",
  },
  {
    id: "isabel",
    displayName: "Isabel",
    companionName: "Lumi",
    tint: "emerald",
    crest: "leaf",
    greeting: "Hi Isabel!",
    greetingHint: "What should we listen to today?",
  },
];

export function assistantProfileById(
  id: string | null | undefined,
): AssistantProfile | null {
  return assistantProfiles.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Scenario content
// ---------------------------------------------------------------------------

export type MediaCard = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  meta: string;
};

/** Episodic continuity mock — the real state will come from sonos-music later. */
export const ninjagoResume = {
  series: "Ninjago audio series",
  lastEpisode: 107,
  lastTitle: "The Storm Temple",
  nextEpisode: 108,
  nextTitle: "Rise of the Sea Serpent",
  nextDuration: "22 min",
};

export const dragonSongChoices: MediaCard[] = [
  {
    id: "weekend-whip",
    title: "The Weekend Whip",
    subtitle: "The Fold — Ninjago theme",
    icon: "🐉",
    meta: "From the dragon episodes",
  },
  {
    id: "puff-magic-dragon",
    title: "Puff, the Magic Dragon",
    subtitle: "Peter, Paul and Mary",
    icon: "🎶",
    meta: "The classic dragon song",
  },
  {
    id: "believer",
    title: "Believer",
    subtitle: "Imagine Dragons",
    icon: "🔥",
    meta: "The dragon band from the car",
  },
];

export const podcastChoices: MediaCard[] = [
  {
    id: "wow-in-the-world",
    title: "Wow in the World",
    subtitle: "Science & wild discoveries",
    icon: "🚀",
    meta: "25 min",
  },
  {
    id: "greeking-out",
    title: "Greeking Out",
    subtitle: "Greek myths & heroes",
    icon: "🏛️",
    meta: "20 min",
  },
  {
    id: "brains-on",
    title: "Brains On!",
    subtitle: "Big why-questions, answered",
    icon: "🧠",
    meta: "30 min",
  },
];

export const parentSuggestion = {
  label: "From Mum & Dad",
  reason: "You've listened to a lot of Ninjago this week — here is something new to try.",
  item: {
    id: "wild-robot",
    title: "The Wild Robot — Chapter 1",
    subtitle: "A robot wakes up alone on a wild island",
    icon: "🤖",
    meta: "24 min",
  } satisfies MediaCard,
};

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export type AssistantIntent =
  | "resume-series"
  | "fuzzy-music"
  | "podcast"
  | "points"
  | "parent-suggestion";

export type StarterPhrase = {
  intent: AssistantIntent;
  icon: string;
  phrase: string;
};

export const starterPhrases: StarterPhrase[] = [
  { intent: "resume-series", icon: "🥷", phrase: "Continue Ninjago" },
  { intent: "fuzzy-music", icon: "🐉", phrase: "Play the song with the dragon" },
  { intent: "podcast", icon: "🎧", phrase: "Find me a cool podcast" },
  { intent: "points", icon: "🪙", phrase: "Where do I stand?" },
];

/**
 * Tiny keyword matcher for the prototype. The production language layer is a
 * family-assistant domain concern; this only needs to route the demo phrases
 * plus reasonable variations, and return null so the UI can run the
 * recoverable correction flow for everything else.
 */
export function detectIntent(text: string): AssistantIntent | null {
  const t = text.toLowerCase();
  if (/dragon/.test(t)) return "fuzzy-music";
  if (/(ninjago|episode|continue|resume|next one)/.test(t)) return "resume-series";
  if (/podcast/.test(t)) return "podcast";
  if (/(where do i stand|stand|points|coins|coin|reward|balance)/.test(t)) return "points";
  if (/(mum|mom|dad|parent|surprise|something (new|different)|idea)/.test(t)) {
    return "parent-suggestion";
  }
  return null;
}

/** The word the assistant should flag as uncertain for the fuzzy music flow. */
export function findUncertainWord(text: string): string | undefined {
  const match = text.match(/dragon\w*/i);
  return match?.[0];
}
