"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import type { FredRunGame, GameSnapshot } from "@/game/fredrun2/game";

import styles from "./fredrun2.module.css";

/** Hinweiszeile, wenn das Profil nicht gespeichert werden kann (Privatmodus, Speicher voll). Der Rahmen ist immer im DOM, damit der Text angesagt wird. */
export function StorageNotice({ ok, className }: { ok: boolean | undefined; className?: string }): React.ReactElement {
  return (
    <div className={className} aria-live="polite">
      {ok === false ? (
        <p className={styles.storageNote}>
          Fortschritt kann in diesem Browser nicht gespeichert werden (Privatmodus?). Münzen und Einstellungen gehen beim Schließen verloren.
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  disabled,
  describedBy,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

/** Schalter-Zeile: Beschriftung mit kurzem Zusatz (eine Zeile, wenn Platz ist) und Schalter; die ganze Zeile ist klickbar. */
function SwitchRow({
  label,
  hint,
  on,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}): React.ReactElement {
  const hintId = useId();
  return (
    <label className={`${styles.field} ${styles.fieldSwitch}`}>
      <span className={styles.fieldText}>
        <span>{label}</span>
        {hint ? (
          <small id={hintId} className={styles.fieldHint}>
            {hint}
          </small>
        ) : null}
      </span>
      <Toggle on={on} onChange={onChange} label={label} disabled={disabled} describedBy={hint ? hintId : undefined} />
    </label>
  );
}

/** Prozentanzeige mit geschütztem Leerzeichen (kein Umbruch zwischen Zahl und %) */
const pct = (v: number): string => `${Math.round(v * 100)}\u00a0%`;
/** Obergrenze der Blitz-Intensität unter „Weniger Bewegung“ (Vertrag der Einstellung `flashes`) */
const FLASH_CAP_REDUCED = 0.3;

/**
 * Regler-Zeile mit Prozentanzeige. `onCommit` läuft beim Loslassen (natives change-Ereignis: Maus/Touch beim Loslassen, Tastatur je Schritt) –
 * React-onChange feuert dagegen bei jeder Bewegung.
 */
function RangeRow({
  id,
  label,
  value,
  onChange,
  onCommit,
  shown,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  /** Wirksamer Wert statt des eingestellten (z. B. „aus“ unter „Weniger Bewegung“); der Text erscheint gedimmt. */
  shown?: string;
}): React.ReactElement {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onCommit) return;
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, [onCommit]);
  return (
    <div className={`${styles.field} ${styles.fieldRange}`}>
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} type="range" min={0} max={1} step={0.05} value={value} aria-valuetext={shown ?? pct(value)} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id} className={`${styles.fieldValue} ${shown ? styles.fieldValueCapped : ""}`}>
        {shown ?? pct(value)}
      </output>
    </div>
  );
}

/** Vibration gibt es nur mit navigator.vibrate (Android) oder einem verbundenen Controller (Rumble); wird erst nach dem Mount gelesen (SSR). */
function subscribeHaptics(onChange: () => void): () => void {
  window.addEventListener("gamepadconnected", onChange);
  window.addEventListener("gamepaddisconnected", onChange);
  return () => {
    window.removeEventListener("gamepadconnected", onChange);
    window.removeEventListener("gamepaddisconnected", onChange);
  };
}
function getHapticsAvailable(): boolean {
  if (Reflect.has(navigator, "vibrate")) return true;
  try {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    for (const p of pads) if (p) return true;
  } catch {
    // Gamepad-API gesperrt (Berechtigungsrichtlinie im iframe): kein Controller
  }
  return false;
}
const getHapticsServer = (): boolean => false;

export interface SettingsFormProps {
  game: FredRunGame | null;
  snap: GameSnapshot;
  /** Systemvorgabe „Bewegung reduzieren“ (prefers-reduced-motion): der Schalter „Weniger Bewegung“ ist dann an und gesperrt. */
  systemReduced: boolean;
}

/**
 * Einstellungen-Seite des Menüs (Panel samt Titel): Gruppen Ton, Grafik & Komfort, Steuerung & Hilfen, Spieler; ab 900 px Bühnenbreite
 * zweispaltig. Das Panel selbst scrollt nie – nur der Gruppenbereich darunter (mit Verlauf am Rand, wo noch Inhalt folgt).
 */
export default function SettingsForm({ game, snap, systemReduced }: SettingsFormProps): React.ReactElement {
  const uid = useId();
  const s = snap.profile.settings;
  const [name, setName] = useState(snap.profile.name);
  const haptics = useSyncExternalStore(subscribeHaptics, getHapticsAvailable, getHapticsServer);
  const reduced = s.reducedMotion || systemReduced;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const measure = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setEdge((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    // Bühne skaliert, Hinweise brechen um, die Speicher-Zeile erscheint: Inhalt und Fenster neu vermessen
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [measure]);

  /** Hörprobe beim Loslassen von Gesamt/Effekte: eine Münze in der neuen Lautstärke (bei „Ton aus“ bleibt sie stumm, das ist gewollt). */
  const preview = useCallback((): void => {
    game?.unlockAudio();
    game?.audio.sfx("coin");
  }, [game]);

  const commitName = (): void => game?.setName(name.trim().slice(0, 16));

  return (
    <div className={`${styles.panel} ${styles.panelSettings}`}>
      <h2 className={styles.panelTitle}>Einstellungen</h2>
      <div ref={scrollRef} className={styles.setScroll} data-top={edge.top ? "true" : undefined} data-bottom={edge.bottom ? "true" : undefined} onScroll={measure}>
        <div ref={innerRef} className={styles.setCols}>
          <div className={styles.setCol}>
            <section className={styles.setGroup} aria-labelledby={`${uid}-g-sound`}>
              <h3 id={`${uid}-g-sound`} className={styles.setGroupTitle}>
                Ton
              </h3>
              <RangeRow id={`${uid}-master`} label="Gesamt" value={s.master} onChange={(v) => game?.setSettings({ master: v })} onCommit={preview} />
              <RangeRow id={`${uid}-music`} label="Musik" value={s.music} onChange={(v) => game?.setSettings({ music: v })} />
              <RangeRow id={`${uid}-sfx`} label="Effekte" value={s.sfx} onChange={(v) => game?.setSettings({ sfx: v })} onCommit={preview} />
              <SwitchRow label="Ton aus" on={s.muted} onChange={(v) => game?.setSettings({ muted: v })} />
            </section>

            <section className={styles.setGroup} aria-labelledby={`${uid}-g-help`}>
              <h3 id={`${uid}-g-help`} className={styles.setGroupTitle}>
                Steuerung &amp; Hilfen
              </h3>
              <SwitchRow label="Sprung-Assistent" hint="Tippen = voller Sprung" on={s.jumpAssist} onChange={(v) => game?.setSettings({ jumpAssist: v })} />
              <SwitchRow label="Schneller Neustart" hint="kurzer Countdown" on={s.quickRestart} onChange={(v) => game?.setSettings({ quickRestart: v })} />
              <SwitchRow label="Signaltöne" hint="Dash, Herz, Zeitlupe" on={s.cues} onChange={(v) => game?.setSettings({ cues: v })} />
            </section>
          </div>

          <div className={styles.setCol}>
            <section className={styles.setGroup} aria-labelledby={`${uid}-g-gfx`}>
              <h3 id={`${uid}-g-gfx`} className={styles.setGroupTitle}>
                Grafik &amp; Komfort
              </h3>
              <div className={styles.field}>
                <label htmlFor={`${uid}-quality`}>Qualität</label>
                <select id={`${uid}-quality`} value={s.quality} onChange={(e) => game?.setSettings({ quality: e.target.value as typeof s.quality })}>
                  <option value="auto">Automatisch</option>
                  <option value="high">Hoch</option>
                  <option value="medium">Mittel</option>
                  <option value="low">Niedrig (Akku schonen)</option>
                </select>
              </div>
              <SwitchRow
                label="Weniger Bewegung"
                hint={systemReduced ? "an (vom System vorgegeben)" : "ruhigeres Bild"}
                on={reduced}
                disabled={systemReduced}
                onChange={(v) => game?.setSettings({ reducedMotion: v })}
              />
              <RangeRow id={`${uid}-shake`} label="Wackeln" value={s.shake} onChange={(v) => game?.setSettings({ shake: v })} shown={reduced ? "aus" : undefined} />
              <RangeRow
                id={`${uid}-flashes`}
                label="Blitze"
                value={s.flashes}
                onChange={(v) => game?.setSettings({ flashes: v })}
                shown={reduced && s.flashes > FLASH_CAP_REDUCED ? `≤\u00a0${pct(FLASH_CAP_REDUCED)}` : undefined}
              />
              <SwitchRow label="Hinweise" hint="Tipps im Spiel" on={s.hints} onChange={(v) => game?.setSettings({ hints: v })} />
              <SwitchRow label="FPS-Anzeige" on={s.showFps} onChange={(v) => game?.setSettings({ showFps: v })} />
              {haptics ? <SwitchRow label="Vibration" hint="bei Treffer und Tod" on={s.haptics} onChange={(v) => game?.setSettings({ haptics: v })} /> : null}
            </section>

            <section className={styles.setGroup} aria-labelledby={`${uid}-g-player`}>
              <h3 id={`${uid}-g-player`} className={styles.setGroupTitle}>
                Spieler
              </h3>
              <div className={styles.field}>
                <label htmlFor={`${uid}-name`}>
                  Name <small className={styles.fieldHint}>für die Bestenliste</small>
                </label>
                <input
                  id={`${uid}-name`}
                  type="text"
                  value={name}
                  maxLength={16}
                  placeholder="Fred"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitName();
                    }
                  }}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
