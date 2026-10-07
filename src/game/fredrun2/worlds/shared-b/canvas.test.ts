import { afterEach, describe, expect, it, vi } from "vitest";
import { touchCanvas } from "./canvas";
import { installTouchStub } from "./test-kit";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeCanvas(w = 64, h = 32): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

describe("touchCanvas (Rastern erzwingen)", () => {
  it("zeichnet einen 1×1-Ausschnitt der Quelle in die Berührungsfläche und gibt sie danach wieder frei", () => {
    const rec = installTouchStub();
    const c = fakeCanvas();
    touchCanvas(c);
    expect(rec.touched).toEqual([c]);
    expect(rec.lastArgs).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    expect(rec.clears).toBe(1); // sonst hielte die Berührungsfläche die Quell-Bitmap fest
  });

  it("die Berührungsfläche wird einmal angelegt und wiederverwendet", () => {
    const rec = installTouchStub();
    touchCanvas(fakeCanvas());
    touchCanvas(fakeCanvas());
    touchCanvas(fakeCanvas());
    expect(rec.sinks).toBe(1);
    expect(rec.touched).toHaveLength(3);
  });

  it("ohne OffscreenCanvas (alte Browser, Vitest ohne DOM) passiert nichts – kein Fehler", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(() => touchCanvas(fakeCanvas())).not.toThrow();
  });

  it("eine nicht lesbare Quelle (Fehler beim Zeichnen) wird verschluckt", () => {
    installTouchStub({ throws: true });
    expect(() => touchCanvas(fakeCanvas())).not.toThrow();
  });

  it("leere Flächen (0 px) werden nicht berührt", () => {
    const rec = installTouchStub();
    touchCanvas(fakeCanvas(0, 10));
    touchCanvas(fakeCanvas(10, 0));
    expect(rec.touched).toHaveLength(0);
  });
});
