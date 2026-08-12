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
  /**
   * The word the confirming flow marks as heard-but-uncertain when this exact
   * suggested phrase is used. Presentation only — never used for routing.
   */
  uncertainWord?: string;
};

export const starterPhrases: StarterPhrase[] = [
  { intent: "resume-series", icon: "🥷", phrase: "Continue Ninjago" },
  {
    intent: "fuzzy-music",
    icon: "🐉",
    phrase: "Play the song with the dragon",
    uncertainWord: "dragon",
  },
  { intent: "podcast", icon: "🎧", phrase: "Find me a cool podcast" },
  { intent: "points", icon: "🪙", phrase: "Where do I stand?" },
];

// ---------------------------------------------------------------------------
// Avatar dress-up styles
//
// The one bounded avatar-customization capability: recolor the companion from
// this fixed, hand-authored set. Session-only (nothing is remembered), never a
// copy of a licensed character's artwork or likeness. The semantic layer may
// select one of these ids and nothing else.
// ---------------------------------------------------------------------------

export type AvatarStyleId = "ocean" | "berry" | "forest" | "sunset" | "midnight";

export type AvatarColors = {
  from: string;
  to: string;
  ring: string;
  face: string;
  badge: string;
};

export type AvatarStyle = {
  id: AvatarStyleId;
  label: string;
  emoji: string;
  tagline: string;
  colors: AvatarColors;
};

export const avatarStyles: AvatarStyle[] = [
  {
    id: "ocean",
    label: "Ocean Splash",
    emoji: "🌊",
    tagline: "Cool blue like a big wave",
    colors: { from: "#7dd3fc", to: "#2563eb", ring: "#38bdf8", face: "#082f49", badge: "#1d4ed8" },
  },
  {
    id: "berry",
    label: "Berry Fizz",
    emoji: "🫐",
    tagline: "Bright pink-purple sparkle",
    colors: { from: "#f0abfc", to: "#a21caf", ring: "#e879f9", face: "#4a044e", badge: "#86198f" },
  },
  {
    id: "forest",
    label: "Forest Hero",
    emoji: "🌿",
    tagline: "Deep green adventure",
    colors: { from: "#86efac", to: "#15803d", ring: "#4ade80", face: "#052e16", badge: "#166534" },
  },
  {
    id: "sunset",
    label: "Sunset Glow",
    emoji: "🌅",
    tagline: "Warm red-orange evening",
    colors: { from: "#fda4af", to: "#e11d48", ring: "#fb7185", face: "#4c0519", badge: "#be123c" },
  },
  {
    id: "midnight",
    label: "Starry Night",
    emoji: "✨",
    tagline: "Dark blue with a glow",
    colors: { from: "#a5b4fc", to: "#4338ca", ring: "#818cf8", face: "#1e1b4b", badge: "#3730a3" },
  },
];

export function avatarStyleById(id: string | null | undefined): AvatarStyle | null {
  return avatarStyles.find((s) => s.id === id) ?? null;
}
