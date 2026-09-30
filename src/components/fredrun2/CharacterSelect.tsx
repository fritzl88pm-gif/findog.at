"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadCharacter, type CharacterSprites } from "@/game/fredrun2/assets";
import { CHARACTERS, type CharacterPerks } from "@/game/fredrun2/characters";
import { MAGNET_RADIUS } from "@/game/fredrun2/constants";
import type { FredRunGame } from "@/game/fredrun2/game";
import type { Profile } from "@/game/fredrun2/profile";
import { CHARACTER_IDS, type CharacterId } from "@/game/fredrun2/types";

import { ACTION_LABEL, ACTION_ORDER, CharacterStage, drawPortrait, type ActionId } from "./characterStage";
import styles from "./characterselect.module.css";

export interface CharacterSelectProps {
  profile: Profile;
  game: FredRunGame | null;
  /** Einstellung „Weniger Bewegung“ aus dem Profil (die System-Einstellung wird zusätzlich beachtet). */
  reducedMotion?: boolean;
}

// --- Werte ------------------------------------------------------------------------------------------

const nf = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 });
const fmt = (n: number): string => Math.floor(n).toLocaleString("de-AT");

function modeOf(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? 1;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Standardwerte = häufigster Wert im Kader (entspricht den Basiswerten der Engine). */
const BASE = (() => {
  const all = CHARACTER_IDS.map((id) => CHARACTERS[id].perks);
  return {
    energyGain: modeOf(all.map((p) => p.energyGain)),
    dashCost: modeOf(all.map((p) => p.dashCost)),
    dashTimeScale: modeOf(all.map((p) => p.dashTimeScale)),
    stompRadius: modeOf(all.map((p) => p.stompRadius)),
  };
})();

const GLIDE_CAP = 3; // Sekunden = volle Leiste

interface StatRow {
  key: string;
  label: string;
  /** 0..1, Basiswert = 0.5 (bei relativen Werten) */
  fill: number;
  value: string;
  boosted: boolean;
  /** Markierung „Standard“ bei 50 % */
  tick: boolean;
}

function relValue(r: number): { text: string; boosted: boolean } {
  const pct = Math.round((r - 1) * 100);
  if (pct === 0) return { text: "Normal", boosted: false };
  return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`, boosted: pct > 0 };
}

function statsOf(p: CharacterPerks): StatRow[] {
  const energy = p.energyGain / BASE.energyGain;
  const dashEff = BASE.dashCost / p.dashCost;
  const dashLen = p.dashTimeScale / BASE.dashTimeScale;
  const stomp = p.stompRadius / BASE.stompRadius;
  const e = relValue(energy);
  const de = relValue(dashEff);
  const dl = relValue(dashLen);
  return [
    { key: "energy", label: "Energie-Laden", fill: Math.min(1, energy * 0.5), value: e.text, boosted: e.boosted, tick: true },
    { key: "dashCost", label: "Dash-Effizienz", fill: Math.min(1, dashEff * 0.5), value: de.text, boosted: de.boosted, tick: true },
    { key: "dashLen", label: "Dash-Länge", fill: Math.min(1, dashLen * 0.5), value: dl.text, boosted: dl.boosted, tick: true },
    {
      key: "stomp",
      label: "Stampf-Radius",
      fill: Math.min(1, stomp * 0.5),
      value: Math.abs(stomp - 1) < 0.02 ? "Normal" : `×${nf.format(stomp)}`,
      boosted: stomp > 1.02,
      tick: true,
    },
    {
      key: "glide",
      label: "Gleiten",
      fill: Math.min(1, p.glideTime / GLIDE_CAP),
      value: p.glideTime > 0 ? `${nf.format(p.glideTime)} s` : "–",
      boosted: p.glideTime > 0,
      tick: false,
    },
    {
      key: "magnet",
      label: "Münz-Sog",
      fill: Math.min(1, p.passiveMagnet / MAGNET_RADIUS),
      value: p.passiveMagnet > 0 ? `${fmt(p.passiveMagnet)} px` : "–",
      boosted: p.passiveMagnet > 0,
      tick: false,
    },
  ];
}

// --- Icons ------------------------------------------------------------------------------------------

function LockIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 10V8a5 5 0 0 1 10 0v2h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7Zm2 0h6V8a3 3 0 0 0-6 0v2Zm3 4a1.6 1.6 0 0 0-.8 3v1.6h1.6V17a1.6 1.6 0 0 0-.8-3Z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={dir === "left" ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AbilityIcon({ id }: { id: CharacterId }): React.ReactElement {
  switch (id) {
    case "fred": // Spürnase: Münz-Magnet
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 3h5v9a2 2 0 0 0 4 0V3h5v9a7 7 0 0 1-14 0V3Z" fill="currentColor" />
          <path d="M5 3h5v4H5V3Zm9 0h5v4h-5V3Z" fill="#fff" opacity=".55" />
        </svg>
      );
    case "frida": // Blitzstart: Blitz
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13.5 1.8 4.6 13.4h6L9.2 22.2l10.2-12.6h-6.3l.4-7.8Z" fill="currentColor" />
        </svg>
      );
    case "superfred": // Cape-Gleiter
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.5 7.5c3.2 1.6 6.2 2.3 9.5 2.3s6.3-.7 9.5-2.3c-.6 5.6-3.6 10.4-9.5 13.5C6.100 17.900 3.100 13.100 2.500 7.500Z" fill="currentColor" />
          <path d="M12 9.800V21" stroke="#fff" strokeWidth="1.400" opacity=".5" />
        </svg>
      );
    case "cyberfred": // Düsen-Dash
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m4 5 7.500 7L4 19M12.500 5l7.500 7-7.500 7" fill="none" stroke="currentColor" strokeWidth="3.400" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "superfrida": // Super-Stampfer
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 2.500v11m-5-4.500 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="3.200" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2.500 18.500c3-1.800 6-1.800 9.500 0s6.500 1.800 9.500 0M5.500 22h13" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" opacity=".8" />
        </svg>
      );
  }
}

// --- Roster-Kachel ---------------------------------------------------------------------------------

function Portrait({ id, locked }: { id: CharacterId; locked: boolean }): React.ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let dead = false;
    let sprites: CharacterSprites | null = null;
    let cw = 0;
    let ch = 0;
    const paint = (): void => {
      if (!dead && cw > 0) drawPortrait(canvas, sprites, locked, cw, ch);
    };
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      cw = r.width;
      ch = r.height;
      paint();
    });
    ro.observe(canvas);
    void loadCharacter(id, ["idle"]).then((s) => {
      sprites = s;
      paint();
    });
    return () => {
      dead = true;
      ro.disconnect();
    };
  }, [id, locked]);
  return <canvas ref={ref} className={styles.portrait} aria-hidden="true" />;
}

interface TileProps {
  id: CharacterId;
  viewed: boolean;
  current: boolean;
  owned: boolean;
  radioRef: (el: HTMLButtonElement | null) => void;
  onView: (id: CharacterId) => void;
  onPrimary: (id: CharacterId) => void;
}

function RosterTile({ id, viewed, current, owned, radioRef, onView, onPrimary }: TileProps): React.ReactElement {
  const c = CHARACTERS[id];
  const status = current ? "aktueller Held" : owned ? "freigeschaltet" : `gesperrt, ${fmt(c.price)} Münzen`;
  return (
    <button
      ref={radioRef}
      type="button"
      role="radio"
      aria-checked={viewed}
      aria-label={`${c.name} – ${status}`}
      tabIndex={viewed ? 0 : -1}
      className={`${styles.tile} ${viewed ? styles.tileOn : ""} ${owned ? "" : styles.tileLocked}`}
      style={{ ["--c1" as string]: c.color, ["--c2" as string]: c.colorDark }}
      onClick={(e) => {
        if (e.detail === 0) return; // Tastatur-Aktivierung läuft über onKeyDown
        onView(id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPrimary(id);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " ") e.preventDefault();
      }}
    >
      <Portrait id={id} locked={!owned} />
      <span className={styles.tileText}>
        <span className={styles.tileName}>{c.name}</span>
        <span className={styles.tileMeta}>
          {owned ? (
            current ? (
              <span className={styles.tileActive}>Aktiv</span>
            ) : (
              <span>Bereit</span>
            )
          ) : (
            <>
              <i className={styles.coin} aria-hidden="true" />
              {fmt(c.price)}
            </>
          )}
        </span>
      </span>
      {!owned ? (
        <span className={styles.lockBadge} aria-hidden="true">
          <LockIcon />
        </span>
      ) : current ? (
        <span className={styles.checkBadge} aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
    </button>
  );
}

// --- Hauptkomponente --------------------------------------------------------------------------------

export default function CharacterSelect({ profile, game, reducedMotion = false }: CharacterSelectProps): React.ReactElement {
  const [view, setView] = useState<CharacterId>(profile.character);
  const [avail, setAvail] = useState<Partial<Record<CharacterId, ActionId[]>>>({});
  const [playing, setPlaying] = useState<ActionId | null>(null);
  const [shaking, setShaking] = useState(false);
  const [announce, setAnnounce] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<CharacterStage | null>(null);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const shakeTimer = useRef<number>(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const def = CHARACTERS[view];
  const owned = profile.unlocked.includes(view);
  const current = profile.character === view;
  const missing = Math.max(0, def.price - profile.coins);
  const index = CHARACTER_IDS.indexOf(view);
  const stats = statsOf(def.perks);
  const actions = avail[view];

  const ui = useCallback(
    (name: "ui-click" | "ui-hover"): void => {
      game?.unlockAudio();
      game?.audio.sfx(name);
    },
    [game],
  );

  // Bühne anlegen / abbauen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new CharacterStage(canvas);
    stage.onAction = setPlaying;
    stage.onAvailable = (id, list) => setAvail((prev) => ({ ...prev, [id]: list }));
    stageRef.current = stage;
    stage.start();
    return () => {
      stage.destroy();
      stageRef.current = null;
      window.clearTimeout(shakeTimer.current);
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // Bühne mit der angezeigten Figur abgleichen
  useEffect(() => {
    const d = CHARACTERS[view];
    stageRef.current?.setHero({ id: d.id, color: d.color, colorDark: d.colorDark, perks: d.perks }, !owned);
  }, [view, owned]);

  const goTo = useCallback(
    (id: CharacterId): void => {
      if (id === view) return;
      setView(id);
      ui("ui-hover");
    },
    [view, ui],
  );

  const step = useCallback(
    (dir: 1 | -1, focus: boolean): void => {
      const n = CHARACTER_IDS.length;
      const next = (CHARACTER_IDS.indexOf(view) + dir + n) % n;
      goTo(CHARACTER_IDS[next]);
      if (focus) radios.current[next]?.focus();
    },
    [view, goTo],
  );

  // Pfeiltasten wechseln die Ansicht (auch wenn der Fokus noch auf dem Tab liegt)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const inRail = radios.current.some((r) => r !== null && r === document.activeElement);
      step(dir, inRail);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const triggerShake = useCallback((): void => {
    setShaking(false);
    window.clearTimeout(shakeTimer.current);
    // Neustart der CSS-Animation im nächsten Frame
    shakeTimer.current = window.setTimeout(() => {
      setShaking(true);
      shakeTimer.current = window.setTimeout(() => setShaking(false), 520);
    }, 16);
  }, []);

  /** Auswählen bzw. kaufen (Enter/Leertaste auf der Kachel, Haupt-Schaltfläche). */
  const primary = useCallback(
    (id: CharacterId): void => {
      if (!game) return;
      const d = CHARACTERS[id];
      game.unlockAudio();
      if (profile.unlocked.includes(id)) {
        if (profile.character === id) {
          setAnnounce(`${d.name} ist bereits ausgewählt.`);
          return;
        }
        game.audio.sfx("ui-click");
        void game.selectCharacter(id);
        setAnnounce(`${d.name} ausgewählt.`);
        return;
      }
      const status = game.buyCharacter(id); // spielt ui-buy bzw. ui-denied selbst
      if (status === "insufficient") {
        triggerShake();
        setAnnounce(`Dir fehlen noch ${Math.max(0, d.price - profile.coins)} Münzen für ${d.name}.`);
      } else if (status === "purchased") {
        setAnnounce(`${d.name} freigeschaltet und ausgewählt.`);
      }
    },
    [game, profile.unlocked, profile.character, profile.coins, triggerShake],
  );

  const onView = useCallback((id: CharacterId): void => goTo(id), [goTo]);

  const onChip = (a: ActionId): void => {
    ui("ui-click");
    stageRef.current?.play(a);
  };

  const canAfford = profile.coins >= def.price;
  const vars = { ["--c1" as string]: def.color, ["--c2" as string]: def.colorDark, ["--nl" as string]: def.name.length };

  let badge: React.ReactNode;
  if (current) {
    badge = (
      <>
        <CheckIcon /> Aktueller Held
      </>
    );
  } else if (owned) {
    badge = "Freigeschaltet";
  } else {
    badge = (
      <>
        <LockIcon /> Gesperrt – nur Vorschau
      </>
    );
  }

  return (
    <div className={styles.root} style={vars} data-reduced={reducedMotion ? "true" : undefined}>
      {/* Roster */}
      <div className={styles.rail} role="radiogroup" aria-label="Held wählen">
        {CHARACTER_IDS.map((id, i) => (
          <RosterTile
            key={id}
            id={id}
            viewed={view === id}
            current={profile.character === id}
            owned={profile.unlocked.includes(id)}
            radioRef={(el) => {
              radios.current[i] = el;
            }}
            onView={onView}
            onPrimary={primary}
          />
        ))}
      </div>

      {/* Bühne */}
      <section
        className={styles.stageCard}
        aria-label={`Vorschau ${def.name}`}
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1, false);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <div className={`${styles.badge} ${!owned ? styles.badgeLocked : current ? styles.badgeCurrent : ""}`}>{badge}</div>
        <div className={styles.counter} aria-hidden="true">
          {index + 1} / {CHARACTER_IDS.length}
        </div>
        <button type="button" className={`${styles.nav} ${styles.navPrev}`} tabIndex={-1} aria-hidden="true" onClick={() => step(-1, false)}>
          <ChevronIcon dir="left" />
        </button>
        <button type="button" className={`${styles.nav} ${styles.navNext}`} tabIndex={-1} aria-hidden="true" onClick={() => step(1, false)}>
          <ChevronIcon dir="right" />
        </button>
        {!owned ? (
          <div className={styles.lockSeal} aria-hidden="true">
            <LockIcon />
          </div>
        ) : null}
        <div className={styles.chips} role="group" aria-label="Bewegungen ansehen">
          {actions
            ? ACTION_ORDER.filter((a) => actions.includes(a)).map((a) => (
                <button key={a} type="button" className={styles.chip} aria-pressed={playing === a} onClick={() => onChip(a)}>
                  {ACTION_LABEL[a]}
                </button>
              ))
            : null}
        </div>
      </section>

      {/* Info */}
      <section className={styles.info} aria-label={`Details zu ${def.name}`}>
        <div className={styles.infoBody} key={view}>
          <h2 className={styles.name}>{def.name}</h2>
          <p className={styles.tagline}>{def.tagline}</p>

          <div className={styles.ability}>
            <span className={styles.abilityIcon}>
              <AbilityIcon id={view} />
            </span>
            <span className={styles.abilityText}>
              <strong>{def.abilityName}</strong>
              <span>{def.abilityText}</span>
            </span>
          </div>

          <ul className={styles.stats} aria-label="Werte im Vergleich zum Standard">
            {stats.map((s, i) => (
              <li key={s.key} className={`${styles.stat} ${s.boosted ? styles.statBoost : ""}`} style={{ ["--i" as string]: i }}>
                <span className={styles.statLabel}>{s.label}</span>
                <span className={styles.statBar} aria-hidden="true">
                  <span className={styles.statFill} style={{ width: `${Math.round(s.fill * 100)}%` }} />
                  {s.tick ? <span className={styles.statTick} /> : null}
                </span>
                <span className={styles.statValue}>{s.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.actions}>
          {owned ? (
            <button
              type="button"
              className={`${styles.cta} ${current ? styles.ctaSelected : styles.ctaSelect}`}
              aria-disabled={current}
              onClick={() => primary(view)}
            >
              {current ? (
                <>
                  Ausgewählt <CheckIcon />
                </>
              ) : (
                "Auswählen"
              )}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.cta} ${styles.ctaBuy} ${canAfford ? "" : styles.ctaPoor} ${shaking ? styles.shake : ""}`}
              aria-disabled={!canAfford}
              onClick={() => primary(view)}
            >
              Kaufen – {fmt(def.price)} <i className={styles.coin} aria-hidden="true" />
              <span className={styles.srOnly}>Münzen</span>
            </button>
          )}
          <p className={`${styles.ctaSub} ${!owned && !canAfford ? styles.ctaSubPoor : ""} ${shaking ? styles.shake : ""}`}>
            {!owned
              ? canAfford
                ? `Du hast ${fmt(profile.coins)} Münzen.`
                : `Dir fehl${missing === 1 ? "t" : "en"} noch ${fmt(missing)} ${missing === 1 ? "Münze" : "Münzen"}.`
              : current
                ? "Dein Held im nächsten Lauf."
                : "Wechselt deinen Helden."}
          </p>
        </div>

        <p className={styles.note}>Alle Helden laufen gleich schnell – Fähigkeiten sind kleine Vorteile, keine Abkürzung.</p>
      </section>

      <div className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
