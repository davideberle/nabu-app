// ---------------------------------------------------------------------------------------------------------------------
// Learning-app story voices — the six-slot registry (owner direction 2026-10-29 09:34: «use ElevenLabs also for the learning
// app; a native voice for German, Spanish and English, probably both male and female, so we have 6 characters in total»).
//
// A SLOT is a native-language voice for story characters: de/es/en × female/male. Content (Family-owned) gives each story
// character one slot; a visit uses only the slots its characters need (no visit must use all six). Assistant identities
// (Nokt for Santiago, Old Lila for Isabel) are NOT story characters and never take a slot — Nokt keeps its own voice setting
// and its live tutor route; nothing here changes the tutor, the microphone or any model.
//
// Which ElevenLabs voice fills a slot is server-only configuration (`ELEVENLABS_VOICE_<LANG>_<GENDER>_ID`), never in source and
// never sent to a browser. A slot's voice must be NATIVE in the slot's language (an English voice that can also read German
// does not qualify). Varieties decided by the owner on October 29: Standard German, Mexican Spanish, American English. Isomorphic:
// imported by the content validator, the narration script, the player and the server routes.
// ---------------------------------------------------------------------------------------------------------------------

export const VOICE_SLOTS = ["de-female", "de-male", "es-female", "es-male", "en-female", "en-male"] as const;
export type VoiceSlot = (typeof VOICE_SLOTS)[number];
export type SlotLanguage = "de" | "es" | "en";

export type VoiceSlotInfo = {
  language: SlotLanguage;
  gender: "female" | "male";
  /** Server-only env name holding the ElevenLabs voice id of this slot. */
  env: string;
  /** Which variety the slot's native voice speaks: the owner's decision (October 29, 09:46) and the options that were offered. */
  dialect: { decided: string; options: string[]; note: string };
};

const DE = { decided: "Standard German", options: ["Swiss Standard German (Schweizer Hochdeutsch)", "Standard German from Germany", "Austrian Standard German"], note: "Isabel's content uses Swiss orthography; the spoken variety is the owner's choice." };
const ES = { decided: "Mexican Spanish", options: ["Castilian (Spain)", "Latin American / Mexican"], note: "Santiago's Spanish lines are written in neutral Spanish; the only professional Spanish voice seen in the account (Ana Sofía) is Mexican." };
const EN = { decided: "American English", options: ["British", "American"], note: "Santiago's English device fallback is en-GB today; the owner chooses the voice variety." };

export const VOICE_SLOT_INFO: Record<VoiceSlot, VoiceSlotInfo> = {
  "de-female": { language: "de", gender: "female", env: "ELEVENLABS_VOICE_DE_FEMALE_ID", dialect: DE },
  "de-male": { language: "de", gender: "male", env: "ELEVENLABS_VOICE_DE_MALE_ID", dialect: DE },
  "es-female": { language: "es", gender: "female", env: "ELEVENLABS_VOICE_ES_FEMALE_ID", dialect: ES },
  "es-male": { language: "es", gender: "male", env: "ELEVENLABS_VOICE_ES_MALE_ID", dialect: ES },
  "en-female": { language: "en", gender: "female", env: "ELEVENLABS_VOICE_EN_FEMALE_ID", dialect: EN },
  "en-male": { language: "en", gender: "male", env: "ELEVENLABS_VOICE_EN_MALE_ID", dialect: EN },
};

/** The children's assistants — identities, not story characters: never a slot, never a story character id from Visit 2 on. */
export const ASSISTANT_IDENTITIES: readonly { id: string; name: string; child: "santiago" | "isabel" }[] = [
  { id: "nokt", name: "Nokt", child: "santiago" },
  { id: "lila", name: "Old Lila", child: "isabel" },
];

export const isVoiceSlot = (v: unknown): v is VoiceSlot => typeof v === "string" && (VOICE_SLOTS as readonly string[]).includes(v);
export const slotLanguage = (slot: VoiceSlot): SlotLanguage => VOICE_SLOT_INFO[slot].language;

const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/;

/** Server-side: the configured ElevenLabs voice of a slot, or null (unset or malformed — never interpolated into a request). */
export function resolveSlotVoiceId(slot: VoiceSlot, env: Record<string, string | undefined>): string | null {
  const v = env[VOICE_SLOT_INFO[slot].env]?.trim();
  return v && VOICE_ID_PATTERN.test(v) ? v : null;
}

/** A content character's voice is valid when it is a slot of the character's own language. */
export function slotFitsCharacter(slot: unknown, language: unknown): boolean {
  return isVoiceSlot(slot) && slotLanguage(slot) === language;
}

// ---------------------------------------------------------------------------------------------------------------------
// Binding story speech to slots (owner «Proceed with implementation», 2026-10-29): a spoken line takes the slot of ITS OWN
// language and its speaking character's gender — Rosa's Spanish dialogue → es-female, a German instruction of hers → de-female
// (never a Spanish voice reading German). A character keeps its identity across languages; only the voice of the line's language
// changes. Characters of released content get their gender from this presentation table (no content version change, no
// progress reset); new content can declare `voice` itself (Isabel's Ida: de-female).
// ---------------------------------------------------------------------------------------------------------------------

export type StoryGender = "female" | "male";
const STORY_CHARACTER_GENDER: Record<string, Record<string, StoryGender>> = {
  // Santiago's released expedition (content v5–v7): Rosa (ids rosa / supplier), June (gardener), Mrs Finley (keeper), Herr Baumann (planner).
  "santiago-expedition": { rosa: "female", supplier: "female", gardener: "female", keeper: "female", planner: "male" },
};

export function characterGender(contentId: string, character: { id: string; voice?: unknown } | null | undefined): StoryGender | null {
  if (!character) return null;
  if (isVoiceSlot(character.voice)) return VOICE_SLOT_INFO[character.voice].gender;
  return STORY_CHARACTER_GENDER[contentId]?.[character.id] ?? null;
}

/** The slot that speaks a line: the line's language × the character's gender (assistants never get one). */
export function slotFor(gender: StoryGender | null | undefined, language: string | null | undefined): VoiceSlot | null {
  if (!gender || !language) return null;
  const s = `${language}-${gender}`;
  return isVoiceSlot(s) ? s : null;
}

/** Server-side: the slots that have a voice configured (booleans only — ids never leave the server). */
export function configuredSlots(env: Record<string, string | undefined>): VoiceSlot[] {
  return VOICE_SLOTS.filter((s) => resolveSlotVoiceId(s, env) !== null);
}

/**
 * Children hear the selected story voices only after the release switch `FAMILY_STORY_VOICES=recorded` — set once every needed
 * line is recorded and the owner accepted the audition. Before it, the voice ids may already be configured (so the owner can
 * prepare and audition), and every child page keeps its earlier route unchanged.
 */
export const STORY_VOICES_SWITCH = "FAMILY_STORY_VOICES";
export function childStoryVoices(env: Record<string, string | undefined>): VoiceSlot[] {
  return env[STORY_VOICES_SWITCH] === "recorded" ? configuredSlots(env) : [];
}
