import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic, HAPTIC_PATTERNS, hapticsSupported, type HapticKind } from "./haptics";

const ON = { enabled: true, demo: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Haptik", () => {
  it("hurt vibriert genau einmal mit 35 ms und meldet true", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(haptic("hurt", ON)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(35);
  });

  it("Muster: hurt 35, stomp 15, death [70,40,110], pit 50, dash 14, powerup 10", () => {
    expect(HAPTIC_PATTERNS.hurt).toBe(35);
    expect(HAPTIC_PATTERNS.stomp).toBe(15);
    expect([...HAPTIC_PATTERNS.death]).toEqual([70, 40, 110]);
    expect(HAPTIC_PATTERNS.pit).toBe(50);
    expect(HAPTIC_PATTERNS.dash).toBe(14);
    expect(HAPTIC_PATTERNS.powerup).toBe(10);
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    for (const k of Object.keys(HAPTIC_PATTERNS) as HapticKind[]) expect(haptic(k, ON)).toBe(true);
    expect(vibrate.mock.calls).toEqual([[35], [15], [[70, 40, 110]], [50], [14], [10]]);
  });

  it("Listenmuster wird als Kopie übergeben (die Konstante bleibt unverändert)", () => {
    const seen: unknown[] = [];
    vi.stubGlobal("navigator", { vibrate: (p: unknown) => (seen.push(p), true) });
    haptic("death", ON);
    (seen[0] as number[]).push(999);
    expect([...HAPTIC_PATTERNS.death]).toEqual([70, 40, 110]);
  });

  it("enabled=false oder demo=true vibriert nie", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(haptic("hurt", { enabled: false, demo: false })).toBe(false);
    expect(haptic("death", { enabled: true, demo: true })).toBe(false);
    expect(haptic("stomp", { enabled: false, demo: true })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("fehlende API wirft nicht und liefert false", () => {
    vi.stubGlobal("navigator", {});
    expect(() => haptic("hurt", ON)).not.toThrow();
    expect(haptic("hurt", ON)).toBe(false);
    expect(hapticsSupported()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(() => haptic("death", ON)).not.toThrow();
    expect(haptic("death", ON)).toBe(false);
    expect(hapticsSupported()).toBe(false);
  });

  it("werfende API wirft nicht und liefert false", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("nicht erlaubt");
      },
    });
    expect(() => haptic("hurt", ON)).not.toThrow();
    expect(haptic("hurt", ON)).toBe(false);
  });

  it("vom Browser abgelehnte Vibration (false) wird als nicht ausgelöst gemeldet", () => {
    vi.stubGlobal("navigator", { vibrate: vi.fn(() => false) });
    expect(haptic("hurt", ON)).toBe(false);
  });

  it("hapticsSupported erkennt die API", () => {
    vi.stubGlobal("navigator", { vibrate: () => true });
    expect(hapticsSupported()).toBe(true);
  });
});
