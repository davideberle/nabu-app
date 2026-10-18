import identities from "@/data/family-assistant-identities.json";
import type { AssistantChildId } from "@/data/family-assistant";

/** Approved artwork, without image processing. The square fits wholly inside
 * the circle (1 / sqrt(2)), preserving the hat, staff, sword and shoulders.
 * Profile controls deliberately keep their separate child glyphs. */
export function AssistantPortrait({ child, className = "h-10 w-10", label }: {
  child: AssistantChildId;
  className?: string;
  /** Empty when a neighboring name already labels the control. */
  label?: string;
}) {
  const identity = identities[child];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ backgroundColor: identity.background }}
      data-assistant-child={child}
    >
      {/* Native img serves the exact approved bytes at every viewport. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={identity.image} alt={label ?? `${identity.name}, assistant`} width={1024} height={1024}
        className="h-[70.71%] w-[70.71%] object-contain" draggable={false} />
    </span>
  );
}
