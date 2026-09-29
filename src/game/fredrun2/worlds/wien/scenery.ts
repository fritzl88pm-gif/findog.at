/**
 * Wien – vorgerenderte Kulissen-Kacheln: Dachlandschaft, Gründerzeit-Fassaden (Varianten intakt → Brand → Ruine),
 * Wolken, Kopfsteinpflaster mit Gleisen, Straßenmöbel-Sprites (Laterne, Platane, Litfaßsäule).
 */
import { hash, pnoise, type Tile, renderTile } from "../shared-a/gfx";

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
}

const FACADE_COLORS = ["#7f6c4e", "#8a8575", "#6d7075", "#80685f", "#67715f", "#8a774b", "#76706a", "#5f6a77"];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const gg = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${gg},${b})`;
}

export function paintFacades(W: number, H: number, o: FacadeOpts, k = 1): Tile {
  return renderTile(W, H, k, (g) => {
    let x = 0;
    let i = 0;
    const holes: Array<[number, number, number, number]> = [];
    while (x < W) {
      let w = 170 + hash(i * 3.1 + 11) * 130;
      if (W - (x + w) < 170) w = W - x;
      const floors = 3 + Math.floor(hash(i * 1.7 + 5) * 3);
      const floorH = 40 + Math.floor(hash(i * 2.9) * 6);
      const groundH = 52;
      const bodyH = groundH + floors * floorH + 14;
      const top = H - bodyH;
      const col = FACADE_COLORS[Math.floor(hash(i * 5.3 + 2) * FACADE_COLORS.length)];
      const style = hash(i * 8.1 + 4);
      const roofKind = hash(i * 6.7 + 9);

      // Dach
      const roofH = 28 + hash(i * 4.4) * 16;
      if (o.damage < 2) {
        g.fillStyle = roofKind < 0.2 ? "#35574f" : "#2a303c";
        g.beginPath();
        g.moveTo(x + 2, top);
        if (roofKind < 0.2 && w > 200) {
          // Eckkuppel (Kupfer-Patina)
          const cx = x + w - 34;
          g.lineTo(x + 12, top - roofH);
          g.lineTo(cx - 26, top - roofH);
          g.lineTo(cx - 26, top - roofH - 14);
          g.quadraticCurveTo(cx - 26, top - roofH - 58, cx, top - roofH - 64);
          g.lineTo(cx, top - roofH - 92);
          g.lineTo(cx + 2, top - roofH - 64);
          g.quadraticCurveTo(cx + 28, top - roofH - 58, cx + 28, top - roofH - 14);
          g.lineTo(cx + 28, top);
        } else {
          g.lineTo(x + 12, top - roofH);
          g.lineTo(x + w - 12, top - roofH);
          g.lineTo(x + w - 2, top);
        }
        g.closePath();
        g.fill();
        // Dachfenster (Gauben)
        const ng = Math.floor((w - 40) / 46);
        for (let d = 0; d < ng; d += 1) {
          const dx = x + 24 + d * 46;
          g.fillStyle = "#3b4252";
          g.fillRect(dx, top - roofH + 8, 16, roofH - 8);
          g.beginPath();
          g.moveTo(dx - 3, top - roofH + 9);
          g.lineTo(dx + 8, top - roofH + 1);
          g.lineTo(dx + 19, top - roofH + 9);
          g.fill();
          const hv = hash(i * 17 + d * 3.1);
          g.fillStyle = hv < o.lit * 0.6 ? "#f2b766" : "#141a26";
          g.fillRect(dx + 4, top - roofH + 12, 8, roofH - 14);
        }
        // Schornsteine
        g.fillStyle = "#2a2f38";
        for (let c = 0; c < 2; c += 1) {
          const cx = x + 20 + hash(i * 3.7 + c) * (w - 50);
          g.fillRect(cx, top - roofH - 16, 10, 20);
          g.fillRect(cx - 2, top - roofH - 18, 14, 4);
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

      // Fassade
      const grd = g.createLinearGradient(0, top, 0, H);
      grd.addColorStop(0, shade(col, 1.08));
      grd.addColorStop(1, shade(col, 0.72));
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
      for (let yy = H - groundH + 8; yy < H; yy += 9) g.fillRect(x, yy, w, 1);

      // Fensterachsen
      const cols = Math.max(2, Math.floor((w - 24) / 40));
      const pitch = (w - 24) / cols;
      for (let f = 0; f < floors; f += 1) {
        const fy = top + 14 + f * floorH;
        // Gurtgesims
        g.fillStyle = shade(col, 1.18);
        g.fillRect(x + 2, fy + floorH - 6, w - 4, 3);
        for (let c = 0; c < cols; c += 1) {
          const wx = x + 12 + c * pitch + pitch / 2 - 8;
          const wy = fy + 7;
          const ww = 16;
          const wh = floorH - 17;
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
          if (o.damage === 2) {
            holes.push([wx, wy, ww, wh]);
            continue;
          }
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
      g.moveTo(doorX - 13, H);
      g.lineTo(doorX - 13, H - 34);
      g.arc(doorX, H - 34, 13, Math.PI, 0);
      g.lineTo(doorX + 13, H);
      g.fill();
      for (let s = 0; s < 2; s += 1) {
        const sxx = s === 0 ? x + 10 : x + w - 58;
        if (Math.abs(sxx + 24 - doorX) < 40) continue;
        const shopLit = hash(i * 23 + s) < o.lit * 1.1 && o.damage < 2;
        const sg = g.createLinearGradient(0, H - 40, 0, H - 4);
        sg.addColorStop(0, shopLit ? "#f6c983" : "#27303f");
        sg.addColorStop(1, shopLit ? "#b86d34" : "#141922");
        g.fillStyle = sg;
        g.fillRect(sxx, H - 40, 48, 36);
        // Markise
        const aw = ["#7c2a2a", "#2d5a3d", "#6b5a2a", "#2f4a6b"][Math.floor(hash(i * 3 + s) * 4)];
        g.fillStyle = aw;
        g.beginPath();
        g.moveTo(sxx - 3, H - 46);
        g.lineTo(sxx + 51, H - 46);
        g.lineTo(sxx + 55, H - 38);
        g.lineTo(sxx - 7, H - 38);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.12)";
        for (let st = 0; st < 6; st += 2) g.fillRect(sxx - 3 + st * 9.5, H - 46, 9.5, 8);
      }
      if (o.damage === 2) {
        // Ruine: zackige Abbruchkante ausschneiden
        g.save();
        g.globalCompositeOperation = "destination-out";
        g.beginPath();
        g.moveTo(x - 1, -10);
        const steps = Math.max(4, Math.round(w / 18));
        for (let s = 0; s <= steps; s += 1) {
          const xx = x + (w * s) / steps;
          const cut = 20 + hash(i * 19 + s * 2.3) * (bodyH * 0.45) + (s % 3 === 0 ? 30 : 0);
          g.lineTo(xx, top + cut);
        }
        g.lineTo(x + w + 1, -10);
        g.closePath();
        g.fill();
        g.restore();
      }
      x += w;
      i += 1;
    }
    if (holes.length) {
      g.save();
      g.globalCompositeOperation = "destination-out";
      for (const [hx, hy, hw, hh] of holes) {
        if (hash(hx * 0.37 + hy) < 0.8) g.fillRect(hx, hy, hw, hh);
      }
      g.restore();
      // verkohlte Ränder
      g.strokeStyle = "rgba(8,6,6,0.55)";
      g.lineWidth = 2;
      for (const [hx, hy, hw, hh] of holes) if (hash(hx * 0.37 + hy) < 0.8) g.strokeRect(hx, hy, hw, hh);
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// Sturmwolken (nahtlos, halbtransparent)

export function paintClouds(W: number, H: number): Tile {
  return renderTile(W, H, 1, (g) => {
    const n = 46;
    for (let i = 0; i < n; i += 1) {
      const cx = (i / n) * W + hash(i * 3.3) * 60;
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
  });
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
    void pnoise;
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
  // 220 × 330, Stamm unten Mitte
  return renderTile(220, 330, k, (g) => {
    const cx = 110;
    // Stamm
    g.fillStyle = "#15181c";
    g.beginPath();
    g.moveTo(cx - 9, 330);
    g.quadraticCurveTo(cx - 4, 220, cx - 6, 150);
    g.lineTo(cx + 6, 150);
    g.quadraticCurveTo(cx + 5, 220, cx + 10, 330);
    g.fill();
    g.strokeStyle = "#15181c";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 2, 170);
    g.quadraticCurveTo(cx - 30, 130, cx - 50, 110);
    g.moveTo(cx + 2, 160);
    g.quadraticCurveTo(cx + 34, 120, cx + 56, 104);
    g.stroke();
    // Krone aus vielen Blattklumpen
    for (let i = 0; i < 26; i += 1) {
      const a = hash(seed * 7 + i * 1.3) * Math.PI * 2;
      const rr = hash(seed * 3 + i * 2.1);
      const x = cx + Math.cos(a) * 70 * rr;
      const y = 100 + Math.sin(a) * 58 * rr - 10;
      const r = 26 + hash(seed + i * 5.3) * 24;
      const shadeV = 18 + hash(seed * 11 + i) * 14;
      g.fillStyle = `rgb(${shadeV | 0},${(shadeV + 10) | 0},${(shadeV + 6) | 0})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Randlicht oben rechts
    g.globalCompositeOperation = "source-atop";
    const rg = g.createLinearGradient(40, 30, 190, 170);
    rg.addColorStop(0, "rgba(120,140,170,0.0)");
    rg.addColorStop(0.7, "rgba(120,140,170,0.0)");
    rg.addColorStop(1, "rgba(150,170,210,0.22)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 220, 330);
    g.globalCompositeOperation = "source-over";
  });
}

export function paintLitfass(k: number): Tile {
  // 70 × 190
  return renderTile(70, 190, k, (g) => {
    const cx = 35;
    g.fillStyle = "#171a20";
    g.fillRect(cx - 24, 34, 48, 146);
    g.fillRect(cx - 27, 178, 54, 12);
    g.beginPath();
    g.ellipse(cx, 32, 29, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(cx - 22, 30);
    g.quadraticCurveTo(cx, -6, cx + 22, 30);
    g.fill();
    // Plakate (gedeckte Farben)
    const cols = ["#8c3b30", "#c7a04a", "#3b5f7d", "#6d4a7a", "#d0c7b5", "#3f6a4a"];
    let y = 42;
    let i = 0;
    while (y < 172) {
      const h = 24 + hash(i * 3.3) * 26;
      g.fillStyle = cols[i % cols.length];
      g.globalAlpha = 0.55;
      g.fillRect(cx - 22, y, 44, Math.min(h, 172 - y));
      g.globalAlpha = 0.3;
      g.fillStyle = "#000";
      g.fillRect(cx - 22, y + Math.min(h, 172 - y) - 2, 44, 2);
      g.globalAlpha = 1;
      y += h;
      i += 1;
    }
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
