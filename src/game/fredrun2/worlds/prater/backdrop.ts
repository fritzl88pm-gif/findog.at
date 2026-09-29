/**
 * Prater – vorgerenderte Kulissen-Kacheln (einmal beim Laden) + dynamische Großobjekte (Riesenrad, Praterturm,
 * Achterbahnzug). Alle Kacheln sind horizontal nahtlos (periodische Platzierung via wrapDraw).
 */
import { colorWithAlpha, paint, rr, wrapDraw, type Ctx2D } from "../shared-b/canvas";
import { mulberry } from "../shared-b/color";

export const BULB_COLORS = ["#fff1c2", "#ffd36b", "#ff5fa8", "#6ff3ff", "#ffe08a", "#ff8a5c", "#b98cff"];

/** Leuchtende Glühbirne in eine Lichtkachel malen (vorgerendert: shadowBlur ist hier erlaubt). */
export function bulb(g: Ctx2D, x: number, y: number, r: number, color: string, halo = 3.2): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r * halo);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.22, colorWithAlpha(color, 0.9));
  grd.addColorStop(0.5, colorWithAlpha(color, 0.22));
  grd.addColorStop(1, colorWithAlpha(color, 0));
  g.fillStyle = grd;
  g.fillRect(x - r * halo, y - r * halo, r * halo * 2, r * halo * 2);
}

// ------------------------------------------------------------------------------------------------
// Ferne Skyline (Wien am Horizont + Praterauen)

export function farSkyline(W: number, H: number): { day: HTMLCanvasElement; lights: HTMLCanvasElement } {
  const rnd = mulberry(4711);
  const blocks: Array<{ x: number; w: number; h: number; c: string }> = [];
  for (let i = 0; i < 60; i += 1) {
    const w = 18 + rnd() * 46;
    blocks.push({ x: rnd() * W, w, h: 26 + rnd() * rnd() * 110, c: rnd() < 0.5 ? "#a497c9" : "#9d8fc2" });
  }
  const landmarks = (g: Ctx2D, lights: boolean): void => {
    // Stephansdom
    wrapDraw(W, 420, 120, (x) => {
      if (lights) {
        bulb(g, x + 62, H - 222, 1.6, "#ffd6a0", 3);
        return;
      }
      g.fillStyle = "#978ac0";
      g.beginPath();
      g.moveTo(x, H - 40);
      g.lineTo(x + 8, H - 98);
      g.lineTo(x + 104, H - 98);
      g.lineTo(x + 112, H - 40);
      g.fill();
      // Dachmuster-Andeutung
      g.fillStyle = "#8c7fb7";
      g.beginPath();
      g.moveTo(x + 8, H - 98);
      g.lineTo(x + 56, H - 132);
      g.lineTo(x + 104, H - 98);
      g.fill();
      // Südturm
      g.fillStyle = "#978ac0";
      g.beginPath();
      g.moveTo(x + 50, H - 98);
      g.lineTo(x + 56, H - 170);
      g.lineTo(x + 62, H - 232);
      g.lineTo(x + 68, H - 170);
      g.lineTo(x + 74, H - 98);
      g.fill();
      for (let k = 0; k < 6; k += 1) {
        const yy = H - 120 - k * 18;
        g.fillRect(x + 56 - (5 - k) * 0.6, yy, 12 + (5 - k) * 1.2, 2);
      }
    });
    // Donauturm
    wrapDraw(W, 980, 60, (x) => {
      if (lights) {
        bulb(g, x + 20, H - 262, 2.2, "#ff5a5a", 3);
        bulb(g, x + 14, H - 214, 1.4, "#ffe7b0", 3);
        bulb(g, x + 26, H - 214, 1.4, "#ffe7b0", 3);
        return;
      }
      g.fillStyle = "#958ac0";
      g.fillRect(x + 17, H - 250, 6, 210);
      g.beginPath();
      g.ellipse(x + 20, H - 214, 16, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 12, H - 226, 16, 10);
      g.fillRect(x + 19, H - 268, 2, 20);
    });
    // DC Tower
    wrapDraw(W, 1340, 60, (x) => {
      if (lights) {
        bulb(g, x + 18, H - 252, 2, "#ff5a5a", 3);
        return;
      }
      g.fillStyle = "#a093c6";
      g.beginPath();
      g.moveTo(x, H - 40);
      g.lineTo(x, H - 236);
      g.lineTo(x + 36, H - 248);
      g.lineTo(x + 38, H - 40);
      g.fill();
      g.fillStyle = "rgba(255,230,200,0.10)";
      for (let k = 0; k < 20; k += 1) g.fillRect(x + 2, H - 60 - k * 9, 34, 1);
      // UNO-City
      g.fillStyle = "#998cc2";
      g.beginPath();
      g.ellipse(x + 110, H - 60, 30, 110, -0.1, Math.PI, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(x + 158, H - 60, 26, 92, 0.12, Math.PI, Math.PI * 2);
      g.fill();
    });
    // Millennium Tower
    wrapDraw(W, 1760, 50, (x) => {
      if (lights) {
        bulb(g, x + 14, H - 236, 2, "#ff5a5a", 3);
        return;
      }
      g.fillStyle = "#a396c8";
      rr(g, x, H - 214, 28, 176, 12);
      g.fill();
      g.fillRect(x + 13, H - 236, 2, 24);
    });
  };

  const day = paint(W, H, (g) => {
    for (const b of blocks) {
      wrapDraw(W, b.x, b.w, (x) => {
        g.fillStyle = b.c;
        g.fillRect(x, H - 40 - b.h, b.w, b.h + 40);
        g.fillStyle = "rgba(255,225,190,0.12)";
        g.fillRect(x + b.w - 4, H - 40 - b.h, 4, b.h + 40);
      });
    }
    landmarks(g, false);
    // Praterauen: Baumkronen-Band
    g.fillStyle = "#8579ad";
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const y = H - 44 - 10 * Math.sin((x / W) * Math.PI * 2 * 9) - 7 * Math.sin((x / W) * Math.PI * 2 * 23 + 1) - 4 * Math.sin((x / W) * Math.PI * 2 * 61);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  });

  const lights = paint(W, H, (g) => {
    const r2 = mulberry(99);
    for (const b of blocks) {
      const n = Math.floor((b.w * b.h) / 260);
      for (let i = 0; i < n; i += 1) {
        if (r2() > 0.45) continue;
        const wx = b.x + 3 + r2() * (b.w - 6);
        const wy = H - 44 - r2() * b.h;
        wrapDraw(W, wx, 3, (x) => {
          g.fillStyle = r2() < 0.8 ? "rgba(255,214,150,0.85)" : "rgba(190,220,255,0.8)";
          g.fillRect(x, wy, 2, 2);
        });
      }
    }
    landmarks(g, true);
  });
  return { day, lights };
}

// ------------------------------------------------------------------------------------------------
// Riesenrad (rotierende Struktur) + Sockel

export interface WheelSprites {
  R: number;
  size: number;
  wheel: HTMLCanvasElement;
  wheelNight: HTMLCanvasElement;
  wheelLights: HTMLCanvasElement;
  base: HTMLCanvasElement;
  baseLights: HTMLCanvasElement;
  baseW: number;
  baseH: number;
}

export function wheelSprites(R: number): WheelSprites {
  const size = Math.ceil(R * 2 + 30);
  const c = size / 2;
  const structure = (g: Ctx2D, col: string, hi: string): void => {
    g.translate(c, c);
    g.lineCap = "round";
    // Speichen (Seile) – paarweise gekreuzt
    g.strokeStyle = col;
    g.lineWidth = 1.3;
    const n = 60;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const b = a + 0.22;
      g.beginPath();
      g.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
      g.lineTo(Math.cos(b) * (R - 10), Math.sin(b) * (R - 10));
      g.stroke();
    }
    // Innenring
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(0, 0, R * 0.34, 0, Math.PI * 2);
    g.stroke();
    // Felge doppelt + Fachwerk
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, R - 16, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1.4;
    g.beginPath();
    const m = 120;
    for (let i = 0; i < m; i += 1) {
      const a = (i / m) * Math.PI * 2;
      const r1 = i % 2 === 0 ? R : R - 16;
      const r2 = i % 2 === 0 ? R - 16 : R;
      const a2 = ((i + 1) / m) * Math.PI * 2;
      g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
    }
    g.stroke();
    // Nabe
    g.fillStyle = col;
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = hi;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 11, 0, Math.PI * 2);
    g.stroke();
  };
  const wheel = paint(size, size, (g) => structure(g, "#4a3a63", "#f3c98a"));
  const wheelNight = paint(size, size, (g) => structure(g, "#1a1233", "#3a2d5a"));
  const wheelLights = paint(size, size, (g) => {
    g.translate(c, c);
    const n = 72;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      bulb(g, Math.cos(a) * R, Math.sin(a) * R, 1.7, i % 6 === 0 ? "#ff6fb5" : "#fff0c8", 3.4);
    }
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      for (let k = 1; k <= 6; k += 1) {
        const rr2 = 22 + (k / 6) * (R - 34);
        bulb(g, Math.cos(a) * rr2, Math.sin(a) * rr2, 1.3, "#ffe3a8", 3);
      }
    }
    bulb(g, 0, 0, 5, "#ffd27a", 3);
  });

  // Sockel: A-Stützen + Eingangshalle
  const baseW = Math.ceil(R * 1.7 + 60);
  const baseH = Math.ceil(R + 150);
  const hubX = baseW / 2;
  const hubY = 14;
  const drawBase = (g: Ctx2D, lights: boolean): void => {
    if (lights) {
      for (let i = 0; i < 9; i += 1) bulb(g, hubX - 120 + i * 30, baseH - 64, 2.2, "#ffd27a", 3.4);
      for (let i = 0; i < 4; i += 1) {
        g.fillStyle = "rgba(255,210,140,0.75)";
        g.fillRect(hubX - 96 + i * 52, baseH - 44, 22, 20);
      }
      return;
    }
    g.strokeStyle = "#433458";
    g.lineCap = "round";
    const feet = [-R * 0.78, -R * 0.52, R * 0.52, R * 0.78];
    for (const f of feet) {
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(hubX, hubY);
      g.lineTo(hubX + f, baseH - 40);
      g.stroke();
    }
    g.lineWidth = 2;
    for (let k = 1; k < 7; k += 1) {
      const t = k / 7;
      const y = hubY + (baseH - 40 - hubY) * t;
      g.beginPath();
      g.moveTo(hubX - R * 0.78 * t, y);
      g.lineTo(hubX - R * 0.52 * t, y + 18);
      g.moveTo(hubX + R * 0.78 * t, y);
      g.lineTo(hubX + R * 0.52 * t, y + 18);
      g.stroke();
    }
    // Eingangshalle
    g.fillStyle = "#6b4f6e";
    g.fillRect(hubX - 140, baseH - 60, 280, 60);
    g.fillStyle = "#8a3c4e";
    g.beginPath();
    g.moveTo(hubX - 152, baseH - 58);
    g.lineTo(hubX, baseH - 92);
    g.lineTo(hubX + 152, baseH - 58);
    g.closePath();
    g.fill();
    g.fillStyle = "#3a2940";
    for (let i = 0; i < 4; i += 1) g.fillRect(hubX - 96 + i * 52, baseH - 44, 22, 20);
    g.fillStyle = "rgba(255,220,170,0.25)";
    g.fillRect(hubX - 140, baseH - 60, 280, 3);
  };
  const base = paint(baseW, baseH, (g) => drawBase(g, false));
  const baseLights = paint(baseW, baseH, (g) => drawBase(g, true));
  return { R, size, wheel, wheelNight, wheelLights, base, baseLights, baseW, baseH };
}

// ------------------------------------------------------------------------------------------------
// Achterbahn (Hochschaubahn): Streckenprofil + Gitterstützen

export function coasterTrackY(u: number, W: number, H: number): number {
  const a = (u / W) * Math.PI * 2;
  const hill = Math.max(0, Math.sin(a * 3 + 0.5));
  const hills = 150 * Math.pow(hill, 1.3) + 46 * (0.5 + 0.5 * Math.sin(a * 7 + 1.2)) + 22 * Math.sin(a * 11 + 0.3);
  return H - 96 - hills;
}

export function coasterTiles(W: number, H: number): { day: HTMLCanvasElement; lights: HTMLCanvasElement; lights2: HTMLCanvasElement } {
  const post = 30;
  const drawStruct = (g: Ctx2D): void => {
    // hintere Stützen (dunkler)
    g.strokeStyle = "#c9b3c4";
    g.lineWidth = 1.3;
    g.beginPath();
    for (let x = 0; x <= W; x += post) {
      const y = coasterTrackY(x + post / 2, W, H) + 10;
      g.moveTo(x + post / 2, y);
      g.lineTo(x + post / 2, H);
    }
    g.stroke();
    // vordere Stützen + Fachwerk
    g.strokeStyle = "#efdcd6";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += post) {
      const y = coasterTrackY(x, W, H) + 6;
      g.moveTo(x, y);
      g.lineTo(x, H);
    }
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = "rgba(239,220,214,0.85)";
    g.beginPath();
    for (let x = 0; x < W; x += post) {
      const y0 = Math.max(coasterTrackY(x, W, H), coasterTrackY(x + post, W, H)) + 10;
      for (let y = y0; y < H - 10; y += 34) {
        g.moveTo(x, y);
        g.lineTo(x + post, Math.min(H, y + 34));
        g.moveTo(x + post, y);
        g.lineTo(x, Math.min(H, y + 34));
      }
    }
    g.stroke();
    // Schienen + Schwellen
    g.strokeStyle = "#f7e9e2";
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = coasterTrackY(x, W, H);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = "#b58fa4";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = coasterTrackY(x, W, H) + 7;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = "#8e6a82";
    for (let x = 0; x < W; x += 9) g.fillRect(x, coasterTrackY(x, W, H) - 1, 2, 9);
  };
  const day = paint(W, H, drawStruct);
  const mkLights = (odd: number): HTMLCanvasElement =>
    paint(W, H, (g) => {
      let i = 0;
      for (let x = 0; x < W; x += 22) {
        i += 1;
        if (i % 2 !== odd) continue;
        bulb(g, x, coasterTrackY(x, W, H) - 3, 1.8, BULB_COLORS[i % BULB_COLORS.length], 3.4);
      }
    });
  return { day, lights: mkLights(0), lights2: mkLights(1) };
}

// ------------------------------------------------------------------------------------------------
// Buden-Reihe (Zuckerwatte, Lebkuchen, Schießbude …) mit Markisen und Schildern

const BOOTHS: Array<{ name: string; a: string; b: string; wall: string }> = [
  { name: "ZUCKERWATTE", a: "#ff7fbf", b: "#fff4f8", wall: "#b85c8c" },
  { name: "LEBKUCHEN", a: "#d9483b", b: "#fff2e0", wall: "#9c4a36" },
  { name: "SCHIESSBUDE", a: "#2bb3a8", b: "#f4fffb", wall: "#2f6f78" },
  { name: "LANGOS", a: "#f2b233", b: "#fff8e6", wall: "#a8742f" },
  { name: "AUTODROM", a: "#6b5bff", b: "#f1efff", wall: "#4b3f9a" },
  { name: "GEISTERBAHN", a: "#3a2c55", b: "#9fe870", wall: "#2a2140" },
  { name: "POPCORN", a: "#e8423f", b: "#fff6d6", wall: "#9a3a3a" },
  { name: "GLÜCKSRAD", a: "#ffcc33", b: "#d23c8c", wall: "#8c4a78" },
];

export function boothTiles(W: number, H: number): { day: HTMLCanvasElement; lights: HTMLCanvasElement; lights2: HTMLCanvasElement } {
  const rnd = mulberry(2024);
  type B = { x: number; w: number; h: number; k: number; tent: boolean };
  const items: B[] = [];
  let x = 20;
  let k = 0;
  while (x < W - 120) {
    const tent = k % 4 === 3;
    const w = tent ? 250 : 150 + Math.floor(rnd() * 70);
    const h = tent ? 190 : 118 + Math.floor(rnd() * 44);
    if (x + w > W - 10) break;
    items.push({ x, w, h, k, tent });
    x += w + 26 + Math.floor(rnd() * 30);
    k += 1;
  }
  const drawDay = (g: Ctx2D): void => {
    // Hintergrund-Bäume zwischen den Buden
    g.fillStyle = "#6a5a86";
    for (let i = 0; i < 26; i += 1) {
      const tx = (i / 26) * W + 30;
      const r = 36 + ((i * 37) % 23);
      wrapDraw(W, tx, r, (xx) => {
        g.beginPath();
        g.arc(xx, H - 120 - ((i * 13) % 30), r, 0, Math.PI * 2);
        g.arc(xx + r * 0.8, H - 106 - ((i * 7) % 20), r * 0.8, 0, Math.PI * 2);
        g.fill();
      });
    }
    for (const b of items) {
      const bx = b.x;
      const top = H - b.h;
      const d = BOOTHS[b.k % BOOTHS.length];
      if (b.tent) {
        // Ringelspiel-Zelt
        g.fillStyle = "#5b3e6e";
        g.fillRect(bx + 20, top + 90, b.w - 40, b.h - 90);
        const cx = bx + b.w / 2;
        const stripes = 12;
        for (let i = 0; i < stripes; i += 1) {
          g.fillStyle = i % 2 ? "#fff1f6" : "#e2366f";
          g.beginPath();
          g.moveTo(cx, top);
          g.lineTo(bx + (i / stripes) * b.w, top + 86);
          g.lineTo(bx + ((i + 1) / stripes) * b.w, top + 86);
          g.closePath();
          g.fill();
        }
        // Volant
        for (let i = 0; i < 14; i += 1) {
          g.fillStyle = i % 2 ? "#ffd24a" : "#e2366f";
          g.beginPath();
          g.arc(bx + (i + 0.5) * (b.w / 14), top + 86, b.w / 28, 0, Math.PI);
          g.fill();
        }
        g.fillStyle = "#ffd24a";
        g.fillRect(cx - 2, top - 26, 4, 28);
        g.fillStyle = "#e2366f";
        g.beginPath();
        g.moveTo(cx + 2, top - 26);
        g.lineTo(cx + 22, top - 20);
        g.lineTo(cx + 2, top - 14);
        g.fill();
        // Pferdchen
        g.fillStyle = "#f3e6d8";
        for (let i = 0; i < 5; i += 1) {
          const hx = bx + 40 + i * ((b.w - 80) / 4);
          const hy = top + 118 + (i % 2) * 14;
          g.fillRect(hx - 1, top + 92, 2, b.h - 92);
          rr(g, hx - 16, hy, 32, 14, 6);
          g.fill();
          g.beginPath();
          g.moveTo(hx + 12, hy + 2);
          g.lineTo(hx + 20, hy - 12);
          g.lineTo(hx + 25, hy - 8);
          g.lineTo(hx + 17, hy + 6);
          g.fill();
          g.beginPath();
          g.fillRect(hx - 12, hy + 12, 3, 12);
          g.fillRect(hx + 9, hy + 12, 3, 12);
        }
        continue;
      }
      // Rückwand
      g.fillStyle = d.wall;
      g.fillRect(bx, top + 24, b.w, b.h - 24);
      // Innenraum (dunkel) + Theke
      g.fillStyle = "rgba(20,10,30,0.55)";
      g.fillRect(bx + 10, top + 58, b.w - 20, b.h - 96);
      g.fillStyle = "#e9d2b4";
      g.fillRect(bx + 4, H - 40, b.w - 8, 8);
      g.fillStyle = d.a;
      g.fillRect(bx + 4, H - 32, b.w - 8, 32);
      g.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < b.w - 8; i += 18) g.fillRect(bx + 4 + i, H - 32, 9, 32);
      // Ware im Inneren
      const r2 = mulberry(b.k * 31 + 7);
      for (let i = 0; i < 7; i += 1) {
        g.fillStyle = BULB_COLORS[(b.k + i) % BULB_COLORS.length];
        const ix = bx + 18 + r2() * (b.w - 36);
        const iy = top + 66 + r2() * (b.h - 118);
        if (d.name === "LEBKUCHEN") {
          g.fillStyle = "#8a4a23";
          heartPath(g, ix, iy, 8);
          g.fill();
          g.strokeStyle = "#fff2e0";
          g.lineWidth = 1;
          heartPath(g, ix, iy, 6);
          g.stroke();
        } else if (d.name === "ZUCKERWATTE") {
          g.fillStyle = i % 2 ? "#ffc2e0" : "#bfe6ff";
          g.beginPath();
          g.arc(ix, iy, 9, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillRect(ix, iy, 6, 8);
        }
      }
      // Markise (gestreift, gewellt)
      const aw = 30;
      const sw = 16;
      for (let i = 0; i < b.w + 8; i += sw) {
        g.fillStyle = (i / sw) % 2 < 1 ? d.a : d.b;
        g.beginPath();
        g.moveTo(bx - 4 + i, top + 28);
        g.lineTo(bx - 4 + i + sw, top + 28);
        g.lineTo(bx - 4 + i + sw, top + 28 + aw);
        g.arc(bx - 4 + i + sw / 2, top + 28 + aw, sw / 2, 0, Math.PI);
        g.closePath();
        g.fill();
      }
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(bx - 4, top + 28, b.w + 8, 4);
      // Schild
      g.fillStyle = "#2b1d3a";
      rr(g, bx + 10, top, b.w - 20, 26, 6);
      g.fill();
      g.strokeStyle = "#f3c98a";
      g.lineWidth = 2;
      g.beginPath();
      rr(g, bx + 10, top, b.w - 20, 26, 6);
      g.stroke();
      g.fillStyle = "#f7e3c0";
      g.font = "800 13px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(d.name, bx + b.w / 2, top + 14);
    }
  };
  const mkLights = (odd: number): HTMLCanvasElement =>
    paint(W, H, (g) => {
      for (const b of items) {
        const top = H - b.h;
        const d = BOOTHS[b.k % BOOTHS.length];
        if (b.tent) {
          const cx = b.x + b.w / 2;
          for (let i = 0; i <= 12; i += 1) {
            if (i % 2 !== odd) continue;
            bulb(g, b.x + (i / 12) * b.w, top + 88, 2.2, BULB_COLORS[i % BULB_COLORS.length], 3.4);
            const t = i / 12;
            bulb(g, cx + (b.x + t * b.w - cx) * 0.5, top + 43, 1.6, "#fff0c8", 3);
          }
          continue;
        }
        let i = 0;
        for (let xx = b.x; xx <= b.x + b.w; xx += 14) {
          i += 1;
          if (i % 2 !== odd) continue;
          bulb(g, xx, top + 29, 1.9, BULB_COLORS[(i + b.k) % BULB_COLORS.length], 3.2);
        }
        if (odd === 0) {
          // Schild-Neon
          g.save();
          g.font = "800 13px system-ui, sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.shadowColor = d.a;
          g.shadowBlur = 10;
          g.fillStyle = "#fff4e0";
          g.fillText(d.name, b.x + b.w / 2, top + 14);
          g.restore();
          // warmes Innenlicht
          const grd = g.createLinearGradient(0, top + 58, 0, H - 40);
          grd.addColorStop(0, "rgba(255,190,120,0.55)");
          grd.addColorStop(1, "rgba(255,140,90,0.15)");
          g.fillStyle = grd;
          g.fillRect(b.x + 10, top + 58, b.w - 20, b.h - 96);
        }
      }
    });
  return { day: paint(W, H, drawDay), lights: mkLights(0), lights2: mkLights(1) };
}

export function heartPath(g: Ctx2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.8, y - r * 1.1, x, y - r * 0.4);
  g.bezierCurveTo(x + r * 0.8, y - r * 1.1, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  g.closePath();
}

// ------------------------------------------------------------------------------------------------
// Nahe Ebene: Kandelaber-Laternen + Lichterketten-Girlanden

export function lampTiles(W: number, H: number, spacing: number, lightsH = H): { day: HTMLCanvasElement; lights: HTMLCanvasElement; lights2: HTMLCanvasElement } {
  const postTop = 120;
  const sag = 70;
  const garlandY = postTop + 40;
  const drawDay = (g: Ctx2D): void => {
    for (let x = spacing / 2; x < W + spacing; x += spacing) {
      wrapDraw(W, x, 60, (px) => {
        // Kandelaber
        g.fillStyle = "#1d2a2c";
        g.fillRect(px - 4, postTop, 8, H - postTop);
        g.fillRect(px - 9, H - 40, 18, 40);
        g.fillRect(px - 12, H - 10, 24, 10);
        g.beginPath();
        g.moveTo(px, postTop + 30);
        g.quadraticCurveTo(px - 30, postTop + 20, px - 34, postTop + 4);
        g.moveTo(px, postTop + 30);
        g.quadraticCurveTo(px + 30, postTop + 20, px + 34, postTop + 4);
        g.strokeStyle = "#1d2a2c";
        g.lineWidth = 4;
        g.stroke();
        for (const ox of [-34, 0, 34]) {
          const ly = ox === 0 ? postTop - 18 : postTop - 6;
          g.fillStyle = "#1d2a2c";
          g.fillRect(px + ox - 8, ly + 18, 16, 4);
          g.fillStyle = "#e9dcc0";
          rr(g, px + ox - 7, ly, 14, 18, 5);
          g.fill();
          g.fillStyle = "#1d2a2c";
          g.beginPath();
          g.moveTo(px + ox - 9, ly);
          g.lineTo(px + ox, ly - 8);
          g.lineTo(px + ox + 9, ly);
          g.fill();
        }
      });
    }
    // Girlanden-Draht
    g.strokeStyle = "rgba(30,24,40,0.9)";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = spacing / 2; x < W + spacing / 2; x += spacing) {
      for (let i = 0; i <= 24; i += 1) {
        const u = i / 24;
        const xx = x + u * spacing;
        const yy = garlandY + Math.sin(u * Math.PI) * sag;
        if (i === 0) g.moveTo(xx, yy);
        else g.lineTo(xx, yy);
      }
    }
    g.stroke();
    // unbeleuchtete Birnen (Glas)
    let n = 0;
    for (let x = spacing / 2; x < W + spacing / 2; x += spacing) {
      for (let i = 1; i < 16; i += 1) {
        const u = i / 16;
        const xx = (x + u * spacing) % W;
        const yy = garlandY + Math.sin(u * Math.PI) * sag + 5;
        g.fillStyle = colorWithAlpha(BULB_COLORS[n % BULB_COLORS.length], 0.75);
        g.beginPath();
        g.arc(xx, yy, 3, 0, Math.PI * 2);
        g.fill();
        n += 1;
      }
    }
  };
  const mkLights = (odd: number): HTMLCanvasElement =>
    paint(W, lightsH, (g) => {
      let n = 0;
      for (let x = spacing / 2; x < W + spacing / 2; x += spacing) {
        for (let i = 1; i < 16; i += 1) {
          const u = i / 16;
          const xx = (x + u * spacing) % W;
          const yy = garlandY + Math.sin(u * Math.PI) * sag + 5;
          if (n % 2 === odd) bulb(g, xx, yy, 2.6, BULB_COLORS[n % BULB_COLORS.length], 3.6);
          n += 1;
        }
        if (odd === 0) {
          wrapDraw(W, x, 60, (px) => {
            for (const ox of [-34, 0, 34]) {
              const ly = ox === 0 ? postTop - 18 : postTop - 6;
              bulb(g, px + ox, ly + 9, 7, "#ffe2a6", 4.2);
            }
          });
        }
      }
    });
  return { day: paint(W, H, drawDay), lights: mkLights(0), lights2: mkLights(1) };
}

// ------------------------------------------------------------------------------------------------
// Vordergrund-Girlande (oben, vor der Figur)

export function topGarland(W: number, H: number): { day: HTMLCanvasElement; lights: HTMLCanvasElement; lights2: HTMLCanvasElement } {
  const spans = [0, 420, 760, 1180, W];
  const pts = (a: number, b: number, i: number, n: number): [number, number] => {
    const u = i / n;
    return [a + (b - a) * u, 6 + Math.sin(u * Math.PI) * (H - 30) * (0.7 + ((a * 7) % 30) / 100)];
  };
  const day = paint(W, H, (g) => {
    g.strokeStyle = "rgba(25,18,30,0.95)";
    g.lineWidth = 2;
    for (let s = 0; s < spans.length - 1; s += 1) {
      g.beginPath();
      for (let i = 0; i <= 30; i += 1) {
        const [x, y] = pts(spans[s], spans[s + 1], i, 30);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    let n = 0;
    for (let s = 0; s < spans.length - 1; s += 1) {
      for (let i = 1; i < 18; i += 1) {
        const [x, y] = pts(spans[s], spans[s + 1], i, 18);
        g.fillStyle = "#2a1f2e";
        g.fillRect(x - 2, y, 4, 5);
        g.fillStyle = colorWithAlpha(BULB_COLORS[n % BULB_COLORS.length], 0.9);
        g.beginPath();
        g.ellipse(x, y + 10, 4.5, 6, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.fillRect(x - 2, y + 6, 1.5, 3);
        n += 1;
      }
    }
  });
  const mk = (odd: number): HTMLCanvasElement =>
    paint(W, H, (g) => {
      let n = 0;
      for (let s = 0; s < spans.length - 1; s += 1) {
        for (let i = 1; i < 18; i += 1) {
          const [x, y] = pts(spans[s], spans[s + 1], i, 18);
          if (n % 2 === odd) bulb(g, x, y + 10, 4, BULB_COLORS[n % BULB_COLORS.length], 3.6);
          n += 1;
        }
      }
    });
  return { day, lights: mk(0), lights2: mk(1) };
}

// ------------------------------------------------------------------------------------------------
// Boden: Promenade mit Granit-Randstein und Pflaster

export function groundTile(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    const rnd = mulberry(77);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#8a6f78");
    grd.addColorStop(0.25, "#6c5466");
    grd.addColorStop(1, "#2e2034");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // Pflaster (perspektivisch: Reihen werden nach unten größer)
    let y = 16;
    let row = 0;
    while (y < H) {
      const rh = 7 + row * 2.2;
      const cw = 16 + row * 5;
      const off = (row % 2) * cw * 0.5;
      for (let x = -cw; x < W + cw; x += cw) {
        const xx = x + off + (rnd() - 0.5) * 3;
        const shade = 0.08 + rnd() * 0.14;
        wrapDraw(W, xx, cw, (px) => {
          g.fillStyle = `rgba(255,236,220,${shade * (1 - row * 0.07)})`;
          g.beginPath();
          rr(g, px + 1.5, y + 1, cw - 3, rh - 2, Math.min(4, rh / 2));
          g.fill();
          g.fillStyle = "rgba(20,8,24,0.25)";
          g.fillRect(px + 2, y + rh - 2, cw - 4, 1.5);
        });
      }
      y += rh;
      row += 1;
    }
    // Randstein
    g.fillStyle = "#d8c2ab";
    g.fillRect(0, 0, W, 6);
    g.fillStyle = "#a88c78";
    g.fillRect(0, 6, W, 9);
    g.fillStyle = "rgba(40,20,30,0.55)";
    g.fillRect(0, 15, W, 2);
    for (let x = 0; x < W; x += 64) {
      g.fillStyle = "rgba(60,36,40,0.45)";
      g.fillRect(x, 0, 2, 15);
    }
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(0, 0, W, 1.5);
    // Konfetti-Reste auf dem Pflaster
    for (let i = 0; i < 70; i += 1) {
      const cx = rnd() * W;
      const cy = 22 + rnd() * (H - 30);
      g.fillStyle = colorWithAlpha(BULB_COLORS[i % BULB_COLORS.length], 0.55);
      g.fillRect(cx, cy, 3 + rnd() * 3, 2);
    }
  });
}

/** Innenansicht des Achterbahn-Grabens (Gitter in der Tiefe) */
export function trenchTile(W: number, H: number): HTMLCanvasElement {
  return paint(W, H, (g) => {
    g.strokeStyle = "rgba(150,110,190,0.28)";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 40) {
      g.moveTo(x, 10);
      g.lineTo(x, H);
    }
    for (let x = 0; x < W; x += 40) {
      for (let y = 10; y < H; y += 40) {
        g.moveTo(x, y);
        g.lineTo(x + 40, y + 40);
        g.moveTo(x + 40, y);
        g.lineTo(x, y + 40);
      }
    }
    g.stroke();
    // Schiene in der Tiefe
    g.strokeStyle = "rgba(220,180,230,0.45)";
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = 58 + Math.sin((x / W) * Math.PI * 4) * 16;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
}
