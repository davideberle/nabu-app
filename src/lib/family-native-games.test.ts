import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { NATIVE_MAC_GAMES, isLaunchUrl, isNativeMacGame, nativeLaunchSupport } from "./family-native-games.ts";

describe("native Mac games (October 25, 2026)", () => {
  it("offers the launch only on a desktop Mac — never an iPad (Macintosh UA + touch), phone, Android or Windows", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    deepEqual(nativeLaunchSupport({ userAgent: mac, maxTouchPoints: 0 }), { supported: true, reason: "mac" });
    deepEqual(nativeLaunchSupport({ userAgent: mac, maxTouchPoints: 5 }), { supported: false, reason: "touch-device" });
    equal(nativeLaunchSupport({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", maxTouchPoints: 5 }).supported, false);
    equal(nativeLaunchSupport({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 }).supported, false);
    equal(nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Linux; Android 15)", maxTouchPoints: 5 }).supported, false);
    deepEqual(nativeLaunchSupport({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 0 }), { supported: false, reason: "not-a-mac" });
    equal(nativeLaunchSupport({ userAgent: "", maxTouchPoints: 0 }).supported, false);
  });
  it("knows exactly one native game and navigates only to the exact launch-link shape", () => {
    deepEqual(Object.keys(NATIVE_MAC_GAMES), ["deimos-rising"]);
    equal(isNativeMacGame("deimos-rising"), true);
    equal(isNativeMacGame("6bd56478-5ea0-4f2a-a2db-be8549a88d05"), false);
    equal(isNativeMacGame("constructor"), false);
    equal(isLaunchUrl(`deimos-rising-studio://play?ticket=${"A".repeat(43)}`), true);
    equal(isLaunchUrl(`deimos-rising-studio://play?ticket=${"A".repeat(43)}&x=1`), false);
    equal(isLaunchUrl("file:///Applications/Calculator.app"), false);
    equal(isLaunchUrl("javascript:alert(1)"), false);
    equal(isLaunchUrl(`https://evil.example/?ticket=${"A".repeat(43)}`), false);
    equal(isLaunchUrl(null), false);
  });
});
