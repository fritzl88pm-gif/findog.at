#!/usr/bin/env python3
"""Fredrun 2.0 – Props-Packer.

Erzeugt aus Rohquellen (AutoSprite-Spritesheets, Kollagen/Previews, Originalspiel-Assets) saubere WebP-Sprites
unter ``public/fredrun2/props/`` und pflegt ``public/fredrun2/props/manifest.json`` (Format: docs/fredrun2/ASSETS.md).

Aufruf (aus dem Repo-Root):

    python3 tools/fredrun2/pack_props.py --src <QUELLVERZEICHNIS> [--only odo-run,tram] [--list]
    python3 tools/fredrun2/pack_props.py --src <SRC> --spec tools/fredrun2/props_spec.json

Das Quellverzeichnis enthaelt die Rohdateien, auf die ``props_spec.json`` per relativem Pfad verweist
(Spritesheet-PNGs von AutoSprite, ausgeschnittene RGBA-Kandidaten, Originalassets aus public/fredrun/ werden
direkt ueber ``@orig/…`` adressiert). Jeder Spec-Eintrag ist ein Prop; ``kind`` bestimmt den Packer:

* ``cycle``  – Charakter-/Gegner-Lauf aus einem Raster-Sheet: Frames ``start .. start+length`` (nahtlos),
               optional gespiegelt (``flip``), gemeinsamer Skalierungsfaktor, Fuss unten mittig,
               horizontal geglaettet (gleitender Mittelwert ueber ``smooth`` Frames, zyklisch).
* ``clip``   – wie ``cycle``, aber kein Loop; Bodenlinie bleibt erhalten (Sprung/Defeated), nur Frame-Auswahl
               ``frames`` (Liste) oder ``start/length/step``.
* ``anim``   – Sheet mit frei schwebendem Objekt (Vogel, Drohne, Biene): Frames werden auf ihren gemeinsamen,
               geglaetteten Schwerpunkt zentriert, Anker = Mitte (0.5, 0.5).
* ``static`` – ein Bild (RGBA-PNG oder Bild auf weissem Grund + ``matte``), enger Zuschnitt mit ``pad`` px Rand.
* ``spin``   – Muenze/Objekt als 1-Frame-Bild -> N Frames Y-Achsen-Drehung (Stauchung), fuer ``coin``.

Abhaengigkeiten: Pillow, numpy, scipy.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "public" / "fredrun2" / "props"
ORIG_DIR = REPO / "public" / "fredrun"
MANIFEST = OUT_DIR / "manifest.json"
WORLD_TAGS = {"wien", "alpen", "finanzamt", "prater", "wachau", "cyber", "allgemein"}
TYPE_TAGS = {"obstacle", "enemy", "pickup", "deco", "hazard"}
ALPHA_T = 40  # Schwelle fuer "sichtbar"


# ----------------------------------------------------------------------------------------------- Bild-Helfer
def open_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def slice_grid(im: Image.Image, cw: int, ch: int, cols: int, n: int) -> list[Image.Image]:
    out = []
    for i in range(n):
        r, c = divmod(i, cols)
        out.append(im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
    return out


def alpha_bbox(im: Image.Image, t: int = ALPHA_T):
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > t)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def centroid_x(im: Image.Image, t: int = 128) -> float:
    a = np.asarray(im)[..., 3].astype(np.float32)
    m = a > t
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return im.width / 2
    return float(xs.mean())


def bleed_colors(im: Image.Image, radius: int = 6) -> Image.Image:
    """Farben transparenter Randpixel mit der naechsten deckenden Farbe fuellen (verhindert dunkle/helle Halos
    durch verlustbehaftete WebP-Kompression und Filterung)."""
    a = np.asarray(im).copy()
    solid = a[..., 3] > 8
    if solid.all() or not solid.any():
        return im
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    near = a[idx[0], idx[1], :3]
    d = ndi.distance_transform_edt(~solid)
    fill = (~solid) & (d <= radius)
    a[..., :3] = np.where(fill[..., None], near, a[..., :3])
    # weit entfernte Transparenz auf Schwarz (kleinere Dateien)
    far = (~solid) & (d > radius)
    a[far, :3] = 0
    return Image.fromarray(a, "RGBA")


def save_webp(im: Image.Image, path: Path, max_kb: int, q_start: int = 88, q_min: int = 66, verbose=True) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    im = bleed_colors(im)
    q = q_start
    while True:
        im.save(path, "WEBP", quality=q, method=6, alpha_quality=92 if q < 84 else 100)
        kb = path.stat().st_size / 1024
        if kb <= max_kb or q <= q_min:
            break
        q -= 4
    if verbose:
        print(f"  -> {path.name}: {im.width}x{im.height}, q{q}, {kb:.0f} KB")
    return int(round(kb))


def _border_connected(mask: np.ndarray) -> np.ndarray:
    lab, _ = ndi.label(mask)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border > 0]
    return np.isin(lab, border)


def _finish_matte(a: np.ndarray, fg: np.ndarray, erode: int, blur: float) -> Image.Image:
    fg_e = ndi.binary_erosion(fg, iterations=erode) if erode > 0 else fg
    idx = ndi.distance_transform_edt(~fg_e, return_distances=False, return_indices=True)
    col = a[idx[0], idx[1]].astype(np.uint8)
    alpha = ndi.gaussian_filter(fg_e.astype(np.float32), blur)
    d = ndi.distance_transform_edt(~fg_e)
    alpha[d > 2.5] = 0
    alpha = np.clip(alpha * 1.15, 0, 1)
    return Image.fromarray(np.dstack([col, (alpha * 255).astype(np.uint8)]), "RGBA")


def keep_main(im: Image.Image, frac: float = 0.06) -> Image.Image:
    """Nur zusammenhaengende Hauptteile behalten (Splitter/Nachbarreste/Tintentropfen entfernen)."""
    arr = np.asarray(im).copy()
    solid = arr[..., 3] > 40
    lab, n = ndi.label(ndi.binary_dilation(solid, iterations=3))
    if n <= 1:
        return im
    sizes = ndi.sum(solid, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= frac * sizes.max()
    arr[..., 3] = np.where(keep[lab], arr[..., 3], 0)
    return Image.fromarray(arr, "RGBA")


def matte_white(img: Image.Image, thr: int = 238, erode: int = 1, blur: float = 0.7, bg_ref=(255, 255, 255),
                shadow: int = 175, gap: int = 2, holes_min: int = 0) -> Image.Image:
    """Freistellung eines Objekts auf (nahezu) einfarbig hellem Grund: Flood-Fill von den Raendern (Luecken in
    Konturen bis ~2*gap px werden geschlossen), helle neutrale Bodenschatten (>= ``shadow``) zaehlen als Grund, weiche
    Kante, Farb-Bleeding gegen weisse Raender. Umschlossene weisse Flaechen bleiben erhalten (ausser
    ``holes_min`` > 0: grosse umschlossene helle Flaechen, z.B. Zaunluecken, werden transparent)."""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    dist = np.abs(a - np.array(bg_ref)).max(-1)
    near = dist <= (255 - thr)
    if shadow:
        chroma = a.max(-1) - a.min(-1)
        near |= (chroma <= 16) & (a.min(-1) >= shadow)
    if gap > 0:
        solid_d = ndi.binary_dilation(~near, iterations=gap)
        bg = _border_connected(~solid_d)
        bg = ndi.binary_dilation(bg, iterations=gap + 1) & near
    else:
        bg = _border_connected(near)
    fg = ~bg
    lab2, n2 = ndi.label(fg)
    if n2:
        sizes = ndi.sum(fg, lab2, range(1, n2 + 1))
        keep = np.zeros(n2 + 1, bool)
        keep[1:] = sizes >= 30
        fg = keep[lab2]
    if holes_min:
        chroma = a.max(-1) - a.min(-1)
        light = fg & (a.min(-1) >= 170) & (chroma <= 40)
        lab3, n3 = ndi.label(light)
        if n3:
            sizes = ndi.sum(light, lab3, range(1, n3 + 1))
            rm = np.zeros(n3 + 1, bool)
            rm[1:] = sizes >= holes_min
            fg = fg & ~rm[lab3]
    return _finish_matte(a, fg, erode, blur)


def matte_glow(img: Image.Image, reach: int = 26, gap: int = 1) -> Image.Image:
    """Neon-/Leuchtobjekte auf Weiss: 'Color-to-Alpha' im Aussenbereich (Glow wird halbtransparent), Innenbereich
    bleibt deckend."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    dark = (255.0 - a.min(-1)) / 255.0  # 0 = weiss, 1 = gesaettigt/dunkel
    core = dark < 0.035
    bg = _border_connected(core)
    dist = ndi.distance_transform_edt(~bg)
    ext = _border_connected(dark < 0.55) & (dist <= reach)
    alpha = np.where(ext, np.clip(dark / 0.5, 0, 1), 1.0)
    alpha = np.where(alpha < 0.07, 0, alpha)
    ac = np.maximum(alpha, 1e-3)[..., None]
    col = np.where(ext[..., None], 255.0 - (255.0 - a) / ac, a)
    col = np.clip(col, 0, 255)
    # feine Aussenkante glaetten
    alpha = ndi.gaussian_filter(alpha, 0.6)
    solid = alpha > 0.05
    lab, n = ndi.label(ndi.binary_dilation(solid, iterations=2))
    if n > 1:
        sizes = ndi.sum(solid, lab, range(1, n + 1))
        k = np.zeros(n + 1, bool); k[1:] = sizes >= 0.05 * sizes.max()
        alpha = np.where(k[lab], alpha, 0)
    return Image.fromarray(np.dstack([col.astype(np.uint8), (alpha * 255).astype(np.uint8)]), "RGBA")


def place(cell: Image.Image, fr: Image.Image, dx: int, dy: int) -> None:
    """Alpha-korrektes Einsetzen mit Clipping an den Zellgrenzen."""
    x0, y0 = max(0, dx), max(0, dy)
    x1, y1 = min(cell.width, dx + fr.width), min(cell.height, dy + fr.height)
    if x1 <= x0 or y1 <= y0:
        return
    part = fr.crop((x0 - dx, y0 - dy, x1 - dx, y1 - dy))
    cell.alpha_composite(part, (x0, y0))


def smooth_circular(v: np.ndarray, win: int, circular: bool) -> np.ndarray:
    if win <= 1:
        return v.copy()
    k = win // 2
    n = len(v)
    out = np.zeros(n, np.float64)
    for i in range(n):
        acc = 0.0
        for j in range(-k, k + 1):
            if circular:
                acc += v[(i + j) % n]
            else:
                acc += v[min(max(i + j, 0), n - 1)]
        out[i] = acc / (2 * k + 1)
    return out


def write_sheet(frames: list[Image.Image], cw: int, ch: int, cols: int) -> tuple[Image.Image, int, int]:
    n = len(frames)
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % cols) * cw, (i // cols) * ch))
    return sheet, cols, rows


# ----------------------------------------------------------------------------------------------- Manifest
def load_manifest() -> dict:
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text())
        except Exception:
            pass
    return {"props": {}}


def save_manifest(man: dict) -> None:
    man["props"] = dict(sorted(man["props"].items()))
    MANIFEST.write_text(json.dumps(man, indent=2, ensure_ascii=False) + "\n")


def check_tags(pid: str, tags: list[str]) -> None:
    ws = [t for t in tags if t in WORLD_TAGS]
    ts = [t for t in tags if t in TYPE_TAGS]
    if not ws or not ts:
        print(f"  WARN {pid}: tags brauchen mindestens eine Welt {sorted(WORLD_TAGS)} und einen Typ {sorted(TYPE_TAGS)}")


def entry(file: str, cols: int, rows: int, frames: int, cw: int, ch: int, ax: float, ay: float, fps: int, loop: bool,
          tags: list[str], **extra) -> dict:
    e = {"file": file, "cols": cols, "rows": rows, "frames": frames, "cw": cw, "ch": ch,
         "ax": round(ax, 4), "ay": round(ay, 4), "fps": fps, "loop": loop, "tags": tags}
    e.update(extra)
    return e


# ----------------------------------------------------------------------------------------------- Packer
def src_path(spec_src: str, src_dir: Path) -> Path:
    if spec_src.startswith("@orig/"):
        return ORIG_DIR / spec_src[len("@orig/"):]
    return src_dir / spec_src


def pick_frames(spec: dict, frames: list[Image.Image]) -> list[Image.Image]:
    if "frames" in spec and isinstance(spec["frames"], list):
        return [frames[i] for i in spec["frames"]]
    start = spec.get("start", 0)
    length = spec.get("length", len(frames) - start)
    step = spec.get("step", 1)
    return [frames[start + i * step] for i in range(0, length, 1) if start + i * step < len(frames)]


def pack_cycle(pid: str, spec: dict, src_dir: Path, loop: bool = True) -> dict:
    """Charakter-/Gegner-Zyklus: Fuss unten mittig, gemeinsamer Skalierungsfaktor, geglaetteter Schwerpunkt."""
    sheet = open_rgba(src_path(spec["src"], src_dir))
    scw = spec["src_cw"]
    sch = spec.get("src_ch", scw)
    frames = slice_grid(sheet, scw, sch, spec["cols"], spec["n"])
    sel = pick_frames(spec, frames)
    if spec.get("flip"):
        sel = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in sel]
    out_w = spec.get("out", 256)
    out_h = spec.get("out_h", out_w)
    target_h = spec.get("target_h", 214)
    foot_pad = spec.get("foot_pad", 6)
    smooth = spec.get("smooth", 7)

    boxes = [alpha_bbox(f) for f in sel]
    hs = np.array([b[3] - b[1] for b in boxes], float)
    ws = np.array([b[2] - b[0] for b in boxes], float)
    if "ref_frame" in spec:  # Hoehe eines bestimmten Quell-Frames (z.B. stehende Pose) als Referenz
        rb = alpha_bbox(frames[spec["ref_frame"]])
        ref_h = float(rb[3] - rb[1])
    else:
        ref_h = float(np.median(hs)) if spec.get("ref", "median") == "median" else float(hs.max())
    scale = target_h / ref_h
    # in die Zelle einpassen
    max_w = (ws.max() * scale)
    if max_w > out_w - 8:
        scale *= (out_w - 8) / max_w
    if spec.get("scale"):
        scale = spec["scale"]
    if spec.get("center") == "bbox":
        cxs = np.array([(b[0] + b[2]) / 2 for b in boxes])
    else:
        cxs = np.array([centroid_x(f) for f in sel])
    cxs_s = smooth_circular(cxs, smooth, circular=loop)
    ground = None
    if not loop or spec.get("keep_ground"):
        # Bodenlinie = tiefster Punkt ueber alle Frames (Sprung/Defeated behalten ihre Hoehe)
        ground = max(b[3] for b in boxes)
    foot_y = out_h - foot_pad
    outs = []
    vis_w = vis_h = 0
    for f, b, cx_s in zip(sel, boxes, cxs_s):
        nw, nh = max(1, round(f.width * scale)), max(1, round(f.height * scale))
        fr = f.resize((nw, nh), Image.LANCZOS)
        bottom = (ground if ground is not None else b[3]) * scale
        dx = round(out_w / 2 - cx_s * scale)
        dy = round(foot_y - bottom)
        cell = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
        place(cell, fr, dx, dy)
        bb = alpha_bbox(cell)
        if bb is not None:
            if bb[0] <= 1 or bb[2] >= out_w - 1 or bb[1] <= 0:
                print(f"  WARN {pid}: Frame beruehrt den Zellrand (bbox {bb})")
            vis_w = max(vis_w, bb[2] - bb[0])
            vis_h = max(vis_h, bb[3] - bb[1])
        outs.append(cell)
    cols = spec.get("out_cols", 8)
    sheet_img, cols, rows = write_sheet(outs, out_w, out_h, cols)
    kb = save_webp(sheet_img, OUT_DIR / f"{pid}.webp", spec.get("max_kb", 420))
    print(f"  {pid}: {len(outs)} Frames, scale {scale:.3f}, sichtbar {vis_w}x{vis_h}")
    return entry(f"{pid}.webp", cols, rows, len(outs), out_w, out_h, 0.5, foot_y / out_h, spec.get("fps", 24),
                 loop, spec["tags"], w=int(vis_w), h=int(vis_h), facing="right", kb=kb)


def pack_anim(pid: str, spec: dict, src_dir: Path) -> dict:
    """Frei schwebendes Objekt (Vogel, Drohne, Biene): auf gemeinsamen Schwerpunkt zentriert, Anker Mitte."""
    sheet = open_rgba(src_path(spec["src"], src_dir))
    scw = spec["src_cw"]
    sch = spec.get("src_ch", scw)
    frames = slice_grid(sheet, scw, sch, spec["cols"], spec["n"])
    sel = pick_frames(spec, frames)
    if spec.get("flip"):
        sel = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in sel]
    out = spec.get("out", 256)
    out_h = spec.get("out_h", out)
    boxes = [alpha_bbox(f) for f in sel]
    # gemeinsame Ober-Bounding-Box (Union) -> alle Frames mit demselben Ausschnitt/Skalierung behandeln
    ux0 = min(b[0] for b in boxes); uy0 = min(b[1] for b in boxes)
    ux1 = max(b[2] for b in boxes); uy1 = max(b[3] for b in boxes)
    pad = spec.get("pad", 6)
    uw, uh = ux1 - ux0, uy1 - uy0
    scale = min((out - 2 * pad) / uw, (out_h - 2 * pad) / uh)
    if spec.get("max_scale"):
        scale = min(scale, spec["max_scale"])
    outs = []
    # gemeinsamer Mittelpunkt der Union-Box: Bewegung im Clip bleibt erhalten (kein Schwerpunkt-Tracking)
    ucx, ucy = (ux0 + ux1) / 2, (uy0 + uy1) / 2
    for f in sel:
        nw, nh = max(1, round(f.width * scale)), max(1, round(f.height * scale))
        fr = f.resize((nw, nh), Image.LANCZOS)
        dx = round(out / 2 - ucx * scale)
        dy = round(out_h / 2 - ucy * scale)
        cell = Image.new("RGBA", (out, out_h), (0, 0, 0, 0))
        place(cell, fr, dx, dy)
        outs.append(cell)
    cols = spec.get("out_cols", 6)
    sheet_img, cols, rows = write_sheet(outs, out, out_h, cols)
    kb = save_webp(sheet_img, OUT_DIR / f"{pid}.webp", spec.get("max_kb", 300))
    print(f"  {pid}: {len(outs)} Frames, scale {scale:.3f}")
    return entry(f"{pid}.webp", cols, rows, len(outs), out, out_h, spec.get("ax", 0.5), spec.get("ay", 0.5),
                 spec.get("fps", 16), spec.get("loop", True), spec["tags"],
                 w=int(uw * scale), h=int(uh * scale), facing=spec.get("facing", "right"), kb=kb)


def load_static_source(spec: dict, src_dir: Path) -> Image.Image:
    p = src_path(spec["src"], src_dir)
    im = Image.open(p)
    m = spec.get("matte")
    if spec.get("crop"):
        # Kollagen-Ausschnitt (x0, y0, x1, y1) mit weissem Sicherheitsrand
        im = im.convert("RGB")
        x0, y0, x1, y1 = spec["crop"]
        m_ = 8
        canvas = Image.new("RGB", (x1 - x0 + 2 * m_, y1 - y0 + 2 * m_), (255, 255, 255))
        canvas.paste(im.crop((x0, y0, x1, y1)), (m_, m_))
        im = canvas
    if m == "glow":
        im = matte_glow(im.convert("RGB"), reach=spec.get("reach", 26))
    elif m:
        im = matte_white(im.convert("RGB"), thr=spec.get("thr", 238), shadow=spec.get("shadow", 175),
                         gap=spec.get("gap", 2), holes_min=spec.get("holes_min", 0))
    else:
        im = im.convert("RGBA")
    if m and spec.get("keep_main", True):
        im = keep_main(im)
    for box in spec.get("erase", []):  # nachtraeglich zu loeschende Rechtecke (Bildkoordinaten nach crop+8px Rand)
        arr = np.asarray(im).copy()
        x0, y0, x1, y1 = box
        arr[y0:y1, x0:x1, 3] = 0
        im = Image.fromarray(arr, "RGBA")
    return im


def pack_static(pid: str, spec: dict, src_dir: Path) -> dict:
    im = load_static_source(spec, src_dir)
    if spec.get("flip"):
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    bb = alpha_bbox(im, 12)
    im = im.crop(bb)
    pad = spec.get("pad", 5)
    max_side = spec.get("max_side", 512)
    scale = 1.0
    if max(im.size) > max_side - 2 * pad:
        scale = (max_side - 2 * pad) / max(im.size)
    if spec.get("min_side") and max(im.size) < spec["min_side"]:
        scale = min(spec["min_side"] / max(im.size), spec.get("max_up", 1.6))
    if scale != 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    cw, ch = im.width + 2 * pad, im.height + 2 * pad
    cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    cell.alpha_composite(im, (pad, pad))
    kb = save_webp(cell, OUT_DIR / f"{pid}.webp", spec.get("max_kb", 250), q_start=90)
    ax = spec.get("ax", 0.5)
    ay = spec.get("ay", (ch - pad) / ch)
    return entry(f"{pid}.webp", 1, 1, 1, cw, ch, ax, ay, 0, True, spec["tags"],
                 w=im.width, h=im.height, facing=spec.get("facing", "right"), kb=kb)


def pack_spin(pid: str, spec: dict, src_dir: Path) -> dict:
    """Y-Achsen-Drehung eines runden Objekts (Muenze) per Horizontal-Stauchung inkl. Muenzkante (Extrusion).
    Die Rueckseite zeigt dasselbe Motiv (nicht gespiegelt)."""
    im = load_static_source(spec, src_dir)
    im = im.crop(alpha_bbox(im, 12))
    out = spec.get("out", 192)
    s = (out - 16) / max(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    n = spec.get("n", 12)
    thick = spec.get("rim", 0.09) * im.width
    rim_col = np.array(spec.get("rim_color", [201, 146, 20]), float)
    w0, h0 = im.size
    outs = []
    for k in range(n):
        ang = 2 * math.pi * k / n
        c, sn = math.cos(ang), math.sin(ang)
        wk = max(2, int(round(w0 * abs(c))))
        face = im.resize((wk, h0), Image.LANCZOS)
        fa = np.asarray(face).astype(np.float32)
        fa[..., :3] *= 0.74 + 0.26 * abs(c)
        face = Image.fromarray(np.clip(fa, 0, 255).astype(np.uint8), "RGBA")
        e = int(round(thick * abs(sn)))
        sgn = 1 if sn >= 0 else -1
        cell = Image.new("RGBA", (out, out), (0, 0, 0, 0))
        oy = (out - h0) // 2
        fx = out // 2 - wk // 2 - (sgn * e) // 2
        if e >= 1:
            m = np.zeros((out, out), bool)
            am = np.asarray(face)[..., 3] > 100
            m[oy:oy + h0, fx:fx + wk] = am
            m2 = np.roll(m, sgn * e, axis=1)
            for d in range(1, e):  # Luecken der Extrusion schliessen
                m2 |= np.roll(m, sgn * d, axis=1)
            rim = m2 & ~m
            ys = np.nonzero(m.any(1))[0]
            y0, y1 = ys.min(), ys.max()
            t = np.clip((np.arange(out) - y0) / max(1, y1 - y0), 0, 1)
            lum = 0.62 + 0.5 * (1 - np.abs(2 * t - 1))  # Mitte heller
            col = np.clip(rim_col[None, :] * lum[:, None], 0, 255)
            arr = np.zeros((out, out, 4), np.uint8)
            arr[..., :3] = col[:, None, :].astype(np.uint8)
            arr[..., 3] = (rim * 255).astype(np.uint8)
            cell.alpha_composite(Image.fromarray(arr, "RGBA"))
        place(cell, face, fx, oy)
        outs.append(cell)
    cols = spec.get("out_cols", 6)
    sheet_img, cols, rows = write_sheet(outs, out, out, cols)
    kb = save_webp(sheet_img, OUT_DIR / f"{pid}.webp", spec.get("max_kb", 250))
    return entry(f"{pid}.webp", cols, rows, len(outs), out, out, 0.5, 0.5, spec.get("fps", 14), True, spec["tags"],
                 w=w0, h=h0, facing="front", kb=kb)


PACKERS = {
    "cycle": lambda pid, spec, src: pack_cycle(pid, spec, src, loop=True),
    "clip": lambda pid, spec, src: pack_cycle(pid, spec, src, loop=False),
    "anim": pack_anim,
    "static": pack_static,
    "spin": pack_spin,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True, help="Quellverzeichnis (Rohsheets/Kandidaten)")
    ap.add_argument("--spec", type=Path, default=Path(__file__).with_name("props_spec.json"))
    ap.add_argument("--only", default="", help="kommagetrennte Prop-IDs")
    ap.add_argument("--list", action="store_true", help="nur Spec-IDs auflisten")
    args = ap.parse_args()
    spec = json.loads(args.spec.read_text())
    props = spec["props"]
    if args.list:
        for k, v in props.items():
            print(k, v["kind"], v["tags"])
        return 0
    only = {s for s in args.only.split(",") if s}
    man = load_manifest()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for pid, sp in props.items():
        if only and pid not in only:
            continue
        print(f"[{pid}] {sp['kind']}")
        check_tags(pid, sp["tags"])
        man["props"][pid] = PACKERS[sp["kind"]](pid, sp, args.src)
    save_manifest(man)
    print(f"manifest.json: {len(man['props'])} Props")
    return 0


if __name__ == "__main__":
    sys.exit(main())
