// Merging accepted complements into a planned day's component list.
//
// Pure and dependency-free so the planner's "Add these 3" path can be tested
// without React. The regression this module exists for: the picker used to call
// a single-item accept handler once per recommendation, so every call read the
// same stale plan and only the last recommendation survived — the other two
// were silently dropped, and three overlapping saves raced each other.
//
// Accepting components is therefore expressed as one merge over the whole
// batch: existing components keep their order and identity, and the batch is
// appended once, de-duplicated deterministically.

/** A component reference as stored on a plan day (`meal.sides[]`). */
export type PlanComponentRef = { id: string; name: string };

export type ComponentMergeResult = {
  /** Existing components first, in their original order, then the new ones. */
  components: PlanComponentRef[];
  /** Only the components this merge actually added, in acceptance order. */
  added: PlanComponentRef[];
  /** False when the merge is a no-op — the caller should skip the save. */
  changed: boolean;
};

/** Ids are compared on their trimmed value; blank ids are not addressable. */
function normalizeId(id: unknown): string {
  return typeof id === "string" ? id.trim() : "";
}

/**
 * Merge newly accepted components into the ones already saved on a day.
 *
 * Deterministic by construction:
 * - existing components keep their saved order, and a duplicated id in the
 *   saved list collapses to its first occurrence,
 * - accepted components are appended in the order they were offered,
 * - an accepted id that already exists — or repeats within the batch — is
 *   kept only once, at its earliest position.
 */
export function mergeMealComponents(
  existing: readonly PlanComponentRef[] | null | undefined,
  additions: readonly PlanComponentRef[] | null | undefined
): ComponentMergeResult {
  const seen = new Set<string>();
  const components: PlanComponentRef[] = [];

  for (const component of existing ?? []) {
    const id = normalizeId(component?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    components.push({ id, name: component.name });
  }

  const added: PlanComponentRef[] = [];
  for (const component of additions ?? []) {
    const id = normalizeId(component?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry = { id, name: component.name };
    components.push(entry);
    added.push(entry);
  }

  return { components, added, changed: added.length > 0 };
}
