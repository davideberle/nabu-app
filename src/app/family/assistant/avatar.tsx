"use client";

import type { AssistantTint, AvatarColors } from "@/data/family-assistant";

export type AvatarState =
  | "ready"
  | "listening"
  | "confirming"
  | "thinking"
  | "showing"
  | "speaking";

const TINTS: Record<AssistantTint, AvatarColors> = {
  amber: {
    from: "#fcd34d",
    to: "#f97316",
    ring: "#f59e0b",
    face: "#431407",
    badge: "#b45309",
  },
  emerald: {
    from: "#6ee7b7",
    to: "#059669",
    ring: "#10b981",
    face: "#022c22",
    badge: "#047857",
  },
};

const AVATAR_CSS = `
.fa-avatar .fa-body {
  transform-origin: 100px 100px;
  transition: transform 0.35s ease;
}
.fa-avatar .fa-eyes,
.fa-avatar .fa-mouth {
  transition: transform 0.3s ease;
}
.fa-avatar .fa-eye,
.fa-avatar .fa-ring,
.fa-avatar .fa-dot,
.fa-avatar .fa-bar {
  transform-box: fill-box;
  transform-origin: center;
}
.fa-state-ready .fa-body {
  animation: fa-bob 3.4s ease-in-out infinite;
}
.fa-state-ready .fa-eye {
  animation: fa-blink 4.6s ease-in-out infinite;
}
.fa-state-listening .fa-body {
  animation: fa-bob 1.6s ease-in-out infinite;
}
.fa-state-confirming .fa-body {
  transform: rotate(-6deg);
}
.fa-state-thinking .fa-body {
  transform: translateY(3px);
}
.fa-ring-a { animation: fa-ring 1.6s ease-out infinite; }
.fa-ring-b { animation: fa-ring 1.6s ease-out 0.5s infinite; }
.fa-dot-1 { animation: fa-dot 1.2s ease-in-out infinite; }
.fa-dot-2 { animation: fa-dot 1.2s ease-in-out 0.18s infinite; }
.fa-dot-3 { animation: fa-dot 1.2s ease-in-out 0.36s infinite; }
.fa-bar-1 { animation: fa-bar 0.7s ease-in-out infinite; }
.fa-bar-2 { animation: fa-bar 0.7s ease-in-out 0.15s infinite; }
.fa-bar-3 { animation: fa-bar 0.7s ease-in-out 0.3s infinite; }
@keyframes fa-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes fa-blink {
  0%, 91%, 100% { transform: scaleY(1); }
  94% { transform: scaleY(0.12); }
}
@keyframes fa-ring {
  0% { transform: scale(0.9); opacity: 0.55; }
  80% { transform: scale(1.12); opacity: 0; }
  100% { transform: scale(1.12); opacity: 0; }
}
@keyframes fa-dot {
  0%, 100% { transform: translateY(0); opacity: 0.45; }
  50% { transform: translateY(-6px); opacity: 1; }
}
@keyframes fa-bar {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .fa-avatar *, .fa-avatar {
    animation: none !important;
    transition: none !important;
  }
}
`;

function Eyes({ state, color }: { state: AvatarState; color: string }) {
  // Eye geometry per state: wide when listening, raised when thinking,
  // shifted toward the stage when showing, uneven when confirming.
  let leftX = 72;
  let rightX = 114;
  let y = 82;
  let leftH = 26;
  let rightH = 26;
  if (state === "listening") {
    leftH = 30;
    rightH = 30;
    y = 79;
  } else if (state === "thinking") {
    y = 72;
    leftH = 20;
    rightH = 20;
  } else if (state === "showing") {
    leftX = 80;
    rightX = 122;
  } else if (state === "confirming") {
    leftH = 26;
    rightH = 15;
  }
  return (
    <g className="fa-eyes" fill={color}>
      <rect className="fa-eye" x={leftX} y={y} width="14" height={leftH} rx="7" />
      <rect
        className="fa-eye"
        x={rightX}
        y={state === "confirming" ? y + 6 : y}
        width="14"
        height={rightH}
        rx="7"
      />
    </g>
  );
}

function Mouth({ state, color }: { state: AvatarState; color: string }) {
  if (state === "speaking") {
    return (
      <g className="fa-mouth" fill={color}>
        <rect className="fa-bar fa-bar-1" x="80" y="124" width="8" height="20" rx="4" />
        <rect className="fa-bar fa-bar-2" x="96" y="118" width="8" height="30" rx="4" />
        <rect className="fa-bar fa-bar-3" x="112" y="124" width="8" height="20" rx="4" />
      </g>
    );
  }
  if (state === "listening") {
    return <circle className="fa-mouth" cx="100" cy="134" r="9" fill={color} />;
  }
  if (state === "confirming") {
    return (
      <path
        className="fa-mouth"
        d="M78 136 q 11 -9 22 0 t 22 0"
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
      />
    );
  }
  if (state === "thinking") {
    return (
      <path
        className="fa-mouth"
        d="M87 134 h 26"
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
      />
    );
  }
  // ready + showing: friendly smile
  return (
    <path
      className="fa-mouth"
      d="M76 130 Q 100 148 124 130"
      fill="none"
      stroke={color}
      strokeWidth="7"
      strokeLinecap="round"
    />
  );
}

export function AssistantAvatar({
  state,
  tint,
  crest,
  look,
  label,
  className,
}: {
  state: AvatarState;
  tint: AssistantTint;
  crest: "bolt" | "leaf";
  /** Session-only dress-up recolor; falls back to the profile tint. */
  look?: { id: string; colors: AvatarColors } | null;
  label: string;
  className?: string;
}) {
  const c = look?.colors ?? TINTS[tint];
  const gradientId = `fa-grad-${look?.id ?? tint}-${crest}`;
  return (
    <div role="img" aria-label={label} className={className}>
      <style>{AVATAR_CSS}</style>
      <svg viewBox="0 0 200 200" className={`fa-avatar fa-state-${state} h-full w-full`}>
        <defs>
          <radialGradient id={gradientId} cx="35%" cy="28%" r="85%">
            <stop offset="0%" stopColor={c.from} />
            <stop offset="100%" stopColor={c.to} />
          </radialGradient>
        </defs>

        {state === "listening" && (
          <g aria-hidden="true">
            <circle className="fa-ring fa-ring-a" cx="100" cy="100" r="80" fill="none" stroke={c.ring} strokeWidth="3" opacity="0.5" />
            <circle className="fa-ring fa-ring-b" cx="100" cy="100" r="92" fill="none" stroke={c.ring} strokeWidth="2" opacity="0.3" />
          </g>
        )}

        {state === "thinking" && (
          <g fill={c.badge} aria-hidden="true">
            <circle className="fa-dot fa-dot-1" cx="140" cy="34" r="5" />
            <circle className="fa-dot fa-dot-2" cx="158" cy="24" r="7" />
            <circle className="fa-dot fa-dot-3" cx="177" cy="14" r="5" />
          </g>
        )}

        <g className="fa-body">
          {crest === "bolt" ? (
            <rect
              x="35"
              y="35"
              width="130"
              height="130"
              rx="42"
              transform="rotate(45 100 100)"
              fill={`url(#${gradientId})`}
            />
          ) : (
            <circle cx="100" cy="102" r="69" fill={`url(#${gradientId})`} />
          )}

          {/* chest mark — the child-specific crest */}
          {crest === "bolt" ? (
            <polygon
              points="103,150 94,166 100,166 96,180 110,161 103,161 108,150"
              fill={c.badge}
              opacity="0.85"
            />
          ) : (
            <path
              d="M100 152 q 12 6 2 22 q -16 -4 -2 -22"
              fill={c.badge}
              opacity="0.85"
            />
          )}

          <Eyes state={state} color={c.face} />
          <Mouth state={state} color={c.face} />
        </g>

        {state === "confirming" && (
          <g aria-hidden="true">
            <circle cx="160" cy="42" r="16" fill={c.badge} />
            <text
              x="160"
              y="49"
              textAnchor="middle"
              fontSize="21"
              fontWeight="700"
              fill="#ffffff"
            >
              ?
            </text>
          </g>
        )}

        {state === "speaking" && (
          <g fill="none" stroke={c.badge} strokeWidth="5" strokeLinecap="round" aria-hidden="true">
            <path d="M168 86 a 16 16 0 0 1 0 28" />
            <path d="M178 76 a 30 30 0 0 1 0 48" opacity="0.5" />
          </g>
        )}
      </svg>
    </div>
  );
}
