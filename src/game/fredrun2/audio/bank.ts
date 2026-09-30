/**
 * Sample-Bank der Klangeffekte.
 *
 * Alle Sample-Effekte stecken in EINER MP3-Sprite-Datei (`sfx-bank.mp3`) plus Manifest (`sfx-bank.json`, gebaut von
 * `tools/fredrun2/build_sfx_bank.py`). Nach dem Unlock wird beides geladen, dekodiert und in kleine mono `AudioBuffer`
 * pro Variante zerlegt (der große Puffer wird danach freigegeben). Bis dahin – und für Effekte ohne Sample – spielt
 * weiter die prozedurale Stimme aus `sfx.ts`; die Bank ist also reine Verbesserung, nie Voraussetzung.
 *
 * Der Datei-Teil ist absichtlich in reine Funktionen getrennt (`parseManifest`, `VariantPicker`, `syncShift`,
 * `sliceFrames`, `jitterRate`), damit die Logik in Vitest ohne echten AudioContext testbar ist (`bank.test.ts`).
 */
import { withRev } from "../asset-rev";
import { clamp, makePanner } from "./dsp";
import { SFX_NAMES } from "./types";
import type { SfxOptions } from "./types";

/** Ordner der Bank-Dateien (Next liefert `public/` unter `/`). */
export const BANK_BASE_URL = "/fredrun2/audio/";
export const BANK_MANIFEST_FILE = "sfx-bank.json";
export const BANK_FORMAT_VERSION = 1;

// -----------------------------------------------------------------------------------------------------------------
// Manifest
// -----------------------------------------------------------------------------------------------------------------
export interface BankVariant {
  /** Beginn im Sprite in Sekunden (nach Encoder-Delay-Ausgleich) */
  start: number;
  /** Länge in Sekunden */
  dur: number;
  /** optionaler Feinabgleich dieser Variante (linear) */
  gain?: number;
}

export interface BankSweep {
  from: number;
  to: number;
  /** Richtung zufällig spiegeln (Vorbeiflug von links oder rechts) */
  flip?: boolean;
}

export interface BankEffect {
  variants: BankVariant[];
  /** Standard-Verstärkung (linear, Standard 1) */
  gain?: number;
  /** Zufällige Tonhöhe: ± Anteil (0.03 = ±3 %) */
  pitchJitter?: number;
  /** Standard-Panorama, falls der Aufrufer keins übergibt */
  pan?: number;
  /** Pan-Fahrt über die Dauer des Effekts (nur ohne Aufrufer-Pan) */
  sweep?: BankSweep;
  /** Reverb-Send 0..1 (überschreibt `SFX_META.reverb` für dieses Sample) */
  reverb?: number;
}

export interface BankManifest {
  version: number;
  /** Dateiname der MP3 im selben Ordner */
  file: string;
  /** Kurz-Hash der MP3 (Cache-Buster) */
  rev?: string;
  sampleRate: number;
  /** Gesamtlänge des Sprites in Sekunden */
  duration: number;
  /** Sync-Puls zum Ausmessen des MP3-Encoder-Delays (Sekunden im Sprite) */
  sync?: { at: number };
  effects: Record<string, BankEffect>;
}

export type ManifestResult = { ok: true; manifest: BankManifest } | { ok: false; errors: string[] };

/** Kleinster erlaubter Abstand zwischen zwei Slices im Sprite (Bank-Builder legt 0.15 s). */
export const MIN_SLICE_GAP = 0.02;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Prüft ein Roh-Manifest (JSON) streng: Namen ∈ `names`, plausible Zeiten, keine überlappenden Slices, Werte im Bereich.
 * Liefert entweder das geprüfte Manifest oder eine Liste lesbarer Fehler (nie eine Ausnahme).
 */
export function parseManifest(raw: unknown, names: readonly string[] = SFX_NAMES): ManifestResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["Manifest ist kein Objekt"] };
  if (raw.version !== BANK_FORMAT_VERSION) errors.push(`version ${String(raw.version)} wird nicht unterstützt (erwartet ${BANK_FORMAT_VERSION})`);
  const file = raw.file;
  if (typeof file !== "string" || !/^[A-Za-z0-9._-]+$/.test(file) || file.startsWith(".")) errors.push("file: einfacher Dateiname erwartet");
  const sampleRate = raw.sampleRate;
  if (!isNum(sampleRate) || sampleRate < 8000 || sampleRate > 96000) errors.push("sampleRate außerhalb 8000..96000");
  const duration = raw.duration;
  if (!isNum(duration) || duration <= 0 || duration > 600) errors.push("duration außerhalb 0..600 s");
  const rev = raw.rev;
  if (rev !== undefined && (typeof rev !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(rev))) errors.push("rev: kurzer alphanumerischer String erwartet");
  let sync: { at: number } | undefined;
  if (raw.sync !== undefined) {
    if (isObj(raw.sync) && isNum(raw.sync.at) && isNum(duration) && raw.sync.at > 0 && raw.sync.at < duration) sync = { at: raw.sync.at };
    else errors.push("sync.at außerhalb des Sprites");
  }
  const effects: Record<string, BankEffect> = {};
  const slices: Array<{ label: string; start: number; end: number }> = [];
  if (!isObj(raw.effects) || Object.keys(raw.effects).length === 0) {
    errors.push("effects fehlt oder ist leer");
  } else {
    for (const [name, e] of Object.entries(raw.effects)) {
      if (!names.includes(name)) {
        errors.push(`${name}: unbekannter Effekt-Name`);
        continue;
      }
      if (!isObj(e) || !Array.isArray(e.variants) || e.variants.length === 0 || e.variants.length > 16) {
        errors.push(`${name}: variants (1..16) fehlt`);
        continue;
      }
      const eff: BankEffect = { variants: [] };
      e.variants.forEach((v: unknown, i: number) => {
        const label = `${name}#${i}`;
        if (!isObj(v) || !isNum(v.start) || !isNum(v.dur)) {
          errors.push(`${label}: start/dur fehlen`);
          return;
        }
        if (v.start < 0 || v.dur < 0.005 || v.dur > 10) errors.push(`${label}: unplausible Zeiten (start ${v.start}, dur ${v.dur})`);
        else if (isNum(duration) && v.start + v.dur > duration + 1e-6) errors.push(`${label}: ragt über das Sprite hinaus`);
        else {
          const variant: BankVariant = { start: v.start, dur: v.dur };
          if (v.gain !== undefined) {
            if (isNum(v.gain) && v.gain > 0 && v.gain <= 4) variant.gain = v.gain;
            else errors.push(`${label}: gain außerhalb 0..4`);
          }
          eff.variants.push(variant);
          slices.push({ label, start: v.start, end: v.start + v.dur });
        }
      });
      const range = (key: "gain" | "pitchJitter" | "pan" | "reverb", lo: number, hi: number): void => {
        const v = e[key];
        if (v === undefined) return;
        if (isNum(v) && v >= lo && v <= hi) eff[key] = v;
        else errors.push(`${name}.${key} außerhalb ${lo}..${hi}`);
      };
      range("gain", 0.01, 4);
      range("pitchJitter", 0, 0.25);
      range("pan", -1, 1);
      range("reverb", 0, 1);
      if (e.sweep !== undefined) {
        const s = e.sweep;
        if (isObj(s) && isNum(s.from) && isNum(s.to) && Math.abs(s.from) <= 1 && Math.abs(s.to) <= 1) eff.sweep = { from: s.from, to: s.to, ...(s.flip === true ? { flip: true } : {}) };
        else errors.push(`${name}.sweep ungültig`);
      }
      effects[name] = eff;
    }
  }
  slices.sort((a, b) => a.start - b.start);
  for (let i = 1; i < slices.length; i++) {
    const prev = slices[i - 1]!;
    const cur = slices[i]!;
    if (cur.start < prev.end + MIN_SLICE_GAP) errors.push(`${prev.label} und ${cur.label} überlappen bzw. liegen zu dicht`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: { version: BANK_FORMAT_VERSION, file: file as string, rev: rev as string | undefined, sampleRate: sampleRate as number, duration: duration as number, sync, effects },
  };
}

// -----------------------------------------------------------------------------------------------------------------
// Reine Hilfslogik
// -----------------------------------------------------------------------------------------------------------------
/**
 * Variantenwahl: "Zufalls-Beutel" – jede Variante kommt einmal pro Runde in zufälliger Reihenfolge dran, und die erste
 * einer neuen Runde ist nie die letzte der vorigen. Dadurch wiederholt sich nie unmittelbar dieselbe Variante, und keine
 * Variante bleibt lange ungespielt (klingt lebendiger als reiner Zufall, ohne hörbares Muster wie bei Round-Robin).
 */
export class VariantPicker {
  private readonly bags = new Map<string, number[]>();
  private readonly last = new Map<string, number>();

  constructor(private readonly rnd: () => number = Math.random) {}

  next(name: string, count: number): number {
    if (count <= 1) return 0;
    let bag = this.bags.get(name);
    if (!bag || bag.length === 0 || bag.some((i) => i >= count)) {
      bag = Array.from({ length: count }, (_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(this.rnd() * (i + 1)));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      const last = this.last.get(name);
      if (last !== undefined && bag[0] === last) {
        const j = 1 + Math.min(bag.length - 2, Math.floor(this.rnd() * (bag.length - 1)));
        [bag[0], bag[j]] = [bag[j]!, bag[0]!];
      }
      this.bags.set(name, bag);
    }
    const i = bag.shift()!;
    this.last.set(name, i);
    return i;
  }
}

/** Abspielrate = angeforderte Tonhöhe × zufälliger Jitter (± `jitter`), auf sinnvollen Bereich begrenzt. */
export function jitterRate(pitch: number, jitter: number, rnd: () => number): number {
  const p = Number.isFinite(pitch) && pitch > 0 ? pitch : 1;
  const j = jitter > 0 ? 1 + (rnd() * 2 - 1) * jitter : 1;
  return clamp(p * j, 0.25, 3);
}

/**
 * Sync-Puls suchen: erster Wert ≥ 40 % des Fenstermaximums in [at − half, at + half]. Muss zu `detect_sync()` im
 * Bank-Builder passen. Gibt die Zeit (s) zurück oder `null`, wenn kein Puls erkennbar ist.
 */
export function detectSync(data: ArrayLike<number>, sampleRate: number, at: number, half = 0.05): number | null {
  const a = Math.max(0, Math.floor((at - half) * sampleRate));
  const b = Math.min(data.length, Math.floor((at + half) * sampleRate));
  let max = 0;
  for (let i = a; i < b; i++) max = Math.max(max, Math.abs(data[i]!));
  if (max < 0.05) return null;
  for (let i = a; i < b; i++) {
    if (Math.abs(data[i]!) >= 0.4 * max) return i / sampleRate;
  }
  return null;
}

/**
 * Korrektur (s), um die die Slices verschoben werden müssen, weil der Browser den MP3-Encoder-Delay nicht (oder anders)
 * herausgerechnet hat. Kleine Abweichungen (< 3 ms) und unplausible (> 80 ms) werden ignoriert.
 */
export function syncShift(detected: number | null, expected: number): number {
  if (detected === null) return 0;
  const d = detected - expected;
  return Math.abs(d) >= 0.003 && Math.abs(d) <= 0.08 ? d : 0;
}

/** Sample-Bereich [von, bis) einer Variante im dekodierten Puffer, oder `null`, wenn er (fast) leer wäre. */
export function sliceFrames(v: BankVariant, shift: number, sampleRate: number, totalFrames: number): [number, number] | null {
  const from = Math.max(0, Math.round((v.start + shift) * sampleRate));
  const to = Math.min(totalFrames, Math.round((v.start + shift + v.dur) * sampleRate));
  return to - from >= 8 ? [from, to] : null;
}

// -----------------------------------------------------------------------------------------------------------------
// Bank (Web Audio)
// -----------------------------------------------------------------------------------------------------------------
export interface BankVoice {
  readonly name: string;
  /** AudioContext-Zeit, zu der die Stimme (bei aktueller Rate) endet */
  readonly endTime: number;
  /** Klickfrei ausblenden und stoppen */
  stop(when?: number): void;
}

export interface BankPlayOptions extends SfxOptions {
  /** AudioContext-Startzeit (Standard: jetzt) */
  when?: number;
  /** Nach dem Ende (auch nach `stop`) genau einmal aufgerufen, Knoten sind dann bereits getrennt */
  onEnded?: () => void;
  /** false: Manifest-Standard-Pan und -Sweep NICHT anwenden (der Aufrufer regelt das Panorama selbst) */
  autoPan?: boolean;
}

export interface BankOptions {
  baseUrl?: string;
  fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
  rnd?: () => number;
  /** gleichzeitige Stimmen pro Effekt (Sicherheitsnetz; `SfxPlayer` begrenzt bereits) */
  maxVoices?: number;
  names?: readonly string[];
}

/** decodeAudioData mit Promise- UND Callback-Variante (ältere Safari-Versionen kennen nur Callbacks). */
export function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

class Voice implements BankVoice {
  ended = false;
  constructor(
    readonly name: string,
    readonly endTime: number,
    private readonly src: AudioBufferSourceNode,
    private readonly out: GainNode,
    private readonly ctx: BaseAudioContext,
  ) {}

  stop(when?: number): void {
    if (this.ended) return;
    const t = Math.max(when ?? 0, this.ctx.currentTime);
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.006);
      this.src.stop(t + 0.05);
    } catch {
      /* schon gestoppt */
    }
  }
}

export class SfxBank {
  private manifest: BankManifest | null = null;
  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly active = new Map<string, Set<Voice>>();
  private readonly picker: VariantPicker;
  private readonly rnd: () => number;
  private loading: Promise<boolean> | null = null;
  private disposed = false;
  /** Grund des letzten Ladefehlers (Debug/Rauchtest); die Bank bleibt dann einfach leer. */
  error: string | null = null;
  /** Gemessener Encoder-Delay-Ausgleich in Sekunden (Debug/Rauchtest). */
  appliedShift = 0;
  played = 0;

  constructor(private readonly ctx: BaseAudioContext, private readonly opts: BankOptions = {}) {
    this.rnd = opts.rnd ?? Math.random;
    this.picker = new VariantPicker(this.rnd);
  }

  get ready(): boolean {
    return this.manifest !== null && !this.disposed;
  }

  /** Effekte, die die Bank beherrscht (leer bis zum erfolgreichen Laden). */
  names(): string[] {
    return this.manifest ? Object.keys(this.manifest.effects) : [];
  }

  has(name: string): boolean {
    return this.ready && this.buffers.has(name);
  }

  info(name: string): BankEffect | undefined {
    return this.has(name) ? this.manifest?.effects[name] : undefined;
  }

  /** Dekodierte Varianten eines Effekts (Tests/Diagnose). */
  variants(name: string): readonly AudioBuffer[] {
    return this.buffers.get(name) ?? [];
  }

  /** Lädt Manifest + MP3 (einmalig, idempotent). Löst immer auf; `false` = nicht verfügbar → prozedurale Stimmen bleiben. */
  load(): Promise<boolean> {
    this.loading ??= this.doLoad().catch((e: unknown) => {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    });
    return this.loading;
  }

  private async doLoad(): Promise<boolean> {
    const doFetch = this.opts.fetch ?? (typeof fetch === "function" ? (u: string) => fetch(u, { credentials: "same-origin" }) : null);
    if (!doFetch) throw new Error("kein fetch verfügbar");
    const base = this.opts.baseUrl ?? BANK_BASE_URL;
    const res = await doFetch(withRev(base + BANK_MANIFEST_FILE));
    if (!res.ok) throw new Error("Manifest nicht ladbar");
    const parsed = parseManifest(await res.json(), this.opts.names);
    if (!parsed.ok) throw new Error("Manifest ungültig: " + parsed.errors.slice(0, 3).join("; "));
    const m = parsed.manifest;
    const mp3 = await doFetch(m.rev ? `${base}${m.file}?v=${m.rev}` : withRev(base + m.file));
    if (!mp3.ok) throw new Error("MP3 nicht ladbar");
    const data = await mp3.arrayBuffer();
    if (this.disposed) return false;
    const decoded = await decodeAudio(this.ctx, data);
    if (this.disposed) return false;

    const sr = decoded.sampleRate;
    const pcm = decoded.getChannelData(0);
    // Encoder-Delay: Browser, die die LAME-Gapless-Info ignorieren, liefern den Sprite verschoben – per Sync-Puls messen
    const shift = m.sync ? syncShift(detectSync(pcm, sr, m.sync.at), m.sync.at) : 0;
    this.appliedShift = shift;
    for (const [name, eff] of Object.entries(m.effects)) {
      const list: AudioBuffer[] = [];
      for (const v of eff.variants) {
        const r = sliceFrames(v, shift, sr, pcm.length);
        if (!r) continue;
        const buf = this.ctx.createBuffer(1, r[1] - r[0], sr);
        buf.getChannelData(0).set(pcm.subarray(r[0], r[1]));
        list.push(buf);
      }
      if (list.length > 0) this.buffers.set(name, list);
    }
    this.manifest = m;
    return this.buffers.size > 0;
  }

  /**
   * Spielt einen Sample-Effekt in `dest`. Wählt die Variante (nie zweimal dieselbe hintereinander), wendet Tonhöhe ×
   * Jitter, Lautstärke, Manifest-Gain und Panorama an. Gibt `null` zurück, wenn der Effekt nicht in der Bank ist.
   */
  play(name: string, dest: AudioNode, o: BankPlayOptions = {}): BankVoice | null {
    if (!this.has(name)) return null;
    const eff = this.manifest!.effects[name]!;
    const bufs = this.buffers.get(name)!;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const when = Math.max(o.when ?? now, now);

    // Sicherheitsnetz: zu viele gleichzeitige Stimmen -> die älteste weich ausblenden
    let set = this.active.get(name);
    if (!set) this.active.set(name, (set = new Set()));
    const cap = this.opts.maxVoices ?? 6;
    while (set.size >= cap) {
      const oldest = set.values().next().value as Voice | undefined;
      if (!oldest) break;
      oldest.stop(now);
      set.delete(oldest);
    }

    const idx = this.picker.next(name, bufs.length);
    const buf = bufs[idx]!;
    const variant = eff.variants[idx] ?? eff.variants[0]!;
    const rate = jitterRate(o.pitch ?? 1, eff.pitchJitter ?? 0, this.rnd);
    const dur = buf.duration / rate;

    let src: AudioBufferSourceNode;
    let out: GainNode;
    try {
      src = ctx.createBufferSource();
      out = ctx.createGain();
    } catch {
      return null;
    }
    src.buffer = buf;
    src.playbackRate.value = rate;
    out.gain.value = clamp((o.volume ?? 1) * (eff.gain ?? 1) * (variant.gain ?? 1), 0, 4);

    // Panorama (nur wenn nötig, StereoPanner kann fehlen)
    const auto = o.autoPan !== false;
    let pan = clamp(o.pan ?? (auto ? (eff.pan ?? 0) : 0), -1, 1);
    let sweep: { from: number; to: number } | null = null;
    if (auto && o.pan === undefined && eff.sweep) {
      const dir = eff.sweep.flip && this.rnd() < 0.5 ? -1 : 1;
      sweep = { from: eff.sweep.from * dir, to: eff.sweep.to * dir };
      pan = sweep.from;
    }
    const panner = pan !== 0 || sweep ? makePanner(ctx, pan) : null;
    src.connect(out);
    if (panner) {
      out.connect(panner);
      panner.connect(dest);
      if (sweep) {
        panner.pan.setValueAtTime(sweep.from, when);
        panner.pan.linearRampToValueAtTime(sweep.to, when + dur);
      }
    } else {
      out.connect(dest);
    }

    const voice = new Voice(name, when + dur, src, out, ctx);
    src.onended = () => {
      voice.ended = true;
      set.delete(voice);
      try {
        src.disconnect();
        out.disconnect();
        panner?.disconnect();
      } catch {
        /* schon getrennt */
      }
      o.onEnded?.();
    };
    try {
      src.start(when);
    } catch {
      src.onended = null;
      try {
        src.disconnect();
        out.disconnect();
        panner?.disconnect();
      } catch {
        /* egal */
      }
      return null;
    }
    set.add(voice);
    this.played++;
    return voice;
  }

  /** Stoppt alle Stimmen und gibt die Puffer frei. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const set of this.active.values()) for (const v of set) v.stop(0);
    this.active.clear();
    this.buffers.clear();
    this.manifest = null;
  }
}
