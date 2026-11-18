// ===========================================================================
// chess-lines-de.js — the CLOSED set of spoken German coach lines (Nov 18, 2026).
//
// Every sentence the coach can SAY is one entry of this frozen map (key → fixed
// text). Nothing else is ever spoken: no free text, no template filled at play
// time, no device voice. The Companion App records each line once with its
// narration voice (de-female slot) and serves the clip by key; without that
// (standalone page) the text is shown silently.
//
// Rules for this set:
//   - name-free: a recording never says a child's name. The SCREEN may show
//     «Hallo Isabel! …» (chess-ui replaces the leading «Hallo!»), the clip says
//     «Hallo! …»;
//   - picture-first, simple German for a 6–7 year old; Swiss spelling (no «ß»);
//   - small: the whole set stays well under 1,500 characters.
// Changing any text changes its recording id — re-record after edits.
// ===========================================================================

(function (root) {
  "use strict";

  const LINES = Object.freeze({
    // Game start: one per opponent (the child's own ladder rung).
    "intro.pip": "Hallo! Du spielst gegen Pip den Pinguin. Er lernt gerade die Züge. Viel Spass!",
    "intro.waffles": "Hallo! Du spielst gegen Sir Waffel. Er ist oft vergesslich. Viel Spass!",
    "intro.bongo": "Hallo! Du spielst gegen Bongo das Faultier. Er ist langsam. Viel Spass!",
    "intro.gizmo": "Hallo! Du spielst gegen Gizmo den Roboter. Er denkt voraus. Viel Spass!",
    "intro.luna": "Hallo! Du spielst gegen Kapitänin Luna. Sie stellt kleine Fallen. Viel Spass!",
    "intro.hoot": "Hallo! Du spielst gegen Professor Uhu. Er spielt sehr klug. Viel Spass!",
    // The one pre-game idea.
    "idea.center": "Stell einen Bauern in die Mitte.",
    "idea.develop": "Hol früh deine Pferde und Läufer heraus.",
    "idea.castle": "Mach früh die Rochade. Dann ist dein König sicher.",
    "idea.queen-late": "Lass die Dame zuerst zu Hause. Sonst wird sie gejagt.",
    "idea.look-captures": "Schau vor jedem Zug: Kann jemand eine Figur fressen?",
    "idea.protect": "Pass mit einer Figur auf die andere auf.",
    "idea.knight-rim": "Ein Pferd in der Mitte springt weiter.",
    "idea.trade-up": "Tausche nur, wenn du die grössere Figur bekommst.",
    // Nudges: the piece in danger × risk type (the board highlights it and its attacker).
    "nudge.p": "Pass auf! Dein Bauer kann gefressen werden.",
    "nudge.n": "Pass auf! Dein Pferd kann gefressen werden.",
    "nudge.b": "Pass auf! Dein Läufer kann gefressen werden.",
    "nudge.r": "Pass auf! Dein Turm kann gefressen werden.",
    "nudge.q": "Pass auf! Deine Dame kann gefressen werden.",
    "nudge.mate": "Pass auf! Dein König kommt in grosse Gefahr.",
    "nudge.other": "Halt! Es gibt einen besseren Zug.",
    // After the child's choice.
    "choice.keep": "Gut, du spielst deinen Zug.",
    "choice.better": "Schau: Diese Figur kann auf das grüne Feld.",
    // Recap: one strength + one next idea.
    "recap.win": "Du hast gewonnen! Super!",
    "recap.safe": "Du hast gut auf deine Figuren aufgepasst.",
    "recap.captures": "Du hast Figuren gefressen. Gut gesehen!",
    "recap.finished": "Du hast fertig gespielt. Toll!",
    "next.safe-square": "Schau vor jedem Zug: Ist das Feld sicher?",
    "next.idea": "Übe weiter die Idee von heute.",
    "next.develop": "Hol am Anfang neue Figuren heraus.",
  });

  const ChessLinesDE = Object.freeze({ LINES });

  if (typeof module !== "undefined" && module.exports) module.exports = ChessLinesDE;
  if (typeof root !== "undefined") root.ChessLinesDE = ChessLinesDE;
})(typeof globalThis !== "undefined" ? globalThis : this);
