Painted plates for the Visit 5 island. Drop PNGs named by plate id (backdrop.png, workshop.png, keeper.png, …; see
src/components/family/learning/harbor-island-plates.ts for the ids and anchor boxes), then run `node scripts/island-plates.mjs`,
which regenerates src/data/family-learning/island-plates.json (ids + sha256, evidence) and the static-import module
src/components/family/learning/harbor-island-plate-assets.ts. Plates are BUILD-TIME static assets (served from /_next/static with a
content hash, outside the auth middleware — the same locally under `next start` as on Vercel); they are deliberately NOT under
public/, where the local auth gate redirects a child session away from them (continuation 2026-10-11).
Transparent background, no text, no live state (no crates, boats, flags, badges). The asset request with sizes and anchors is
learning/visit5-2026-10-10/candidate/ART-ASSET-REQUEST.md in the family-assistant Vault folder.
