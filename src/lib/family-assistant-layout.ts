// ---------------------------------------------------------------------------
// Family Assistant — interaction sizing and responsive-composition contract.
//
// The /family/assistant surface is used by children holding a shared iPad, so
// the primary controls carry explicit minimum sizes, and the desktop-style
// side-by-side composition is allowed only in genuine landscape. These
// constants are the single source of truth: `client.tsx` applies them, and
// `family-assistant-layout.test.ts` asserts the numbers so a future style
// tweak cannot silently shrink a child's touch targets.
//
// The class strings must stay literal (never template-built) so Tailwind's
// source scanner sees them.
// ---------------------------------------------------------------------------

/** Minimum visible size of the push-to-talk control, in CSS px. */
export const TALK_BUTTON_MIN_PX = 132;

/**
 * The push-to-talk / stop button — the one unmistakable primary control in the
 * ready and listening states. The whole visible circle is the clickable
 * element; the listening pulse ring around it is decorative and
 * pointer-events-none.
 */
export const TALK_BUTTON_SIZE_CLASS = "h-[136px] w-[136px]";

/** Minimum height of the primary typed input and its send control, in CSS px. */
export const PRIMARY_INPUT_MIN_PX = 56;

/** Typed fallback input: h-14 = 56px. */
export const PRIMARY_INPUT_HEIGHT_CLASS = "h-14";

/** Send control beside the typed input: 56 x 56 px. */
export const SEND_BUTTON_SIZE_CLASS = "h-14 w-14";

/** Minimum hit target for every ordinary interactive control, in CSS px. */
export const ORDINARY_TARGET_MIN_PX = 48;

/**
 * The only variant prefix under which the conversation may split into the
 * avatar rail + stage columns. Width alone is not enough: iPad portrait is
 * 1024 CSS px wide, and giving it the desktop split is exactly the sparse
 * layout this contract exists to prevent.
 */
export const SIDE_BY_SIDE_VARIANT_PREFIX = "lg:landscape:";
