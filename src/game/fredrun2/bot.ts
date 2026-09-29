/**
 * Vorausschauender Bot: spielt Fredrun 2.0 durch Simulation kurzer Handlungspläne auf einem Klon der Sim.
 * Verwendung: (1) Automatisierte Tests (Level-Generator muss lösbar sein), (2) Vorschau-/Attract-Modus im Menü,
 * (3) QA-Screenshots. Nutzt ausschließlich öffentliche Sim-Schnittstellen.
 */
import { FIXED_DT } from "./constants";
import { NO_INPUT, type Sim, type SimInput } from "./sim";

type ActionKind = "jump" | "slide" | "dash" | "stomp";
interface Action {
  t: number;
  kind: ActionKind;
  /** Haltedauer (jump/slide) */
  dur: number;
}
interface Plan {
  actions: Action[];
  end: number;
  name: string;
}

function mkPlans(): Plan[] {
  const plans: Plan[] = [{ actions: [], end: 0, name: "none" }];
  const push = (name: string, actions: Action[]) => {
    const end = Math.max(...actions.map((a) => a.t + a.dur));
    plans.push({ actions, end, name });
  };
  const delays = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.36, 0.42, 0.5, 0.6, 0.7];
  for (const d of delays) push(`jump@${d}`, [{ t: d, kind: "jump", dur: 0.5 }]);
  for (const d of delays) push(`tap@${d}`, [{ t: d, kind: "jump", dur: 0.12 }]);
  for (const d of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) push(`slide@${d}`, [{ t: d, kind: "slide", dur: 0.6 }]);
  for (const d of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) push(`slideL@${d}`, [{ t: d, kind: "slide", dur: 1.05 }]);
  for (const d of [0, 0.1, 0.2, 0.3, 0.45]) {
    for (const dd of [0.18, 0.3, 0.42, 0.55]) {
      push(`dj@${d}+${dd}`, [
        { t: d, kind: "jump", dur: dd + 0.35 },
        { t: d + dd, kind: "jump", dur: 0.4 },
      ]);
    }
  }
  for (const d of [0, 0.15, 0.3, 0.45]) {
    for (const dd of [0.15, 0.3, 0.45]) {
      push(`stomp@${d}+${dd}`, [
        { t: d, kind: "jump", dur: dd },
        { t: d + dd, kind: "stomp", dur: 0.2 },
      ]);
    }
  }
  for (const d of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65]) push(`dash@${d}`, [{ t: d, kind: "dash", dur: 0.1 }]);
  // Kombis: Rutschen dann springen
  for (const d of [0, 0.15, 0.3]) {
    for (const dd of [0.5, 0.7, 0.9]) {
      push(`slide-jump@${d}+${dd}`, [
        { t: d, kind: "slide", dur: dd },
        { t: d + dd + 0.05, kind: "jump", dur: 0.5 },
      ]);
    }
  }
  return plans;
}

const PLANS = mkPlans();

function planInput(plan: Plan, tau: number, dt: number): SimInput {
  let jump = false;
  let jumpPressed = false;
  let slide = false;
  let slidePressed = false;
  let dashPressed = false;
  for (const a of plan.actions) {
    const inside = tau >= a.t && tau < a.t + a.dur;
    const edge = tau >= a.t && tau < a.t + dt;
    switch (a.kind) {
      case "jump":
        if (inside) jump = true;
        if (edge) jumpPressed = true;
        break;
      case "slide":
        if (inside) slide = true;
        if (edge) slidePressed = true;
        break;
      case "stomp":
        if (inside) slide = true;
        if (edge) slidePressed = true;
        break;
      case "dash":
        if (edge) dashPressed = true;
        break;
    }
  }
  return { jump, jumpPressed, slide, slidePressed, dashPressed };
}

export interface BotOptions {
  /** Menschliche Reaktionszeit (Sek.): Aktionen setzen erst so viel später ein */
  reaction?: number;
  /** Sichtweite in Pixeln ab Spielerposition (Standard: unbegrenzt) – simuliert "nur sichtbare Gefahren" */
  vision?: number;
  /** Vorausschau in Sekunden */
  horizon?: number;
  /** Entscheidungen pro Sekunde */
  decisionHz?: number;
  /** darf Dash nutzen */
  allowDash?: boolean;
}

export class Bot {
  private plan: Plan | null = null;
  private planT = 0;
  private sinceDecision = 1;
  readonly horizon: number;
  readonly interval: number;
  readonly allowDash: boolean;
  readonly reaction: number;
  readonly vision: number;
  lastPlanName = "none";

  constructor(opts: BotOptions = {}) {
    this.reaction = opts.reaction ?? 0;
    this.vision = opts.vision ?? Infinity;
    this.horizon = opts.horizon ?? 1.4;
    this.interval = 1 / (opts.decisionHz ?? 9);
    this.allowDash = opts.allowDash ?? true;
  }

  /** Simuliert einen Plan; liefert die Überlebenszeit bis zum ersten Schaden (oder Horizont). */
  private rollout(sim: Sim, plan: Plan): { survived: number; ok: boolean; hearts: number } {
    const c = sim.clone();
    if (Number.isFinite(this.vision)) {
      const limit = c.playerWorldX + this.vision;
      c.ents = c.ents.filter((e) => e.x <= limit);
    }
    const startHearts = c.player.hearts;
    const startShield = c.player.shield > 0;
    let tau = 0;
    const steps = Math.round(this.horizon / FIXED_DT);
    for (let i = 0; i < steps; i += 1) {
      const input = planInput(plan, tau - this.reaction, FIXED_DT);
      c.step(FIXED_DT, input);
      tau += FIXED_DT;
      if (c.phase !== "running" || c.player.hearts < startHearts || (startShield && c.player.shield <= 0 && c.player.invuln > 0.5)) {
        return { survived: tau, ok: false, hearts: c.player.hearts };
      }
    }
    return { survived: this.horizon, ok: true, hearts: c.player.hearts };
  }

  private decide(sim: Sim): void {
    let best: { plan: Plan; survived: number } | null = null;
    for (const plan of PLANS) {
      if (!this.allowDash && plan.name.startsWith("dash")) continue;
      if (plan.name.startsWith("dash") && sim.player.energy < sim.perks.dashCost) continue;
      const r = this.rollout(sim, plan);
      if (r.ok) {
        this.plan = plan;
        this.planT = 0;
        this.lastPlanName = plan.name;
        return;
      }
      if (!best || r.survived > best.survived + 0.001) best = { plan, survived: r.survived };
    }
    this.plan = best?.plan ?? PLANS[0];
    this.planT = 0;
    this.lastPlanName = this.plan.name + "!";
  }

  /** Eingabe für den nächsten Sim-Schritt. */
  input(sim: Sim, dt: number): SimInput {
    if (sim.phase !== "running") return NO_INPUT;
    this.sinceDecision += dt;
    const planDone = !this.plan || this.planT > this.plan.end + this.reaction + 0.02;
    if (this.sinceDecision >= this.interval && (planDone || this.plan?.name === "none" || this.plan?.name.endsWith("!"))) {
      this.decide(sim);
      this.sinceDecision = 0;
    }
    const plan = this.plan ?? PLANS[0];
    const inp = planInput(plan, this.planT - this.reaction, dt);
    this.planT += dt;
    return inp;
  }
}
