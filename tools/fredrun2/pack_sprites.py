#!/usr/bin/env python3
"""Fredrun 2.0 - Sprite-Packer.

Liest AutoSprite-Rohsheets (Raster aus quadratischen Frames, transparenter Hintergrund), bereinigt die Frames,
skaliert sie mit EINEM gemeinsamen Faktor pro Charakter, verankert sie am Fuss (cx, footY) und schreibt pro
Animation ein WebP-Raster sowie pro Charakter eine `atlas.json` (Format: docs/fredrun2/ASSETS.md).

Aufruf (aus dem Repo-Root):

    python3 tools/fredrun2/pack_sprites.py --src <ROHSHEET-ORDNER> [--chars fred,frida] [--anims run,jump]
                                           [--out public/fredrun2/chars] [--config tools/fredrun2/sprite_sources.json]
                                           [--preview <ORDNER>] [--report]

* `--src`     Ordner mit den Rohsheets. Dateinamen stehen in `sprite_sources.json` (`src`, z.B. `fred_run.png`);
              Rohsheets sind die 512px-Sheets von AutoSprite (`sheetUrl` aus list_spritesheets) bzw. die
              Originalsheets aus public/fredrun/ (Fallback / victory), siehe `origin` in der Config.
* `--config`  JSON mit Quelle + Frame-Auswahl je Charakter/Animation (siehe Kopf der Datei sprite_sources.json).
* `--preview` schreibt je Charakter einen Kontaktbogen (aus den fertigen WebPs) als JPG.
* `--report`  gibt nur die Analyse aus (Skalierung, Figurhoehen, Loop-Naht), schreibt nichts.

Pipeline je Frame:
  1. Alpha bereinigen (Schwelle, Fragmente < 2 % der Hauptfigur entfernen), Farbsaeume entfernen ("defringe":
     halbtransparente Randpixel bekommen die Farbe des naechsten deckenden Pixels).
  2. Hauptfigur = groesste zusammenhaengende Komponente (+ nahe Teile) -> Bounding-Box, Schwerpunkt.
  3. Gemeinsamer Skalierfaktor S = runHeight / Median(Figurhoehe im run-Zyklus) (Lanczos, premultiplied alpha).
     Einzelne Animationen koennen `scaleMul` (manuell) bzw. `autoScale` (Flaechen-Angleichung an run) haben, falls
     das Rohmaterial anders gezoomt ist.
  4. Fussanker: unterste Zeile der Hauptfigur -> footY; x: geglaetteter Schwerpunkt (gleitender Mittelwert,
     7 Frames, bei Loops zirkulaer) -> cx. `vanchor: "center"` (Salto): Schwerpunkt-y bleibt fix statt der Fuesse.
  5. Zellgroesse 256x256 (waechst automatisch, wenn eine Pose nicht passt), Raster 8 Spalten, WebP q~82.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

CELL = 256
CX = 128
FOOT_Y = 246
RUN_H = 214
COLS = 8
SMOOTH_WIN = 7
WEBP_Q = 82
MAX_KB = 450


# --------------------------------------------------------------------------- Laden / Auswahl

def load_sheet(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def extract_frames(sheet: Image.Image, cols: int, total: int) -> list[np.ndarray]:
    fw = sheet.width // cols
    out = []
    for i in range(total):
        r, c = divmod(i, cols)
        out.append(np.asarray(sheet.crop((c * fw, r * fw, (c + 1) * fw, (r + 1) * fw))).copy())
    return out


def select_indices(spec, total: int) -> list[int]:
    """spec: Liste von Indizes ODER Dict {start,end,n,pingpong,step,reverse}."""
    if spec is None:
        return list(range(total))
    if isinstance(spec, list):
        return [int(i) for i in spec]
    start = int(spec.get("start", 0))
    end = int(spec.get("end", total - 1))
    if "step" in spec:
        idx = list(range(start, end + 1, int(spec["step"])))
    elif "n" in spec:
        n = int(spec["n"])
        idx = [int(round(v)) for v in np.linspace(start, end, n, endpoint=bool(spec.get("endpoint", True)))]
    else:
        idx = list(range(start, end + 1))
    if spec.get("reverse"):
        idx = idx[::-1]
    if spec.get("pingpong"):
        idx = idx + idx[-2:0:-1]
    return idx


# --------------------------------------------------------------------------- Frame-Bereinigung

def clean_frame(rgba: np.ndarray, a_lo: int = 24, min_frag: int = 80, frag_ratio: float = 0.02) -> dict:
    """Gibt {rgba, main(bool mask), bbox_all, bbox_main, cx, cy, area} zurueck (Koordinaten im Quellframe)."""
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3].astype(np.float32)
    a = np.clip((a - a_lo) * 255.0 / (255.0 - a_lo), 0, 255)

    solid = a >= 40
    lab, n = ndi.label(solid, structure=np.ones((3, 3)))
    if n == 0:
        return dict(rgba=np.zeros_like(rgba), main=np.zeros((h, w), bool), empty=True)
    sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    keep_ids = [i + 1 for i, s in enumerate(sizes) if s >= max(min_frag, frag_ratio * sizes.max())]
    keep = np.isin(lab, keep_ids)
    # Weiche Raender der behaltenen Komponenten mitnehmen
    keep_soft = ndi.binary_dilation(keep, iterations=3)
    a = np.where(keep_soft, a, 0)

    # Hauptfigur: groesste Komponente + Komponenten in 10px Naehe
    main0 = lab == biggest
    near = ndi.binary_dilation(main0, iterations=10)
    main_ids = [i for i in keep_ids if i == biggest or np.any(near & (lab == i))]
    main = np.isin(lab, main_ids)

    # Defringe: Farbe halbtransparenter Randpixel := Farbe des naechsten (fast) deckenden Pixels
    interior = a >= 245
    if interior.any():
        dist, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
        repl = rgb[iy, ix]
        edge = (~interior) & (dist <= 12)
        rgb = np.where(edge[..., None], repl, rgb)

    out = np.dstack([np.clip(rgb, 0, 255), a]).astype(np.uint8)
    ys, xs = np.nonzero(a > 40)
    bbox_all = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    ys, xs = np.nonzero(main)
    bbox_main = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    wgt = a * main
    tot = wgt.sum()
    cx = float((wgt.sum(0) * np.arange(w)).sum() / tot)
    cy = float((wgt.sum(1) * np.arange(h)).sum() / tot)
    return dict(rgba=out, main=main, bbox_all=bbox_all, bbox_main=bbox_main, cx=cx, cy=cy,
                area=float(main.sum()), empty=False)


# --------------------------------------------------------------------------- Glaetten / Analyse

def smooth(values: np.ndarray, win: int, circular: bool) -> np.ndarray:
    n = len(values)
    win = max(1, min(win, n if n % 2 == 1 else n - 1))
    half = win // 2
    out = np.zeros(n, dtype=np.float64)
    for i in range(n):
        acc = 0.0
        for k in range(-half, half + 1):
            j = i + k
            if circular:
                j %= n
            else:
                j = min(max(j, 0), n - 1)
            acc += values[j]
        out[i] = acc / (2 * half + 1)
    return out


def thumb(frame: dict, size: int = 48) -> np.ndarray:
    """Kleine, am Fuss/Schwerpunkt ausgerichtete Alpha-Vorschau (fuer Distanzen)."""
    a = frame["rgba"][..., 3].astype(np.float32) / 255.0
    rgb = frame["rgba"][..., :3].astype(np.float32) / 255.0
    h, w = a.shape
    bx0, by0, bx1, by1 = frame["bbox_main"]
    cx = int(round(frame["cx"]))
    cy = by1
    box = int(h * 0.8)
    canvas = np.zeros((box, box, 4), np.float32)
    x0, y0 = cx - box // 2, cy - box + 4
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + box, w), min(y0 + box, h)
    if sx1 <= sx0 or sy1 <= sy0:
        return np.zeros((size, size, 4), np.float32)
    canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, :3] = rgb[sy0:sy1, sx0:sx1] * a[sy0:sy1, sx0:sx1, None]
    canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, 3] = a[sy0:sy1, sx0:sx1]
    im = Image.fromarray((canvas * 255).astype(np.uint8), "RGBA").resize((size, size), Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0


def dist_matrix(frames: list[dict]) -> np.ndarray:
    t = np.stack([thumb(f).ravel() for f in frames])
    sq = (t ** 2).sum(1)
    d = sq[:, None] + sq[None, :] - 2 * t @ t.T
    return np.sqrt(np.maximum(d, 0))


def find_loop(frames: list[dict], pmin: int, pmax: int) -> tuple[int, int, float]:
    """Sucht (start, period), so dass frame[start+period] ~ frame[start] (nahtloser Loop).
    Rueckgabe: start, period, Naht-Verhaeltnis (Distanz Naht / mittlere Distanz benachbarter Frames)."""
    D = dist_matrix(frames)
    n = len(frames)
    adj = np.mean([D[i, i + 1] for i in range(n - 1)])
    best = None
    for p in range(pmin, pmax + 1):
        for s in range(0, n - p):
            # Naht: Uebergang von letztem Frame (s+p-1) zu erstem (s) soll wie ein normaler Schritt sein
            seam = D[s + p - 1, s]
            # Zusatz: ganze Periode soll sich im naechsten Durchlauf wiederholen (falls vorhanden)
            score = seam
            if s + 2 * p <= n:
                score += 0.5 * np.mean([D[s + k, s + p + k] for k in range(0, p, max(1, p // 8))])
            if best is None or score < best[0]:
                best = (score, s, p, seam)
    _, s, p, seam = best
    return s, p, float(seam / max(adj, 1e-6))


# --------------------------------------------------------------------------- Packen

def resize_rgba(arr: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    im = Image.fromarray(arr, "RGBA").resize(size, Image.LANCZOS)  # Pillow: premultiplied (RGBa) intern
    return np.asarray(im)


def bleed_colors(arr: np.ndarray) -> np.ndarray:
    """RGB unter (fast) transparenten Pixeln := naechste Farbe der Figur (kein dunkler/heller Saum beim Filtern)."""
    a = arr[..., 3]
    interior = a >= 200
    if not interior.any():
        return arr
    _, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
    out = arr.copy()
    m = a < 200
    out[..., :3][m] = arr[iy, ix, :3][m]
    return out


def process_anim(name: str, spec: dict, frames_raw: list[np.ndarray], S: float, cfg: dict, cleaned=None) -> dict:
    """Erzeugt fertiges Sheet fuer eine Animation. Gibt dict(image, meta, stats) zurueck."""
    idx = select_indices(spec.get("sel"), len(frames_raw))
    loop = bool(spec.get("loop", False))
    if cleaned is None:
        cleaned = {}
    fr = []
    for i in idx:
        if i not in cleaned:
            cleaned[i] = clean_frame(frames_raw[i])
        if cleaned[i].get("empty"):
            raise SystemExit(f"{name}: Frame {i} ist leer")
        fr.append(cleaned[i])

    fw = frames_raw[0].shape[0]  # Quell-Framebreite: S ist "Pixel pro Bruchteil der Framebreite"
    mult = float(spec.get("scaleMul", 1.0)) * float(spec.get("_autoMul", 1.0))
    native = bool(spec.get("native"))  # Pixel 1:1 uebernehmen (z.B. 192px-Originale), Groessenkorrektur via atlas.scale
    s = 1.0 if native else S / fw * mult
    # Pixeldichte-Faktor fuer Zielraster: bei Quellen mit kleinerer Zelle (192er Original) nicht hochskalieren
    cell_w = int(spec.get("cell", fw if native else CELL))
    cell_h = cell_w

    circ = loop
    X = np.array([f["cx"] * s for f in fr])
    Xs = smooth(X, SMOOTH_WIN, circ)
    vanchor = spec.get("vanchor", "foot")
    Yc = np.array([f["cy"] * s for f in fr])
    if vanchor == "center":
        Ys = smooth(Yc, 5, False)
        ends = [fr[k]["bbox_main"][3] - fr[k]["bbox_main"][1] for k in (0, 1, -2, -1) if -len(fr) <= k < len(fr)]
        stand_h = float(np.median(ends)) * s
        cyc_target = FOOT_Y - 0.5 * stand_h * float(spec.get("centerRise", 1.0))

    placed = []  # (image, left, top) im Zellkoordinatensystem (cx=CX, footY=FOOT_Y, vor Zellwachstum)
    for k, f in enumerate(fr):
        bx0, by0, bx1, by1 = f["bbox_all"]
        pad = 2
        H, W = f["rgba"].shape[:2]
        bx0, by0 = max(bx0 - pad, 0), max(by0 - pad, 0)
        bx1, by1 = min(bx1 + pad, W), min(by1 + pad, H)
        crop = f["rgba"][by0:by1, bx0:bx1]
        nw, nh = max(1, int(round((bx1 - bx0) * s))), max(1, int(round((by1 - by0) * s)))
        img = resize_rgba(crop, (nw, nh))
        left = int(round(CX - Xs[k] + bx0 * s))
        if vanchor == "center":
            top = int(round(cyc_target - Ys[k] + by0 * s))
        else:
            foot_row = (f["bbox_main"][3] - by0) * s  # Unterkante der Hauptfigur im skalierten Crop
            top = int(round(FOOT_Y + 1 - foot_row))
        placed.append((img, left, top))

    # Zellgroesse bestimmen (waechst bei Bedarf)
    min_l = min(p[1] for p in placed)
    max_r = max(p[1] + p[0].shape[1] for p in placed)
    min_t = min(p[2] for p in placed)
    max_b = max(p[2] + p[0].shape[0] for p in placed)
    half = max(CX - min_l, max_r - CX) + 3
    cw = max(cell_w, int(math.ceil(2 * half / 16.0) * 16))
    need_top = FOOT_Y + 1 - min_t + 4
    bottom_margin = max(CELL - 1 - FOOT_Y, max_b - (FOOT_Y + 1) + 4)
    ch = max(cell_h, int(math.ceil((need_top + bottom_margin) / 16.0) * 16))
    foot_y = ch - int(bottom_margin) - 1
    cx = cw // 2
    dx, dy = cx - CX, foot_y - FOOT_Y

    n = len(placed)
    cols = COLS if n > 4 else n
    cols = min(cols, n)
    rows = int(math.ceil(n / cols))
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for k, (img, left, top) in enumerate(placed):
        cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        x, y = left + dx, top + dy
        # alpha_composite mit Clipping
        src = Image.fromarray(img, "RGBA")
        sx0, sy0 = max(0, -x), max(0, -y)
        sx1, sy1 = min(src.width, cw - x), min(src.height, ch - y)
        if sx1 > sx0 and sy1 > sy0:
            cell.alpha_composite(src.crop((sx0, sy0, sx1, sy1)), dest=(x + sx0, y + sy0))
        arr = bleed_colors(np.asarray(cell))
        cell = Image.fromarray(arr, "RGBA")
        r, c = divmod(k, cols)
        sheet.paste(cell, (c * cw, r * ch))

    heights = [(f["bbox_main"][3] - f["bbox_main"][1]) * s for f in fr]
    meta = dict(file=f"{name}.webp", cols=cols, rows=rows, frames=n, cw=cw, ch=ch, cx=cx, footY=foot_y,
                scale=round(float(spec.get("_nativeScale", spec.get("scale", 1.0))), 4), fps=spec.get("fps", 24), loop=loop)
    return dict(image=sheet, meta=meta, heights=heights, idx=idx, frames=fr, scale=s, mult=mult)


def save_webp(img: Image.Image, path: Path, q: int = WEBP_Q, max_kb: int = MAX_KB) -> int:
    quality = q
    while True:
        img.save(path, "WEBP", quality=quality, method=6, alpha_quality=90)
        kb = path.stat().st_size / 1024
        if kb <= max_kb or quality <= 60:
            return int(round(kb))
        quality -= 4


# --------------------------------------------------------------------------- Vorschau

def preview(char_dir: Path, atlas: dict, out: Path, every: int = 3, cell: int = 128, only=None):
    rows = []
    maxc = 0
    for name, m in atlas["anims"].items():
        if only and name not in only:
            continue
        im = Image.open(char_dir / m["file"]).convert("RGBA")
        idx = list(range(0, m["frames"], every))
        if (m["frames"] - 1) not in idx:
            idx.append(m["frames"] - 1)  # letzter Frame (Loop-Naht) immer zeigen
        tiles = []
        for i in idx:
            r, c = divmod(i, m["cols"])
            fr = im.crop((c * m["cw"], r * m["ch"], (c + 1) * m["cw"], (r + 1) * m["ch"]))
            k = cell / 256.0
            fr = fr.resize((int(m["cw"] * k), int(m["ch"] * k)), Image.LANCZOS)
            tile = Image.new("RGBA", (cell, cell), (108, 148, 108, 255))
            d = ImageDraw.Draw(tile)
            fy = int(m["footY"] * k) + (cell - int(m["ch"] * k))
            d.line([(0, fy), (cell, fy)], fill=(255, 255, 255, 90))
            d.line([(cell // 2, fy - 4), (cell // 2, fy + 3)], fill=(255, 60, 60, 255))
            ox = (cell - fr.width) // 2
            oy = cell - fr.height
            fr = fr.crop((max(-ox, 0), max(-oy, 0), min(fr.width, cell - ox), fr.height))
            tile.alpha_composite(fr, dest=(max(ox, 0), max(oy, 0)))
            d = ImageDraw.Draw(tile)
            d.text((2, 2), f"{name}{i}", fill=(255, 255, 0, 255))
            tiles.append(tile)
        rows.append(tiles)
        maxc = max(maxc, min(len(tiles), 12))
    per_row = maxc
    total_rows = sum(int(math.ceil(len(r) / per_row)) for r in rows)
    sheet = Image.new("RGB", (per_row * cell, total_rows * cell), (108, 148, 108))
    y = 0
    for tiles in rows:
        for k, t in enumerate(tiles):
            sheet.paste(t.convert("RGB"), ((k % per_row) * cell, y + (k // per_row) * cell))
        y += int(math.ceil(len(tiles) / per_row)) * cell
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)


def stand_ref(cid: str, anims: dict, frames_for, S: float) -> float:
    """Standhoehe (Pixel im Zielmassstab) aus Frame 0 der Animationen mit `standRef: true` (Seed-Pose = stehend)."""
    hs = []
    for nm, sp in anims.items():
        if sp.get("standRef"):
            raw, cache = frames_for(sp)
            i = select_indices(sp.get("sel"), len(raw))[0] if sp.get("sel") else 0
            i = sp.get("standFrame", 0)
            cache.setdefault(i, clean_frame(raw[i]))
            f = cache[i]
            hs.append((f["bbox_main"][3] - f["bbox_main"][1]) / raw[0].shape[0] * S)
    if not hs:
        raise SystemExit(f"{cid}: standMatch ohne standRef-Animationen")
    return float(np.median(hs))


def resolve_loop(cid: str, name: str, spec: dict, raw: list, cache: dict) -> None:
    """Wertet `loop_detect` {from,to,pmin,pmax[,n]} aus und setzt spec["sel"] auf den besten nahtlosen Zyklus."""
    ld = spec.get("loop_detect")
    if not ld:
        return
    cand_idx = list(range(ld.get("from", 0), ld.get("to", len(raw) - 1) + 1))
    for i in cand_idx:
        cache.setdefault(i, clean_frame(raw[i]))
    s0, p, seam = find_loop([cache[i] for i in cand_idx], ld["pmin"], ld["pmax"])
    start = cand_idx[s0]
    print(f"[{cid}] {name} loop_detect: start={start} period={p} seam={seam:.2f}")
    spec["sel"] = {"start": start, "end": start + p - 1}
    if ld.get("n") and ld["n"] != p:
        spec["sel"] = {"start": start, "end": start + p, "n": ld["n"], "endpoint": False}


# --------------------------------------------------------------------------- Hauptprogramm

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="Ordner mit den Rohsheets")
    ap.add_argument("--config", default=str(HERE / "sprite_sources.json"))
    ap.add_argument("--out", default=str(REPO / "public" / "fredrun2" / "chars"))
    ap.add_argument("--chars", default="")
    ap.add_argument("--anims", default="")
    ap.add_argument("--preview", default="")
    ap.add_argument("--every", type=int, default=3, help="Vorschau: jeden n-ten Frame zeigen")
    ap.add_argument("--cell", type=int, default=128, help="Vorschau: Kachelgroesse in px")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args(argv)

    cfg = json.loads(Path(args.config).read_text())
    src = Path(args.src)
    out_root = Path(args.out)
    chars = [c for c in args.chars.split(",") if c] or list(cfg["chars"].keys())
    only = [a for a in args.anims.split(",") if a]

    for cid in chars:
        ccfg = cfg["chars"][cid]
        anims = ccfg["anims"]
        sheet_cache: dict[str, list[np.ndarray]] = {}
        clean_cache: dict[tuple, dict] = {}

        def frames_for(spec):
            key = (spec["src"], spec["cols"], spec["total"])
            if key not in sheet_cache:
                sheet_cache[key] = extract_frames(load_sheet(src / spec["src"]), spec["cols"], spec["total"])
            return sheet_cache[key], clean_cache.setdefault(key, {})

        # --- Skalierfaktor aus run
        run_spec = dict(anims["run"])
        raw, cache = frames_for(run_spec)
        resolve_loop(cid, "run", run_spec, raw, cache)
        run_idx = select_indices(run_spec.get("sel"), len(raw))
        run_frames = []
        for i in run_idx:
            cache.setdefault(i, clean_frame(raw[i]))
            run_frames.append(cache[i])
        hs = [f["bbox_main"][3] - f["bbox_main"][1] for f in run_frames]
        run_h_src = float(np.median(hs))
        run_area_src = float(np.median([f["area"] for f in run_frames])) / raw[0].shape[0] ** 2
        fw_run = raw[0].shape[0]
        S = RUN_H / run_h_src * fw_run  # Pixel je Bruchteil der Quell-Framebreite (Rohsheets duerfen verschieden gross sein)
        print(f"[{cid}] run: frames={len(run_idx)} median_h_src={run_h_src:.1f} (fw={fw_run}) scale={S / fw_run:.4f} "
              f"max_h={max(hs) * S / fw_run:.0f} min_h={min(hs) * S / fw_run:.0f}")

        atlas = dict(id=cid, runHeight=RUN_H, anims={})
        char_dir = out_root / cid
        for name, spec in anims.items():
            if only and name not in only:
                continue
            spec = dict(spec)
            if name == "run":
                spec = run_spec
            raw, cache = frames_for(spec)
            if name != "run":
                resolve_loop(cid, name, spec, raw, cache)
            # Groessen-Angleichung fuer Rohmaterial mit anderem Zoom:
            #   standMatch: Standpose der ersten Frames := Standhoehe des Charakters (aus Frame 0 der first_frame-Clips,
            #               siehe `standRef` in der Config); autoScale: Flaechen-Angleichung an run (grob).
            if spec.get("standMatch"):
                ref = stand_ref(cid, anims, frames_for, S)
                sel0 = select_indices(spec.get("sel"), len(raw))
                if spec["standMatch"] != "median":
                    sel0 = sel0[:3]  # erste Frames = Standpose
                hs0 = []
                for i in sel0:
                    cache.setdefault(i, clean_frame(raw[i]))
                    h_src = cache[i]["bbox_main"][3] - cache[i]["bbox_main"][1]
                    hs0.append(h_src if spec.get("native") else h_src / raw[0].shape[0] * S)
                spec["_autoMul"] = float(ref / np.median(hs0))
                if spec.get("native"):  # Pixel nicht anfassen, Korrektur ueber atlas.scale
                    spec["_nativeScale"] = spec.pop("_autoMul")
            elif spec.get("autoScale"):
                idx = select_indices(spec.get("sel"), len(raw))
                ar = []
                for i in idx:
                    cache.setdefault(i, clean_frame(raw[i]))
                    ar.append(cache[i]["area"])
                spec["_autoMul"] = float(np.clip(math.sqrt(run_area_src / (np.percentile(ar, spec.get("autoPct", 75)) / raw[0].shape[0] ** 2)), 0.5, 2.5))
            res = process_anim(name, spec, raw, S, cfg, cache)
            m = res["meta"]
            n = m["frames"]
            hh = res["heights"]
            seam = ""
            if spec.get("loop") and n > 2:
                D = dist_matrix(res["frames"])
                adj = float(np.mean([D[i, i + 1] for i in range(n - 1)]))
                seam = f" seam={D[n - 1, 0] / max(adj, 1e-6):.2f}"
            ar_f = float(np.median([f["area"] for f in res["frames"]])) / raw[0].shape[0] ** 2
            area_eq = math.sqrt(run_area_src / ar_f) / (S / raw[0].shape[0]) * (S / raw[0].shape[0]) if ar_f else 0
            print(f"  {name:10s} n={n:2d} cell={m['cw']}x{m['ch']} mult={res['mult']:.3f} "
                  f"scale={m['scale']} areaEq={area_eq:.2f} h(med/max)={np.median(hh):.0f}/{max(hh):.0f}{seam}  idx={res['idx'][:3]}..{res['idx'][-2:]}")
            if args.report:
                continue
            char_dir.mkdir(parents=True, exist_ok=True)
            kb = save_webp(res["image"], char_dir / m["file"])
            m["kb"] = kb
            atlas["anims"][name] = m
        if args.report:
            continue
        # vorhandene atlas.json mit nur teilweise gepackten Animationen mergen
        ap_path = char_dir / "atlas.json"
        if only and ap_path.exists():
            old = json.loads(ap_path.read_text())
            old["anims"].update(atlas["anims"])
            atlas = old
        # kb ist nur Info -> nicht in die Engine-Datei
        clean_atlas = json.loads(json.dumps(atlas))
        for m in clean_atlas["anims"].values():
            m.pop("kb", None)
        # Reihenfolge stabil
        order = ["run", "jump", "fall", "doublejump", "slide", "hurt", "dash", "stomp", "idle", "victory"]
        clean_atlas["anims"] = {k: clean_atlas["anims"][k] for k in order if k in clean_atlas["anims"]}
        ap_path.write_text(json.dumps(clean_atlas, indent=2) + "\n")
        print(f"[{cid}] atlas.json geschrieben ({len(clean_atlas['anims'])} Animationen)")
        if args.preview:
            preview(char_dir, clean_atlas, Path(args.preview) / f"{cid}.jpg", args.every, args.cell, only or None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
