#!/usr/bin/env python3
"""Fredrun 2.0 – SFX-Bank-Builder.

Baut aus den freien Kenney-Klangpaketen (CC0, https://kenney.nl/assets) EINE Sprite-Datei mit allen Klangeffekten:

    public/fredrun2/audio/sfx-bank.mp3    alle Effekte hintereinander (mono, libmp3lame)
    public/fredrun2/audio/sfx-bank.json   Manifest: je Effekt-Name Varianten {start, dur} in Sekunden + Standardwerte

Aufruf (aus dem Repo-Root):

    python3 tools/fredrun2/build_sfx_bank.py --src <ORDNER MIT DEN KENNEY-PAKETEN> [--out public/fredrun2/audio]
                                             [--only jump,coin] [--report <ORDNER>] [--wav <ORDNER>] [--list]

``--src`` enthaelt die entpackten Pakete (je ``<paket>/Audio/*.ogg``):

    interface-sounds  impact-sounds  digital-audio  sci-fi-sounds  rpg-audio  casino-audio

``--report`` schreibt zusaetzlich eine Pegel-/Laengentabelle (report.txt) und Spektrogramm-Kontaktboegen (PNG) je Kategorie;
``--wav`` legt jede fertige Variante als 16-bit-WAV zum Anhoeren ab. ``--only`` baut nur die genannten Effekte in die Analyse
(nuetzlich beim Feilen an einem Rezept; das Bank-Ergebnis enthaelt dann nur diese Effekte und wird NICHT ueberschrieben, solange
``--out`` nicht ausdruecklich angegeben ist).

Ablauf
------
1. Jedes Rezept (``@fx``) holt Quell-Samples (``src()``), bearbeitet sie (Trimmen, EQ, Tonhoehe, Reverse, Layering, Hall ...)
   und liefert 1-4 Varianten (mono float32, 44.1 kHz).
2. ``finish()``: Gleichstrom raus, Ein-/Ausblendung an den Schnittkanten (keine Klicks), Varianten eines Effekts auf gleiche
   Lautheit bringen, Gruppe auf den Ziel-Spitzenpegel des Effekts skalieren, Lookahead-Limiter auf -2 dBFS.
3. Die Varianten werden mit 150 ms Stille dazwischen in einen Sprite gelegt; am Anfang steht ein Sync-Puls, mit dem die Laufzeit
   den MP3-Encoder-Delay des jeweiligen Browsers messen und ausgleichen kann (siehe ``bank.ts``).
4. ffmpeg/libmp3lame kodiert (mono, 112 kbps), das Skript dekodiert das Ergebnis testweise wieder und prueft die Ausrichtung
   der Schnitte (Selbsttest), dann wird das Manifest geschrieben.

Effekte ohne passendes Sample (bee-buzz, pigeon) und die Jingles (gameover, highscore) sind bewusst NICHT in der Bank – dort laeuft
weiter die prozedurale Stimme bzw. der Jingle-Player. Wer einen neuen Effekt hinzufuegt: Rezept schreiben, Namen aus
``SFX_NAMES`` (src/game/fredrun2/audio/types.ts) verwenden.

Abhaengigkeiten: Python 3.10+, numpy, scipy, Pillow (nur fuer --report); ffmpeg (mit libmp3lame) im PATH, per ``--ffmpeg``,
``$FFMPEG`` oder das pip-Paket ``imageio-ffmpeg``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import zlib
from pathlib import Path
from typing import Callable

import numpy as np
from scipy import signal
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d

REPO = Path(__file__).resolve().parents[2]
SR = 44100                      # Arbeits- und Sprite-Abtastrate
GAP = 0.15                      # Stille zwischen zwei Varianten im Sprite (s)
SYNC_AT = 0.06                  # Lage des Sync-Pulses im Sprite (s)
LEAD = 0.25                     # Ende der Anfangsstille (erste Variante beginnt hier)
TAIL = 0.20                     # Stille am Ende des Sprites
MP3_KBPS = 112
CEIL_DB = -2.0                  # harte Spitzenpegel-Grenze aller Effekte (dBFS)
BANK_VERSION = 1

# ---------------------------------------------------------------------------------------------------------------------
# Quellen: Kuerzel -> Kenney-Paket (alle CC0, "Kenney, www.kenney.nl")
# ---------------------------------------------------------------------------------------------------------------------
PACKS = {
    "ui": "interface-sounds",   # Interface Sounds 1.0 – Klicks, Auswahl, Bestaetigung, Fehler, Glas, Glitch, Scratch
    "imp": "impact-sounds",     # Impact Sounds 1.0 – Aufpralle (Holz, Metall, Glas, Stein, Plattform, Faust), Schritte
    "dig": "digital-audio",     # Digital Audio 1.0 – Retro-Pieps, Power-ups, Zaps, Laser
    "sci": "sci-fi-sounds",     # Sci-Fi Sounds 1.0 – Explosionen, Kraftfeld, Laser, Triebwerke, Metall-Aufpralle
    "rpg": "rpg-audio",         # RPG Audio 1.0 – Buecher, Stoff, Muenzen, Schritte, Metall
    "cas": "casino-audio",      # Casino Audio 1.0 – Karten, Chips, Wuerfel
}

_src_root: Path = Path(".")
_ffmpeg: str = "ffmpeg"
_cache: dict[str, np.ndarray] = {}


def find_ffmpeg(explicit: str | None) -> str:
    if explicit:
        return explicit
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    try:  # pip install imageio-ffmpeg bringt ein statisches Binary mit
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return shutil.which("ffmpeg") or "ffmpeg"


def load_raw(ref: str) -> np.ndarray:
    """``"imp/impactPunch_heavy_000"`` -> mono float32 mit 44.1 kHz (ffmpeg dekodiert das OGG), unveraendert und ungetrimmt."""
    if ref not in _cache:
        pack, name = ref.split("/", 1)
        path = _src_root / PACKS[pack] / "Audio" / f"{name}.ogg"
        if not path.exists():
            sys.exit(f"Quelle fehlt: {path}")
        p = subprocess.run(
            [_ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
            capture_output=True,
            check=True,
        )
        _cache[ref] = np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)
    return _cache[ref].copy()


# ---------------------------------------------------------------------------------------------------------------------
# Kleine DSP-Bibliothek (alles numpy/scipy, mono, float64 waehrend der Bearbeitung)
# ---------------------------------------------------------------------------------------------------------------------
def db(x: float) -> float:
    """dB -> linearer Faktor."""
    return 10.0 ** (x / 20.0)


def peak_db(x: np.ndarray) -> float:
    return 20.0 * math.log10(max(float(np.max(np.abs(x))) if len(x) else 0.0, 1e-9))


def sec(x: np.ndarray) -> float:
    return len(x) / SR


def onset(x: np.ndarray, thr_db: float = -50.0) -> int:
    """Index des ersten Samples ueber ``thr_db`` relativ zum Spitzenwert."""
    a = np.abs(x)
    idx = np.flatnonzero(a > a.max() * db(thr_db))
    return int(idx[0]) if len(idx) else 0


def end_of(x: np.ndarray, thr_db: float = -55.0) -> int:
    """Index NACH dem letzten Sample ueber ``thr_db`` (geglaettet, damit einzelne Ausreisser nicht zaehlen)."""
    a = maximum_filter1d(np.abs(x), size=int(0.004 * SR))
    idx = np.flatnonzero(a > a.max() * db(thr_db))
    return int(idx[-1]) + 1 if len(idx) else len(x)


def src(ref: str, t0: float | None = None, t1: float | None = None, thr: float = -50.0) -> np.ndarray:
    """Quell-Sample laden, Anfangsstille wegtrimmen (Attack liegt danach bei 0 s), optional auf [t0, t1] Sekunden kuerzen.

    Zeiten zaehlen ab dem getrimmten Anfang. Das Ende bekommt bei Kuerzung einen weichen Ausklang (5 ms)."""
    x = load_raw(ref)
    x = x[max(0, onset(x, thr) - int(0.0005 * SR)):]
    a = int((t0 or 0.0) * SR)
    b = int(t1 * SR) if t1 is not None else len(x)
    y = x[a:b]
    if t1 is not None and b < len(x):
        y = fade(y, 0.0, 0.005)
    return y


def cut(x: np.ndarray, t0: float, t1: float | None = None) -> np.ndarray:
    return x[int(t0 * SR): int(t1 * SR) if t1 is not None else None]


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0, curve: str = "cos") -> np.ndarray:
    """Ein-/Ausblendung in Sekunden (cos = gleichmaessig weich, lin = linear, exp = schneller Abfall fuer Ausklaenge)."""
    y = x.copy()
    n = len(y)

    def ramp(m: int) -> np.ndarray:
        r = np.linspace(0.0, 1.0, m, endpoint=False)
        if curve == "lin":
            return r
        if curve == "exp":
            return r ** 2.2
        return 0.5 - 0.5 * np.cos(np.pi * r)

    a = min(n, int(fin * SR))
    b = min(n, int(fout * SR))
    if a > 0:
        y[:a] *= ramp(a)
    if b > 0:
        y[n - b:] *= ramp(b)[::-1]
    return y


def gain(x: np.ndarray, g_db: float) -> np.ndarray:
    return x * db(g_db)


def reverse(x: np.ndarray) -> np.ndarray:
    return x[::-1].copy()


def _sos(kind: str, f: float | tuple[float, float], order: int) -> np.ndarray:
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def lp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("lowpass", min(f, SR * 0.45), order), x)


def hp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("highpass", f, order), x)


def bp(x: np.ndarray, f0: float, f1: float, order: int = 2) -> np.ndarray:
    return signal.sosfilt(_sos("bandpass", (f0, min(f1, SR * 0.45)), order), x)


def _rbj(kind: str, f: float, q: float, g_db: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """RBJ-Biquad (Audio-EQ-Cookbook)."""
    a_ = 10 ** (g_db / 40.0)
    w = 2 * math.pi * f / SR
    cw, sw = math.cos(w), math.sin(w)
    al = sw / (2 * q)
    if kind == "peak":
        b = [1 + al * a_, -2 * cw, 1 - al * a_]
        a = [1 + al / a_, -2 * cw, 1 - al / a_]
    elif kind == "lowshelf":
        s = 2 * math.sqrt(a_) * al
        b = [a_ * ((a_ + 1) - (a_ - 1) * cw + s), 2 * a_ * ((a_ - 1) - (a_ + 1) * cw), a_ * ((a_ + 1) - (a_ - 1) * cw - s)]
        a = [(a_ + 1) + (a_ - 1) * cw + s, -2 * ((a_ - 1) + (a_ + 1) * cw), (a_ + 1) + (a_ - 1) * cw - s]
    elif kind == "highshelf":
        s = 2 * math.sqrt(a_) * al
        b = [a_ * ((a_ + 1) + (a_ - 1) * cw + s), -2 * a_ * ((a_ - 1) + (a_ + 1) * cw), a_ * ((a_ + 1) + (a_ - 1) * cw - s)]
        a = [(a_ + 1) - (a_ - 1) * cw + s, 2 * ((a_ - 1) - (a_ + 1) * cw), (a_ + 1) - (a_ - 1) * cw - s]
    elif kind == "lowpass":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == "highpass":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == "bandpass":  # konstante Spitzenverstaerkung 0 dB
        b = [al, 0.0, -al]
        a = [1 + al, -2 * cw, 1 - al]
    else:
        raise ValueError(kind)
    b_ = np.array(b) / a[0]
    a_c = np.array(a) / a[0]
    return b_, a_c


def eq(x: np.ndarray, kind: str, f: float, g_db: float = 0.0, q: float = 0.9) -> np.ndarray:
    """Peak-/Shelf-Filter: ``eq(x, "peak", 3000, +4, q=1)``, ``eq(x, "lowshelf", 200, -6)``, ``eq(x, "highshelf", 6000, +3)``."""
    b, a = _rbj(kind, f, q, g_db)
    return signal.lfilter(b, a, x)


def sweep(x: np.ndarray, kind: str, f0: float, f1: float, q: float = 1.2, curve: float = 1.0, block: int = 32) -> np.ndarray:
    """Filter mit ueber die Zeit gleitender Eckfrequenz (exponentiell f0 -> f1), Resonanz ``q``. kind: lowpass|highpass|bandpass.

    Grundbaustein fuer Whooshes, Riser und "Dumpf-werden"-Effekte. Zustand wird ueber Bloecke weitergereicht (kein Knacken)."""
    y = np.empty_like(x)
    n = len(x)
    zi = np.zeros(2)
    nb = max(1, math.ceil(n / block))
    for i in range(nb):
        u = (i * block) / max(1, n - 1)
        f = f0 * (f1 / f0) ** min(1.0, u ** curve)
        b, a = _rbj(kind, min(f, SR * 0.45), q)
        s = slice(i * block, min(n, (i + 1) * block))
        y[s], zi = signal.lfilter(b, a, x[s], zi=zi)
    return y


def resample_rate(x: np.ndarray, rate: float) -> np.ndarray:
    """Wiedergabe mit ``rate`` (>1: hoeher UND kuerzer, wie playbackRate)."""
    from fractions import Fraction

    fr = Fraction(1.0 / rate).limit_denominator(2000)
    return signal.resample_poly(x, fr.numerator, fr.denominator)


def semis(x: np.ndarray, n: float) -> np.ndarray:
    return resample_rate(x, 2.0 ** (n / 12.0))


def glide(x: np.ndarray, r0: float, r1: float) -> np.ndarray:
    """Tonhoehen-Gleiten ("Tape-Stop"/Doppler): Abspielrate wandert exponentiell von ``r0`` nach ``r1`` ueber die Quelle."""
    up = 4
    xu = signal.resample_poly(x, up, 1)
    n = len(xu)
    k = 4000
    u = np.linspace(0.0, 1.0, k)
    rate = r0 * (r1 / r0) ** u
    dt = (n / SR / up) / rate / (k - 1)          # Ausgangszeit pro Schritt
    t = np.concatenate([[0.0], np.cumsum(dt[:-1])])
    m = int(t[-1] * SR)
    uu = np.interp(np.arange(m) / SR, t, u)
    return np.interp(uu * (n - 1), np.arange(n), xu)


def f0_of(x: np.ndarray, lo: float = 120.0, hi: float = 4000.0, t0: float = 0.005, dur: float = 0.06) -> float:
    """Grundfrequenz per Autokorrelation (fuer Stimmen von Zupf-/Glas-Samples)."""
    a = int(t0 * SR)
    seg = x[a: a + int(dur * SR)] * np.hanning(max(8, min(len(x) - a, int(dur * SR))))
    n = 1 << int(math.ceil(math.log2(len(seg) * 2)))
    ac = np.fft.irfft(np.abs(np.fft.rfft(seg, n)) ** 2)[: len(seg)]
    ac = ac / (ac[0] + 1e-12)
    lo_l, hi_l = int(SR / hi), min(int(SR / lo), len(ac) - 2)
    k = int(np.argmax(ac[lo_l:hi_l])) + lo_l
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    k = k + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
    return SR / k


def tune(x: np.ndarray, target_hz: float, **kw: float) -> np.ndarray:
    """Sample auf eine bestimmte Note stimmen (Resampling, dauert dadurch entsprechend kuerzer/laenger)."""
    return resample_rate(x, target_hz / f0_of(x, **kw))


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def hz(note: str) -> float:
    """``hz("G5")`` -> 783.99"""
    n, o = note[:-1], int(note[-1])
    return 440.0 * 2.0 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12.0)


def lv(x: np.ndarray, rel: float = 0.0, ref: float = -18.0, cap: float = -4.0) -> np.ndarray:
    """Ebene auf einen gemeinsamen, wahrnehmungsnahen Bezugspegel bringen (dann ``rel`` dB darueber/darunter).

    Bezug ist der K-bewertete RMS des lautesten 60-ms-Abschnitts = ``ref`` dB (Rauschen, Toene, Rumpeln klingen so gleich
    laut, egal wie die Quelldatei ausgesteuert war); sehr kurze Transienten (Klicks, Knacken) wuerden dadurch unsinnig
    verstaerkt und werden deshalb auf ``cap`` dBFS Spitze begrenzt. Rezepte muessen so keine Quellpegel kennen."""
    k = _k_weight(x)
    n = int(0.06 * SR)
    if len(k) < n:
        k = np.pad(k, (0, n - len(k)))
    ms = float(uniform_filter1d(k ** 2, size=n, mode="constant").max())
    g_rms = ref - 10.0 * math.log10(ms + 1e-12)
    g_peak = cap - peak_db(x)
    return x * db(min(g_rms, g_peak) + rel)


def mix(*layers: tuple, length: float | None = None, norm: bool = True) -> np.ndarray:
    """Ebenen uebereinanderlegen: ``mix((x, at_sec, gain_db), ...)``; ``at`` und ``gain_db`` sind optional.

    Mit ``norm`` (Standard) wird jede Ebene zuerst per ``lv()`` auf den gemeinsamen Bezugspegel gebracht, ``gain_db`` ist dann
    der Pegelabstand relativ dazu (0 = gleich laut wie die anderen Ebenen, -6 = deutlich leiser)."""
    parts = []
    end = 0
    for lay in layers:
        x = lay[0]
        at = int(round((lay[1] if len(lay) > 1 else 0.0) * SR))
        g = lay[2] if len(lay) > 2 else 0.0
        parts.append((lv(x, g) if norm else x * db(g), at))
        end = max(end, at + len(x))
    if length is not None:
        end = int(length * SR)
    out = np.zeros(end)
    for x, at in parts:
        m = min(len(x), end - at)
        if m > 0:
            out[at: at + m] += x[:m]
    return out


def arp(sample: np.ndarray, base_hz: float, notes: list[str] | list[float], step: float, g_db: float = 0.0,
        ramp_db: float = 0.0, length: float | None = None) -> np.ndarray:
    """Zupf-/Glocken-Sample als Arpeggio: jede Note ist das auf ``notes[i]`` gestimmte Sample, im Abstand ``step`` s."""
    layers = []
    for i, nt in enumerate(notes):
        f = hz(nt) if isinstance(nt, str) else float(nt)
        layers.append((resample_rate(sample, f / base_hz), i * step, g_db + ramp_db * i))
    return mix(*layers, length=length)


def env_follow(x: np.ndarray, ms: float = 8.0) -> np.ndarray:
    return uniform_filter1d(maximum_filter1d(np.abs(x), size=max(1, int(ms * 0.001 * SR))), size=max(1, int(ms * 0.001 * SR)))


def saturate(x: np.ndarray, drive: float = 2.0) -> np.ndarray:
    """Weiche Saettigung (tanh) – macht Aufpralle dichter/druckvoller."""
    return np.tanh(x * drive) / np.tanh(drive)


def bitcrush(x: np.ndarray, bits: int = 6, hold: int = 4) -> np.ndarray:
    """Sample&Hold + Quantisierung (Glitch/Digital-Look)."""
    y = np.repeat(x[::hold], hold)[: len(x)]
    q = 2 ** (bits - 1)
    return np.round(y * q) / q


def am(x: np.ndarray, rate: float, depth: float = 0.5, phase: float = 0.0) -> np.ndarray:
    """Amplitudenmodulation (Tremolo / Rollen)."""
    t = np.arange(len(x)) / SR
    return x * (1.0 - depth * 0.5 + depth * 0.5 * np.sin(2 * math.pi * rate * t + phase))


def rng_for(name: str, salt: int = 0) -> np.random.Generator:
    """Deterministische Zufallsquelle je Effekt (Aenderung eines Rezepts wuerfelt die anderen nicht neu)."""
    return np.random.default_rng(zlib.crc32(f"{name}:{salt}".encode()) & 0xFFFFFFFF)


def noise(n: float, rng: np.random.Generator, kind: str = "white") -> np.ndarray:
    m = int(n * SR)
    w = rng.standard_normal(m)
    if kind == "white":
        return w
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(m, 1 / SR)
    f[0] = f[1]
    spec *= f ** (-0.5 if kind == "pink" else -1.0)
    y = np.fft.irfft(spec, m)
    return y / (np.std(y) + 1e-12)


def reverb(x: np.ndarray, rt60: float = 0.6, wet: float = 0.25, pre: float = 0.008, damp: float = 6500.0,
           lowcut: float = 160.0, seed: str = "rv", tail_cut: float = 0.02) -> np.ndarray:
    """Kleiner Faltungshall mit erzeugtem Impuls: fruehe Reflexionen + exponentiell abklingendes, gedaempftes Rauschen.

    ``wet`` ist der Pegel des Halls relativ zum Trockensignal (linear). Die Laenge waechst um die Hallfahne; Ausklang bei -60 dB."""
    rng = rng_for(seed)
    n = int((rt60 * 1.05 + pre) * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9078 * np.maximum(0.0, t - pre) / rt60)
    ir[: int(pre * SR)] = 0.0
    ir = lp(ir, damp, 2)
    ir = hp(ir, lowcut, 2)
    for _ in range(7):  # fruehe Reflexionen
        d = int((pre + rng.uniform(0.004, 0.045)) * SR)
        ir[d] += rng.uniform(0.4, 1.0) * (1 if rng.random() < 0.5 else -1)
    ir /= math.sqrt(float(np.sum(ir ** 2))) + 1e-12
    w = signal.fftconvolve(x, ir) * wet
    out = np.zeros(max(len(x), len(w)))
    out[: len(x)] += x
    out += np.pad(w, (0, len(out) - len(w)))
    return out


# ---- Lautheit (K-bewertet nach ITU-R BS.1770, mit 200-ms-Fenster fuer kurze Effekte) -----------------------------------
def _k_weight(x: np.ndarray) -> np.ndarray:
    b1, a1 = _rbj("highshelf", 1681.97, 0.7071, 4.0)
    b2, a2 = _rbj("highpass", 38.135, 0.5003)
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x))


def loudness(x: np.ndarray, win: float = 0.2) -> float:
    """Lautester 200-ms-Abschnitt in LUFS-Naeherung (kurze Effekte werden mit Stille aufgefuellt = zeitliche Integration).

    Bei sehr kurzen Effekten (Klicks) ist die Lautheit klein bei hohem Spitzenpegel – das ist gewollt, sie bleiben "spitz"."""
    k = _k_weight(x)
    n = int(win * SR)
    if len(k) < n:
        k = np.pad(k, (0, n - len(k)))
    ms = uniform_filter1d(k ** 2, size=n, mode="constant")
    return -0.691 + 10.0 * math.log10(float(ms.max()) + 1e-12)


def limit(x: np.ndarray, ceil_db: float = CEIL_DB, look: float = 0.0025) -> np.ndarray:
    """Lookahead-Limiter (Minimumfilter + Glaettung): garantiert Spitzen <= ``ceil_db`` ohne Ueberschwinger."""
    c = db(ceil_db)
    n = max(2, int(look * SR))
    gr = np.minimum(1.0, c / np.maximum(np.abs(x), 1e-9))
    gr = uniform_filter1d(minimum_filter1d(gr, size=2 * n + 1), size=n | 1)
    return x * np.minimum(gr, 1.0)


def bump(dur: float, f: float, decay: float, rng: np.random.Generator | None = None) -> np.ndarray:
    """Kurzer gedaempfter Sinus (Klopfen/Klick-Koerper) – nur fuer winzige Ergaenzungen der Samples."""
    t = np.arange(int(dur * SR)) / SR
    return np.sin(2 * math.pi * f * t) * np.exp(-t / decay)


# ---------------------------------------------------------------------------------------------------------------------
# Rezepte
# ---------------------------------------------------------------------------------------------------------------------
class Spec:
    """Ein Effekt: Rezept-Funktion + Standardwerte fuer das Manifest."""

    def __init__(self, name: str, fn: Callable[[], list[np.ndarray]], cat: str, peak: float, jitter: float,
                 reverb: float | None, pan: float | None, sweep: tuple[float, float] | None, gain: float) -> None:
        self.name, self.fn, self.cat, self.peak, self.jitter = name, fn, cat, peak, jitter
        self.reverb, self.pan, self.sweep, self.gain = reverb, pan, sweep, gain


SPECS: dict[str, Spec] = {}


def fx(name: str, cat: str, peak: float = -9.0, jitter: float = 0.03, reverb: float | None = None,
       pan: float | None = None, sweep: tuple[float, float] | None = None, gain: float = 1.0):
    """Rezept registrieren.

    ``peak``    Ziel-Spitzenpegel der lautesten Variante in dBFS (Kategorien: UI -12..-9, haeufige Bewegung -10..-7,
                Pickups -9..-6, Treffer/Explosionen -3..-2). Alles wird zusaetzlich auf -2 dBFS begrenzt.
    ``jitter``  zufaellige Tonhoehe der Laufzeit (+-Anteil, 0.03 = +-3 %) – bei melodischen Effekten klein/0.
    ``reverb``  Reverb-Send der Laufzeit (0..1) statt des Standardwertes aus SFX_META (Effekte mit eingebautem Hall: klein).
    ``pan``     Standard-Panorama, ``sweep`` (von, bis) fuer Vorbeiflug-Effekte (Laufzeit-Pan-Automation).
    ``gain``    Standard-Verstaerkung im Manifest (Feinabgleich ohne Neubau).
    """

    def deco(fn: Callable[[], list[np.ndarray]]):
        SPECS[name] = Spec(name, fn, cat, peak, jitter, reverb, pan, sweep, gain)
        return fn

    return deco


def air(rng: np.random.Generator, dur: float, f0: float, f1: float, q: float = 1.1, attack: float = 0.02,
        decay: float = 3.0, ref: str = "sci/thrusterFire_003", at: float = 1.0) -> np.ndarray:
    """Luftrauschen (aus einem Triebwerks-Sample, Ausschnitt ohne Zuendphase) mit gleitendem Bandpass und Huellkurve."""
    x = cut(load_raw(ref), at + float(rng.uniform(0, 0.5)), at + 0.5 + dur)[: int(dur * SR)]
    x = sweep(x, "bandpass", f0, f1, q=q)
    t = np.arange(len(x)) / SR
    e = np.minimum(1.0, t / max(attack, 1e-3)) * np.exp(-decay * t / dur)
    return x * e


# ---- UI -------------------------------------------------------------------------------------------------------------
@fx("ui-click", "ui", peak=-9, jitter=0.03, reverb=0.03)
def ui_click():
    # Kurzer, trockener "Tock": Zupf-Koerper (Ton) + Klick-Transiente, weich hochgefiltert
    a = mix((src("ui/select_001"), 0, 0), (src("ui/click_003"), 0, -7))
    b = mix((src("ui/select_002"), 0, 0), (src("ui/click_005"), 0, -8))
    c = mix((fade(cut(tune(src("ui/pluck_001"), hz("A5")), 0, 0.05), 0, 0.03), 0, -3), (src("ui/click_002"), 0, -8))
    return [lp(v, 9000) for v in (a, b, c)]


@fx("ui-hover", "ui", peak=-17, jitter=0.04, reverb=0.02)
def ui_hover():
    return [lp(src("ui/tick_002"), 5500), lp(src("ui/tick_001"), 6000)]


@fx("ui-back", "ui", peak=-11, jitter=0.03, reverb=0.03)
def ui_back():
    # abfallendes Zupfen: zwei Varianten, leise Klick-Ebene darunter
    a = mix((src("ui/back_002"), 0, 0), (src("ui/click_003"), 0, -12))
    b = mix((src("ui/back_004"), 0, 0), (src("ui/click_002"), 0, -12))
    return [lp(a, 7000), lp(b, 7000)]


@fx("ui-buy", "ui", peak=-7, jitter=0.0, reverb=0.10)
def ui_buy():
    # "Ka-Ching": Muenzen klimpern + aufsteigender Bestaetigungston + Glas-Glitzern, kurzer Hall
    out = []
    for coins, conf, glass_at in (("rpg/handleCoins", "ui/confirmation_003", 0.10), ("rpg/handleCoins2", "ui/confirmation_002", 0.12)):
        c = hp(cut(src(coins), 0, 0.45), 500)
        c = fade(c, 0, 0.12)
        k = semis(src(conf), 12)
        g = fade(cut(src("ui/glass_004"), 0, 0.55), 0, 0.2)
        v = mix((c, 0, -4), (k, 0.02, -3), (g, glass_at, -13))
        out.append(reverb(v, rt60=0.55, wet=0.22, seed=f"buy{coins}"))
    return out


@fx("ui-denied", "ui", peak=-9, jitter=0.03, reverb=0.03)
def ui_denied():
    # Zwei dumpfe Zupfer abwaerts ("nope"), tief gestimmt und weich
    a = semis(mix((src("ui/error_001"), 0, 0), (src("imp/impactSoft_medium_000"), 0, -8)), -5)
    b = semis(mix((src("ui/error_004"), 0, 0), (src("imp/impactSoft_medium_001"), 0, -8)), -3)
    return [lp(a, 5000), lp(b, 5000)]


def ring(note: str, dur: float, ref: str = "ui/glass_004", g_db: float = 0.0, fout: float = 0.12) -> np.ndarray:
    """Langer, reiner Glas-Ton auf ``note`` gestimmt (Nachklang / "Ting"); ``dur`` = Laenge inkl. Ausblendung."""
    x = tune(src(ref), hz(note))
    return gain(fade(cut(x, 0, dur), 0.0, min(fout, dur * 0.8)), g_db)


def pluck(note: str, which: int = 1, dur: float | None = None) -> np.ndarray:
    """Zupfton (Kenney pluck_001 = A4, pluck_002 = ~D#5) auf ``note`` gestimmt."""
    x = tune(src(f"ui/pluck_00{which}"), hz(note))
    return fade(cut(x, 0, dur), 0, 0.02) if dur else x


def sub(ref: str, st: float = 0.0, f: float = 250.0, dur: float | None = None, g_db: float = 0.0) -> np.ndarray:
    """Tiefer Koerper eines Samples: transponiert, tiefpassgefiltert (fuer Wumms unter Aufprallen)."""
    x = src(ref)
    if st:
        x = semis(x, st)
    x = lp(x, f, 2)
    if dur:
        x = fade(cut(x, 0, dur), 0, min(0.05, dur * 0.5))
    return gain(x, g_db)


def scatter(rng: np.random.Generator, pool: list[np.ndarray], n: int, t0: float, t1: float, g0: float, g1: float,
            st: float = 0.0, lowpass: float | None = None, length: float | None = None) -> np.ndarray:
    """``n`` Treffer aus ``pool`` an zufaelligen Zeiten in [t0, t1] (Pegel g0 -> g1 dB ueber die Zeit, zufaellige Tonhoehe +-st)."""
    times = np.sort(rng.uniform(t0, t1, n))
    layers = []
    for i, t in enumerate(times):
        x = pool[int(rng.integers(len(pool)))]
        x = semis(x, float(rng.uniform(-st, st))) if st else x
        if lowpass:
            x = lp(x, lowpass)
        u = (t - t0) / max(1e-6, t1 - t0)
        layers.append((x, float(t), g0 + (g1 - g0) * u + float(rng.uniform(-2, 2))))
    return mix(*layers, length=length)


# ---- Bewegung -------------------------------------------------------------------------------------------------------
@fx("jump", "move", peak=-9, jitter=0.04, reverb=0.05)
def jump():
    # "hup": Stoff-Flick + aufsteigendes Luftrauschen + ganz leiser Retro-Aufwaertsschub (gibt dem Sprung Charakter)
    rng = rng_for("jump")
    out = []
    for cloth, pj, (f0, f1), pj_db, st in (
        ("rpg/cloth2", "dig/phaseJump2", (500, 2600), -13, 0),
        ("rpg/cloth3", "dig/phaseJump3", (600, 3000), -14, 1),
        ("rpg/cloth1", "dig/phaseJump1", (450, 2400), -13, -1),
        ("rpg/cloth4", "dig/phaseJump4", (700, 3200), -15, 2),
    ):
        a = air(rng, 0.20, f0, f1, decay=3.2)
        c = hp(fade(src(cloth, 0, 0.13), 0, 0.05), 600)
        b = lp(semis(fade(src(pj, 0, 0.2), 0, 0.08), st), 3200)
        out.append(mix((a, 0.0, -4), (c, 0.0, -3), (b, 0.0, pj_db)))
    return out


@fx("doublejump", "move", peak=-9, jitter=0.03, reverb=0.10)
def doublejump():
    # heller, "luftiger": Sprung-Basis + Glitzer-Zupfer (zweiter Impuls in der Luft)
    rng = rng_for("doublejump")
    out = []
    for i, (cloth, pj, spark, note) in enumerate((("rpg/cloth3", "dig/phaseJump5", "ui/glass_002", "E6"), ("rpg/cloth1", "dig/phaseJump4", "ui/glass_003", "G6"))):
        a = air(rng, 0.22, 1200, 5200, q=1.0, decay=2.8)
        c = hp(fade(src(cloth, 0, 0.11), 0, 0.05), 900)
        b = lp(fade(src(pj, 0, 0.2), 0, 0.08), 4200)
        s = pluck(note, 2, 0.14)
        r = ring(note, 0.26, spark, g_db=-3, fout=0.15)
        out.append(mix((a, 0, -4), (c, 0, -4), (b, 0, -14), (s, 0.04, -7), (r, 0.045, -10)))
    return out


@fx("land", "move", peak=-8, jitter=0.05, reverb=0.05)
def land():
    # Landung: dumpfer Koerper (weicher Aufprall) + Schuh-Transiente + kleines Scharren
    out = []
    for i, (body, step, scuff) in enumerate((
        ("imp/impactSoft_medium_000", "imp/footstep_concrete_000", "imp/footstep_grass_000"),
        ("imp/impactSoft_medium_001", "imp/footstep_carpet_001", "imp/footstep_grass_001"),
        ("imp/impactSoft_medium_003", "imp/footstep_concrete_003", "imp/footstep_grass_002"),
        ("imp/impactSoft_medium_004", "imp/footstep_wood_001", "imp/footstep_grass_004"),
    )):
        b = lp(src(body), 320)
        s = hp(src(step), 350)
        g = hp(lp(cut(src(scuff), 0, 0.14), 5000), 700)
        out.append(mix((b, 0, 0), (s, 0, -6), (g, 0.012, -14)))
    return out


@fx("slide", "move", peak=-11, jitter=0.05, reverb=0.04)
def slide():
    # Rutschen: Stoff-Reibung + weiches, fallendes Reibungsrauschen (Boden), dumpfer Bodenkontakt am Anfang
    rng = rng_for("slide")
    out = []
    for cloth, f0, f1, body in (("rpg/cloth3", 1500, 600, "imp/impactSoft_medium_002"), ("rpg/cloth1", 1900, 800, "imp/impactSoft_medium_004"), ("rpg/cloth4", 1300, 500, "imp/impactSoft_medium_001")):
        c = hp(cut(src(cloth), 0, 0.34), 350)
        n = air(rng, 0.34, f0, f1, q=0.7, attack=0.05, decay=1.6, ref="sci/thrusterFire_001", at=0.8)
        fr = fade(mix((c, 0, -2), (n, 0, 0)), 0.02, 0.14)
        out.append(mix((fr, 0, 0), (lp(src(body), 300), 0, -3)))
    return out


@fx("dash", "move", peak=-8, jitter=0.03, reverb=0.08)
def dash():
    # Schub: Luft-Whoosh mit steigendem Bandpass + "Wumm" des Kraftfelds + Sub-Stoss
    rng = rng_for("dash")
    out = []
    for i, (ff, f0, f1) in enumerate((("sci/forceField_001", 350, 4200), ("sci/forceField_003", 500, 5200), ("sci/forceField_000", 300, 3600))):
        a = air(rng, 0.30, f0, f1, q=1.3, attack=0.03, decay=2.2)
        w = hp(fade(src(ff, 0, 0.30), 0.01, 0.12), 180)
        s = sub("sci/lowFrequency_explosion_001", 0, 170, 0.22, g_db=-10)
        out.append(mix((a, 0, -1), (w, 0, -9), (s, 0, 0)))
    return out


@fx("stomp", "move", peak=-3, jitter=0.03, reverb=0.08)
def stomp():
    # Stampfer: schwere Platte + tiefer Aufprall + Crunch-Anteil, kurzer Raum
    out = []
    for i, (plate, soft, crunch, metal) in enumerate((
        ("imp/impactPlate_heavy_001", "imp/impactSoft_heavy_000", "sci/explosionCrunch_000", "sci/impactMetal_002"),
        ("imp/impactPlate_heavy_003", "imp/impactSoft_heavy_002", "sci/explosionCrunch_002", "sci/impactMetal_004"),
        ("imp/impactPlate_heavy_002", "imp/impactSoft_heavy_004", "sci/explosionCrunch_003", "sci/impactMetal_000"),
    )):
        p = lp(src(plate), 6000)
        s = lp(src(soft), 200)
        c = fade(lp(src(crunch, 0, 0.26), 1800), 0, 0.15)
        m = lp(src(metal, 0, 0.35), 900)
        v = mix((p, 0, -2), (s, 0, -1), (c, 0, -9), (m, 0, -5))
        out.append(reverb(v, rt60=0.35, wet=0.16, seed=f"stomp{i}"))
    return out


@fx("stomp-chain", "move", peak=-6, jitter=0.0, reverb=0.16)
def stomp_chain():
    # Kombo-Stampfer: leichterer Aufprall + aufsteigende Zupf-Terz-Kette (wird mit der Kettenlaenge hoeher gestimmt)
    out = []
    for i, (plate, soft, plk) in enumerate((("imp/impactPlate_medium_001", "imp/impactSoft_medium_000", 2), ("imp/impactPlate_medium_003", "imp/impactSoft_medium_002", 1))):
        body = mix((hp(src(plate), 200), 0, -3), (lp(src(soft), 260), 0, -2))
        notes = ["G5", "B5", "D6", "G6"]
        chime = arp(pluck("G5", plk), hz("G5"), notes, 0.055, g_db=-7, ramp_db=1.0)
        rings = arp(ring("G5", 0.4, "ui/glass_002", -6), hz("G5"), notes, 0.055, ramp_db=0.5)
        out.append(reverb(mix((body, 0, 0), (chime, 0.05, 0), (rings, 0.05, -5)), rt60=0.5, wet=0.18, seed=f"sc{i}"))
    return out


@fx("spring", "move", peak=-8, jitter=0.03, reverb=0.12)
def spring():
    # Sprungfeder: aufsteigendes "Boing" (Retro-Phasensprung) + Metall-Twang + Luft
    rng = rng_for("spring")
    out = []
    for pj, metal in (("dig/phaseJump1", "imp/impactMetal_light_001"), ("dig/phaseJump2", "imp/impactMetal_light_004")):
        b = lp(fade(src(pj), 0, 0.12), 5200)
        t = semis(hp(src(metal, 0, 0.25), 900), 3)
        a = air(rng, 0.25, 800, 4200, decay=2.5)
        out.append(mix((b, 0, -2), (t, 0, -7), (a, 0, -12)))
    return out


@fx("portal", "move", peak=-6, jitter=0.02, reverb=0.10, sweep=(-0.7, 0.7))
def portal():
    # Portal: Kraftfeld-Schwellen + rueckwaerts laufendes Glas-Glitzern + Luft-Riser, halliger Ausklang
    rng = rng_for("portal")
    out = []
    for ff, door, note in (("sci/forceField_000", "sci/doorOpen_001", "E6"), ("sci/forceField_002", "sci/doorOpen_002", "B5")):
        w = hp(fade(src(ff), 0.05, 0.25), 140)
        g = reverse(ring(note, 0.7, "ui/glass_004", fout=0.05))
        g = fade(g, 0.3, 0.02)
        a = air(rng, 0.85, 300, 6000, q=1.0, attack=0.45, decay=1.0)
        d = lp(fade(src(door), 0.05, 0.3), 7000)
        v = mix((w, 0, -2), (g, 0.15, -10), (a, 0, -6), (d, 0.2, -13))
        out.append(reverb(v, rt60=0.9, wet=0.3, seed=f"portal{ff}"))
    return out


@fx("wallbreak", "move", peak=-2, jitter=0.03, reverb=0.12)
def wallbreak():
    # Wand bricht: Holz-/Stein-Knall + Crunch-Wolke + Sub + verstreute Bruchstuecke
    rng = rng_for("wallbreak")
    out = []
    for i, (crunch, crack, sub_ref) in enumerate((("sci/explosionCrunch_000", "imp/impactPlank_medium_001", "sci/lowFrequency_explosion_001"), ("sci/explosionCrunch_001", "imp/impactPlank_medium_002", "sci/lowFrequency_explosion_000"))):
        c = sweep(src(crunch, 0, 0.7), "lowpass", 9000, 1400, q=0.8)
        c = fade(c, 0, 0.25)
        k = src(crack)
        s = sub(sub_ref, 0, 220, 0.6, g_db=-1)
        debris = scatter(rng, [src(f"imp/impactMining_00{j}", 0, 0.3) for j in range(5)], 6, 0.05, 0.45, -8, -14, st=3, length=0.7)
        v = mix((c, 0, -4), (k, 0, -1), (s, 0, -3), (debris, 0, 0))
        out.append(reverb(v, rt60=0.55, wet=0.2, seed=f"wall{i}"))
    return out


# ---- Pickups / Power-ups ---------------------------------------------------------------------------------------------
@fx("coin", "pick", peak=-8, jitter=0.015, reverb=0.10)
def coin():
    # "Bling-Ling": zwei aufsteigende Zupftoene (Quarte, wie ein Muenz-Ding) mit Glas-Nachklang + Metall-Klick eines Chips.
    # Die Varianten unterscheiden sich in Klangfarbe (Zupfer/Glas/Klick), nicht in der Tonhoehe -> Kombos klingen einheitlich.
    out = []
    cfg = ((1, 2, "ui/glass_004", "cas/chips-stack-2"), (2, 1, "ui/glass_002", "cas/chip-lay-2"),
           (1, 1, "ui/glass_001", "cas/chips-stack-5"), (2, 2, "ui/glass_003", "cas/chips-collide-2"))
    for i, (p1, p2, rr, clk) in enumerate(cfg):
        v = mix(
            (pluck("B5", p1, 0.10), 0, 0), (ring("B5", 0.22, rr, -4), 0, -6),
            (pluck("E6", p2, 0.12), 0.055, 0), (ring("E6", 0.40, rr, -4), 0.055, -5),
            (hp(cut(src(clk), 0, 0.06), 2500), 0, -9),
        )
        out.append(reverb(v, rt60=0.30, wet=0.14, seed=f"coin{i}"))
    return out


@fx("gem", "pick", peak=-6, jitter=0.01, reverb=0.16)
def gem():
    # Edelstein: schnelle Glitzer-Kaskade (Pentatonik) mit langem, glasigem Nachklang und Hall
    out = []
    for i, (notes, rr) in enumerate((("E6 G#6 B6 E7 G#7", "ui/glass_002"), ("D6 F#6 A6 D7 F#7", "ui/glass_003"))):
        ns = notes.split()
        pings = arp(pluck("E6", 2, 0.12), hz("E6"), ns, 0.048, ramp_db=0.8)
        rings = arp(ring("E6", 0.5, rr, fout=0.3), hz("E6"), ns, 0.048, ramp_db=0.5)
        top = ring(ns[-1], 0.9, "ui/glass_004", -2, fout=0.5)
        v = mix((pings, 0, 0), (rings, 0, -4), (top, 0.19, -8), (hp(cut(src("cas/chips-handle-1"), 0, 0.4), 4000), 0.02, -14))
        out.append(reverb(v, rt60=0.9, wet=0.28, seed=f"gem{i}"))
    return out


@fx("heart", "pick", peak=-7, jitter=0.0, reverb=0.16)
def heart():
    # Herz: zwei weiche Herzschlag-Bumms + warmer aufsteigender Akkord
    thump = lp(semis(src("imp/impactSoft_medium_001"), -4), 260)
    thump2 = lp(semis(src("imp/impactSoft_medium_003"), -5), 240)
    notes = ["C5", "E5", "G5", "C6"]
    warm = arp(lp(pluck("C5", 1, 0.5), 5000), hz("C5"), notes, 0.075, ramp_db=0.5)
    rings = arp(ring("C6", 0.55, "ui/glass_002", fout=0.3), hz("C6"), notes[1:] + ["E6"], 0.075, ramp_db=0.0)
    v = mix((thump, 0, 0), (thump2, 0.14, -2), (warm, 0.06, -2), (rings, 0.06, -9))
    return [reverb(v, rt60=0.8, wet=0.25, seed="heart")]


@fx("powerup", "pick", peak=-6, jitter=0.0, reverb=0.16)
def powerup():
    # Power-up: aufsteigendes Zupf-Arpeggio (C-Dur) ueber Retro-Aufwaertstreppe, Luft-Riser und Glitzer-Abschluss
    rng = rng_for("powerup")
    out = []
    for i, (pu, plk) in enumerate((("dig/powerUp7", 2), ("dig/powerUp12", 1))):
        notes = ["C5", "E5", "G5", "C6", "E6"]
        ap = arp(pluck("C5", plk, 0.3), hz("C5"), notes, 0.05, ramp_db=0.8)
        steps = lp(cut(src(pu), 0, 0.6), 5200)
        riser = air(rng, 0.42, 600, 6500, q=1.0, attack=0.3, decay=1.2)
        top = ring("E7", 0.6, "ui/glass_002", fout=0.35)
        v = mix((ap, 0, 0), (steps, 0, -9), (riser, 0, -9), (top, 0.25, -6))
        out.append(reverb(v, rt60=0.7, wet=0.24, seed=f"pow{i}"))
    return out


@fx("shield-on", "pick", peak=-7, jitter=0.02, reverb=0.16)
def shield_on():
    # Schild: Kraftfeld baut sich auf (Schwellen) + Glas-Riser + Metall-Ping am Ende
    rng = rng_for("shield-on")
    out = []
    for ff, ping, note in (("sci/forceField_003", "imp/impactMetal_light_001", "G6"), ("sci/forceField_004", "imp/impactMetal_light_003", "D6")):
        w = hp(fade(cut(src(ff), 0, 0.62), 0.03, 0.2), 250)
        g = fade(reverse(ring(note, 0.5, "ui/glass_004", fout=0.02)), 0.25, 0.01)
        a = air(rng, 0.5, 500, 5000, q=1.2, attack=0.32, decay=1.0)
        p = hp(cut(src(ping), 0, 0.3), 1200)
        v = mix((w, 0, 0), (g, 0.12, -7), (a, 0, -9), (p, 0.6, -6), (ring(note, 0.6, "ui/glass_002", fout=0.4), 0.62, -8))
        out.append(reverb(v, rt60=0.7, wet=0.22, seed=f"sh{ff}"))
    return out


@fx("shield-hit", "pick", peak=-5, jitter=0.03, reverb=0.14)
def shield_hit():
    # Schildtreffer: heller Metall-Klang + kurzer Kraftfeld-Ruck + Glas-Splitter
    out = []
    for i, (clang, ff, gl) in enumerate((("imp/impactMetal_light_002", "sci/forceField_001", "ui/glass_003"), ("imp/impactMetal_light_004", "sci/forceField_002", "ui/glass_006"))):
        c = hp(src(clang), 600)
        f = hp(fade(src(ff, 0, 0.22), 0, 0.12), 200)
        g = src(gl)
        z = hp(fade(src("dig/zap1", 0, 0.16), 0, 0.1), 900)
        out.append(reverb(mix((c, 0, 0), (f, 0, -4), (g, 0.005, -8), (z, 0, -10)), rt60=0.35, wet=0.16, seed=f"shh{i}"))
    return out


@fx("slowmo-on", "pick", peak=-6, jitter=0.0, reverb=0.16)
def slowmo_on():
    # Zeitlupe an: Tape-Stop (Kraftfeld gleitet nach unten) + tiefer Wumm + Retro-Abwaertsschub, Filter schliesst sich
    w = glide(src(("sci/forceField_000")), 1.0, 0.32)
    w = sweep(w, "lowpass", 7000, 320, q=1.1)
    thump = sub("imp/impactSoft_heavy_001", 0, 200, 0.4)
    d = glide(lp(src("dig/lowDown"), 2600), 1.0, 0.55)
    v = mix((w, 0.02, 0), (thump, 0, -3), (d, 0.05, -9))
    v = fade(v, 0, 0.35)
    return [reverb(v, rt60=0.8, wet=0.25, seed="slowon")]


@fx("slowmo-off", "pick", peak=-8, jitter=0.0, reverb=0.14)
def slowmo_off():
    # Zeitlupe aus: Tonhoehe schnellt zurueck (Tape-Start), Luft-Riser, "Snap" + Glas-Ping am Ende
    rng = rng_for("slowmo-off")
    w = glide(fade(src("sci/forceField_002", 0, 0.55), 0.06, 0.05), 0.45, 1.25)
    w = sweep(w, "lowpass", 400, 7000, q=1.1)
    a = air(rng, 0.34, 400, 7500, q=1.1, attack=0.25, decay=0.8)
    snap = mix((src("ui/click_003"), 0, 0), (hp(src("imp/impactGeneric_light_001"), 500), 0, -3))
    v = mix((w, 0, 0), (a, 0, -5), (snap, 0.30, -1), (ring("B6", 0.4, "ui/glass_002", fout=0.25), 0.30, -6))
    return [reverb(v, rt60=0.5, wet=0.2, seed="slowoff")]


@fx("magnet-on", "pick", peak=-7, jitter=0.02, reverb=0.12)
def magnet_on():
    # Magnet: summendes Kraftfeld mit Tremolo, steigend + metallisches "Einrasten"
    w = semis(src("sci/forceField_004", 0, 0.55), 5)
    w = am(hp(fade(w, 0.02, 0.15), 200), 22, 0.6)
    w = sweep(w, "lowpass", 900, 5000, q=1.3)
    latch = hp(src("rpg/metalLatch"), 500)
    v = mix((w, 0, 0), (latch, 0.26, -2), (ring("A5", 0.4, "ui/glass_002", fout=0.25), 0.27, -8))
    return [reverb(v, rt60=0.5, wet=0.18, seed="magnet")]


# ---- Treffer / Combo -----------------------------------------------------------------------------------------------------
@fx("hurt", "hit", peak=-2.5, jitter=0.03, reverb=0.10)
def hurt():
    # Autsch: Faustschlag-Koerper + Sub + kurzer elektrischer "Zap" (Schmerz) + Crunch
    out = []
    for i, (punch, soft, laser, crunch) in enumerate((
        ("imp/impactPunch_heavy_000", "imp/impactSoft_heavy_001", "sci/laserSmall_002", "sci/explosionCrunch_000"),
        ("imp/impactPunch_heavy_002", "imp/impactSoft_heavy_003", "sci/laserSmall_003", "sci/explosionCrunch_002"),
        ("imp/impactPunch_heavy_004", "imp/impactSoft_heavy_002", "sci/laserSmall_000", "sci/explosionCrunch_003"),
    )):
        p = lp(src(punch), 7500)
        s = lp(src(soft), 190, 2)
        z = semis(fade(src(laser, 0, 0.3), 0, 0.15), -5)
        c = fade(lp(src(crunch, 0, 0.14), 3500), 0, 0.09)
        out.append(reverb(mix((p, 0, 0), (s, 0, -3), (z, 0, -9), (c, 0, -8)), rt60=0.3, wet=0.12, seed=f"hurt{i}"))
    return out


@fx("death", "hit", peak=-2, jitter=0.02, reverb=0.16)
def death():
    # Tod: grosser Einschlag, Crunch-Wolke die sich tiefpassend verabschiedet, langer Sub-Ausklang, absackender Retro-Ton
    out = []
    for i, (crunch, boom, fall, clang) in enumerate((
        ("sci/explosionCrunch_002", "sci/lowFrequency_explosion_000", "dig/lowDown", "imp/impactMetal_heavy_001"),
        ("sci/explosionCrunch_004", "sci/lowFrequency_explosion_001", "dig/zapThreeToneDown", "imp/impactMetal_heavy_003"),
    )):
        c = sweep(src(crunch, 0, 1.3), "lowpass", 9000, 260, q=0.9)
        c = fade(c, 0, 0.5)
        b = fade(sub(boom, 0, 300, 1.5), 0, 0.6)
        f = glide(lp(src(fall), 3000), 1.0, 0.45)
        f = fade(f, 0, 0.3)
        k = lp(src(clang), 5000)
        v = mix((c, 0, -1), (b, 0, -2), (f, 0.04, -9), (k, 0, -6))
        out.append(reverb(v, rt60=1.0, wet=0.28, seed=f"death{i}"))
    return out


@fx("near-miss", "hit", peak=-9, jitter=0.03, reverb=0.08, sweep=(-0.8, 0.8))
def near_miss():
    # Knapp vorbei: Luft-Whoosh mit fallendem Bandpass + Doppler-Tonhoehen-Abfall (Pan-Vorbeiflug macht die Laufzeit)
    rng = rng_for("near-miss")
    out = []
    for i, (f0, f1, sw) in enumerate(((3800, 900, "rpg/knifeSlice2"), (3200, 800, "rpg/knifeSlice"))):
        a = air(rng, 0.34, f0, f1, q=1.3, attack=0.07, decay=1.6)
        s = lp(cut(src(sw), 0.1, 0.45), 6500)
        v = glide(mix((a, 0, 0), (fade(s, 0.03, 0.15), 0.02, -5)), 1.2, 0.78)
        out.append(fade(v, 0.01, 0.1))
    return out


@fx("combo-up", "hit", peak=-8, jitter=0.0, reverb=0.16)
def combo_up():
    # Kombo steigt: drei aufsteigende Zupfer + Glas (wird mit der Kombohoehe hoeher gestimmt)
    out = []
    for i, (plk, rr) in enumerate(((2, "ui/glass_002"), (1, "ui/glass_003"))):
        notes = ["G5", "C6", "G6"]
        p = arp(pluck("G5", plk, 0.16), hz("G5"), notes, 0.055, ramp_db=0.8)
        r = arp(ring("G5", 0.45, rr, fout=0.3), hz("G5"), notes, 0.055, ramp_db=0.8)
        out.append(reverb(mix((p, 0, 0), (r, 0, -5)), rt60=0.5, wet=0.2, seed=f"cu{i}"))
    return out


@fx("combo-break", "hit", peak=-8, jitter=0.03, reverb=0.10)
def combo_break():
    # Kombo reisst: fallender Retro-Ton, Glas-Knacks, dumpfer Bumms
    out = []
    for i, (fall, glass, body) in enumerate((("dig/highDown", "imp/impactGlass_light_001", "imp/impactSoft_medium_001"), ("dig/phaserDown1", "imp/impactGlass_light_003", "imp/impactSoft_medium_002"))):
        d = lp(fade(src(fall), 0, 0.15), 3200)
        g = hp(src(glass), 1200)
        b = lp(src(body), 240)
        out.append(mix((d, 0, 0), (g, 0.0, -5), (b, 0.02, -4)))
    return out


# ---- Ablauf / Stinger -----------------------------------------------------------------------------------------------
@fx("countdown", "flow", peak=-8, jitter=0.0, reverb=0.10)
def countdown():
    # Countdown-Tick: sauberer Ton A5 (Zupfer + Glas) mit winzigem Klick
    v = mix((pluck("A5", 1, 0.22), 0, 0), (ring("A5", 0.30, "ui/glass_002", fout=0.2), 0, -5), (src("ui/click_003"), 0, -10))
    return [v]


@fx("go", "flow", peak=-5, jitter=0.0, reverb=0.16)
def go():
    # "GO!": C-Dur-Akkord (Zupfer + Glas) mit Anschlag, aufsteigender Luft und Crunch
    rng = rng_for("go")
    notes = ["C5", "E5", "G5", "C6"]
    chord = mix(*[(pluck(n, 2 if i % 2 else 1, 0.45), 0, 0) for i, n in enumerate(notes)])
    rings = mix(*[(ring(n, 0.9, "ui/glass_002", fout=0.5), 0, -3) for n in ["C6", "E6", "G6", "C7"]])
    hit = lp(src("imp/impactPlate_medium_002"), 5200)
    w = air(rng, 0.4, 600, 7500, q=1.0, attack=0.22, decay=1.1)
    cr = fade(lp(src("sci/explosionCrunch_000", 0, 0.25), 2500), 0, 0.15)
    v = mix((chord, 0, 0), (rings, 0, -5), (hit, 0, -4), (w, 0, -8), (cr, 0, -12))
    return [reverb(v, rt60=0.9, wet=0.28, seed="go")]


@fx("checkpoint", "flow", peak=-6, jitter=0.0, reverb=0.16)
def checkpoint():
    # Checkpoint: vier aufsteigende Glockenzupfer (G-C-E-G), letzter klingt lange nach, luftiger Glanz
    notes = ["G5", "C6", "E6", "G6"]
    p = arp(pluck("G5", 2, 0.25), hz("G5"), notes, 0.11, ramp_db=0.8)
    r = mix(*[(ring(n, 0.55 if i < 3 else 1.0, "ui/glass_002", fout=0.4), i * 0.11, -4 + i) for i, n in enumerate(notes)])
    shimmer = hp(fade(cut(src("cas/chips-handle-1"), 0, 0.5), 0.05, 0.3), 5000)
    v = mix((p, 0, 0), (r, 0, -3), (shimmer, 0.05, -14))
    return [reverb(v, rt60=1.0, wet=0.3, seed="cp")]


@fx("world-transition", "flow", peak=-2, jitter=0.0, reverb=0.20)
def world_transition():
    # Weltwechsel: rueckwaerts laufende Crunch-Wolke + Luft-Riser (1.1 s) -> Einschlag mit Sub -> Glockenglanz und langer Hall
    rng = rng_for("world")
    rise = reverse(sweep(src("sci/explosionCrunch_001", 0, 1.2), "lowpass", 6500, 500, q=0.8))
    rise = fade(rise, 0.1, 0.01)
    air_ = air(rng, 1.15, 200, 9000, q=1.0, attack=0.9, decay=0.5)
    T = 1.12
    hit = mix((lp(src("imp/impactPlate_heavy_002"), 5500), 0, 0), (sub("sci/lowFrequency_explosion_001", 0, 260, 0.9), 0, -1),
              (fade(lp(src("sci/explosionCrunch_000", 0, 0.5), 1800), 0, 0.3), 0, -6))
    bells = arp(pluck("C6", 2, 0.4), hz("C6"), ["C6", "E6", "G6", "C7"], 0.08, ramp_db=0.5)
    rings = arp(ring("C6", 0.9, "ui/glass_002", fout=0.5), hz("C6"), ["C6", "E6", "G6", "C7"], 0.08, ramp_db=0.0)
    v = mix((rise, 0, -1), (air_, 0, -7), (hit, T, 0), (bells, T + 0.05, -6), (rings, T + 0.05, -10))
    return [reverb(v, rt60=1.4, wet=0.32, seed="world")]


# ---- Weltspezifisch ---------------------------------------------------------------------------------------------------
def flicker(x: np.ndarray, rng: np.random.Generator, gap: tuple[float, float] = (0.012, 0.03), lo: float = 0.12) -> np.ndarray:
    """Zufaelliges Ein-/Ausflackern der Lautstaerke (Knistern, Statik): stueckweise konstante Verstaerkung, 3 ms geglaettet."""
    g = np.ones(len(x))
    i = 0
    while i < len(x):
        n = int(rng.uniform(*gap) * SR)
        g[i: i + n] = rng.uniform(lo, 1.0)
        i += max(1, n)
    return x * uniform_filter1d(g, size=int(0.003 * SR) | 1)


@fx("lightning-warn", "world", peak=-8, jitter=0.03, reverb=0.10)
def lightning_warn():
    # Blitz-Warnung: elektrisches Summen (Zap-Sample) + anschwellendes, flackerndes Knistern + leiser Tief-Brumm
    rng = rng_for("lightning-warn")
    buzz = hp(fade(src("dig/zap2", 0, 0.75), 0.15, 0.1), 500)
    st = cut(load_raw("sci/thrusterFire_004"), 1.0, 1.8)[: int(0.75 * SR)]
    st = flicker(hp(st, 3500), rng)
    st = st * np.linspace(0.25, 1.0, len(st))
    hum = fade(lp(cut(load_raw("sci/spaceEngineLow_001"), 1.0, 1.75), 260), 0.25, 0.1)
    return [reverb(mix((buzz, 0, -3), (st, 0, 0), (hum, 0, -6)), rt60=0.4, wet=0.14, seed="lw")]


@fx("thunder", "world", peak=-2, jitter=0.03, reverb=0.10)
def thunder():
    # Donner: scharfer Knall (Blitzeinschlag), darauf rollendes, tief werdendes Grollen mit langem Hall
    out = []
    for i, (crunch, boom, slow) in enumerate((("sci/explosionCrunch_004", "sci/lowFrequency_explosion_000", 0.62), ("sci/explosionCrunch_003", "sci/lowFrequency_explosion_001", 0.55))):
        crack = hp(fade(src("sci/explosionCrunch_000", 0, 0.22), 0, 0.12), 1400)
        roll = resample_rate(src(crunch), slow)
        roll = sweep(roll, "lowpass", 1000, 110, q=0.7)
        roll = fade(roll, 0.06, 1.0)
        b = fade(sub(boom, -2, 260, None), 0, 0.8)
        v = mix((crack, 0, -2), (roll, 0.09, 0), (b, 0.09, -3))
        v = reverb(v, rt60=1.6, wet=0.35, lowcut=60, seed=f"thunder{i}")
        out.append(fade(v, 0, 0.9))
    return out


@fx("tram-bell", "world", peak=-5, jitter=0.02, reverb=0.08)
def tram_bell():
    # Strassenbahn "Ding-Ding-Ding": dreimal die schwere Glocke, um eine Oktave nach oben gestimmt, leicht ueberlappend
    out = []
    for i, (bell, st) in enumerate((("imp/impactBell_heavy_003", 10), ("imp/impactBell_heavy_002", 11))):
        b = fade(hp(semis(src(bell), st), 250), 0, 0.2)
        b = cut(b, 0, 0.42)
        click = hp(src("rpg/metalClick", 0, 0.1), 2000)
        v = mix((b, 0.0, -1), (b, 0.125, 0), (b, 0.25, 1), (click, 0.0, -14), length=0.75)
        out.append(reverb(v, rt60=0.5, wet=0.15, seed=f"tram{i}"))
    return out


@fx("stamp-thud", "world", peak=-4, jitter=0.04, reverb=0.10)
def stamp_thud():
    # Behoerden-Stempel: Buch-Klatschen (Papier) + schwerer Holz-Aufprall + dumpfer Bumms
    out = []
    for i, (book, wood, soft) in enumerate((("rpg/bookPlace1", "imp/impactWood_heavy_000", "imp/impactSoft_heavy_000"), ("rpg/bookPlace2", "imp/impactWood_heavy_002", "imp/impactSoft_heavy_002"), ("rpg/bookPlace3", "imp/impactWood_heavy_004", "imp/impactSoft_heavy_004"))):
        v = mix((hp(src(book), 250), 0, -2), (src(wood), 0, 0), (lp(src(soft), 200), 0, -3))
        out.append(reverb(v, rt60=0.3, wet=0.12, seed=f"stamp{i}"))
    return out


@fx("laser-zap", "world", peak=-7, jitter=0.04, reverb=0.10)
def laser_zap():
    # Laser: kurzer "Pew" aus zwei Laser-Samples mit leisem Sub-Klick
    out = []
    for i, (a, b, sb) in enumerate((("sci/laserRetro_002", "sci/laserSmall_001", "imp/impactSoft_medium_000"), ("sci/laserSmall_002", "sci/laserRetro_000", "imp/impactSoft_medium_002"), ("sci/laserRetro_004", "sci/laserSmall_004", "imp/impactSoft_medium_004"))):
        x = fade(src(a, 0, 0.26), 0, 0.05)
        y = semis(fade(src(b, 0, 0.26), 0, 0.05), 2)
        out.append(mix((x, 0, 0), (y, 0, -5), (lp(src(sb), 260), 0, -8)))
    return out


@fx("paper-flutter", "world", peak=-12, jitter=0.05, reverb=0.08)
def paper_flutter():
    # Papierflattern: Karten-Fächer und Buchblätter, hochpassgefiltert (leicht, luftig)
    out = []
    for ref, n0, n1 in (("cas/card-fan-1", 0.0, 0.6), ("rpg/bookFlip2", 0.0, 0.42), ("cas/card-fan-2", 0.0, 0.7)):
        x = hp(cut(src(ref), n0, n1), 500)
        out.append(fade(x, 0.004, 0.08))
    return out


@fx("cannon", "world", peak=-2, jitter=0.03, reverb=0.14)
def cannon():
    # Kanone: Mündungsknall (Crunch) + tiefer Druck + Metall-Klang, langer Hall-Ausklang
    out = []
    for i, (crunch, boom, clang, plate) in enumerate((("sci/explosionCrunch_001", "sci/lowFrequency_explosion_000", "sci/impactMetal_001", "imp/impactPlate_heavy_001"), ("sci/explosionCrunch_003", "sci/lowFrequency_explosion_001", "sci/impactMetal_003", "imp/impactPlate_heavy_004"))):
        c = sweep(src(crunch, 0, 0.9), "lowpass", 8000, 1500, q=0.8)
        c = fade(c, 0, 0.3)
        b = fade(sub(boom, 0, 300, 1.2), 0, 0.5)
        k = lp(src(clang, 0, 0.5), 2500)
        p = semis(lp(src(plate), 3000), -6)
        v = mix((c, 0, -2), (b, 0, -2), (k, 0, -8), (p, 0, -5))
        out.append(reverb(v, rt60=0.9, wet=0.3, seed=f"cannon{i}"))
    return out


@fx("splash", "world", peak=-6, jitter=0.05, reverb=0.16)
def splash():
    # Platsch: Wasser-Rauschen (Bandpass faellt), "Bloop" des Eintauchens (Drop-Samples) + verstreute Tropfen
    rng = rng_for("splash")
    out = []
    for i, (bloop, drops) in enumerate((("ui/drop_004", ("ui/drop_001", "ui/drop_002", "ui/drop_003")), ("ui/drop_003", ("ui/drop_004", "ui/drop_002", "ui/drop_001")))):
        w = air(rng, 0.42, 5500, 1400, q=0.8, attack=0.012, decay=3.0)
        b = lp(semis(src(bloop), 4), 4000)
        dr = scatter(rng, [semis(src(d), 7) for d in drops], 5, 0.10, 0.42, -5, -12, st=5, length=0.5)
        out.append(reverb(mix((w, 0, 0), (b, 0, -1), (dr, 0, -6)), rt60=0.5, wet=0.2, seed=f"splash{i}"))
    return out


@fx("barrel-roll", "world", peak=-8, jitter=0.04, reverb=0.08, sweep=(-0.5, 0.5))
def barrel_roll():
    # Fass rollt: dumpfe Holz-Schlaege in beschleunigender Folge ueber grollendem Boden-Rumpeln
    out = []
    for i in range(2):
        rng = rng_for("barrel-roll", i)
        pool = [lp(src(f"imp/impactWood_heavy_00{j}", 0, 0.24), 1100) for j in range(5)] + [src(f"imp/footstep_wood_00{j}") for j in range(4)]
        n = 8
        layers = []
        t = 0.0
        for k in range(n):
            e = math.sin(math.pi * (k + 0.5) / n)
            x = semis(pool[int(rng.integers(len(pool)))], float(rng.uniform(-2, 2)))
            layers.append((x, t, -8 + 8 * e + float(rng.uniform(-1.5, 1.5))))
            t += 0.125 - k * 0.006 + float(rng.uniform(-0.01, 0.01))
        hits = mix(*layers, length=0.95)
        rumble = lp(noise(0.95, rng, "brown"), 300)
        rumble = am(rumble, 9 + 3 * i, 0.7) * np.sin(np.linspace(0, math.pi, len(rumble))) ** 0.7
        out.append(mix((hits, 0, 0), (rumble, 0, -4)))
    return out


@fx("glitch", "world", peak=-7, jitter=0.03, reverb=0.08)
def glitch():
    # Glitch: Stotter-Folge aus Mini-Glitches (zufaellige Tonhoehe) ueber zerhacktem, bit-reduziertem "Weltraum-Muell"
    out = []
    for i, trash in enumerate(("dig/spaceTrash2", "dig/spaceTrash4", "dig/spaceTrash1")):
        rng = rng_for("glitch", i)
        pool = [src(f"ui/glitch_00{j}") for j in range(1, 5)]
        layers = []
        t = 0.0
        for k in range(11):
            x = semis(pool[int(rng.integers(4))], float(rng.uniform(-8, 6)))
            layers.append((x, t, float(rng.uniform(-6, 0))))
            t += 0.033 + float(rng.uniform(-0.008, 0.012))
        ticks = mix(*layers, length=0.4)
        tr = bitcrush(hp(cut(src(trash), 0.0, 0.4), 500), 5, 3)
        tr = tr * (rng.random(int(0.4 * SR) // 900 + 1).repeat(900)[: len(tr)] > 0.35)
        out.append(fade(mix((ticks, 0, 0), (tr, 0, -6)), 0.002, 0.05))
    return out


@fx("avalanche-warn", "world", peak=-5, jitter=0.02, reverb=0.16)
def avalanche_warn():
    # Lawinen-Warnung: anschwellendes Grollen (rueckwaerts gelaufener Sub-Boom + tiefes Crunch-Rollen) mit Eis-Knacken
    rng = rng_for("avalanche")
    swell = reverse(sub("sci/lowFrequency_explosion_000", 0, 280, 1.3))
    swell = fade(swell, 0.4, 0.15)
    roll = sweep(resample_rate(src("sci/explosionCrunch_004", 0, 1.9), 0.8), "lowpass", 260, 600, q=0.8)
    roll = fade(roll[: int(1.3 * SR)], 0.8, 0.25)
    ice = scatter(rng, [hp(src(f"imp/impactGlass_light_00{j}"), 2500) for j in range(5)], 5, 0.2, 1.0, -14, -8, st=4, length=1.3)
    return [reverb(mix((swell, 0, 0), (roll, 0, -3), (ice, 0, -8)), rt60=1.0, wet=0.25, seed="aval")]


@fx("rockfall", "world", peak=-4, jitter=0.04, reverb=0.12)
def rockfall():
    # Steinschlag: Brocken poltern (Mining-Aufpralle, zufaellig verteilt) + grosser Aufprall am Ende
    out = []
    for i in range(2):
        rng = rng_for("rockfall", i)
        pool = [lp(src(f"imp/impactMining_00{j}", 0, 0.35), 5000) for j in range(5)] + [src(f"imp/impactGeneric_light_00{j}") for j in range(3)]
        hits = scatter(rng, pool, 10, 0.0, 0.62, -9, -3, st=4, length=1.0)
        big = mix((lp(src("imp/impactSoft_heavy_001"), 260), 0, 0), (src("imp/impactMining_004", 0, 0.5), 0, -3))
        rumble = fade(lp(noise(0.8, rng, "brown"), 350), 0.1, 0.4)
        out.append(reverb(mix((hits, 0, 0), (big, 0.64, 0), (rumble, 0, -8)), rt60=0.5, wet=0.2, seed=f"rock{i}"))
    return out


@fx("crumble", "world", peak=-8, jitter=0.05, reverb=0.10)
def crumble():
    # Broeckelnder Boden: Kiesel-Kruemel (Schritt-/Mining-Schnipsel) in abnehmender Dichte ueber dumpfem Rumpeln
    out = []
    for i in range(3):
        rng = rng_for("crumble", i)
        pool = [hp(cut(src(f"imp/footstep_grass_00{j}"), 0, 0.12), 900) for j in range(5)] + [lp(src(f"imp/impactMining_00{j}", 0, 0.2), 4000) for j in range(3)]
        bits = scatter(rng, pool, 9, 0.0, 0.42, -3, -12, st=5, length=0.55)
        low = fade(lp(src("sci/explosionCrunch_00%d" % (i + 1), 0, 0.5), 700), 0.03, 0.3)
        out.append(mix((bits, 0, 0), (low, 0, -8)))
    return out


@fx("enemy-defeat", "world", peak=-5, jitter=0.03, reverb=0.12)
def enemy_defeat():
    # Gegner besiegt: satter "Bonk" (Faust + Blech) + kurzes, aufsteigendes Glitzer-Duo
    out = []
    for i, (punch, tin, glass) in enumerate((("imp/impactPunch_medium_000", "imp/impactTin_medium_000", "ui/glass_002"), ("imp/impactPunch_medium_002", "imp/impactTin_medium_002", "ui/glass_003"), ("imp/impactPunch_medium_004", "imp/impactTin_medium_004", "ui/glass_001"))):
        p = lp(src(punch), 6500)
        t = hp(src(tin), 700)
        ch = arp(pluck("G6", 2, 0.12), hz("G6"), ["G6", "D7"], 0.07, ramp_db=0.5)
        r = arp(ring("G6", 0.3, glass, fout=0.2), hz("G6"), ["G6", "D7"], 0.07)
        out.append(reverb(mix((p, 0, 0), (t, 0, -5), (ch, 0.05, -6), (r, 0.05, -10)), rt60=0.4, wet=0.15, seed=f"defeat{i}"))
    return out
