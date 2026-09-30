"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { createAudio } from "@/game/fredrun2/audio";
import { CHARACTERS } from "@/game/fredrun2/characters";
import { deathLabel } from "@/game/fredrun2/death-names";
import { FredRunGame, type GameSnapshot } from "@/game/fredrun2/game";
import { boardKey, defaultProfile, type ScoreEntry } from "@/game/fredrun2/profile";
import { dateKey } from "@/game/fredrun2/rng";
import { TOUR_ORDER, dailyWorld } from "@/game/fredrun2/sim";
import { WORLD_IDS, type RunMode, type WorldId } from "@/game/fredrun2/types";
import { WORLDS } from "@/game/fredrun2/worlds";

import CharacterSelect from "./CharacterSelect";
import styles from "./fredrun2.module.css";

type Tab = "play" | "worlds" | "characters" | "board" | "settings" | "help";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "play", label: "Spielen" },
  { id: "worlds", label: "Welten" },
  { id: "characters", label: "Charaktere" },
  { id: "board", label: "Bestenliste" },
  { id: "settings", label: "Einstellungen" },
  { id: "help", label: "Anleitung" },
];

const TIPS = [
  "Tipp: Wer knapp an Hindernissen vorbeischrammt, bekommt Kombo-Punkte.",
  "Tipp: In der Luft nach unten drücken lässt dich auf Gegner stampfen.",
  "Tipp: Ein voller Energiering erlaubt einen unverwundbaren Dash.",
  "Tipp: Sprungtaste länger halten = höher springen.",
  "Tipp: Herzen sind selten – aber Schutzschilde fangen einen Treffer ab.",
  "Tipp: Die Weltreise führt dich durch alle sechs Welten.",
];

const LOADING: GameSnapshot = {
  phase: "loading",
  loadProgress: 0,
  countdown: 0,
  profile: defaultProfile(),
  result: null,
  live: { dashReady: false, hearts: 0, score: 0 },
  fps: 60,
  quality: 2,
  audioUnlocked: false,
  demoWorld: "wien",
  error: null,
};

function fmt(n: number): string {
  return Math.floor(n).toLocaleString("de-AT");
}

const MODE_LABEL: Record<RunMode, string> = { world: "Welt-Lauf", tour: "Weltreise", daily: "Tageslauf" };
const MODE_DESC: Record<RunMode, string> = {
  world: "Endlos in einer Welt – eigene Bestenliste je Welt.",
  tour: "Alle sechs Welten hintereinander, mit steigendem Tempo.",
  daily: "Jeden Tag derselbe Kurs für alle – kämpfe um den Tagesrekord.",
};

function useGame(): { game: FredRunGame | null; snap: GameSnapshot; canvasRef: React.RefObject<HTMLCanvasElement | null>; stageRef: React.RefObject<HTMLDivElement | null> } {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [game, setGame] = useState<FredRunGame | null>(null);
  const listeners = useRef(new Set<() => void>());
  const gameRef = useRef<FredRunGame | null>(null);

  const subscribe = useCallback((cb: () => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const getSnapshot = useCallback((): GameSnapshot => gameRef.current?.getSnapshot() ?? LOADING, []);
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => LOADING);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const g = new FredRunGame({
      canvas,
      container: stage,
      audio: createAudio(),
      onChange: () => listeners.current.forEach((l) => l()),
    });
    gameRef.current = g;
    setGame(g);
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { __fr2: { game: FredRunGame } }).__fr2 = { game: g };
    }
    void g.init();
    return () => {
      g.destroy();
      gameRef.current = null;
    };
  }, []);

  return { game, snap, canvasRef, stageRef };
}

/** Titel-Logo (Bild mit Transparenz); fällt bei Ladefehler auf den Schriftzug zurück. */
function LogoImage({ className }: { className?: string }): React.ReactElement {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <div className={styles.logo}>
        <span className={styles.logoMain}>Fredrun</span>
        <span className={styles.logoSub}>2.0</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${styles.logoImg} ${className ?? ""}`}
      src="/fredrun2/logo.webp"
      alt="Fredrun 2.0"
      width={1457}
      height={975}
      decoding="async"
      fetchPriority="high"
      draggable={false}
      onError={() => setOk(false)}
    />
  );
}

function WorldArt({ id }: { id: WorldId }): React.ReactElement {
  const w = WORLDS[id];
  const [ok, setOk] = useState(true);
  return (
    <div className={styles.worldArt} style={{ background: `linear-gradient(135deg, ${w.accent}, ${w.accentDark})` }}>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/fredrun2/previews/${id}.webp`}
          alt=""
          width={480}
          height={192}
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 72%", display: "block" }}
          onError={() => setOk(false)}
        />
      ) : null}
    </div>
  );
}

export interface FredRun2Props {
  /** In die App eingebettet (wie das Original-Fredrun): Größe folgt dem Inhaltsbereich, Vollbild über die Schaltfläche. */
  embedded?: boolean;
  /** Supabase-Sitzung der App: liefert den Spielernamen aus dem Original-Fredrun-Profil. */
  accessToken?: string;
}

export default function FredRun2({ embedded = false, accessToken = "" }: FredRun2Props = {}): React.ReactElement {
  const { game, snap, canvasRef, stageRef } = useGame();
  const [tab, setTab] = useState<Tab>("play");
  const [boardKeyState, setBoardKeyState] = useState<string | null>(null);
  const [tipIdx, setTipIdx] = useState(0);
  const [ignoreRotate, setIgnoreRotate] = useState(false);
  const [namePrompt, setNamePrompt] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isTouch, setIsTouch] = useState(false);
  const profile = snap.profile;
  const phase = snap.phase;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setTipIdx(Math.floor(Math.random() * TIPS.length));
      setIsTouch(window.matchMedia?.("(pointer: coarse)").matches === true || "ontouchstart" in window);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Fokus von verschwundenen Menü-/Pause-Tasten lösen, damit Leertaste im Spiel nie eine Schaltfläche auslöst
  useEffect(() => {
    if (phase === "running" || phase === "countdown") (document.activeElement as HTMLElement | null)?.blur?.();
  }, [phase]);

  const startRun = useCallback(() => {
    if (!game) return;
    if (!profile.name && !profile.seenIntro) {
      setNamePrompt(true);
      return;
    }
    void game.startRun();
  }, [game, profile.name, profile.seenIntro]);

  // Tastatur-Kurzbefehle
  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // Eingebettet gehören Tasten der App (Seitenleiste, Links …): nur im Spielbereich oder ohne Fokus auswerten
      if (embedded && target && target !== document.body && !stageRef.current?.parentElement?.contains(target)) return;
      if (phase === "menu" && !namePrompt && (e.code === "Enter" || (e.code === "Space" && tag !== "BUTTON")) && tag !== "BUTTON") {
        e.preventDefault();
        startRun();
      } else if (phase === "gameover") {
        if (e.code === "Enter" || (e.code === "Space" && tag !== "BUTTON")) {
          e.preventDefault();
          game.restart();
        } else if (e.code === "Escape") game.toMenu();
      } else if (phase === "paused" && (e.code === "Enter" || (e.code === "Space" && tag !== "BUTTON"))) {
        e.preventDefault();
        game.resume();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, phase, namePrompt, startRun, embedded, stageRef]);

  // Spielername aus dem Original-Fredrun-Profil übernehmen (nur wenn hier noch keiner gesetzt ist)
  useEffect(() => {
    if (!game || !accessToken) return;
    const controller = new AbortController();
    void fetch("/api/fredrun/highscores?world=vienna", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ playerName?: unknown }>) : null))
      .then((body) => {
        const remote = typeof body?.playerName === "string" ? body.playerName.trim().slice(0, 16) : "";
        if (remote && !game.getSnapshot().profile.name) {
          game.setName(remote);
          setNameDraft(remote);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [game, accessToken]);

  const click = useCallback(
    (fn: () => void) => () => {
      game?.unlockAudio();
      game?.audio.sfx("ui-click");
      fn();
    },
    [game],
  );

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el
        .requestFullscreen?.({ navigationUI: "hide" })
        .then(() => {
          const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          void orientation?.lock?.("landscape").catch(() => undefined);
        })
        .catch(() => undefined);
    }
  }, [stageRef]);

  const onFullscreen = useCallback(() => {
    game?.unlockAudio();
    game?.audio.sfx("ui-click");
    toggleFullscreen();
  }, [game, toggleFullscreen]);

  const activeBoard = boardKeyState ?? boardKey(profile.mode, profile.world, dateKey());

  const world = WORLDS[profile.world];
  const character = CHARACTERS[profile.character];
  const bestKey = boardKey(profile.mode, profile.world, dateKey());
  const best = profile.best[bestKey] ?? 0;

  const boards = useMemo(() => {
    const list: Array<{ key: string; label: string }> = [];
    for (const id of WORLD_IDS) list.push({ key: `world:${id}`, label: WORLDS[id].name });
    list.push({ key: "tour", label: "Weltreise" });
    list.push({ key: boardKey("daily", "wien", dateKey()), label: "Tageslauf" });
    return list;
  }, []);

  const showMenu = phase === "menu";

  // Die Heldenauswahl hat ein eigenes Musikstück; alle anderen Menü-Tabs spielen das Menü-Thema.
  const wasSelecting = useRef(false);
  useEffect(() => {
    if (!game) return;
    if (phase !== "menu") {
      wasSelecting.current = false;
      return;
    }
    const selecting = tab === "characters";
    if (selecting !== wasSelecting.current) {
      wasSelecting.current = selecting;
      game.audio.music.play(selecting ? "select" : "menu", { crossfadeSec: 0.9 });
    }
  }, [game, phase, tab]);

  return (
    <div className={`${styles.root} ${embedded ? styles.embedded : ""}`}>
      <div className={styles.stage} ref={stageRef}>
        <canvas ref={canvasRef} className={styles.canvas} aria-label="Fredrun 2.0 Spielfläche" role="img" />

        {profile.settings.showFps ? <div className={styles.fps}>{snap.fps} fps · Q{snap.quality}</div> : null}

        {/* Laden */}
        {phase === "loading" ? (
          <div className={`${styles.overlay} ${styles.loading}`} role="status" aria-live="polite">
            <LogoImage className={styles.logoLoading} />
            <div className={styles.bar} aria-hidden="true">
              <div className={styles.barFill} style={{ width: `${Math.round(snap.loadProgress * 100)}%` }} />
            </div>
            <div className={styles.tip}>{TIPS[tipIdx]}</div>
          </div>
        ) : null}

        {/* Menü */}
        {showMenu ? (
          <div className={`${styles.overlay} ${tab === "play" ? styles.veilCenter : styles.veil} ${styles.menu}`}>
            <div className={styles.menuTop}>
              <div className={styles.tabs} role="tablist" aria-label="Menü">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
                    onClick={click(() => setTab(t.id))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className={styles.chips}>
                <span className={styles.chip} title="Münzen">
                  <i className={styles.coinDot} /> {fmt(profile.coins)}
                </span>
                <button className={styles.iconBtn} aria-label={profile.settings.muted ? "Ton einschalten" : "Ton ausschalten"} onClick={click(() => game?.setSettings({ muted: !profile.settings.muted }))}>
                  {profile.settings.muted ? "🔇" : "🔊"}
                </button>
                <button className={styles.iconBtn} aria-label="Vollbild" onClick={onFullscreen}>
                  ⛶
                </button>
              </div>
            </div>

            <div className={styles.body}>
              {tab === "play" ? (
                <>
                  <div className={`${styles.hero} ${styles.heroCenter}`}>
                    <LogoImage className={styles.logoHero} />
                    <p className={`${styles.muted} ${styles.heroTagline}`}>
                      <strong style={{ color: profile.mode === "tour" ? "#ddd6fe" : "#e8edff" }}>
                        {profile.mode === "tour" ? "Weltreise: alle Welten in einem Lauf." : world.tagline}
                      </strong>
                    </p>
                    <button className={styles.playBtn} onClick={click(startRun)} autoFocus>
                      Los geht’s!
                    </button>
                    <div className={styles.row}>
                      <button className={styles.summaryCard} onClick={click(() => setTab("characters"))} style={{ flex: 1 }}>
                        <i className={styles.swatch} style={{ background: character.color }} />
                        <div>
                          <strong>{character.name}</strong>
                          <span>{character.abilityName}</span>
                        </div>
                      </button>
                      <button className={styles.summaryCard} onClick={click(() => setTab("worlds"))} style={{ flex: 1 }}>
                        <i className={styles.swatch} style={{ background: profile.mode === "tour" ? "#c4b5fd" : world.accent }} />
                        <div>
                          <strong>{profile.mode === "tour" ? "Weltreise" : profile.mode === "daily" ? `Tageslauf: ${WORLDS[dailyWorld()].name}` : world.name}</strong>
                          <span>{`Rekord ${fmt(best)}`}</span>
                        </div>
                      </button>
                    </div>
                    {snap.error ? <div className={styles.errorBox}>Fehler beim Laden: {snap.error}</div> : null}
                  </div>
                </>
              ) : null}

              {tab === "worlds" ? (
                <div className={styles.panel}>
                  <div className={styles.tabs} style={{ marginBottom: 8 }}>
                    {(["world", "tour", "daily"] as RunMode[]).map((m) => (
                      <button key={m} className={`${styles.tab} ${profile.mode === m ? styles.tabActive : ""}`} onClick={click(() => game?.setMode(m))}>
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <p className={styles.muted} style={{ margin: "0 0 12px" }}>
                    {MODE_DESC[profile.mode]}
                  </p>
                  <div className={styles.grid}>
                    {WORLD_IDS.map((id) => {
                      const w = WORLDS[id];
                      const selected = profile.world === id && profile.mode !== "tour";
                      const b = profile.best[boardKey("world", id)] ?? 0;
                      return (
                        <button
                          key={id}
                          className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
                          style={{ ["--c1" as string]: w.accent, ["--c2" as string]: w.accentDark }}
                          onClick={click(() => void game?.selectWorld(id, profile.mode === "tour" ? "tour" : profile.mode))}
                          aria-pressed={selected}
                        >
                          <WorldArt id={id} />
                          <span className={styles.cardTitle} title={w.tagline}>{w.name}</span>
                          <span className={styles.tagRow}>
                            {w.mechanics.slice(0, 2).map((m) => (
                              <span key={m} className={styles.tag}>
                                {m}
                              </span>
                            ))}
                          </span>
                          <span className={styles.badge}>{b > 0 ? `Rekord ${fmt(b)}` : "Neu"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {tab === "characters" ? <CharacterSelect profile={profile} game={game} reducedMotion={profile.settings.reducedMotion} /> : null}

              {tab === "board" ? (
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>Bestenliste</h2>
                  <div className={styles.boardTabs}>
                    {boards.map((b) => (
                      <button key={b.key} className={`${styles.tab} ${activeBoard === b.key ? styles.tabActive : ""}`} onClick={click(() => setBoardKeyState(b.key))}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                  <BoardTable entries={profile.top[activeBoard] ?? []} />
                  <p className={styles.muted} style={{ marginTop: 12 }}>
                    Lebenslang: {fmt(profile.lifetime.runs)} Läufe · {fmt(profile.lifetime.meters)} m · {fmt(profile.lifetime.coins)} Münzen · {fmt(profile.lifetime.stomps)} Stampfer · {fmt(profile.lifetime.nearMisses)} knappe Rettungen
                  </p>
                </div>
              ) : null}

              {tab === "settings" ? (
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>Einstellungen</h2>
                  <SettingsForm game={game} snap={snap} />
                </div>
              ) : null}

              {tab === "help" ? (
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>So wird gelaufen</h2>
                  <HelpBody />
                </div>
              ) : null}
            </div>
            {!embedded ? (
              <Link className={styles.backLink} href="/">
                ← Zurück zu Findog
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Countdown */}
        {phase === "countdown" && snap.countdown > 0 ? (
          <div className={`${styles.overlay} ${styles.countdown}`} aria-live="assertive">
            <div className={styles.countNum} key={snap.countdown}>
              {snap.countdown}
            </div>
          </div>
        ) : null}

        {/* Bedienelemente im Spiel */}
        {phase === "running" || phase === "countdown" ? (
          <>
            <button data-fr2-ui className={`${styles.iconBtn} ${styles.pauseBtn}`} aria-label="Pause" onClick={() => game?.pause()} style={{ display: phase === "running" ? "grid" : "none" }}>
              ⏸
            </button>
            {isTouch ? (
              <>
                <button
                  data-fr2-ui
                  className={`${styles.touch} ${styles.touchSlide}`}
                  aria-label="Rutschen"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    game?.input.setUiSlide(true);
                  }}
                  onPointerUp={() => game?.input.setUiSlide(false)}
                  onPointerCancel={() => game?.input.setUiSlide(false)}
                  onPointerLeave={() => game?.input.setUiSlide(false)}
                >
                  ↓
                </button>
                <button
                  data-fr2-ui
                  className={`${styles.touch} ${styles.touchDash} ${snap.live.dashReady ? styles.touchReady : ""}`}
                  aria-label="Dash"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    game?.input.pressDash();
                  }}
                >
                  ⚡
                </button>
              </>
            ) : null}
          </>
        ) : null}

        {/* Pause */}
        {phase === "paused" ? (
          <div className={`${styles.overlay} ${styles.veilFull} ${styles.modal}`}>
            <div className={styles.modalCard} role="dialog" aria-label="Pause">
              <h2 className={styles.modalTitle}>Pause</h2>
              <button className={styles.playBtn} onClick={click(() => game?.resume())} autoFocus style={{ fontSize: undefined }}>
                Weiter
              </button>
              <div className={styles.row} style={{ justifyContent: "center" }}>
                <button className={styles.btn} onClick={click(() => game?.restart())}>
                  Neustart
                </button>
                <button className={styles.btn} onClick={click(() => game?.toMenu())}>
                  Hauptmenü
                </button>
                <button className={styles.btn} onClick={click(() => game?.setSettings({ muted: !profile.settings.muted }))}>
                  {profile.settings.muted ? "🔇 Ton an" : "🔊 Ton aus"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Game Over */}
        {phase === "gameover" && snap.result ? (
          <div className={`${styles.overlay} ${styles.veilFull} ${styles.modal}`}>
            <div className={styles.modalCard} role="dialog" aria-label="Ergebnis">
              <h2 className={styles.modalTitle}>{snap.result.isNewBest ? "Neuer Rekord!" : "Geschafft!"}</h2>
              {snap.result.isNewBest ? <div className={styles.newBest}>Persönliche Bestleistung</div> : null}
              <div className={styles.bigScore}>{fmt(snap.result.score)}</div>
              <div className={styles.muted} style={{ textAlign: "center", marginTop: -8 }}>
                {snap.result.mode === "tour" ? "Weltreise" : snap.result.mode === "daily" ? "Tageslauf" : WORLDS[snap.result.world].name}
                {snap.result.rank ? ` · Platz ${snap.result.rank} der Bestenliste` : ""}
                {deathLabel(snap.result.deathCause) ? ` · gestoppt von: ${deathLabel(snap.result.deathCause)}` : ""}
              </div>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <b>{fmt(snap.result.meters)} m</b>
                  <span>Strecke</span>
                </div>
                <div className={styles.stat}>
                  <b>+{fmt(snap.result.coins)}</b>
                  <span>Münzen</span>
                </div>
                <div className={styles.stat}>
                  <b>×{snap.result.maxCombo}</b>
                  <span>Kombo</span>
                </div>
                <div className={styles.stat}>
                  <b>{fmt(snap.result.stomps)}</b>
                  <span>Stampfer</span>
                </div>
                <div className={styles.stat}>
                  <b>{fmt(snap.result.nearMisses)}</b>
                  <span>Knapp</span>
                </div>
                <div className={styles.stat}>
                  <b>{Math.floor(snap.result.seconds / 60)}:{String(Math.floor(snap.result.seconds % 60)).padStart(2, "0")}</b>
                  <span>Zeit</span>
                </div>
              </div>
              <div className={styles.row} style={{ justifyContent: "center" }}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={click(() => game?.restart())} autoFocus>
                  Nochmal
                </button>
                <button className={styles.btn} onClick={click(() => game?.toMenu())}>
                  Menü
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Name */}
        {namePrompt ? (
          <div className={`${styles.overlay} ${styles.veilFull} ${styles.modal}`} style={{ zIndex: 35 }}>
            <form
              className={styles.modalCard}
              onSubmit={(e) => {
                e.preventDefault();
                game?.setName(nameDraft.trim().slice(0, 16));
                game?.markIntroSeen();
                setNamePrompt(false);
                void game?.startRun();
              }}
            >
              <h2 className={styles.modalTitle}>Wie heißt du?</h2>
              <p className={styles.muted} style={{ margin: 0, textAlign: "center" }}>
                Dein Name erscheint in der Bestenliste dieses Geräts.
              </p>
              <input className={styles.nameInput} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Fred" maxLength={16} autoFocus aria-label="Name" />
              <div className={styles.row} style={{ justifyContent: "center" }}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Los!
                </button>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => {
                    game?.markIntroSeen();
                    setNamePrompt(false);
                    void game?.startRun();
                  }}
                >
                  Überspringen
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {/* Querformat-Hinweis */}
        {!ignoreRotate ? (
          <div className={styles.rotate} role="alert">
            <div>
              <div style={{ fontSize: "3em" }}>⟲</div>
              Bitte das Gerät ins Querformat drehen.
              <div style={{ marginTop: 20 }}>
                <button className={styles.btn} onClick={() => setIgnoreRotate(true)}>
                  Trotzdem spielen
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BoardTable({ entries }: { entries: ScoreEntry[] }): React.ReactElement {
  if (!entries.length) return <p className={styles.muted}>Noch keine Einträge – lauf los!</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Held</th>
          <th style={{ textAlign: "right" }}>Meter</th>
          <th style={{ textAlign: "right" }}>Punkte</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={`${e.date}-${i}`}>
            <td className={i === 0 ? styles.rankGold : i === 1 ? styles.rankSilver : i === 2 ? styles.rankBronze : undefined}>{i + 1}</td>
            <td>{e.name}</td>
            <td>{CHARACTERS[e.character]?.name ?? e.character}</td>
            <td style={{ textAlign: "right" }}>{fmt(e.meters)}</td>
            <td style={{ textAlign: "right" }}>{fmt(e.score)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): React.ReactElement {
  return <button className={`${styles.toggle} ${on ? styles.toggleOn : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function SettingsForm({ game, snap }: { game: FredRunGame | null; snap: GameSnapshot }): React.ReactElement {
  const s = snap.profile.settings;
  const [name, setName] = useState(snap.profile.name);
  return (
    <div>
      <div className={styles.field}>
        <label htmlFor="fr2-name">Name (Bestenliste)</label>
        <input id="fr2-name" type="text" value={name} maxLength={16} placeholder="Fred" onChange={(e) => setName(e.target.value)} onBlur={() => game?.setName(name.trim().slice(0, 16))} />
      </div>
      <div className={styles.field}>
        <label htmlFor="fr2-master">Gesamtlautstärke</label>
        <input id="fr2-master" type="range" min={0} max={1} step={0.05} value={s.master} onChange={(e) => game?.setSettings({ master: Number(e.target.value) })} />
      </div>
      <div className={styles.field}>
        <label htmlFor="fr2-music">Musik</label>
        <input id="fr2-music" type="range" min={0} max={1} step={0.05} value={s.music} onChange={(e) => game?.setSettings({ music: Number(e.target.value) })} />
      </div>
      <div className={styles.field}>
        <label htmlFor="fr2-sfx">Effekte</label>
        <input id="fr2-sfx" type="range" min={0} max={1} step={0.05} value={s.sfx} onChange={(e) => game?.setSettings({ sfx: Number(e.target.value) })} />
      </div>
      <div className={styles.field}>
        <span>Ton aus</span>
        <Toggle on={s.muted} onChange={(v) => game?.setSettings({ muted: v })} label="Ton aus" />
      </div>
      <div className={styles.field}>
        <label htmlFor="fr2-quality">Grafikqualität</label>
        <select id="fr2-quality" value={s.quality} onChange={(e) => game?.setSettings({ quality: e.target.value as typeof s.quality })}>
          <option value="auto">Automatisch</option>
          <option value="high">Hoch</option>
          <option value="medium">Mittel</option>
          <option value="low">Niedrig (Akku schonen)</option>
        </select>
      </div>
      <div className={styles.field}>
        <span>Weniger Bewegung (kein Wackeln/Blitzen)</span>
        <Toggle on={s.reducedMotion} onChange={(v) => game?.setSettings({ reducedMotion: v })} label="Weniger Bewegung" />
      </div>
      <div className={styles.field}>
        <span>Einsteiger-Hinweise im Spiel</span>
        <Toggle on={s.hints} onChange={(v) => game?.setSettings({ hints: v })} label="Hinweise" />
      </div>
      <div className={styles.field}>
        <span>FPS-Anzeige</span>
        <Toggle on={s.showFps} onChange={(v) => game?.setSettings({ showFps: v })} label="FPS-Anzeige" />
      </div>
    </div>
  );
}

function HelpBody(): React.ReactElement {
  return (
    <div className={styles.help}>
      <div className={styles.helpCard}>
        <h3>Steuerung</h3>
        <ul>
          <li>
            <span className={styles.kbd}>Leertaste</span> / <span className={styles.kbd}>↑</span> / <span className={styles.kbd}>W</span> · Tippen: springen (halten = höher, in der Luft nochmal = Doppelsprung)
          </li>
          <li>
            <span className={styles.kbd}>↓</span> / <span className={styles.kbd}>S</span> · nach unten wischen: rutschen – in der Luft: <b>Stampfen</b>
          </li>
          <li>
            <span className={styles.kbd}>Shift</span> / <span className={styles.kbd}>D</span> · Dash-Taste: Dash (kostet Energie)
          </li>
          <li>
            <span className={styles.kbd}>Esc</span> / <span className={styles.kbd}>P</span> Pause · <span className={styles.kbd}>M</span> Ton · Gamepad wird unterstützt
          </li>
        </ul>
      </div>
      <div className={styles.helpCard}>
        <h3>Punkte & Kombos</h3>
        <ul>
          <li>Jeder Meter zählt. Münzen, Edelsteine, Stampfer und knappe Rettungen geben Bonus.</li>
          <li>Kombo ×2 … ×8: Bonus-Aktionen in Folge verlängern die Kombo, ein Treffer beendet sie.</li>
          <li>Stampfen auf Gegner lässt dich hochfedern – Ketten geben mehr Punkte.</li>
        </ul>
      </div>
      <div className={styles.helpCard}>
        <h3>Energie & Dash</h3>
        <ul>
          <li>Münzen, Stampfer und Beinahe-Treffer laden den Energiering.</li>
          <li>Dash: kurzer Turbo, unverwundbar, zerschmettert Kisten und Geschosse.</li>
          <li>Jeder Held hat eine eigene Fähigkeit (Gleiten, Düsen-Dash, Superstampfer …).</li>
        </ul>
      </div>
      <div className={styles.helpCard}>
        <h3>Power-ups</h3>
        <ul>
          <li>🧲 Magnet zieht Münzen an · 🛡 Schutzschild fängt einen Treffer ab</li>
          <li>⏳ Zeitlupe verlangsamt die Welt · ⚡ Turbo: Raketenflug, unverwundbar</li>
          <li>❤ Herz: ein Leben mehr (max. 5)</li>
        </ul>
      </div>
      <div className={styles.helpCard} style={{ gridColumn: "1 / -1" }}>
        <h3>Sechs Welten, sechs Ideen</h3>
        <p>
          {TOUR_ORDER.map((id) => `${WORLDS[id].name}: ${WORLDS[id].mechanics.slice(0, 2).join(", ") || WORLDS[id].tagline}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}
