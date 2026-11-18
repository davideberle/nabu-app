// ---------------------------------------------------------------------------
// Nov 18, 2026 (item 16): when a child starts a Game Studio game on the Mac
// mini, unmute it at the Studio volume (40 %, set by the bridge; visits and
// Nokt stay at 70 %). Every game started through the Studio play flow counts,
// chess included (it runs on the same Studio lease).
//
// Fire-and-forget: the call goes through the learning client's existing
// device-audio path (same learning credential, same app route, same bridge
// route and rate limit, body `{ reason: "studio-start" }` only). It never
// awaits, never throws, and its outcome never reaches the game start.
// ---------------------------------------------------------------------------

import type { ChildId } from "./family-assistant-turn.ts";
import type { DeviceAudioReason } from "./family-learning-client.ts";

export const STUDIO_START_AUDIO_REASON: DeviceAudioReason = "studio-start";

type DeviceAudioSender = { deviceAudio: (childId: ChildId, reason: DeviceAudioReason) => Promise<unknown> };

/** Ask the bridge to unmute at the Studio volume. Returns at once; a failure (sync or async) is swallowed. */
export function fireStudioStartAudio(client: DeviceAudioSender, child: ChildId): void {
  try {
    void Promise.resolve(client.deviceAudio(child, STUDIO_START_AUDIO_REASON)).catch(() => undefined);
  } catch {
    // A volume call must never block or break the game start.
  }
}
