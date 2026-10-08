"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { withRev } from "@/game/fredrun2/asset-rev";
import { createAudio } from "@/game/fredrun2/audio";
import { CHARACTERS } from "@/game/fredrun2/characters";
import { deathLabel } from "@/game/fredrun2/death-names";
import { FredRunGame, type GameSnapshot } from "@/game/fredrun2/game";
import { boardKey, defaultProfile, type Profile } from "@/game/fredrun2/profile";
import { dateKey } from "@/game/fredrun2/rng";
import { TOUR_ORDER, dailyWorld } from "@/game/fredrun2/sim";
import { WORLD_IDS, type RunMode, type WorldId } from "@/game/fredrun2/types";
import { formatNumber } from "@/game/fredrun2/ui-logic";
import { WORLDS } from "@/game/fredrun2/worlds";

import CharacterSelect from "./CharacterSelect";
import styles from "./fredrun2.module.css";
import { useAccessToken, useGlobalBoard, useRunSubmission } from "./globalBoard";
import SettingsForm, { StorageNotice } from "./SettingsForm";

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
  "Tipp: Die Weltreise führt dich durch alle acht Welten.",
];

const LOADING: GameSnapshot = {
  phase: "loading",
  loadProgress: 0,
  countdown: 0,
  profile: defaultProfile(),
  result: null,
  live: { dashReady: false, hearts: 0, score: 0, coins: 0 },
  fps: 60,
  quality: 2,
  audioUnlocked: false,
  demoWorld: "wien",
  error: null,
  touch: false,
  storageOk: true,
  loadingWorld: null,
};

/** Systemvorgabe „Bewegung reduzieren“ als externer Speicher: serverseitig false, im Browser live (inkl. change-Ereignis). */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
let reducedMq: MediaQueryList | null | undefined;
function reducedMotionQuery(): MediaQueryList | null {
  if (reducedMq === undefined) reducedMq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_QUERY) : null;
  return reducedMq;
}
function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = reducedMotionQuery();
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}
const getSystemReducedMotion = (): boolean => reducedMotionQuery()?.matches === true;
const getSystemReducedMotionServer = (): boolean => false;

interface TabStripProps<T extends string> {
  /** `group`: Zwischenüberschrift; aufeinanderfolgende Reiter mit gleichem Wert stehen in einer Gruppe (nur optisch, die Leiste bleibt ein tablist). */
  items: ReadonlyArray<{ id: T; label: string; group?: string }>;
  value: T | null;
  /** `byKeyboard`: Auswahl per Pfeiltaste/Pos1/Ende (der Fokus bleibt dann in der Leiste). */
  onSelect: (id: T, byKeyboard: boolean) => void;
  label: string;
  className?: string;
  style?: React.CSSProperties;
  /** Basis für die ids der Reiter (`<idBase>-tab-<id>`), damit ein Tabpanel per aria-labelledby darauf zeigen kann. */
  idBase?: string;
  /** id des zugehörigen Tabpanels (aria-controls des aktiven Reiters). */
  panelId?: string;
}

/**
 * Reiter-Leiste nach dem ARIA-Tab-Muster: nur der aktive Reiter ist per Tab erreichbar (Roving-Tabindex), Links/Rechts wechselt
 * (mit Umbruch) und wählt sofort aus, Pos1/Ende springen zum ersten/letzten Reiter.
 */
function TabStrip<T extends string>({ items, value, onSelect, label, className, style, idBase, panelId }: TabStripProps<T>): React.ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIdx = items.findIndex((t) => t.id === value);
  const tabbable = activeIdx >= 0 ? activeIdx : 0;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = refs.current.indexOf(e.target as HTMLButtonElement);
    const from = at >= 0 ? at : tabbable;
    let next = -1;
    if (e.key === "ArrowRight") next = (from + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (from - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(items[next].id, true);
    refs.current[next]?.focus();
  };
  const renderTab = (t: { id: T; label: string }, i: number): React.ReactElement => {
    const on = i === activeIdx;
    return (
      <button
        key={t.id}
        ref={(el) => {
          refs.current[i] = el;
        }}
        id={idBase ? `${idBase}-tab-${t.id}` : undefined}
        type="button"
        role="tab"
        aria-selected={on}
        aria-controls={on ? panelId : undefined}
        tabIndex={i === tabbable ? 0 : -1}
        className={`${styles.tab} ${on ? styles.tabActive : ""}`}
        onClick={() => onSelect(t.id, false)}
      >
        {t.label}
      </button>
    );
  };
  // Gruppen: je zusammenhängender Lauf gleicher `group`-Werte ein Block mit Überschrift (aria-hidden: die Reiter tragen ihre Namen selbst)
  const blocks: React.ReactNode[] = [];
  if (items.some((t) => t.group)) {
    for (let from = 0; from < items.length; ) {
      let to = from + 1;
      while (to < items.length && items[to].group === items[from].group) to += 1;
      blocks.push(
        <div key={`${items[from].group ?? ""}-${from}`} className={styles.tabGroup}>
          {items[from].group ? (
            <span className={styles.tabGroupLabel} aria-hidden="true">
              {items[from].group}
            </span>
          ) : null}
          <div className={styles.tabGroupChips}>{items.slice(from, to).map((t, k) => renderTab(t, from + k))}</div>
        </div>,
      );
      from = to;
    }
  }
  return (
    <div className={className ?? styles.tabs} style={style} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {blocks.length ? blocks : items.map(renderTab)}
    </div>
  );
}

const MODE_LABEL: Record<RunMode, string> = { world: "Welt-Lauf", tour: "Weltreise", daily: "Tageslauf" };
const MODE_DESC: Record<RunMode, string> = {
  world: "Endlos in einer Welt – eigene Bestenliste je Welt.",
  tour: "Alle acht Welten hintereinander, mit steigendem Tempo.",
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
      src={withRev("/fredrun2/logo.webp")}
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
          src={withRev(`/fredrun2/previews/${id}.webp`)}
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
  /** Supabase-Sitzung der App: Spielername aus dem Original-Fredrun-Profil und globale Bestenliste (ohne Angabe: Sitzung des Browsers). */
  accessToken?: string;
}

export default function FredRun2({ embedded = false, accessToken: accessTokenProp = "" }: FredRun2Props = {}): React.ReactElement {
  const { game, snap, canvasRef, stageRef } = useGame();
  const accessToken = useAccessToken(accessTokenProp);
  const uid = useId();
  const [tab, setTab] = useState<Tab>("play");
  /** Reiter zuletzt per Tastatur gewechselt: dann holt der Spielen-Knopf den Fokus nicht an sich (der bliebe sonst nicht in der Leiste). */
  const [tabByKeyboard, setTabByKeyboard] = useState(false);
  const [boardKeyState, setBoardKeyState] = useState<string | null>(null);
  const [tipIdx, setTipIdx] = useState(0);
  const [ignoreRotate, setIgnoreRotate] = useState(false);
  const [namePrompt, setNamePrompt] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isTouch, setIsTouch] = useState(false);
  const profile = snap.profile;
  const phase = snap.phase;
  // „Weniger Bewegung“ gilt als Einstellung ODER Systemvorgabe; das Wurzelelement trägt es als data-reduced (CSS), die Heldenauswahl bekommt es als Prop
  const systemReduced = useSyncExternalStore(subscribeReducedMotion, getSystemReducedMotion, getSystemReducedMotionServer);
  const reduced = profile.settings.reducedMotion || systemReduced;

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

  const loadingWorld = snap.loadingWorld ?? null;
  const startRun = useCallback(() => {
    // Während eine Welt lädt, ist „Los geht’s!“ gesperrt (auch per Enter/Leertaste): kein mehrfaches Starten
    if (!game || loadingWorld) return;
    if (!profile.name && !profile.seenIntro) {
      setNamePrompt(true);
      return;
    }
    void game.startRun();
  }, [game, loadingWorld, profile.name, profile.seenIntro]);

  /** „Jetzt laufen“ in der leeren Bestenliste: Welt/Modus der angezeigten Liste wählen und starten (Namensfrage wie beim Spielen-Knopf). */
  const playBoard = useCallback(
    (key: string) => {
      if (!game) return;
      game.unlockAudio();
      game.audio.sfx("ui-click");
      if (key.startsWith("world:")) {
        const id = key.slice("world:".length);
        if ((WORLD_IDS as readonly string[]).includes(id)) void game.selectWorld(id as WorldId, "world");
      } else game.setMode(key === "tour" ? "tour" : "daily");
      startRun();
    },
    [game, startRun],
  );

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

  // Startseite: Im Tageslauf zählt die Tages-Welt (nicht die zuletzt gewählte), in der Weltreise der Routentext
  const runWorld = WORLDS[profile.mode === "daily" ? dailyWorld() : profile.world];
  const runTagline = profile.mode === "tour" ? "Weltreise: alle Welten in einem Lauf." : runWorld.tagline;
  const runTitle = profile.mode === "tour" ? "Weltreise" : profile.mode === "daily" ? `Tageslauf · ${runWorld.name}` : runWorld.name;
  const character = CHARACTERS[profile.character];
  const bestKey = boardKey(profile.mode, profile.world, dateKey());
  const best = profile.best[bestKey] ?? 0;

  // Globale Bestenliste (jeder gegen jeden): Anzeige im Menü, Einreichung nach jedem Lauf
  const board = useGlobalBoard(accessToken, activeBoard, phase === "menu" && tab === "board");
  const result = snap.result;
  const submission = useMemo(
    () =>
      accessToken && result && result.score > 0
        ? { board: result.board, runId: result.runId, name: profile.name, score: Math.floor(result.score), meters: Math.floor(result.meters), character: result.character }
        : null,
    [accessToken, result, profile.name],
  );
  const submitState = useRunSubmission(accessToken, submission);

  // Bestenlisten-Chips in zwei Gruppen: die acht Welten und die beiden Modi
  const boardItems = useMemo(() => {
    const list: Array<{ id: string; label: string; group: string }> = [];
    for (const id of WORLD_IDS) list.push({ id: `world:${id}`, label: WORLDS[id].name, group: "Welten" });
    list.push({ id: "tour", label: "Weltreise", group: "Modi" });
    list.push({ id: boardKey("daily", "wien", dateKey()), label: "Tageslauf", group: "Modi" });
    return list;
  }, []);
  const modeItems = useMemo(() => (["world", "tour", "daily"] as RunMode[]).map((m) => ({ id: m, label: MODE_LABEL[m] })), []);

  const showMenu = phase === "menu";
  const panelId = `${uid}-panel`;

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

  // Deckt ein Reiter die Bühne ab (Charaktere, Bestenliste, Einstellungen, Anleitung), darf die Demo dahinter sparen (Hub: setMenuCovered).
  // Spielen und Welten zeigen die Demo-Welt, sie bleibt voll animiert; außerhalb des Menüs ist nichts verdeckt.
  const menuCovered = showMenu && (tab === "characters" || tab === "board" || tab === "settings" || tab === "help");
  useEffect(() => {
    game?.setMenuCovered(menuCovered); // idempotent: bei jedem Reiterwechsel (tab) erneut gemeldet, nicht nur bei Wertwechsel
  }, [game, menuCovered, tab]);
  useEffect(() => () => game?.setMenuCovered(false), [game]);

  return (
    <div className={`${styles.root} ${embedded ? styles.embedded : ""}`} data-phase={phase} data-reduced={reduced ? "true" : undefined}>
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
              <TabStrip
                items={TABS}
                value={tab}
                label="Menü"
                idBase={uid}
                panelId={panelId}
                onSelect={(id, byKeyboard) =>
                  click(() => {
                    setTabByKeyboard(byKeyboard);
                    setTab(id);
                  })()
                }
              />
              <div className={styles.chips}>
                <span className={styles.chip} title="Münzen">
                  <i className={styles.coinDot} /> {formatNumber(profile.coins)}
                </span>
                <button className={styles.iconBtn} aria-label={profile.settings.muted ? "Ton einschalten" : "Ton ausschalten"} onClick={click(() => game?.setSettings({ muted: !profile.settings.muted }))}>
                  {profile.settings.muted ? "🔇" : "🔊"}
                </button>
                <button className={styles.iconBtn} aria-label="Vollbild" onClick={onFullscreen}>
                  ⛶
                </button>
              </div>
            </div>

            {/* Speichern geht nicht (Privatmodus, Speicher voll): auf jedem Reiter sichtbar, damit Käufe und Rekorde nicht still verloren gehen */}
            <StorageNotice ok={snap.storageOk} className={styles.noticeSlot} />

            <div className={styles.body} role="tabpanel" id={panelId} aria-labelledby={`${uid}-tab-${tab}`}>
              {tab === "play" ? (
                <>
                  <div className={`${styles.hero} ${styles.heroCenter}`}>
                    <LogoImage className={styles.logoHero} />
                    <p className={`${styles.muted} ${styles.heroTagline}`}>
                      <strong style={{ color: profile.mode === "tour" ? "#ddd6fe" : "#e8edff" }}>{runTagline}</strong>
                    </p>
                    <button
                      className={styles.playBtn}
                      onClick={loadingWorld ? undefined : click(startRun)}
                      aria-disabled={loadingWorld ? true : undefined}
                      aria-busy={loadingWorld ? true : undefined}
                      autoFocus={!tabByKeyboard}
                    >
                      {loadingWorld ? "Welt wird geladen …" : "Los geht’s!"}
                    </button>
                    <div className={styles.row}>
                      <button className={styles.summaryCard} onClick={click(() => setTab("characters"))} style={{ flex: "1 1 0" }}>
                        <i className={styles.swatch} style={{ background: character.color }} />
                        <div className={styles.summaryText}>
                          <strong>{character.name}</strong>
                          <span>{character.abilityName}</span>
                        </div>
                      </button>
                      <button className={styles.summaryCard} onClick={click(() => setTab("worlds"))} style={{ flex: "1.35 1 0" }} title={profile.mode === "daily" ? runTitle : undefined}>
                        <i className={styles.swatch} style={{ background: profile.mode === "tour" ? "#c4b5fd" : runWorld.accent }} />
                        <div className={styles.summaryText}>
                          <strong>{runTitle}</strong>
                          <span>{loadingWorld ? "wird geladen …" : `Rekord ${formatNumber(best)}`}</span>
                        </div>
                      </button>
                    </div>
                    {snap.error ? <div className={styles.errorBox}>Fehler beim Laden: {snap.error}</div> : null}
                  </div>
                </>
              ) : null}

              {tab === "worlds" ? <WorldsPanel profile={profile} game={game} modeItems={modeItems} click={click} loadingWorld={loadingWorld} /> : null}

              {tab === "characters" ? <CharacterSelect profile={profile} game={game} reducedMotion={reduced} active={showMenu && tab === "characters"} /> : null}

              {tab === "board" ? (
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>Bestenliste</h2>
                  <p className={styles.muted} style={{ margin: "-4px 0 10px" }}>
                    {accessToken ? "Weltweit – jeder gegen jeden, je Spieler zählt der beste Lauf." : "Nur dieses Gerät – melde dich in Findog an, um weltweit gegen alle anzutreten."}
                  </p>
                  <TabStrip className={styles.boardTabs} items={boardItems} value={activeBoard} label="Bestenliste wählen" onSelect={(key) => click(() => setBoardKeyState(key))()} />
                  {accessToken ? (
                    <GlobalBoard state={board.state} onRetry={board.retry} onPlay={() => playBoard(activeBoard)} />
                  ) : (
                    <BoardTable rows={localRows(profile.top[activeBoard] ?? [], profile.best[activeBoard] ?? 0)} onPlay={() => playBoard(activeBoard)} />
                  )}
                  <p className={styles.muted} style={{ marginTop: 12 }}>
                    Lebenslang: {formatNumber(profile.lifetime.runs)} Läufe · {formatNumber(profile.lifetime.meters)} m · {formatNumber(profile.lifetime.coins)} Münzen · {formatNumber(profile.lifetime.stomps)} Stampfer · {formatNumber(profile.lifetime.nearMisses)} knappe Rettungen
                  </p>
                </div>
              ) : null}

              {tab === "settings" ? <SettingsForm game={game} snap={snap} systemReduced={systemReduced} /> : null}

              {tab === "help" ? (
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>So wird gelaufen</h2>
                  <HelpBody />
                </div>
              ) : null}
            </div>
            {!embedded && tab === "play" ? (
              <Link className={styles.backLink} href="/" aria-label="Zurück zu Findog">
                <span aria-hidden="true">←</span>
                <span className={styles.backLinkText}>&nbsp;Zurück zu Findog</span>
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
              <div className={styles.bigScore}>{formatNumber(snap.result.score)}</div>
              <div className={styles.muted} style={{ textAlign: "center", marginTop: -8 }}>
                {snap.result.mode === "tour" ? "Weltreise" : snap.result.mode === "daily" ? "Tageslauf" : WORLDS[snap.result.world].name}
                {deathLabel(snap.result.deathCause) ? ` · gestoppt von: ${deathLabel(snap.result.deathCause)}` : ""}
              </div>
              {accessToken && snap.result.score > 0 ? (
                <div className={styles.muted} style={{ textAlign: "center", marginTop: 4 }} aria-live="polite">
                  {submitState?.status === "done" && submitState.rank
                    ? `Weltweit Platz ${submitState.rank}${submitState.score !== null ? ` · dein Bestwert ${formatNumber(submitState.score)}` : ""}`
                    : submitState?.status === "failed"
                      ? "Weltweite Bestenliste gerade nicht erreichbar."
                      : "Weltweite Bestenliste wird aktualisiert …"}
                </div>
              ) : null}
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <b>{formatNumber(snap.result.meters)} m</b>
                  <span>Strecke</span>
                </div>
                <div className={styles.stat}>
                  <b>+{formatNumber(snap.result.coins)}</b>
                  <span>Münzen</span>
                </div>
                <div className={styles.stat}>
                  <b>×{snap.result.maxCombo}</b>
                  <span>Kombo</span>
                </div>
                <div className={styles.stat}>
                  <b>{formatNumber(snap.result.stomps)}</b>
                  <span>Stampfer</span>
                </div>
                <div className={styles.stat}>
                  <b>{formatNumber(snap.result.nearMisses)}</b>
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
                Dein Name erscheint in der weltweiten Bestenliste.
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

interface WorldsPanelProps {
  profile: Profile;
  game: FredRunGame | null;
  modeItems: ReadonlyArray<{ id: RunMode; label: string }>;
  /** Handler mit Klickton und Audio-Entsperrung (aus der Hauptkomponente) */
  click: (fn: () => void) => () => void;
  /** Welt, die gerade lädt (Hub); null = keine */
  loadingWorld: WorldId | null;
}

/**
 * Welten-Reiter, je Modus mit passenden Daten: Welt-Lauf wählt die Welt (je Welt eigener Rekord), Weltreise zeigt die Route
 * (Karten in TOUR_ORDER mit Nummern, Weltreise-Rekord, keine Auswahl), Tageslauf hebt nur die Tages-Welt hervor (übrige gedimmt, Tagesrekord).
 */
function WorldsPanel({ profile, game, modeItems, click, loadingWorld }: WorldsPanelProps): React.ReactElement {
  const mode = profile.mode;
  const todayWorld = dailyWorld();
  const order = mode === "tour" ? TOUR_ORDER : WORLD_IDS;
  const modeBest = profile.best[boardKey(mode, profile.world, dateKey())] ?? 0;
  return (
    <div className={styles.panel}>
      <TabStrip items={modeItems} value={mode} label="Modus" style={{ marginBottom: 8 }} onSelect={(m) => click(() => game?.setMode(m))()} />
      <div className={styles.modeLine}>
        <p className={styles.muted}>{MODE_DESC[mode]}</p>
        {mode !== "world" ? (
          <span className={styles.recordPill}>
            {mode === "tour" ? "Weltreise-Rekord" : "Tagesrekord"} {modeBest > 0 ? formatNumber(modeBest) : "–"}
          </span>
        ) : null}
      </div>
      <div className={styles.grid} role={mode === "tour" ? "list" : undefined} aria-label={mode === "tour" ? "Route der Weltreise" : undefined}>
        {order.map((id, i) => {
          const w = WORLDS[id];
          const vars = { ["--c1" as string]: w.accent, ["--c2" as string]: w.accentDark };
          const art = <WorldArt id={id} />;
          const title = (
            <span className={styles.cardTitle} title={w.tagline}>
              {w.name}
            </span>
          );
          const tags = (
            <span className={styles.tagRow}>
              {w.mechanics.slice(0, 1).map((m) => (
                <span key={m} className={styles.tag}>
                  {m}
                </span>
              ))}
            </span>
          );
          if (mode === "tour") {
            // Route: keine Auswahl, nur Reihenfolge – deshalb kein Knopf
            return (
              <div key={id} role="listitem" className={`${styles.card} ${styles.cardStatic}`} style={vars}>
                {art}
                <span className={styles.cardNum} role="img" aria-label={`Station ${i + 1}`}>
                  {i + 1}
                </span>
                {title}
                {tags}
              </div>
            );
          }
          const today = mode === "daily" && id === todayWorld;
          const selected = mode === "world" ? profile.world === id : today;
          const best = profile.best[boardKey("world", id)] ?? 0;
          const badge = loadingWorld === id ? "Lädt …" : today ? "Heute" : best > 0 ? `Rekord ${formatNumber(best)}` : "Neu";
          const dimmed = mode === "daily" && !today;
          return (
            <button
              key={id}
              className={`${styles.card} ${selected ? styles.cardSelected : ""} ${dimmed ? styles.cardDim : ""}`}
              style={vars}
              onClick={dimmed ? undefined : click(() => void game?.selectWorld(id, mode))}
              aria-pressed={dimmed ? undefined : selected}
              disabled={dimmed}
              title={dimmed ? "Heute läuft nur der Tageslauf-Kurs" : undefined}
            >
              {art}
              {title}
              {tags}
              {dimmed ? null : <span className={`${styles.badge} ${today ? styles.badgeToday : ""}`}>{badge}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface BoardRow {
  rank: number;
  name: string;
  character: string;
  meters: number;
  score: number;
  /** eigener Eintrag (weltweit: vom Server markiert; lokal: der Bestwert dieser Liste) */
  me: boolean;
  /** Zusatz hinter dem Namen: weltweit „(du)“, lokal „Rekord“ */
  tag?: string;
}

/** Zeilen der lokalen Liste (alles eigene Läufe): der Bestwert der Liste ist hervorgehoben. */
function localRows(entries: ReadonlyArray<{ name: string; character: string; meters: number; score: number }>, best: number): BoardRow[] {
  let marked = false;
  return entries.map((e, i) => {
    const me = !marked && best > 0 && e.score === best;
    if (me) marked = true;
    return { rank: i + 1, name: e.name, character: e.character, meters: e.meters, score: e.score, me, tag: me ? "Rekord" : undefined };
  });
}

/** Leere Liste: statt nur eines Satzes ein Knopf, der einen Lauf in der Welt bzw. dem Modus der angezeigten Bestenliste startet. */
function BoardTable({ rows, onPlay }: { rows: BoardRow[]; onPlay: () => void }): React.ReactElement {
  if (!rows.length) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.muted}>Noch keine Einträge – lauf los!</p>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onPlay}>
          Jetzt laufen
        </button>
      </div>
    );
  }
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
        {rows.map((e) => (
          <tr key={`${e.rank}-${e.name}`} className={e.me ? styles.rowMe : undefined} aria-current={e.me ? "true" : undefined}>
            <td className={e.rank === 1 ? styles.rankGold : e.rank === 2 ? styles.rankSilver : e.rank === 3 ? styles.rankBronze : undefined}>{e.rank}</td>
            <td>
              {e.name}
              {e.me && e.tag ? <span className={styles.meTag}>{e.tag}</span> : null}
            </td>
            <td>{CHARACTERS[e.character as keyof typeof CHARACTERS]?.name ?? e.character}</td>
            <td style={{ textAlign: "right" }}>{formatNumber(e.meters)}</td>
            <td style={{ textAlign: "right" }}>{formatNumber(e.score)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GlobalBoard({ state, onRetry, onPlay }: { state: ReturnType<typeof useGlobalBoard>["state"]; onRetry: () => void; onPlay: () => void }): React.ReactElement {
  if (state.status === "error") {
    return (
      <div>
        <p className={styles.muted}>Die weltweite Bestenliste ist gerade nicht erreichbar.</p>
        <button className={styles.btn} onClick={onRetry}>
          Erneut laden
        </button>
      </div>
    );
  }
  if (state.status !== "ready") return <p className={styles.muted}>Bestenliste wird geladen …</p>;
  const { entries, me } = state.data;
  const inTop = entries.some((e) => e.me);
  return (
    <div>
      <BoardTable rows={entries.map((e) => ({ ...e, tag: "(du)" }))} onPlay={onPlay} />
      {me && !inTop ? (
        <p className={styles.muted} style={{ marginTop: 10 }}>
          Dein Platz: <b>{formatNumber(me.rank)}</b> · {formatNumber(me.score)} Punkte
        </p>
      ) : null}
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
        <h3>Acht Welten, acht Ideen</h3>
        <p>
          {TOUR_ORDER.map((id) => `${WORLDS[id].name}: ${WORLDS[id].mechanics.slice(0, 2).join(", ") || WORLDS[id].tagline}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}
