/**
 * Leerlauf-Aufwärmen der Welten (`WorldRenderer.warm(budgetMs)`): eine Warteschlange kleiner, einzeln abgeschlossener
 * Backschritte (Rauch-/Dampfgrößen, Hindernis-Sprites, …), die der Hub während Countdown, Menü-Demo und der ersten
 * Lauf-Sekunden in Zeitscheiben von ~3 ms abarbeitet. Jeder Schritt meldet, ob noch etwas übrig ist; die Kosten je
 * Schritt werden mitgemessen, damit ein Aufruf nur Schritte beginnt, die voraussichtlich noch ins Budget passen.
 */
import { nowMs } from "./layers";

interface Job {
  /** ein Schritt; true = dieser Auftrag ist fertig */
  step: () => boolean;
  /** gleitende Schätzung der Dauer eines Schritts (ms) */
  cost: number;
}

export class WarmQueue {
  private jobs: Job[] = [];
  private readonly now: () => number;

  constructor(now: () => number = nowMs) {
    this.now = now;
  }

  /** Auftrag anhängen; `step` wird wiederholt aufgerufen, bis es true liefert. `estMs` = erste Kostenschätzung. */
  add(step: () => boolean, estMs = 2): void {
    this.jobs.push({ step, cost: estMs });
  }

  /** Alle offenen Aufträge verwerfen (z.B. vor dem Neuaufbau nach einem Skalenwechsel) */
  clear(): void {
    this.jobs.length = 0;
  }

  get pending(): number {
    return this.jobs.length;
  }

  /**
   * Höchstens ca. `budgetMs` Millisekunden arbeiten. Der erste Schritt läuft immer (sonst verhungert ein einzelner
   * größerer Schritt), weitere nur, wenn sie nach Schätzung noch ins Budget passen. true = nichts mehr zu tun.
   */
  run(budgetMs: number): boolean {
    const t0 = this.now();
    let did = false;
    while (this.jobs.length) {
      const job = this.jobs[0];
      if (did && this.now() - t0 + job.cost > budgetMs) return false;
      did = true;
      const a = this.now();
      const done = job.step();
      job.cost = job.cost * 0.6 + (this.now() - a) * 0.4;
      if (done) this.jobs.shift();
    }
    return true;
  }
}
