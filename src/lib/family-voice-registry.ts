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
// does not qualify) — chosen by the owner; the dialect of each language is still an open owner decision (below). Isomorphic:
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
  /** Owner decision still open: which variety the slot's native voice speaks. Options are listed, none is chosen here. */
  dialect: { decided: null; options: string[]; note: string };
};

const DE = { decided: null, options: ["Swiss Standard German (Schweizer Hochdeutsch)", "Standard German from Germany", "Austrian Standard German"], note: "Isabel's content uses Swiss orthography; the spoken variety is the owner's choice." };
const ES = { decided: null, options: ["Castilian (Spain)", "Latin American / Mexican"], note: "Santiago's Spanish lines are written in neutral Spanish; the only professional Spanish voice seen in the account (Ana Sofía) is Mexican." };
const EN = { decided: null, options: ["British", "American"], note: "Santiago's English device fallback is en-GB today; the owner chooses the voice variety." };

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
