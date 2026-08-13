import { familyAssistantManifest } from "@/lib/family-assistant-manifest";

/**
 * GET /family/assistant/manifest.webmanifest
 *
 * The Family Assistant's own web-app manifest, so the route installs from
 * Safari's share sheet as a dedicated iPad Home Screen app. Next's `manifest.*`
 * file convention only exists at the app root — and the root manifest is the
 * Family Board's, which must not change — so this surface serves its own.
 *
 * Public on purpose (the middleware matcher excludes this exact path): Safari
 * fetches manifests without credentials, and the body is static install
 * metadata with nothing user- or child-specific in it.
 */
export function GET() {
  return new Response(JSON.stringify(familyAssistantManifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json",
      // Static metadata; a day of caching keeps installs snappy without
      // pinning an old manifest forever.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
