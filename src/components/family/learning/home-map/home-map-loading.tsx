"use client";

// Step 2 B: what a child sees while the map loads — their own avatar and one short line, never a blank sea. Tiny and free of
// Phaser, so it shows at once (also while the map's code is still downloading).
import type { ChildId } from "@/lib/family-assistant-turn";

const LINE: Record<ChildId, string> = { santiago: "Deine Insel lädt …", isabel: "Dein Garten lädt …" };

export function HomeMapLoading({ child }: { child: ChildId }) {
  return (
    <div className="absolute inset-0 z-[5] grid place-items-center" style={{ background: "linear-gradient(180deg, #7fd8e6 0%, #3fc1d4 100%)" }} role="status" aria-live="polite" data-testid="home-map-loading-card">
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-white/85 px-8 py-6 shadow-lg">
        {/* Frame 0 of the avatar sheet (the standing pose), shown at half size like on the map. */}
        <div
          aria-hidden
          className="animate-bounce"
          style={{ width: 96, height: 128, backgroundImage: `url(/family/home-map/${child}-avatar.png)`, backgroundSize: "384px 512px", backgroundPosition: "0 0", backgroundRepeat: "no-repeat", animationDuration: "1.4s" }}
          data-testid="home-map-loading-avatar"
        />
        <p className="text-xl font-bold" style={{ color: "#4a3520" }} data-testid="home-map-loading-text">
          {LINE[child]}
        </p>
      </div>
    </div>
  );
}
