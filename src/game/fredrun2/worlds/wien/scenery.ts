/**
 * Wien – vorgerenderte Kulissen-Kacheln: Dachlandschaft, Gründerzeit-Fassaden (Varianten intakt → Brand → Ruine),
 * Wolken, Kopfsteinpflaster mit Gleisen, Straßenmöbel-Sprites (Laterne, Platane, Litfaßsäule).
 */
import { hash, type Tile, renderTile } from "../shared-a/gfx";

// ---------------------------------------------------------------------------------------------------
// Dachlandschaft (fern)

export interface RoofOpts {
  lit: number;
  ruin: number;
}

export function paintRooftops(W: number, H: number, o: RoofOpts): Tile {
  return renderTile(W, H, 1, (g) => {
    let x = 0;
    let i = 0;
    const base = "#1d2332";
    const rim = "rgba(150,165,200,0.25)";
    while (x < W) {
      let w = 60 + hash(i * 3.3 + 1) * 110;
      if (W - (x + w) < 60) w = W - x;
      const top = 70 + hash(i * 1.9 + 2) * 90 + (o.ruin ? hash(i * 5.1) * 40 : 0);
      const kind = hash(i * 7.7 + 3);
      g.fillStyle = base;
      g.beginPath();
      g.moveTo(x, H);
      if (o.ruin > 0.5) {
        // Ruinen-Silhouette: zackige Oberkante
        const steps = Math.max(3, Math.round(w / 14));
        for (let s = 0; s <= steps; s += 1) {
          const xx = x + (w * s) / steps;
          g.lineTo(xx, top + 18 + hash(i * 13 + s * 1.7) * 38);
        }
      } else if (kind < 0.35) {
        // Satteldach
        g.lineTo(x, top + 26);
        g.lineTo(x + w * 0.5, top);
        g.lineTo(x + w, top + 26);
      } else if (kind < 0.7) {
        // Mansarde
        g.lineTo(x, top + 22);
        g.lineTo(x + 10, top);
        g.lineTo(x + w - 10, top);
        g.lineTo(x + w, top + 22);
      } else if (kind < 0.86) {
        // Flachdach mit Attika
        g.lineTo(x, top + 8);
        g.lineTo(x + w, top + 8);
      } else {
        // Kuppel / Turm
        const cx = x + w * 0.5;
        g.lineTo(x, top + 30);
        g.lineTo(cx - 20, top + 30);
        g.lineTo(cx - 20, top + 6);
        g.quadraticCurveTo(cx - 20, top - 26, cx, top - 34);
        g.lineTo(cx, top - 58);
        g.lineTo(cx + 2, top - 34);
        g.quadraticCurveTo(cx + 20, top - 26, cx + 20, top + 6);
        g.lineTo(cx + 20, top + 30);
        g.lineTo(x + w, top + 30);
      }
      g.lineTo(x + w, H);
      g.closePath();
      g.fill();
      // Rim-Licht an der Oberkante
      g.strokeStyle = rim;
      g.lineWidth = 1.5;
      g.stroke();
      // Schornsteine
      if (o.ruin < 0.5) {
        const nch = 1 + Math.floor(hash(i * 2.1) * 3);
        for (let c = 0; c < nch; c += 1) {
          const cx = x + 10 + hash(i * 4.3 + c) * (w - 24);
          const ch = 10 + hash(i * 9.1 + c) * 14;
          g.fillStyle = base;
          g.fillRect(cx, top - ch + 6, 7, ch + 10);
          g.fillRect(cx - 1.5, top - ch + 4, 10, 3);
        }
      }
      // Fenster (winzige warme Punkte)
      const rows = Math.floor((H - top - 40) / 22);
      const cols = Math.floor((w - 14) / 14);
      for (let r = 0; r < rows; r += 1) {
        for (let c2 = 0; c2 < cols; c2 += 1) {
          const hv = hash(i * 31 + r * 7.3 + c2 * 1.37);
          const wx = x + 9 + c2 * 14;
          const wy = top + 38 + r * 22;
          if (o.ruin > 0.5) {
            if (hv < 0.05) {
              g.fillStyle = "rgba(255,110,40,0.8)";
              g.fillRect(wx, wy, 4, 6);
            }
            continue;
          }
          if (hv < o.lit) {
            g.fillStyle = hv < o.lit * 0.3 ? "rgba(255,214,140,0.95)" : "rgba(255,190,110,0.75)";
            g.fillRect(wx, wy, 4, 6);
          } else {
            g.fillStyle = "rgba(10,14,24,0.55)";
            g.fillRect(wx, wy, 4, 6);
          }
        }
      }
      x += w;
      i += 1;
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// Gründerzeit-Fassaden (Mittelgrund)

export interface FacadeOpts {
  /** Anteil beleuchteter Fenster */
  lit: number;
  /** Anteil brennender Fenster */
  fire: number;
  /** 0 = intakt, 1 = beschädigt, 2 = Ruine */
  damage: 0 | 1 | 2;
  /** Ruine: glimmende Glutnester in den Fensterhöhlen (false = kalte Asche) */
  embers?: boolean;
}

/** Leuchtreklamen (Nasenschilder) an Erdgeschoss-Ecken – kurz, deutsch, dezent. */
const SIGNS: Array<[string, string]> = [
  ["CAFÉ", "#ffcf7a"],
  ["HOTEL", "#ff6f7d"],
  ["KINO", "#7fe3ff"],
  ["BAR", "#ff8ad8"],
  ["WEIN", "#ffd36b"],
  ["TABAK", "#9dff9a"],
];

function neonSign(g: CanvasRenderingContext2D, x: number, yTop: number, i: number, lit: boolean): void {
  const [text, color] = SIGNS[i % SIGNS.length];
  const n = text.length;
  const h = n * 8 + 6;
  // Halterung
  g.fillStyle = "#1a1c22";
  g.fillRect(x - 5, yTop + 4, 5, 2);
  g.fillRect(x - 5, yTop + h - 6, 5, 2);
  // Kasten
  g.fillStyle = lit ? "#20131c" : "#15161b";
  g.fillRect(x, yTop, 11, h);
  g.strokeStyle = lit ? color : "#3a3d46";
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, yTop + 0.5, 10, h - 1);
  if (lit) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const grd = g.createRadialGradient(x + 5.5, yTop + h / 2, 1, x + 5.5, yTop + h / 2, h * 0.9);
    grd.addColorStop(0, color + "55");
    grd.addColorStop(1, color + "00");
    g.fillStyle = grd;
    g.fillRect(x - h, yTop - h * 0.4, h * 2 + 11, h * 1.8);
    g.restore();
  }
  g.fillStyle = lit ? "#fff4e6" : "#4a4d57";
  g.font = "bold 7px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k < n; k += 1) g.fillText(text[k], x + 5.5, yTop + 7 + k * 8);
}

/**
 * Ruinenhaus (Stufen „Trümmer & Asche“ / „kalte Asche“): hohle, ausgebrannte Mauerschalen mit stufig
 * abgebrochener Oberkante, Deckenplatten- und Trägerstümpfen, durchsichtigen Fensterhöhlen und Schuttkegel.
 */
function ruinBuilding(
  g: CanvasRenderingContext2D,
  x: number,
  w: number,
  i: number,
  H: number,
  o: FacadeOpts,
  holes: Array<[number, number, number, number]>,
  glows: Array<[number, number, number]>,
): void {
  const floors = 3 + Math.floor(hash(i * 1.7 + 5) * 3);
  const floorH = 30 + Math.floor(hash(i * 2.9) * 5);
  const groundH = 40;
  const col0 = FACADE_COLORS[Math.floor(hash(i * 5.3 + 2) * FACADE_COLORS.length)];
  const kind = hash(i * 4.7 + 3);
  const keep = kind < 0.16 ? 0 : kind < 0.48 ? 1 + Math.floor(hash(i * 6.1) * 2) : floors - Math.floor(hash(i * 6.3) * 2);
  const cols = Math.max(2, Math.floor((w - 20) / 30));
  const pitch = (w - 20) / cols;
  const baseY = (lvl: number): number => H - groundH - lvl * floorH;
  // Abbruchkante: Höhe je Fensterachse in Geschossen (±1 Geschoss, gezackt)
  const edge: Array<[number, number]> = [];
  const lvlAt: number[] = [];
  for (let j = 0; j <= cols; j += 1) {
    const d = hash(i * 13.1 + j * 2.7);
    const lvl = Math.max(0, Math.min(floors, keep + (d < 0.25 ? -1 : d > 0.8 ? 1 : 0)));
    lvlAt.push(lvl);
    const xx = j === 0 ? x : j === cols ? x + w : x + 10 + j * pitch;
    const yy = baseY(lvl) - (lvl === 0 ? 6 + hash(i * 3.9 + j) * 18 : hash(i * 7.9 + j) * 10);
    edge.push([xx, yy]);
    if (j < cols) {
      const mx = x + 10 + (j + 0.5) * pitch;
      const lower = Math.max(yy, baseY(Math.min(lvl, floors)));
      edge.push([mx + (hash(i + j * 5.1) - 0.5) * 8, lower + 4 + hash(i * 2.3 + j) * 16]);
    }
  }
  const wall = shade(col0, 0.46);
  const wallDark = shade(col0, 0.26);
  const minEdge = edge.reduce((m, p) => Math.min(m, p[1]), H);
  // Mauerschale
  const grd = g.createLinearGradient(0, minEdge, 0, H);
  grd.addColorStop(0, wall);
  grd.addColorStop(0.6, wallDark);
  grd.addColorStop(1, "#1c1917");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(x, H);
  for (const [px, py] of edge) g.lineTo(px, py);
  g.lineTo(x + w, H);
  g.closePath();
  g.fill();
  // Gebäudefuge
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(x, minEdge, 2, H - minEdge);
  // Rustika-Sockel (verrußt)
  g.fillStyle = shade(col0, 0.34);
  g.fillRect(x, H - groundH, w, groundH);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let yy = H - groundH + 7; yy < H; yy += 7) g.fillRect(x, yy, w, 1);
  // Geschosse: Gurtgesimse + Fensterhöhlen (nur unterhalb der Abbruchkante)
  for (let f = 0; f < floors; f += 1) {
    const fyTop = baseY(f + 1);
    const lineY = baseY(f + 1) + 2;
    for (let c = 0; c < cols; c += 1) {
      const lvl = Math.min(lvlAt[c], lvlAt[c + 1]);
      if (f + 1 > lvl) continue;
      const wx = x + 10 + c * pitch + pitch / 2 - 6;
      g.fillStyle = shade(col0, 0.58);
      g.fillRect(x + 10 + c * pitch, lineY, pitch, 2);
      const wy = fyTop + 8;
      const wh = floorH - 14;
      const hv = hash(i * 57.3 + f * 11.1 + c * 3.7);
      g.fillStyle = "#0f0b0a";
      g.fillRect(wx, wy, 12, wh);
      // Rußfahne über der Höhle
      const sg = g.createLinearGradient(0, wy - 20, 0, wy);
      sg.addColorStop(0, "rgba(0,0,0,0)");
      sg.addColorStop(1, "rgba(6,5,4,0.7)");
      g.fillStyle = sg;
      g.fillRect(wx - 3, wy - 20, 18, 20);
      // Laibung (Streiflicht oben)
      g.fillStyle = "rgba(200,180,160,0.18)";
      g.fillRect(wx - 1, wy - 1, 14, 1.5);
      if (hv > 0.42 && f >= 1) holes.push([wx + 1, wy + 1, 10, wh - 2]);
      else if (o.embers && hv < 0.07) {
        g.fillStyle = "rgba(255,110,40,0.85)";
        g.fillRect(wx + 2, wy + wh * 0.55, 8, wh * 0.45);
        glows.push([wx + 6, wy + wh * 0.75, 1]);
      }
    }
  }
  // Erdgeschoss: ausgebrannte Portale
  const doorX = x + w * (0.3 + hash(i * 2.2) * 0.4);
  g.fillStyle = "#0e0b0a";
  g.beginPath();
  g.moveTo(doorX - 11, H);
  g.lineTo(doorX - 11, H - 26);
  g.arc(doorX, H - 26, 11, Math.PI, 0);
  g.lineTo(doorX + 11, H);
  g.fill();
  for (let s = 0; s < 2; s += 1) {
    const sxx = s === 0 ? x + 8 : x + w - 46;
    if (Math.abs(sxx + 19 - doorX) < 32) continue;
    g.fillStyle = "#120e0c";
    g.fillRect(sxx, H - 30, 38, 27);
  }
  // Deckenplatten- und Trägerstümpfe an der Abbruchkante
  g.lineCap = "round";
  for (let j = 0; j < cols; j += 1) {
    const lvl = Math.min(lvlAt[j], lvlAt[j + 1]);
    if (lvl < 1) continue;
    const sy = baseY(lvl) + 1;
    const x0 = x + 10 + j * pitch;
    const hv = hash(i * 21.7 + j);
    if (hv < 0.55) {
      g.fillStyle = "#26211f";
      g.fillRect(x0 - 3, sy - 2, pitch * (0.6 + hv * 0.6), 4);
      g.fillStyle = "rgba(210,190,170,0.3)";
      g.fillRect(x0 - 3, sy - 2, pitch * (0.6 + hv * 0.6), 1);
    }
    if (hv > 0.62) {
      g.strokeStyle = "#1a1614";
      g.lineWidth = 2;
      g.beginPath();
      const bx = x0 + pitch * 0.5;
      g.moveTo(bx, sy);
      g.lineTo(bx + (hv - 0.8) * 60, sy - 14 - hv * 16);
      g.stroke();
    }
  }
  // Streiflicht auf der Abbruchkante (Silhouette bleibt lesbar)
  g.strokeStyle = "rgba(220,200,180,0.32)";
  g.lineWidth = 1.5;
  g.beginPath();
  edge.forEach(([px, py], k) => (k === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
  g.stroke();
  // Schuttkegel
  const m = 7;
  g.fillStyle = "#2a2522";
  g.beginPath();
  g.moveTo(x - 12, H);
  for (let s2 = 0; s2 <= m; s2 += 1) g.lineTo(x + (w * s2) / m, H - 8 - hash(i * 7.7 + s2) * (kind < 0.16 ? 44 : 24));
  g.lineTo(x + w + 12, H);
  g.closePath();
  g.fill();
  for (let b = 0; b < Math.round(w / 9); b += 1) {
    const bx = x + hash(i * 3.1 + b * 1.3) * w;
    const by = H - 4 - hash(i * 5.3 + b * 2.1) * 20;
    g.fillStyle = b % 3 === 0 ? "#5e3426" : b % 3 === 1 ? "#453e3a" : "#6b5d52";
    g.fillRect(bx, by, 6 + hash(b + i) * 5, 3 + hash(b * 2 + i) * 2);
  }
}

const FACADE_COLORS = ["#6b5b44", "#716d62", "#585d66", "#6a5752", "#566052", "#73633f", "#645f5a", "#4f5a68"];

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return "#" + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${gg},${b})`;
}

export interface FacadeTile extends Tile {
  /** Dächer: [x, Oberkante Dach, Breite] in Kachelkoordinaten */
  roofs: Array<[number, number, number]>;
}

/** Gebäude je Teilschritt beim schrittweisen Malen der Fassaden (2048 px = 11 Gebäude → 3 Schritte von je ca. 5 ms) */
const FACADE_STEP = 4;

/**
 * Fassaden malen, nach je `FACADE_STEP` Gebäuden mit `yield` unterbrochen (der Aufrufer treibt den Generator Schritt für
 * Schritt, siehe `startFacades`); die Zeichenbefehle sind dieselben wie am Stück.
 */
function* facadeSteps(g: CanvasRenderingContext2D, W: number, H: number, o: FacadeOpts, roofs: Array<[number, number, number]>): Generator<void, void, void> {
  let x = 0;
  let i = 0;
  const holes: Array<[number, number, number, number]> = [];
  const glows: Array<[number, number, number]> = [];
  while (x < W) {
    if (i > 0 && i % FACADE_STEP === 0) yield;
    let w = 130 + hash(i * 3.1 + 11) * 110;
    if (W - (x + w) < 130) w = W - x;
    const floors = 3 + Math.floor(hash(i * 1.7 + 5) * 3);
    const floorH = 30 + Math.floor(hash(i * 2.9) * 5);
    const groundH = 40;
    const bodyH = groundH + floors * floorH + 12;
    const top = H - bodyH;
    if (o.damage === 2) {
      roofs.push([x, top - 20 - hash(i * 4.4) * 12, w]);
      ruinBuilding(g, x, w, i, H, o, holes, glows);
      x += w;
      i += 1;
      continue;
    }
    const col0 = FACADE_COLORS[Math.floor(hash(i * 5.3 + 2) * FACADE_COLORS.length)];
    const col = o.fire > 0.15 ? shadeHex(col0, 0.72) : col0;
    const style = hash(i * 8.1 + 4);
    const roofKind = hash(i * 6.7 + 9);

    // Dach
    const roofH = 20 + hash(i * 4.4) * 12;
    if (o.damage < 2) {
      g.fillStyle = roofKind < 0.2 ? "#35574f" : "#2a303c";
      g.beginPath();
      g.moveTo(x + 2, top);
      if (roofKind < 0.2 && w > 160) {
        // Eckkuppel (Kupfer-Patina)
        const cx = x + w - 28;
        g.lineTo(x + 10, top - roofH);
        g.lineTo(cx - 20, top - roofH);
        g.lineTo(cx - 20, top - roofH - 10);
        g.quadraticCurveTo(cx - 20, top - roofH - 42, cx, top - roofH - 46);
        g.lineTo(cx, top - roofH - 66);
        g.lineTo(cx + 2, top - roofH - 46);
        g.quadraticCurveTo(cx + 22, top - roofH - 42, cx + 22, top - roofH - 10);
        g.lineTo(cx + 22, top);
      } else {
        g.lineTo(x + 12, top - roofH);
        g.lineTo(x + w - 12, top - roofH);
        g.lineTo(x + w - 2, top);
      }
      g.closePath();
      g.fill();
      // Dachfenster (Gauben)
      const ng = Math.floor((w - 40) / 38);
      for (let d = 0; d < ng; d += 1) {
        const dx = x + 22 + d * 38;
        g.fillStyle = "#3b4252";
        g.fillRect(dx, top - roofH + 6, 12, roofH - 6);
        g.beginPath();
        g.moveTo(dx - 2, top - roofH + 7);
        g.lineTo(dx + 6, top - roofH + 1);
        g.lineTo(dx + 14, top - roofH + 7);
        g.fill();
        const hv = hash(i * 17 + d * 3.1);
        g.fillStyle = hv < o.lit * 0.6 ? "#f2b766" : "#141a26";
        g.fillRect(dx + 3, top - roofH + 9, 6, roofH - 11);
      }
      // Schornsteine
      g.fillStyle = "#2a2f38";
      for (let c = 0; c < 2; c += 1) {
        const cx = x + 20 + hash(i * 3.7 + c) * (w - 50);
        g.fillRect(cx, top - roofH - 12, 8, 16);
        g.fillRect(cx - 2, top - roofH - 14, 12, 3);
      }
      if (o.damage === 1) {
        // Sturmschäden: Loch im Dach
        g.fillStyle = "#11141c";
        const hx = x + 30 + hash(i * 9.9) * (w - 90);
        g.beginPath();
        g.moveTo(hx, top - roofH + 2);
        g.lineTo(hx + 30, top - roofH + 4);
        g.lineTo(hx + 22, top - 6);
        g.lineTo(hx + 6, top - 10);
        g.closePath();
        g.fill();
      }
    }

    roofs.push([x, top - roofH, w]);
    // Fassade
    const grd = g.createLinearGradient(0, top, 0, H);
    grd.addColorStop(0, shade(col, 1.12));
    grd.addColorStop(0.55, shade(col, 0.82));
    grd.addColorStop(1, shade(col, 0.55));
    g.fillStyle = grd;
    g.fillRect(x, top, w, bodyH);
    // Gebäudefuge
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(x, top, 2, bodyH);
    // Hauptgesims
    g.fillStyle = shade(col, 1.3);
    g.fillRect(x - 2, top, w + 4, 6);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(x, top + 6, w, 4);
    // Rustika-Sockel
    g.fillStyle = shade(col, 0.85);
    g.fillRect(x, H - groundH, w, groundH);
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let yy = H - groundH + 7; yy < H; yy += 7) g.fillRect(x, yy, w, 1);

    // Fensterachsen
    const cols = Math.max(2, Math.floor((w - 20) / 30));
    const pitch = (w - 20) / cols;
    for (let f = 0; f < floors; f += 1) {
      const fy = top + 14 + f * floorH;
      // Gurtgesims
      g.fillStyle = shade(col, 1.18);
      g.fillRect(x + 2, fy + floorH - 6, w - 4, 3);
      for (let c = 0; c < cols; c += 1) {
        const wx = x + 10 + c * pitch + pitch / 2 - 6;
        const wy = fy + 6;
        const ww = 12;
        const wh = floorH - 14;
        const hv = hash(i * 57.3 + f * 11.1 + c * 3.7);
        const arched = style > 0.66;
        // Fensterrahmen / Verdachung
        g.fillStyle = shade(col, 1.25);
        if (f === floors - 1 && style < 0.5) {
          // Dreiecksgiebel (Beletage oben)
          g.beginPath();
          g.moveTo(wx - 4, wy - 1);
          g.lineTo(wx + ww / 2, wy - 8);
          g.lineTo(wx + ww + 4, wy - 1);
          g.closePath();
          g.fill();
        } else {
          g.fillRect(wx - 3, wy - 4, ww + 6, 3);
        }
        g.fillRect(wx - 2, wy + wh, ww + 4, 3);
        const fire = hv > 1 - o.fire;
        const lit = !fire && hv < o.lit;
        if (fire || lit) glows.push([wx + ww / 2, wy + wh / 2, fire ? 1 : 0]);
        if (fire) {
          const fg = g.createLinearGradient(0, wy, 0, wy + wh);
          fg.addColorStop(0, "#ffe08a");
          fg.addColorStop(0.5, "#ff8a2a");
          fg.addColorStop(1, "#b3261e");
          g.fillStyle = fg;
        } else if (lit) {
          const lg = g.createLinearGradient(0, wy, 0, wy + wh);
          lg.addColorStop(0, "#ffe2a6");
          lg.addColorStop(1, "#e89a45");
          g.fillStyle = lg;
        } else {
          const ug = g.createLinearGradient(0, wy, 0, wy + wh);
          ug.addColorStop(0, "#3d4a63");
          ug.addColorStop(1, "#141a27");
          g.fillStyle = ug;
        }
        if (arched) {
          g.beginPath();
          g.moveTo(wx, wy + wh);
          g.lineTo(wx, wy + 6);
          g.arc(wx + ww / 2, wy + 6, ww / 2, Math.PI, 0);
          g.lineTo(wx + ww, wy + wh);
          g.closePath();
          g.fill();
        } else {
          g.fillRect(wx, wy, ww, wh);
        }
        // Fensterkreuz
        g.fillStyle = lit || fire ? "rgba(60,30,10,0.55)" : "rgba(120,130,150,0.35)";
        g.fillRect(wx + ww / 2 - 0.75, wy + 2, 1.5, wh - 2);
        g.fillRect(wx, wy + wh * 0.42, ww, 1.5);
        if (fire) {
          // Rußfahne
          const sg = g.createLinearGradient(0, wy - 30, 0, wy);
          sg.addColorStop(0, "rgba(0,0,0,0)");
          sg.addColorStop(1, "rgba(10,6,4,0.65)");
          g.fillStyle = sg;
          g.fillRect(wx - 4, wy - 30, ww + 8, 30);
        }
      }
    }
    // Erdgeschoss: Portal + Geschäfte
    const doorX = x + w * (0.3 + hash(i * 2.2) * 0.4);
    g.fillStyle = "#1a1d24";
    g.beginPath();
    g.moveTo(doorX - 10, H);
    g.lineTo(doorX - 10, H - 26);
    g.arc(doorX, H - 26, 10, Math.PI, 0);
    g.lineTo(doorX + 10, H);
    g.fill();
    for (let s = 0; s < 2; s += 1) {
      const sxx = s === 0 ? x + 8 : x + w - 46;
      if (Math.abs(sxx + 19 - doorX) < 32) continue;
      const shopLit = hash(i * 23 + s) < o.lit * 1.1;
      const sg = g.createLinearGradient(0, H - 30, 0, H - 3);
      sg.addColorStop(0, shopLit ? "#f6c983" : "#27303f");
      sg.addColorStop(1, shopLit ? "#b86d34" : "#141922");
      g.fillStyle = sg;
      g.fillRect(sxx, H - 30, 38, 27);
      // Markise
      const aw = ["#7c2a2a", "#2d5a3d", "#6b5a2a", "#2f4a6b"][Math.floor(hash(i * 3 + s) * 4)];
      g.fillStyle = aw;
      g.beginPath();
      g.moveTo(sxx - 3, H - 35);
      g.lineTo(sxx + 41, H - 35);
      g.lineTo(sxx + 45, H - 28);
      g.lineTo(sxx - 7, H - 28);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.12)";
      for (let st = 0; st < 6; st += 2) g.fillRect(sxx - 3 + st * 7.5, H - 35, 7.5, 7);
    }
    // Leuchtreklame (Nasenschild) an der Hausecke
    if (hash(i * 7.3 + 1) < 0.34 && w > 150 && x + w < W - 40) {
      const lit = o.fire < 0.2 && hash(i * 2.9 + 4) < o.lit * 1.4;
      neonSign(g, x + w - 18, H - 40 - 44, Math.floor(hash(i * 1.3 + 8) * 60), lit);
    }
    x += w;
    i += 1;
  }
  if (glows.length) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const warm = g.createRadialGradient(0, 0, 0, 0, 0, 22);
    warm.addColorStop(0, "rgba(255,190,110,0.28)");
    warm.addColorStop(1, "rgba(255,190,110,0)");
    const hot = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    hot.addColorStop(0, "rgba(255,120,40,0.45)");
    hot.addColorStop(1, "rgba(255,90,30,0)");
    for (const [gx, gy2, f] of glows) {
      g.save();
      g.translate(gx, gy2);
      g.fillStyle = f ? hot : warm;
      g.fillRect(-30, -30, 60, 60);
      g.restore();
    }
    g.restore();
  }
  if (holes.length) {
    g.save();
    g.globalCompositeOperation = "destination-out";
    for (const [hx, hy, hw, hh] of holes) g.fillRect(hx, hy, hw, hh);
    g.restore();
  }
}

/** Unfertig gemalte Fassaden-Kachel: `step()` malt den nächsten Teil, true = fertig (danach ist `tile` vollständig) */
export interface FacadeBuild {
  readonly tile: FacadeTile;
  step(): boolean;
}

/** Wie `paintFacades`, aber in Teilschritten (Rohvariante einer Stufe, ohne einen 15-20-ms-Block im Frame). */
export function startFacades(W: number, H: number, o: FacadeOpts, k = 1, reuse?: HTMLCanvasElement | null): FacadeBuild {
  const roofs: Array<[number, number, number]> = [];
  let gen: Generator<void, void, void> | null = null;
  const tile = renderTile(
    W,
    H,
    k,
    (g) => {
      gen = facadeSteps(g, W, H, o, roofs);
    },
    reuse,
  );
  return {
    tile: { ...tile, roofs },
    step(): boolean {
      if (!gen) return true;
      if (!gen.next().done) return false;
      gen = null;
      return true;
    },
  };
}

export function paintFacades(W: number, H: number, o: FacadeOpts, k = 1, reuse?: HTMLCanvasElement | null): FacadeTile {
  const b = startFacades(W, H, o, k, reuse);
  while (!b.step()) {
    // weiter bis zum Ende
  }
  return b.tile;
}

// ---------------------------------------------------------------------------------------------------
// Sturmwolken (nahtlos, halbtransparent)

/** Anzahl der Wolkenballen einer Kachel; `paintCloudsA` malt die erste Hälfte, `paintCloudsB` den Rest und die Ausblendung unten */
const CLOUD_N = 46;

function cloudBlobs(g: CanvasRenderingContext2D, W: number, H: number, i0: number, i1: number): void {
  for (let i = i0; i < i1; i += 1) {
    const cx = (i / CLOUD_N) * W + hash(i * 3.3) * 60;
    const cy = 40 + hash(i * 1.1) * (H - 110);
    const r = 70 + hash(i * 7.7) * 120;
    for (const off of [-W, 0, W]) {
      const x = cx + off;
      if (x + r < 0 || x - r > W) continue;
      const grd = g.createRadialGradient(x, cy, r * 0.1, x, cy, r);
      const d = 0.25 + hash(i * 5.5) * 0.35;
      grd.addColorStop(0, `rgba(18,22,34,${d})`);
      grd.addColorStop(0.6, `rgba(24,28,40,${d * 0.55})`);
      grd.addColorStop(1, "rgba(24,28,40,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, cy, r * 1.6, r * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Wolken, Teil 1: die erste Hälfte der Ballen (Teil 2 folgt in `paintCloudsB`; zusammen genau `paintClouds`) */
export function paintCloudsA(W: number, H: number): Tile {
  return renderTile(W, H, 1, (g) => cloudBlobs(g, W, H, 0, CLOUD_N >> 1));
}

/** Wolken, Teil 2: restliche Ballen und die Ausblendung nach unten auf die in Teil 1 begonnene Kachel */
export function paintCloudsB(t: Tile): void {
  const g = t.canvas.getContext("2d");
  if (!g) return;
  cloudBlobs(g, t.w, t.h, CLOUD_N >> 1, CLOUD_N);
  g.globalCompositeOperation = "destination-in";
  const m = g.createLinearGradient(0, 0, 0, t.h);
  m.addColorStop(0, "rgba(0,0,0,1)");
  m.addColorStop(0.62, "rgba(0,0,0,1)");
  m.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = m;
  g.fillRect(0, 0, t.w, t.h);
  g.globalCompositeOperation = "source-over";
}

export function paintClouds(W: number, H: number): Tile {
  const t = paintCloudsA(W, H);
  paintCloudsB(t);
  return t;
}

/** Weiche Rauchwolke (Sprite). */
export function paintSmokePuff(size: number): Tile {
  return renderTile(size, size, 1, (g, w, h) => {
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2;
      const x = w / 2 + Math.cos(a) * w * 0.16 * hash(i + 3);
      const y = h / 2 + Math.sin(a) * h * 0.16 * hash(i + 7);
      const r = w * (0.22 + hash(i * 2.3) * 0.14);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(30,28,30,0.5)");
      grd.addColorStop(1, "rgba(30,28,30,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// Straße: Kopfsteinpflaster + Gleise

export const STREET_RAIL_Y = [17, 55];

export function paintStreet(W: number, H: number, k: number): Tile {
  return renderTile(W, H, k, (g) => {
    g.fillStyle = "#1c1f27";
    g.fillRect(0, 0, W, H);
    // Pflasterreihen mit Perspektive
    const rows: number[] = [];
    let y = 3;
    let rh = 7;
    while (y < H) {
      rows.push(y, rh);
      y += rh + 1.2;
      rh = Math.min(26, rh * 1.13 + 0.6);
    }
    for (let r = 0; r < rows.length; r += 2) {
      const ry = rows[r];
      const rhh = rows[r + 1];
      const sw = rhh * 1.7;
      const n = Math.max(1, Math.round(W / sw));
      const step = W / n;
      const off = (r / 2) % 2 ? step * 0.5 : 0;
      for (let s = -1; s <= n; s += 1) {
        const sx = s * step + off;
        const hv = hash(r * 13.1 + ((s + n) % n) * 1.77);
        const base = 38 + hv * 22;
        const cr = base * 0.95;
        const cg = base * 0.98;
        const cb = base * 1.12;
        g.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
        const rr = Math.min(4, rhh * 0.35);
        const x0 = sx + 1;
        const y0 = ry;
        const ww = step - 2;
        const hh = rhh;
        g.beginPath();
        g.moveTo(x0 + rr, y0);
        g.arcTo(x0 + ww, y0, x0 + ww, y0 + hh, rr);
        g.arcTo(x0 + ww, y0 + hh, x0, y0 + hh, rr);
        g.arcTo(x0, y0 + hh, x0, y0, rr);
        g.arcTo(x0, y0, x0 + ww, y0, rr);
        g.fill();
        // Nässe-Glanz oben
        g.fillStyle = `rgba(170,190,230,${0.08 + hv * 0.1})`;
        g.fillRect(x0 + 2, y0 + 1, ww - 4, Math.max(1, hh * 0.22));
      }
    }
    // Gleise
    for (const ry of STREET_RAIL_Y) {
      const thick = ry < 30 ? 5 : 8;
      g.fillStyle = "#0e1016";
      g.fillRect(0, ry - 2, W, thick + 4);
      const rg = g.createLinearGradient(0, ry, 0, ry + thick);
      rg.addColorStop(0, "#c9d2e0");
      rg.addColorStop(0.35, "#7d8696");
      rg.addColorStop(1, "#3a404c");
      g.fillStyle = rg;
      g.fillRect(0, ry, W, thick);
      g.fillStyle = "#07080c";
      g.fillRect(0, ry + thick * 0.55, W, 1.5);
    }
    // Pfützenflecken / dunkle Nässe (periodisch)
    for (let i = 0; i < 9; i += 1) {
      const cx = (i + hash(i * 3.1)) * (W / 9);
      const cy = 22 + hash(i * 1.9) * (H - 40);
      const rx = 30 + hash(i * 7.3) * 60;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grd.addColorStop(0, "rgba(10,14,24,0.45)");
      grd.addColorStop(1, "rgba(10,14,24,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(cx, cy, rx, rx * 0.25, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Bodenfläche nach vorn abdunkeln
    const dg = g.createLinearGradient(0, 0, 0, H);
    dg.addColorStop(0, "rgba(0,0,0,0)");
    dg.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = dg;
    g.fillRect(0, 0, W, H);
  });
}

// ---------------------------------------------------------------------------------------------------
// Straßenmöbel (Silhouetten mit Randlicht)

export function paintLamp(k: number): Tile {
  // 60 × 320, Fuß unten Mitte
  return renderTile(60, 320, k, (g) => {
    const cx = 30;
    g.fillStyle = "#11141b";
    // Sockel
    g.beginPath();
    g.moveTo(cx - 10, 320);
    g.lineTo(cx - 7, 290);
    g.lineTo(cx + 7, 290);
    g.lineTo(cx + 10, 320);
    g.fill();
    // Mast (leicht konisch)
    g.beginPath();
    g.moveTo(cx - 5, 292);
    g.lineTo(cx - 3, 70);
    g.lineTo(cx + 3, 70);
    g.lineTo(cx + 5, 292);
    g.fill();
    g.fillRect(cx - 7, 180, 14, 5);
    g.fillRect(cx - 6, 250, 12, 4);
    // Laternenkopf
    g.beginPath();
    g.moveTo(cx - 14, 40);
    g.lineTo(cx + 14, 40);
    g.lineTo(cx + 9, 70);
    g.lineTo(cx - 9, 70);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx - 17, 40);
    g.lineTo(cx, 26);
    g.lineTo(cx + 17, 40);
    g.fill();
    g.fillRect(cx - 1.5, 16, 3, 12);
    // Glas
    const lg = g.createLinearGradient(0, 42, 0, 68);
    lg.addColorStop(0, "#fff1c4");
    lg.addColorStop(1, "#f5b154");
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(cx - 11, 43);
    g.lineTo(cx + 11, 43);
    g.lineTo(cx + 7, 67);
    g.lineTo(cx - 7, 67);
    g.closePath();
    g.fill();
    g.fillStyle = "#11141b";
    g.fillRect(cx - 0.75, 43, 1.5, 24);
    // Randlicht rechts
    g.fillStyle = "rgba(160,175,210,0.35)";
    g.fillRect(cx + 3, 72, 1.2, 216);
  });
}

export function paintLampOff(k: number): Tile {
  return renderTile(60, 320, k, (g) => {
    const cx = 30;
    g.fillStyle = "#0d1016";
    g.beginPath();
    g.moveTo(cx - 10, 320);
    g.lineTo(cx - 7, 290);
    g.lineTo(cx + 7, 290);
    g.lineTo(cx + 10, 320);
    g.fill();
    g.beginPath();
    g.moveTo(cx - 5, 292);
    g.lineTo(cx - 3, 70);
    g.lineTo(cx + 3, 70);
    g.lineTo(cx + 5, 292);
    g.fill();
    g.beginPath();
    g.moveTo(cx - 14, 40);
    g.lineTo(cx + 14, 40);
    g.lineTo(cx + 9, 70);
    g.lineTo(cx - 9, 70);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx - 17, 40);
    g.lineTo(cx, 26);
    g.lineTo(cx + 17, 40);
    g.fill();
    g.fillStyle = "#2a2f3a";
    g.beginPath();
    g.moveTo(cx - 11, 43);
    g.lineTo(cx + 11, 43);
    g.lineTo(cx + 7, 67);
    g.lineTo(cx - 7, 67);
    g.closePath();
    g.fill();
  });
}

export function paintTree(k: number, seed: number): Tile {
  // 200 × 300, Stamm unten Mitte
  return renderTile(200, 300, k, (g) => {
    const cx = 100;
    // Stamm + Äste
    g.fillStyle = "#14161a";
    g.beginPath();
    g.moveTo(cx - 8, 300);
    g.quadraticCurveTo(cx - 3, 210, cx - 5, 140);
    g.lineTo(cx + 5, 140);
    g.quadraticCurveTo(cx + 4, 210, cx + 9, 300);
    g.fill();
    g.strokeStyle = "#14161a";
    g.lineCap = "round";
    for (const [dx, dy, w] of [
      [-44, -58, 5],
      [50, -66, 5],
      [-20, -90, 4],
      [24, -96, 4],
    ] as Array<[number, number, number]>) {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx, 170);
      g.quadraticCurveTo(cx + dx * 0.4, 170 + dy * 0.6, cx + dx, 150 + dy);
      g.stroke();
    }
    // Krone: Blattbüschel mit Licht von oben rechts
    const clumps: Array<[number, number, number]> = [];
    for (let i = 0; i < 34; i += 1) {
      const a = hash(seed * 7 + i * 1.3) * Math.PI * 2;
      const rr = Math.sqrt(hash(seed * 3 + i * 2.1));
      clumps.push([cx + Math.cos(a) * 72 * rr, 92 + Math.sin(a) * 56 * rr, 14 + hash(seed + i * 5.3) * 16]);
    }
    clumps.sort((p, q) => p[1] - q[1]);
    for (const [x, y, r] of clumps) {
      const lg = g.createRadialGradient(x + r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
      lg.addColorStop(0, "#3b4a3c");
      lg.addColorStop(0.55, "#222b24");
      lg.addColorStop(1, "#151a17");
      g.fillStyle = lg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Blattspitzen am Rand
    g.fillStyle = "#1a211c";
    for (let i = 0; i < 60; i += 1) {
      const a = hash(seed * 13 + i * 0.7) * Math.PI * 2;
      const x = cx + Math.cos(a) * (70 + hash(i + seed) * 16);
      const y = 92 + Math.sin(a) * (54 + hash(i * 2 + seed) * 12);
      g.beginPath();
      g.ellipse(x, y, 5, 3, a, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Verkohlter, kahler Baum (späte Stufen). */
export function paintBareTree(k: number, seed: number): Tile {
  return renderTile(200, 300, k, (g) => {
    g.strokeStyle = "#0f0f11";
    g.lineCap = "round";
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      if (depth <= 0) return;
      const n = 2;
      for (let i = 0; i < n; i += 1) {
        const da = (i === 0 ? -1 : 1) * (0.35 + hash(seed * 9 + depth * 3 + i + x) * 0.45);
        branch(x2, y2, a + da, len * (0.62 + hash(seed + depth + i * 2 + y) * 0.2), w * 0.62, depth - 1);
      }
    };
    branch(100, 300, -Math.PI / 2, 120, 10, 5);
    g.strokeStyle = "rgba(255,120,50,0.35)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(98, 290);
    g.lineTo(99, 220);
    g.stroke();
  });
}

/** Regenvorhang (nahtlos kachelbar), halbtransparente Schlieren. */
export function paintRainSheet(W: number, H: number): Tile {
  return renderTile(W, H, 1, (g) => {
    g.lineCap = "round";
    for (let i = 0; i < 260; i += 1) {
      const x = hash(i * 1.7) * W;
      const y = hash(i * 3.1) * H;
      const len = 40 + hash(i * 5.3) * 120;
      const a = 0.04 + hash(i * 7.9) * 0.1;
      g.strokeStyle = `rgba(190,205,235,${a})`;
      g.lineWidth = 1 + hash(i * 2.2) * 1.5;
      for (const [ox, oy] of [
        [0, 0],
        [-W, 0],
        [W, 0],
        [0, -H],
        [0, H],
      ]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox - len * 0.28, y + oy + len);
        g.stroke();
      }
    }
  });
}

export function paintLitfass(k: number): Tile {
  // 70 × 190
  return renderTile(70, 190, k, (g) => {
    const cx = 35;
    g.fillStyle = "#12141a";
    g.fillRect(cx - 24, 34, 48, 146);
    g.fillRect(cx - 27, 178, 54, 12);
    g.beginPath();
    g.ellipse(cx, 32, 29, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx - 22, 30);
    g.quadraticCurveTo(cx, -6, cx + 22, 30);
    g.fill();
    // Plakate (gedeckt, im Halbdunkel – Kulisse, kein Hindernis)
    const cols = ["#4a2a26", "#5e5236", "#2c3a48", "#3d3144", "#4a4842", "#2e3f33"];
    let y = 42;
    let i = 0;
    while (y < 172) {
      const h = Math.min(24 + hash(i * 3.3) * 26, 172 - y);
      g.globalAlpha = 0.85;
      g.fillStyle = cols[i % cols.length];
      g.fillRect(cx - 22, y, 44, h);
      // angedeutete Plakatgrafik
      g.globalAlpha = 0.22;
      g.fillStyle = "#e8dcc4";
      if (hash(i * 5.1) < 0.5) g.fillRect(cx - 16, y + 5, 26, 3);
      else {
        g.beginPath();
        g.arc(cx - 4, y + h * 0.5, Math.min(7, h * 0.3), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.4;
      g.fillStyle = "#000";
      g.fillRect(cx - 22, y + h - 2, 44, 2);
      g.globalAlpha = 1;
      y += h;
      i += 1;
    }
    // ins Halbdunkel der Nah-Ebene zurücknehmen
    g.fillStyle = "rgba(10,12,18,0.42)";
    g.fillRect(cx - 24, 34, 48, 146);
    // Zylinder-Schattierung
    const sg = g.createLinearGradient(cx - 24, 0, cx + 24, 0);
    sg.addColorStop(0, "rgba(0,0,0,0.55)");
    sg.addColorStop(0.55, "rgba(0,0,0,0)");
    sg.addColorStop(0.85, "rgba(160,175,210,0.12)");
    sg.addColorStop(1, "rgba(0,0,0,0.4)");
    g.fillStyle = sg;
    g.fillRect(cx - 24, 34, 48, 146);
  });
}

/** Weicher Lichthof (für Laternen, Scheinwerfer). */
export function paintGlow(size: number, color: string): Tile {
  return renderTile(size, size, 1, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.25, color.replace(/[\d.]+\)$/, "0.35)"));
    grd.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------------------------------------------
// Oberleitungsmast (Straßenbahn) – Silhouette mit Randlicht, Ausleger trägt Tragseil und Fahrdraht

export const MAST_W = 120;
export const MAST_H = 540;
/** Mastachse im Tile */
export const MAST_AX = 22;
/** Aufhängepunkt (Auslegerspitze) im Tile */
export const MAST_TIP_X = 104;
export const MAST_TIP_Y = 26;

export function paintMast(k: number, broken: boolean): Tile {
  return renderTile(MAST_W, MAST_H, k, (g) => {
    const cx = MAST_AX;
    const col = "#12151c";
    g.fillStyle = col;
    // Sockel
    g.beginPath();
    g.moveTo(cx - 11, MAST_H);
    g.lineTo(cx - 8, MAST_H - 46);
    g.lineTo(cx + 8, MAST_H - 46);
    g.lineTo(cx + 11, MAST_H);
    g.fill();
    g.fillRect(cx - 10, MAST_H - 50, 20, 5);
    const topY = broken ? 250 : 14;
    // Mast (leicht konisch)
    g.beginPath();
    g.moveTo(cx - 5, MAST_H - 46);
    g.lineTo(cx - 3, topY);
    g.lineTo(cx + 3, topY);
    g.lineTo(cx + 5, MAST_H - 46);
    g.fill();
    // Zierringe
    for (const ry of [MAST_H - 180, MAST_H - 330]) if (ry > topY) g.fillRect(cx - 6, ry, 12, 4);
    if (broken) {
      // abgeknickter Stumpf mit Bruchkante
      g.beginPath();
      g.moveTo(cx - 3, topY + 2);
      g.lineTo(cx - 1, topY - 12);
      g.lineTo(cx + 2, topY - 4);
      g.lineTo(cx + 4, topY - 16);
      g.lineTo(cx + 3, topY + 2);
      g.fill();
    } else {
      // Knauf
      g.beginPath();
      g.arc(cx, topY - 3, 4, 0, Math.PI * 2);
      g.fill();
      // Ausleger + Strebe
      g.fillRect(cx, MAST_TIP_Y - 2, MAST_TIP_X - cx, 4);
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx + 2, MAST_TIP_Y + 44);
      g.lineTo(cx + 62, MAST_TIP_Y + 2);
      g.stroke();
      // Isolator + Hänger zum Fahrdraht
      g.fillStyle = "#39404d";
      g.fillRect(MAST_TIP_X - 4, MAST_TIP_Y - 5, 8, 10);
      g.fillStyle = col;
      g.fillRect(MAST_TIP_X - 1, MAST_TIP_Y + 4, 2, 24);
    }
    // Randlicht rechts
    g.fillStyle = "rgba(160,175,210,0.3)";
    g.fillRect(cx + 3, topY + 6, 1.2, MAST_H - 56 - topY);
  });
}

// ---------------------------------------------------------------------------------------------------
// Dachbrand: Flammenbündel (Animation in Einzelbildern, additiv zu zeichnen)

export function paintFlameFrames(n: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < n; f += 1) {
    const t = (f / n) * Math.PI * 2;
    out.push(
      renderTile(84, 86, 1, (g) => {
        const base = 84;
        for (let q = 0; q < 5; q += 1) {
          const fx = 42 + (q - 2) * 11 + Math.sin(t + q * 1.7) * 3;
          const fh = 34 + 26 * hash(q * 3.3 + 1) + 12 * Math.sin(t * 2 + q * 2.1);
          const fg = g.createLinearGradient(0, base - fh, 0, base);
          fg.addColorStop(0, "rgba(255,80,20,0)");
          fg.addColorStop(0.45, "rgba(255,120,30,0.55)");
          fg.addColorStop(1, "rgba(255,210,120,0.9)");
          g.fillStyle = fg;
          g.beginPath();
          g.moveTo(fx - 9, base);
          g.quadraticCurveTo(fx - 8, base - fh * 0.55, fx + Math.sin(t + q) * 5, base - fh);
          g.quadraticCurveTo(fx + 9, base - fh * 0.5, fx + 9, base);
          g.closePath();
          g.fill();
        }
      }).canvas,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Kanalschacht (Lücken): Ziegelwand in der Tiefe, nahtlos (Periode 28 px)

export function paintShaft(W: number, H: number): HTMLCanvasElement {
  return renderTile(W, H, 1, (g) => {
    const sg = g.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, "#2a2320");
    sg.addColorStop(0.35, "#120f0e");
    sg.addColorStop(1, "#050505");
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(90,60,45,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    for (let y = 6, r = 0; y < H - 30; y += 11, r += 1) {
      g.moveTo(0, y);
      g.lineTo(W, y);
      for (let x = (r % 2) * 14; x <= W; x += 28) {
        g.moveTo(x, y);
        g.lineTo(x, y + 11);
      }
    }
    g.stroke();
    const dark = g.createLinearGradient(0, 0, 0, H);
    dark.addColorStop(0, "rgba(0,0,0,0.1)");
    dark.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = dark;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(40,60,80,0.6)";
    g.fillRect(0, H - 26, W, 26);
  }).canvas;
}
