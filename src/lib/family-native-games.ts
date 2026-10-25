// ---------------------------------------------------------------------------
// Native Mac games in the Family Games library (October 25, 2026).
//
// Game Studio owns the registry (its child adapter marks a library card
// `launch: "native"`, `platform: "macos"`) and the launch ticket. This module
// only decides, in the browser, whether THIS device may offer the launch: a
// desktop Mac. iPadOS Safari reports a Macintosh user agent, so touch points
// tell an iPad from a Mac; phones, Windows and Android never qualify. A device
// that does not qualify shows where the game plays instead of a Play button
// and never acquires a lease for it.
//
// The launch itself is a user-initiated navigation to the URL the adapter
// returns; macOS hands it to the app on the device that was clicked, never to
// another computer. Browser-only, no secrets.
// ---------------------------------------------------------------------------

/** Native games this app renders as a Mac launcher instead of a web frame (mirrors Game Studio's registry). */
export const NATIVE_MAC_GAMES: Readonly<Record<string, { title: string }>> = Object.freeze({ "deimos-rising": Object.freeze({ title: "Deimos Rising" }) });

export function isNativeMacGame(gameId: string): boolean {
  return Object.hasOwn(NATIVE_MAC_GAMES, gameId);
}

export type NativeSupport = { supported: boolean; reason: "mac" | "touch-device" | "not-a-mac" };

export function nativeLaunchSupport(device: { userAgent: string; maxTouchPoints: number }): NativeSupport {
  const ua = device.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return { supported: false, reason: "touch-device" };
  if (!/Macintosh|Mac OS X/.test(ua)) return { supported: false, reason: "not-a-mac" };
  // iPadOS desktop-class Safari: a Macintosh user agent with a touch screen.
  if (typeof device.maxTouchPoints === "number" && device.maxTouchPoints > 1) return { supported: false, reason: "touch-device" };
  return { supported: true, reason: "mac" };
}

/** The current browser's support (false during server rendering). */
export function currentNativeSupport(): NativeSupport {
  if (typeof navigator === "undefined") return { supported: false, reason: "not-a-mac" };
  return nativeLaunchSupport({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 });
}

/** Only the exact launch URL shape Game Studio issues is ever navigated to. */
export function isLaunchUrl(value: unknown): value is string {
  return typeof value === "string" && /^deimos-rising-studio:\/\/play\?ticket=[A-Za-z0-9_-]{43}$/.test(value);
}
