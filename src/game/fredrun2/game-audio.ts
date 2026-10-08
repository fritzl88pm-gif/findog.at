/**
 * Sim-Ereignis -> Ton. Ersetzt `audioFor` aus game.ts: Münzleiter und gerasteter Combo-/Stampf-Klang (audio/cues.ts), Zonen-Sounds mit
 * Abstands-Pegel und Mindestabstand, Zustands-Hinweise (Dash bereit, letztes Herz, Zeitlupe vorbei) über `tick`.
 *
 * Bewusst ohne Import aus game.ts oder audio/engine: Ein- und Ausgänge sind strukturelle Typen (`AudioSink`, `GameAudioEvent`,
 * `EventSimLike`/`TickSimLike`), sodass die Zuordnung mit einer Attrappe getestet wird (`game-audio.test.ts`). Der Hub reicht sein Audio-
 * Objekt und die Sim durch und ruft `onEvent` je Ereignis (nicht im Demo-Lauf) und `tick` einmal je Frame auf.
 */
import { VIEW_W } from "./constants";
import { CueTracker, coinPitch, comboPitch, stompChainPitch, zoneCue, zoneGroup, type CueInput, type CueName, type ZoneGroup } from "./audio/cues";

/** Was der Hub von seinem Audio-Objekt zur Verfügung stellt; `duck` und `music` sind optional (Attrappen, kaputte Audio-Engine). */
export interface AudioSink {
  sfx(name: string, opts?: { pitch?: number; volume?: number; pan?: number }): void;
  duck?(amount: number, sec: number): void;
  music?: { play(id: string, opts?: { crossfadeSec?: number; intensity?: number }): void };
}

/** Das Stück eines `SimEvent`, das hier gebraucht wird (`SimEvent` passt strukturell). */
export interface GameAudioEvent {
  type: string;
  /** Bildschirm-x des Ereignisses (Pan, Zonen-Abstand) */
  x: number;
  y?: number;
  value?: number;
  tag?: string;
  skin?: string;
}

/** Für `onEvent`: nur das Musikstück der aktuellen Welt (Weltwechsel). */
export interface EventSimLike {
  world: { music: string };
}

/** Für `tick`: Zustand, aus dem die Hinweise abgeleitet werden. */
export interface TickSimLike {
  time: number;
  perks: { dashCost: number };
  player: { energy: number; dashCd: number; hearts: number; slowmo: number };
}

export type SimLike = EventSimLike & TickSimLike;

export interface GameAudioOptions {
  /** Einstellung "Signaltöne": false schaltet Dash-bereit, Herzschlag und Zeitlupe-vorbei ab (Zonen-/Ereignistöne bleiben) */
  cuesEnabled: () => boolean;
}

export interface GameAudio {
  onEvent(ev: GameAudioEvent, sim: EventSimLike): void;
  /**
   * Einmal je Frame (auch in der Pause, dann mit `paused = true`): `dt` = Frame-Zeit in Sekunden. Die Zonen-Sperren laufen auf der Summe dieser `dt`;
   * ohne `tick`-Aufrufe öffnen sie sich nie wieder. In der Pause und in den ersten 2 s eines Laufs kommen keine Hinweise.
   */
  tick(dt: number, sim: TickSimLike, paused: boolean): void;
  /** Neuer Lauf: Hinweis-Zustand und Zonen-Zeitstempel vergessen (geschieht auch automatisch, wenn `tick` eine andere Sim sieht). */
  reset(): void;
}

/** Mindestabstand zweier aktiver Zonen-Sounds derselben Skin-Gruppe (Sekunden); begrenzt Salven mehrerer gleichzeitiger Zonen. */
export const ZONE_MIN_GAP_SEC = 0.35;
/**
 * Gesamtdeckel über alle Gruppen: höchstens zwei Zonen-Sounds je `ZONE_WINDOW_SEC`. Der Gruppen-Abstand allein lässt bis zu 3 Töne je
 * Sekunde zu (Bot-Tally Finanzamt/Cyber: Stempel + Laser-Warnung + Laser-aktiv), mehr als zwei verschiedene Zonen-Klänge pro Sekunde sind
 * nicht mehr zu unterscheiden. Die zwei Plätze sind nicht gleichwertig, damit der Deckel nie das Wichtige verdrängt:
 *  - Signal = der aktive Takt ("jetzt gefährlich"): braucht nur einen freien der zwei Plätze (`clock - zoneT2 > ZONE_WINDOW_SEC`).
 *  - Hinweis = die Warnung ("gleich gefährlich"): spielt nur in einer ganz freien Sekunde (`clock - zoneT1 > ZONE_WINDOW_SEC`). Sie belegt
 *    einen Platz, nie beide, und nimmt kein Signal vorweg, das schon im Fenster liegt.
 *  - unhörbar (`cue.volume < ZONE_AUDIBLE_VOLUME`, Zone weit neben dem Bild): wird weder gespielt noch gezählt und sperrt nichts.
 * Auch ein Hinweis kann das dritte Ereignis eines Fensters nicht verhindern (Hinweis, Signal, Signal binnen einer Sekunde: das letzte
 * fällt weg); das ist der Preis der harten Obergrenze und im Bot-Tally die Ausnahme (unter 1 % der lauten Signale).
 */
export const ZONE_WINDOW_SEC = 1;
/**
 * Unter dieser Lautstärke (-12 dB) bringt ein Zonen-Ton nichts mehr: Laser, Steinschlag, Stempel und Phasen-Glitch liegen dort im Terzband
 * meist unter der Musik (Offline-Render Wien/Cyber: Mittel -5 bis 0 dB, schlechtester Fall bis -10 dB; nur der Donner bleibt bei +1 bis +6 dB).
 * Das sind Laser- und Steinschlag-Warnungen ab ca. 300 px und alle übrigen Töne ab ca. 400 px neben dem Bildrand (`zoneCue` blendet bis auf 0.2
 * ab). Solche Töne belegen weder einen Platz im Gesamtdeckel noch sperren sie eine Gruppe. Eine Schwelle von 0.15 reichte nicht: Der Boden 0.2
 * der aktiven Töne liegt darüber, und weit entfernte Zonen verdrängten weiter laute Signale (Bot-Tally 4 Seeds x 8 Welten x 180 s: 7 statt 1
 * von 314 verworfen).
 */
export const ZONE_AUDIBLE_VOLUME = 0.25;
/** Herzschlag und Stampf-Whoosh: Lautstärken der Hinweise. */
const HEARTBEAT_VOLUME = 0.4;
const DASH_DENIED_VOLUME = 0.5;
const STOMP_START_PITCH = 0.75;
const STOMP_START_VOLUME = 0.45;
/** Pan-Spanne: Ereignis am Bildrand = ±0.6 (wie bisher). */
const PAN_SPAN = 0.6;

export function createGameAudio(audio: AudioSink, opts: GameAudioOptions): GameAudio {
  const tracker = new CueTracker();
  /** wiederverwendetes Eingabeobjekt: kein Objekt pro Frame */
  const cueIn: CueInput = { t: 0, energy: 0, dashCost: 0, dashCd: 0, hearts: 0, slowmo: 0, paused: false };
  /** Zeit (Sekunden, aus den `tick`-dt summiert) und Zeitstempel des letzten aktiven Zonen-Sounds je Skin-Gruppe */
  let clock = 0;
  const zoneLast = new Map<ZoneGroup, number>();
  /** Zeitstempel der letzten beiden gespielten Zonen-Sounds (neuester zuerst), für den Gesamtdeckel */
  let zoneT1 = -Infinity;
  let zoneT2 = -Infinity;
  let lastSim: object | null = null;

  const panOf = (x: number): number => Math.max(-1, Math.min(1, (x - VIEW_W / 2) / (VIEW_W / 2))) * PAN_SPAN;

  function playCue(name: CueName): void {
    if (name === "heartbeat") audio.sfx("heartbeat", { volume: HEARTBEAT_VOLUME });
    else audio.sfx(name);
  }

  function zoneSound(ev: GameAudioEvent, tag: string): void {
    const skin = ev.skin ?? tag.split(":")[1] ?? "";
    const group = zoneGroup(skin);
    if (!group) return;
    const active = tag.startsWith("zone-active:");
    const cue = zoneCue(skin, active ? "active" : "warn", ev.x);
    if (!cue || cue.volume < ZONE_AUDIBLE_VOLUME) return;
    if (active) {
      // Signal: Salven einer Gruppe dünnen und einen der zwei Plätze des Gesamtdeckels nehmen. Eine Warnung sperrt die Gruppe nicht.
      const last = zoneLast.get(group);
      if (last !== undefined && clock - last < ZONE_MIN_GAP_SEC) return;
      // strikt "> Fenster", damit auch ein Fenster mit beiden Rändern höchstens zwei Töne enthält
      if (clock - zoneT2 <= ZONE_WINDOW_SEC) return;
      zoneLast.set(group, clock);
    } else if (clock - zoneT1 <= ZONE_WINDOW_SEC) {
      // Hinweis: nur in einer ganz freien Sekunde (das schließt den Mindestabstand der Gruppe ein)
      return;
    }
    zoneT2 = zoneT1;
    zoneT1 = clock;
    audio.sfx(cue.name, cue.pitch === undefined ? { volume: cue.volume, pan: panOf(ev.x) } : { pitch: cue.pitch, volume: cue.volume, pan: panOf(ev.x) });
  }

  function onEvent(ev: GameAudioEvent, sim: EventSimLike): void {
    const a = audio;
    switch (ev.type) {
      case "start":
        // Lauf beginnt (auch wenn der Hub dieselbe Sim wiederverwendet): Hinweis-Zustand und Zonen-Sperren vergessen
        reset();
        break;
      case "jump":
        a.sfx("jump");
        break;
      case "doublejump":
        a.sfx("doublejump");
        break;
      case "land":
        a.sfx("land", { volume: Math.min(1, (ev.value ?? 400) / 1000) });
        break;
      case "slide":
        a.sfx("slide");
        break;
      case "dash":
        a.sfx("dash");
        break;
      case "dash-denied":
        a.sfx("ui-denied", { volume: DASH_DENIED_VOLUME });
        break;
      case "stomp-start":
        // Stampfen in der Luft: leiser, tiefer Whoosh bis zum Aufprall (vorhandenes dash-Sample)
        a.sfx("dash", { pitch: STOMP_START_PITCH, volume: STOMP_START_VOLUME });
        break;
      case "stomp-land":
        a.sfx("stomp");
        break;
      case "bounce":
        a.sfx("stomp-chain", { pitch: stompChainPitch(ev.value ?? 1) });
        break;
      case "spring":
        a.sfx("spring", { pan: panOf(ev.x) });
        break;
      case "portal":
        a.sfx("portal");
        break;
      case "coin":
        // Sim-Wert = Münzen der laufenden Kette (1 = erste): die Leiter zählt ab 0
        a.sfx("coin", { pitch: coinPitch((ev.value ?? 1) - 1), pan: panOf(ev.x) });
        break;
      case "gem":
        a.sfx("gem", { pan: panOf(ev.x) });
        break;
      case "heart":
        a.sfx("heart");
        break;
      case "powerup":
        a.sfx("powerup");
        if (ev.tag === "slowmo") a.sfx("slowmo-on");
        if (ev.tag === "magnet") a.sfx("magnet-on");
        break;
      case "shield-on":
        a.sfx("shield-on");
        break;
      case "shield-hit":
        a.sfx("shield-hit");
        break;
      case "hurt":
        a.sfx("hurt");
        a.duck?.(0.5, 0.25);
        break;
      case "death":
        a.sfx("death");
        a.duck?.(0.9, 1.2);
        break;
      case "near-miss":
        a.sfx("near-miss");
        break;
      case "combo-up":
        a.sfx("combo-up", { pitch: comboPitch(ev.value ?? 2) });
        break;
      case "combo-break":
        a.sfx("combo-break");
        break;
      case "enemy-defeat":
        a.sfx("enemy-defeat", { pan: panOf(ev.x) });
        break;
      case "wallbreak":
        a.sfx("wallbreak", { pan: panOf(ev.x) });
        break;
      case "pit-fall":
        a.sfx("splash");
        break;
      case "world-transition":
        a.sfx("world-transition");
        a.music?.play(sim.world.music, { crossfadeSec: 2 });
        break;
      case "milestone":
        a.sfx("checkpoint");
        break;
      case "custom": {
        const tag = ev.tag ?? "";
        if (tag.startsWith("sfx:")) a.sfx(tag.slice(4), { pan: panOf(ev.x) });
        else if (tag.startsWith("zone-")) zoneSound(ev, tag);
        else if (tag === "crumble") a.sfx("crumble", { pan: panOf(ev.x) });
        break;
      }
      default:
        break;
    }
  }

  function tick(dt: number, sim: TickSimLike, paused: boolean): void {
    if (dt > 0 && Number.isFinite(dt)) clock += dt;
    if (sim !== lastSim) {
      // neue Sim = neuer Lauf
      if (lastSim) reset();
      lastSim = sim;
    }
    const p = sim.player;
    cueIn.t = sim.time;
    cueIn.energy = p.energy;
    cueIn.dashCost = sim.perks.dashCost;
    cueIn.dashCd = p.dashCd;
    cueIn.hearts = p.hearts;
    cueIn.slowmo = p.slowmo;
    cueIn.paused = paused;
    // Der Tracker läuft auch bei ausgeschalteten Signaltönen mit (Zustand bleibt aktuell, kein Nachholen beim Einschalten); nur die Ausgabe entfällt
    const cues = tracker.update(cueIn);
    if (cues.length > 0 && opts.cuesEnabled()) for (const c of cues) playCue(c);
  }

  function reset(): void {
    tracker.reset();
    zoneLast.clear();
    zoneT1 = -Infinity;
    zoneT2 = -Infinity;
  }

  return { onEvent, tick, reset };
}
