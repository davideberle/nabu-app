// Browser-test safety boundary for Family Assistant UI verification.
//
// This module is deliberately test-only infrastructure. Production clients do
// not import it, so the children's normal speech behavior is unchanged.

export const FAMILY_TTS_ROUTE = /\/api\/family\/assistant\/tts(?:\?.*)?$/;

export const BROWSER_AUDIO_GUARD_SCRIPT = String.raw`(() => {
  const resolved = () => Promise.resolve();
  const noOp = () => undefined;

  // Browser speech is the final fallback used by the child UI. Block it first.
  if (globalThis.speechSynthesis) {
    try {
      Object.defineProperty(globalThis.speechSynthesis, "speak", {
        configurable: false,
        writable: false,
        value: noOp,
      });
      globalThis.speechSynthesis.cancel?.();
    } catch {
      try { globalThis.speechSynthesis.speak = noOp; } catch {}
    }
  }

  // Prevent both explicit media playback and Audio-constructor playback.
  const mediaPrototype = globalThis.HTMLMediaElement?.prototype;
  if (mediaPrototype) {
    try {
      Object.defineProperty(mediaPrototype, "play", {
        configurable: false,
        writable: false,
        value: resolved,
      });
    } catch {
      try { mediaPrototype.play = resolved; } catch {}
    }
  }

  const NativeAudio = globalThis.Audio;
  if (typeof NativeAudio === "function") {
    const MutedAudio = new Proxy(NativeAudio, {
      construct(Target, args, NewTarget) {
        const element = Reflect.construct(Target, args, NewTarget);
        try { element.autoplay = false; } catch {}
        try { element.muted = true; } catch {}
        try { element.volume = 0; } catch {}
        return element;
      },
    });
    try { Object.defineProperty(globalThis, "Audio", { configurable: false, value: MutedAudio }); } catch {}
  }

  // A newly-created AudioContext can start in the running state. Suspend each
  // one immediately, make resume a no-op, and neutralize scheduled sources.
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const NativeContext = globalThis[name];
    if (typeof NativeContext !== "function") continue;
    try {
      Object.defineProperty(NativeContext.prototype, "resume", {
        configurable: false,
        writable: false,
        value: resolved,
      });
    } catch {
      try { NativeContext.prototype.resume = resolved; } catch {}
    }
    const MutedContext = new Proxy(NativeContext, {
      construct(Target, args, NewTarget) {
        const context = Reflect.construct(Target, args, NewTarget);
        try { context.suspend?.(); } catch {}
        return context;
      },
    });
    try { Object.defineProperty(globalThis, name, { configurable: false, value: MutedContext }); } catch {}
  }

  for (const name of ["AudioScheduledSourceNode", "OscillatorNode", "AudioBufferSourceNode", "ConstantSourceNode"]) {
    const prototype = globalThis[name]?.prototype;
    if (!prototype) continue;
    try {
      Object.defineProperty(prototype, "start", {
        configurable: false,
        writable: false,
        value: noOp,
      });
    } catch {
      try { prototype.start = noOp; } catch {}
    }
  }
})();`;

/**
 * Preserve caller-owned launch options while making mute-audio mandatory.
 * @template {Record<string, unknown>} T
 * @param {T & { args?: string[] }} [options]
 * @returns {T & { args: string[] }}
 */
export function audioSafeChromiumLaunchOptions(options = /** @type {T} */ ({})) {
  const args = [...(options.args ?? [])];
  if (!args.includes("--mute-audio")) args.push("--mute-audio");
  return { ...options, args };
}

export async function installBrowserAudioGuard(context) {
  // addInitScript applies to every page/frame before any page-owned script.
  await context.addInitScript({ content: BROWSER_AUDIO_GUARD_SCRIPT });
  await context.route(FAMILY_TTS_ROUTE, (route) => route.abort("blockedbyclient"));
}
