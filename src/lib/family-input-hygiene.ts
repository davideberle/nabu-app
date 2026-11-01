// Step 1 (2026-11-01, S1-03): every child text field turns off the browser's typing help — autocomplete, autocorrect,
// automatic capitals, spell check and Chrome's writing suggestions — so what is recorded is what the child typed. The Mac
// mini's own predictive text and autocorrect were turned off system-wide by Nabu on November 1.
// `writingsuggestions` is a plain HTML attribute React passes through unchanged (Chrome reads it).
export const NO_TYPING_HELP = { autoComplete: "off", autoCorrect: "off", autoCapitalize: "off", spellCheck: false, writingsuggestions: "false" } as const;
