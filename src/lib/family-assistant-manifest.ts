// The dedicated web-app manifest for the Family Assistant iPad surface.
//
// `/family/assistant` is installable as its own Home Screen app, separate from
// the Family Board: its manifest names the Assistant and starts on the
// Assistant route. The global `/manifest.json` (Nabu Family Board,
// `start_url: /family/dashboard`) is untouched — the two installs coexist on
// the same iPad.
//
// Next.js only supports the `manifest.*` file convention at the app root, so
// this one is served by a route handler
// (`src/app/family/assistant/manifest.webmanifest/route.ts`) and advertised via
// the page's `metadata.manifest`. The object lives here, outside the route,
// so the `node --test` suite can assert it without importing Next.
//
// Deliberately **no service worker and no offline caching**: every response on
// this surface is authenticated, per-child, and `no-store`; an offline cache
// would be a place a sibling's conversation could linger.

export const FAMILY_ASSISTANT_MANIFEST_PATH = "/family/assistant/manifest.webmanifest";

/** PNG used for the iPad Home Screen icon (`apple-touch-icon`). */
export const FAMILY_ASSISTANT_APPLE_ICON = "/family-assistant-icon.png";

/** Larger PNG for the manifest icon set. */
export const FAMILY_ASSISTANT_ICON_512 = "/family-assistant-icon-512.png";

export const familyAssistantManifest = {
  name: "Family Assistant",
  short_name: "Assistant",
  description: "Santiago and Isabel's conversational companion",
  id: "/family/assistant",
  start_url: "/family/assistant",
  scope: "/",
  display: "standalone",
  background_color: "#f5f3f0",
  theme_color: "#f5f3f0",
  orientation: "any",
  icons: [
    {
      src: FAMILY_ASSISTANT_ICON_512,
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: FAMILY_ASSISTANT_APPLE_ICON,
      sizes: "180x180",
      type: "image/png",
    },
  ],
} as const;
