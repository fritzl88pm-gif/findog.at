/** Leichtgewichtiges Partikelsystem (Objekt-Pool, keine Allokationen im Betrieb). */

export type ParticleShape = "circle" | "spark" | "ring" | "square" | "star" | "streak";

interface P {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  color: string;
  shape: ParticleShape;
  additive: boolean;
  /** Bildschirmfest (bewegt sich mit der Welt nach links) */
  world: boolean;
}

export interface EmitOpts {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  drag?: number;
  life?: number;
  size?: number;
  grow?: number;
  rot?: number;
  vr?: number;
  color?: string;
  shape?: ParticleShape;
  additive?: boolean;
  world?: boolean;
}

export interface Popup {
  active: boolean;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

export class Particles {
  private readonly pool: P[] = [];
  private readonly popups: Popup[] = [];
  private cursor = 0;
  private pcursor = 0;
  budget = 1;

  constructor(readonly capacity = 640) {
    for (let i = 0; i < capacity; i += 1) {
      this.pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 0, max: 1, size: 4, grow: 0, rot: 0, vr: 0, color: "#fff", shape: "circle", additive: false, world: false });
    }
    for (let i = 0; i < 24; i += 1) this.popups.push({ active: false, x: 0, y: 0, text: "", color: "#fff", life: 0, max: 1, size: 28 });
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    for (const p of this.popups) p.active = false;
  }

  emit(o: EmitOpts): void {
    if (this.budget < 1 && Math.random() > this.budget) return;
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.ax = o.ax ?? 0;
    p.ay = o.ay ?? 0;
    p.drag = o.drag ?? 0;
    p.life = 0;
    p.max = o.life ?? 0.6;
    p.size = o.size ?? 5;
    p.grow = o.grow ?? 0;
    p.rot = o.rot ?? 0;
    p.vr = o.vr ?? 0;
    p.color = o.color ?? "#fff";
    p.shape = o.shape ?? "circle";
    p.additive = o.additive ?? false;
    p.world = o.world ?? false;
  }

  popup(x: number, y: number, text: string, color = "#fff", size = 30, life = 0.9): void {
    const p = this.popups[this.pcursor];
    this.pcursor = (this.pcursor + 1) % this.popups.length;
    p.active = true;
    p.x = x;
    p.y = y;
    p.text = text;
    p.color = color;
    p.life = 0;
    p.max = life;
    p.size = size;
  }

  update(dt: number, scroll: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.active = false;
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      if (p.drag) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * dt - (p.world ? scroll * dt : 0);
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      p.rot += p.vr * dt;
    }
    for (const q of this.popups) {
      if (!q.active) continue;
      q.life += dt;
      if (q.life >= q.max) q.active = false;
      else q.y -= 46 * dt * (1 - q.life / q.max * 0.6);
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.save();
    let additive = false;
    for (const p of this.pool) {
      if (!p.active) continue;
      const u = p.life / p.max;
      const a = Math.max(0, 1 - u * u);
      if (p.additive !== additive) {
        additive = p.additive;
        g.globalCompositeOperation = additive ? "lighter" : "source-over";
      }
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.strokeStyle = p.color;
      const s = Math.max(0.1, p.size);
      switch (p.shape) {
        case "circle":
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.fill();
          break;
        case "square":
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
          g.restore();
          break;
        case "ring":
          g.lineWidth = Math.max(1, s * 0.12);
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.stroke();
          break;
        case "spark": {
          g.lineWidth = Math.max(1.5, s * 0.5);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          g.stroke();
          break;
        }
        case "streak":
          g.fillRect(p.x, p.y - 1, s * 6, 2);
          break;
        case "star": {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.beginPath();
          for (let i = 0; i < 4; i += 1) {
            const ang = (i * Math.PI) / 2;
            g.lineTo(Math.cos(ang) * s, Math.sin(ang) * s);
            g.lineTo(Math.cos(ang + Math.PI / 4) * s * 0.28, Math.sin(ang + Math.PI / 4) * s * 0.28);
          }
          g.closePath();
          g.fill();
          g.restore();
          break;
        }
      }
    }
    g.restore();
  }

  drawPopups(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const q of this.popups) {
      if (!q.active) continue;
      const u = q.life / q.max;
      const pop = u < 0.15 ? 0.6 + (u / 0.15) * 0.55 : 1.15 - Math.min(0.15, (u - 0.15) * 0.3);
      g.globalAlpha = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      g.font = `800 ${Math.round(q.size * pop)}px ${FONT}`;
      g.lineWidth = 6;
      g.strokeStyle = "rgba(20,24,40,0.85)";
      g.strokeText(q.text, q.x, q.y);
      g.fillStyle = q.color;
      g.fillText(q.text, q.x, q.y);
    }
    g.restore();
  }
}

export const FONT = '"Nunito", "Baloo 2", "Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif';
