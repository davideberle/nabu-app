# Approved assistant presentation

Family Assistant owns `projects/family-assistant/assets/avatars/identities.json` and the two approved original WebP files. The app's `src/data/family-assistant-identities.json` and `public/family-assistant/avatars/` are byte-identical deployment projections. Approval: David, October 18, 2026.

- `santiago` / Santiago → assistant **Nokt**.
- `isabel` / Isabel → assistant **Old Lila**.

Child IDs, profile names/glyphs, storage keys and records are unchanged. `AssistantPortrait` is separate from the child profile glyph. Its inscribed square preserves the entire artwork inside a circular frame, including hat/staff/sword/shoulders. It uses the original bytes without generated or optimized derivatives. Accessible names come from the current child selection; adjacent visible names use decorative images.

The Family rail, Home launcher, Learning launcher/panel and unprepared-learning view use the same identity projection. Existing switching navigates to the selected child's Home, unmounting the prior surface; this behavior remains unchanged. Message attribution and provenance labels remain untouched (there was no message portrait to replace). No avatar settings were added.

AI remains retired. This is not provider activation, a memory import, or stronger sibling authentication. Tutor provenance, learning content/state, wallet/timing, playback and APIs are unchanged. Only the two exact static asset paths were added to the child-account route allowlist.

Verify the approved IDs/names and immutable image hashes with `node --test src/lib/family-assistant-identity.test.ts`. Retain retirement, child-shell, access, Visit 6, audio-guard and tutor tests, TypeScript, production build, and silent browser checks for both children at phone/tablet/desktop sizes before release. The domain's dated release receipt owns deployment and screenshots.
