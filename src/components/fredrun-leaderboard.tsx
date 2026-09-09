"use client";

import { useId } from "react";
import { FREDRUN_WORLDS, FREDRUN_WORLD_IDS, type FredRunWorldId } from "@/lib/fredrun-worlds";
import type { FredRunLeaderboardEntry } from "@/lib/fredrun-highscores";

function PodiumTrophy({ rank }: { rank: number }) {
  const id = useId();
  const colors = rank === 1 ? ["#fff2ba", "#f5c65c", "#ad6a1c"] : rank === 2 ? ["#f0f8ff", "#bed2e0", "#6a829b"] : ["#ffe2ca", "#d99a71", "#85472e"];
  return (
    <svg className="fredrun-podium-trophy" viewBox="0 0 160 150" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0.8">
          <stop stopColor={colors[0]} /><stop offset=".48" stopColor={colors[1]} /><stop offset="1" stopColor={colors[2]} />
        </linearGradient>
        <radialGradient id={`${id}-halo`}><stop stopColor={colors[1]} stopOpacity=".23" /><stop offset="1" stopColor={colors[1]} stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="80" cy="73" r="70" fill={`url(#${id}-halo)`} />
      <g fill="none" stroke={colors[1]} strokeWidth="2" opacity=".75">
        <path d="M62 123C24 116 12 79 27 51M98 123c38-7 50-44 35-72" />
      </g>
      <g fill={`url(#${id}-metal)`}>
        {[0, 1, 2, 3, 4].map(i => <g key={i} transform={`rotate(${i * 17} 80 76)`}><path d="M25 69Q9 64 14 49Q29 53 25 69M24 70Q39 62 33 51Q23 56 24 70" /></g>)}
        {[0, 1, 2, 3, 4].map(i => <g key={i} transform={`translate(160 0) scale(-1 1) rotate(${i * 17} 80 76)`}><path d="M25 69Q9 64 14 49Q29 53 25 69M24 70Q39 62 33 51Q23 56 24 70" /></g>)}
      </g>
      {rank === 1 ? <>
        <path d="M52 47H36v10c0 17 11 25 26 26M108 47h16v10c0 17-11 25-26 26" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="7" />
        <path d="M50 37h60l-5 36c-2 16-12 24-25 24S57 89 55 73Z" fill={`url(#${id}-metal)`} stroke={colors[0]} />
        <path d="M61 43h8l-4 27c-1 6 0 11 2 15-6-4-9-11-10-19Z" fill="#fff9df" opacity=".55" />
        <path d="M75 96h10v16l14 6v8H61v-8l14-6Z" fill={`url(#${id}-metal)`} />
        <path d="m80 49 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2Z" fill="#83520e" opacity=".8" />
        <path d="m80 8 3 8 9 3-9 3-3 8-3-8-9-3 9-3Z" fill={colors[0]} />
      </> : <>
        <path d="m56 33 11 42h26l11-42-17 5-7 22-7-22Z" fill={rank === 2 ? "#638aa7" : "#a9654c"} stroke={colors[1]} strokeWidth="2" />
        <circle cx="80" cy="87" r="30" fill={`url(#${id}-metal)`} stroke={colors[0]} strokeWidth="2" />
        <circle cx="80" cy="87" r="23" fill="none" stroke={colors[2]} strokeWidth="1.5" />
        <path d="m80 70 5 11 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2Z" fill={colors[2]} />
      </>}
    </svg>
  );
}

export type FredRunLeaderboardProps = {
  world: FredRunWorldId;
  selectWorld: (world: FredRunWorldId) => void;
  entries: FredRunLeaderboardEntry[];
  state: "loading" | "ready" | "error";
  error: string;
  retry: () => void;
};

export function FredRunLeaderboard({ world, selectWorld, entries, state, error, retry }: FredRunLeaderboardProps) {
  const id = useId();
  const name = FREDRUN_WORLDS[world].name;
  return (
    <section className="fredrun-leaderboard" aria-labelledby={`${id}-title`}>
      <div className="fredrun-leaderboard-header">
        <div><p className="eyebrow">Die besten Runden</p><h2 id={`${id}-title`}>Ruhmeshalle <span>Top 10</span></h2></div>
        <span className="fredrun-leaderboard-season">Jede Runde zählt</span>
      </div>
      <div className="fredrun-world-tabs" role="tablist" aria-label="Welt der Topliste">
        {FREDRUN_WORLD_IDS.map(worldId => <button key={worldId} type="button" role="tab"
          id={`${id}-tab-${worldId}`} aria-controls={`${id}-board`} aria-selected={world === worldId}
          tabIndex={world === worldId ? 0 : -1}
          onClick={() => selectWorld(worldId)}
          onKeyDown={event => {
            const index = FREDRUN_WORLD_IDS.indexOf(worldId);
            const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
            if (next === null) return;
            event.preventDefault();
            selectWorld(FREDRUN_WORLD_IDS[next]);
            const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
            buttons?.[next]?.focus();
          }}
        >{FREDRUN_WORLDS[worldId].name}</button>)}
      </div>
      <div id={`${id}-board`} role="tabpanel" aria-labelledby={`${id}-tab-${world}`} tabIndex={0} aria-busy={state === "loading"}>
        <div className="fredrun-board-heading"><h3>{name}</h3><span>Beste Runden · Top 10</span></div>
        {state === "loading" ? <p className="fredrun-leaderboard-state" role="status">Topliste für {name} wird geladen …</p>
          : state === "error" ? <div className="fredrun-leaderboard-state" role="alert"><p>{name}: {error}</p><button type="button" className="secondary-button compact-button" onClick={retry}>Erneut versuchen</button></div>
          : entries.length === 0 ? <div className="fredrun-leaderboard-empty"><PodiumTrophy rank={1} /><h4>Dein Platz auf dem Podium?</h4><p>Noch keine Runden in {name}. Hol dir Platz 1!</p></div>
          : <>
            <ol className="fredrun-podium" aria-label={`Podium · ${name}`}>
              {entries.slice(0, 3).map(entry => <li className={`fredrun-podium-place fredrun-podium-place--${entry.rank}`} key={entry.rank}>
                <PodiumTrophy rank={entry.rank} />
                <div className="fredrun-podium-person"><span className="fredrun-podium-label">{entry.rank === 1 ? "Spitzenplatz" : entry.rank === 2 ? "Silber" : "Bronze"}</span><strong>{entry.name}</strong><span className="fredrun-podium-score">{entry.score.toLocaleString("de-AT")}<small>Punkte</small></span></div>
                <div className="fredrun-podium-step"><span>Platz {entry.rank}</span><b aria-hidden="true">{String(entry.rank).padStart(2, "0")}</b></div>
              </li>)}
            </ol>
            {entries.length > 3 ? <ol className="fredrun-leaderboard-list" start={4} aria-label={`Plätze 4 bis 10 · ${name}`}>
              {entries.slice(3, 10).map(entry => <li className="fredrun-leaderboard-entry" key={entry.rank}><span className="fredrun-leaderboard-rank" aria-label={`Platz ${entry.rank}`}>{String(entry.rank).padStart(2, "0")}</span><strong>{entry.name}</strong><span>{entry.score.toLocaleString("de-AT")} <small>Punkte</small></span></li>)}
            </ol> : null}
            <p className="fredrun-leaderboard-note">Dein nächster Lauf kann alles verändern.</p>
          </>}
      </div>
    </section>
  );
}
