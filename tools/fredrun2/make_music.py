#!/usr/bin/env python3
"""
Fredrun 2.0 – Musik-Schleifen aus den Suno-Rohstücken bauen.

Die Rohstücke (2–3 Minuten, mit Intro/Outro) liegen nach `kie-audio.mjs music` als <id>-a.mp3 / <id>-b.mp3 vor.
Dieses Skript wählt je Stück einen taktgenauen Ausschnitt, der sich im Spiel nahtlos wiederholen lässt:

  1. Tempo + Taktraster schätzen (Onset-Kurve, Kammfilter-Suche, Downbeat über Bass-Onsets).
  2. Schleifenbeginn S auf einen Taktanfang legen, Länge P = N Takte (Vielfaches von 4, ≈ 55–80 s),
     das Ende vor dem Outro halten und P um ± 60 ms so feinjustieren, dass die Onset-Kurven am Übergang passen.
  3. Ausschnitt [S, S+P+X] schneiden (X = 2 Schläge Überblendung), Lautheit auf ≈ −15 LUFS (linear, 2-Pass) und als MP3 kodieren.
  4. `music.json` schreiben: je Stück {period, xfade, bpm, dur, gain}. Der Spieler (audio/tracks.ts) startet alle `period`
     Sekunden eine neue Kopie und blendet gleichzeitig X Sekunden über → rhythmisch nahtlose Endlosschleife.

Aufruf:
  python3 tools/fredrun2/make_music.py --src <Ordner mit *-a.mp3/*-b.mp3> --ffmpeg <Pfad> [--only wien,alpen] [--report]
Ohne --ffmpeg wird `imageio_ffmpeg` (pip) verwendet.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.signal import stft

SR = 22050
HOP = 256
FPS = SR / HOP

# Auswahl je Stück: Liste von Varianten (Kandidat a/b des Suno-Auftrags, Wunschbeginn [s] im Rohstück).
# Die erste Variante heißt <id>.mp3, weitere <id>-2.mp3 … – der Spieler wechselt zwischen ihnen von Lauf zu Lauf.
# Kriterien: Tempo passt zum Wunsch, kein langer Break, stabile Energie (siehe --report).
PICKS: dict[str, list[dict]] = {
    "menu": [{"cand": "b", "from": 8}, {"cand": "a", "from": 6}],
    "select": [{"cand": "b", "from": 6}, {"cand": "a", "from": 6}],
    "wien": [{"cand": "a", "from": 8}, {"cand": "b", "from": 8}],
    "alpen": [{"cand": "b", "from": 8}, {"cand": "a", "from": 8}],
    "finanzamt": [{"cand": "b", "from": 6}, {"cand": "a", "from": 6}],
    "prater": [{"cand": "a", "from": 6}, {"cand": "b", "from": 6}],
    "wachau": [{"cand": "b", "from": 8}, {"cand": "a", "from": 8}],
    "cyber": [{"cand": "a", "from": 40}, {"cand": "b", "from": 40}],
}
TARGET_LOOP = (55.0, 80.0)  # Sekunden
BITRATE = "96k"
TARGET_LUFS = -15.0


def ffmpeg_path(arg: str | None) -> str:
    if arg:
        return arg
    env = os.environ.get("FFMPEG")
    if env:
        return env
    import imageio_ffmpeg  # type: ignore

    return imageio_ffmpeg.get_ffmpeg_exe()


def load_mono(ff: str, path: Path) -> np.ndarray:
    p = subprocess.run([ff, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32)


def onset_curves(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Gesamt-Onset-Kurve und Bass-Onset-Kurve (< 160 Hz), beide mit FPS Bildern/s."""
    f, _, Z = stft(x, SR, nperseg=1024, noverlap=1024 - HOP)
    mag = np.log1p(np.abs(Z) * 30)
    d = np.maximum(0, np.diff(mag, axis=1))
    full = d.sum(axis=0)
    bass = d[f < 160].sum(axis=0)

    def clean(v: np.ndarray) -> np.ndarray:
        v = v - np.convolve(v, np.ones(43) / 43, mode="same")
        return np.maximum(v, 0)

    return clean(full), clean(bass)


def estimate_tempo(flux: np.ndarray) -> float:
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1 :]
    lo, hi = int(FPS * 60 / 200), int(FPS * 60 / 60)
    lags = np.arange(lo, hi)
    bpms = 60 * FPS / lags
    prior = np.exp(-0.5 * (np.log2(bpms / 130) / 0.6) ** 2)
    return float(bpms[int(np.argmax(ac[lo:hi] * prior))])


def comb_score(flux: np.ndarray, period_frames: float, phase: float) -> float:
    idx = np.arange(phase, len(flux) - 1, period_frames)
    i0 = np.floor(idx).astype(int)
    frac = idx - i0
    v = flux[i0] * (1 - frac) + flux[np.minimum(i0 + 1, len(flux) - 1)] * frac
    return float(v.mean())


def refine_grid(flux: np.ndarray, bpm0: float) -> tuple[float, float]:
    """Feines Tempo (± 3 %) und Phase (Sekunden) mit maximaler Kammfilter-Übereinstimmung."""
    best = (-1.0, bpm0, 0.0)
    for bpm in np.linspace(bpm0 * 0.97, bpm0 * 1.03, 61):
        pf = FPS * 60 / bpm
        for ph in np.arange(0, pf, 1.0):
            s = comb_score(flux, pf, ph)
            if s > best[0]:
                best = (s, float(bpm), ph / FPS)
    return best[1], best[2]


def downbeat_offset(bass: np.ndarray, bpm: float, phase: float) -> int:
    """Welcher der 4 Schläge trägt die stärkste Bass-Betonung (Taktanfang)?"""
    pf = FPS * 60 / bpm
    sums = np.zeros(4)
    cnt = np.zeros(4)
    k = 0
    t = phase * FPS
    while t < len(bass) - 1:
        i = int(round(t))
        sums[k % 4] += bass[max(0, i - 1) : i + 2].max()
        cnt[k % 4] += 1
        k += 1
        t += pf
    return int(np.argmax(sums / np.maximum(cnt, 1)))


def env_at(flux: np.ndarray, t0: float, dur: float) -> np.ndarray:
    a = int(t0 * FPS)
    b = int((t0 + dur) * FPS)
    return flux[max(0, a) : max(0, b)]


def seam_shift(flux: np.ndarray, s: float, p: float, x: float) -> float:
    """Feinjustierung von P: Korrelation der Onset-Kurve [S,S+X] mit [S+P+δ, S+P+δ+X]."""
    ref = env_at(flux, s, x)
    best = (-1.0, 0.0)
    for d_ms in range(-60, 61, 5):
        cand = env_at(flux, s + p + d_ms / 1000, x)
        n = min(len(ref), len(cand))
        if n < 8:
            continue
        a, b = ref[:n] - ref[:n].mean(), cand[:n] - cand[:n].mean()
        den = float(np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
        c = float(a @ b) / den
        if c > best[0]:
            best = (c, d_ms / 1000)
    return best[1]


def outro_start(x: np.ndarray) -> float:
    """Zeit, ab der das Stück ausklingt (letztes 2-s-Fenster deutlich über Medianpegel)."""
    w = SR * 2
    rms = np.array([np.sqrt(np.mean(x[i : i + w] ** 2)) + 1e-9 for i in range(0, len(x) - w // 2, w)])
    db = 20 * np.log10(rms)
    med = float(np.median(db))
    last = len(db) - 1
    while last > 0 and db[last] < med - 3.5:
        last -= 1
    return (last + 1) * 2.0


def plan_loop(x: np.ndarray, want_from: float) -> dict:
    flux, bass = onset_curves(x)
    bpm0 = estimate_tempo(flux)
    bpm, phase = refine_grid(flux, bpm0)
    beat = 60 / bpm
    db_off = downbeat_offset(bass, bpm, phase)
    bar = 4 * beat
    end_limit = outro_start(x)
    dur = len(x) / SR
    xfade = 2 * beat
    # erster Taktanfang ≥ want_from
    t = phase + db_off * beat
    while t < want_from:
        t += bar
    s = t
    # Schleifenlänge: größtes Vielfaches von 4 Takten im Zielbereich, das noch vor das Outro passt
    lo, hi = TARGET_LOOP
    best_n = None
    for n in range(4, 200, 4):
        p = n * bar
        if s + p + xfade > end_limit:
            break
        if p <= hi:
            best_n = n
    if best_n is None or best_n * bar < min(lo, 30):
        # kurzes Stück: früher beginnen
        s = phase + db_off * beat
        while s < 2.0:
            s += bar
        best_n = None
        for n in range(4, 200, 4):
            p = n * bar
            if s + p + xfade > end_limit:
                break
            best_n = n
    if best_n is None:
        raise RuntimeError("kein Schleifenbereich gefunden")
    p = best_n * bar
    delta = seam_shift(flux, s, p, xfade)
    p += delta
    return dict(bpm=round(bpm, 2), start=s, period=p, xfade=xfade, bars=best_n, outro=end_limit, dur=dur, downbeat=db_off, seam_shift_ms=int(delta * 1000))


def measure_lufs(ff: str, path: Path) -> float:
    p = subprocess.run([ff, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"I:\s+(-?\d+\.\d+) LUFS", p.stderr)
    return float(m[-1]) if m else -20.0


def build(ff: str, src: Path, out: Path, ids: list[str], report: bool) -> dict:
    manifest: dict[str, dict] = {}
    tmp = out / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for tid in ids:
        for idx, pick in enumerate(PICKS[tid]):
            key = tid if idx == 0 else f"{tid}-{idx + 1}"
            raw = src / f"{tid}-{pick['cand']}.mp3"
            x = load_mono(ff, raw)
            plan = plan_loop(x, pick["from"])
            print(f"[{key}] {raw.name}: {plan['bpm']} bpm, Start {plan['start']:.2f}s, {plan['bars']} Takte, Periode {plan['period']:.3f}s, X {plan['xfade']:.2f}s, "
                  f"Outro ab {plan['outro']:.0f}s von {plan['dur']:.0f}s (Naht {plan['seam_shift_ms']} ms)")
            if report:
                continue
            seg = tmp / f"{key}.wav"
            length = plan["period"] + plan["xfade"]
            subprocess.run([ff, "-v", "error", "-y", "-ss", f"{plan['start']:.4f}", "-t", f"{length:.4f}", "-i", str(raw), "-ac", "2", "-ar", "44100", str(seg)], check=True)
            lufs = measure_lufs(ff, seg)
            gain = TARGET_LUFS - lufs
            final = out / f"{key}.mp3"
            # statische Verstärkung + Begrenzer gegen Übersteuerung, kein Loudnorm-Pumpen
            subprocess.run(
                [ff, "-v", "error", "-y", "-i", str(seg), "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=disabled", "-c:a", "libmp3lame", "-b:a", BITRATE, "-joint_stereo", "1", str(final)],
                check=True,
            )
            manifest[key] = dict(
                file=f"{key}.mp3",
                bpm=plan["bpm"],
                period=round(plan["period"], 4),
                xfade=round(plan["xfade"], 4),
                length=round(length, 3),
                bytes=final.stat().st_size,
                source=raw.name,
            )
            print(f"      → {final.name} {final.stat().st_size / 1024:.0f} KB (Lautheit {lufs:.1f} → {TARGET_LUFS} LUFS)")
    for f in tmp.glob("*"):
        f.unlink()
    tmp.rmdir()
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="public/fredrun2/audio/music")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--only")
    ap.add_argument("--report", action="store_true", help="nur planen, nichts schreiben")
    a = ap.parse_args()
    ff = ffmpeg_path(a.ffmpeg)
    ids = a.only.split(",") if a.only else list(PICKS)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = build(ff, Path(a.src), out, ids, a.report)
    if not a.report:
        mf = out / "music.json"
        old = json.loads(mf.read_text()) if mf.exists() else {}
        old.update(manifest)
        mf.write_text(json.dumps(old, indent=2, ensure_ascii=False) + "\n")
        total = sum(v["bytes"] for v in old.values())
        print(f"music.json geschrieben ({len(old)} Stücke, {total / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
