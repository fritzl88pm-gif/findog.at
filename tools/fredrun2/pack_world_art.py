#!/usr/bin/env python3
"""Fredrun 2.0 – Kulissen-Packer für die per fal.ai (GPT Image 2) gemalten Welten (`winter`, `oper`).

Nimmt die rohen PNGs (2304×768 bzw. 1536×512, aus `fal-art.mjs`), macht horizontal kachelbare Ebenen wirklich nahtlos
und schreibt WebP nach `public/fredrun2/worlds/<welt>/<ebene>.webp` plus `manifest.json` (Größen, Kachelbreite).

Nahtlos machen: Die letzten `n` Spalten werden in die ersten `n` Spalten übergeblendet und die Kachel um `n` Spalten
gekürzt – dadurch schließt die letzte Spalte exakt an die erste an (Blend im vormultiplizierten Alpha-Raum, kein Saum).

    python3 tools/fredrun2/pack_world_art.py --src /tmp/art/winter --world winter [--seam 64] [--quality 84]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
OUT_ROOT = REPO / "public" / "fredrun2" / "worlds"

# Ebenen je Welt: Quellname (ohne Weltpräfix und .png) → Optionen
#   tile:   horizontal kachelbar (Naht korrigieren)
#   scale:  Skalierung der Datei (Speicher sparen bei weichen Fernebenen)
LAYERS: dict[str, dict[str, dict]] = {
    "winter": {
        "sky-dusk": {"tile": True, "scale": 0.75, "q": 80},
        "sky-night": {"tile": True, "scale": 0.75, "q": 80},
        "far-city": {"tile": True, "scale": 0.9, "q": 84},
        "mid-market": {"tile": True, "q": 86},
        "mid-rink": {"tile": True, "q": 86},
        "mid-krampus": {"tile": True, "q": 86},
        "near-fir": {"tile": True, "q": 84},
        "ground": {"tile": True, "q": 84},
        "ice": {"tile": True, "q": 84},
    },
    "oper": {
        "far-ballroom": {"tile": True, "q": 84},
        "far-foyer": {"tile": True, "q": 82},
        "far-boxes": {"tile": True, "q": 82},
        "far-mirror": {"tile": True, "q": 84},
        "far-midnight": {"tile": True, "q": 82},
        "mid-columns": {"tile": True, "q": 86},
        "mid-tables": {"tile": True, "q": 86},
        "near-curtain": {"tile": True, "q": 84},
        "ground-parquet": {"tile": True, "q": 84},
        "ground-carpet": {"tile": True, "q": 84},
    },
}


def make_seamless(im: Image.Image, n: int) -> Image.Image:
    """Kachel um n Spalten kürzen; die letzten n Spalten faden in die ersten n Spalten über."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255.0
    h, w, _ = a.shape
    rgb = a[..., :3] * a[..., 3:4]  # vormultipliziert
    al = a[..., 3:4]
    out_rgb = rgb[:, : w - n].copy()
    out_al = al[:, : w - n].copy()
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)[None, :, None]
    # x in [0,n): von Spalten (w-n+x) [Ende] nach Spalten (x) [Anfang]
    out_rgb[:, :n] = rgb[:, w - n :] * (1 - t) + rgb[:, :n] * t
    out_al[:, :n] = al[:, w - n :] * (1 - t) + al[:, :n] * t
    safe = np.maximum(out_al, 1e-4)
    res = np.concatenate([np.clip(out_rgb / safe, 0, 1), out_al], axis=2)
    return Image.fromarray((res * 255 + 0.5).astype(np.uint8), "RGBA")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Ordner mit <welt>-<ebene>.png")
    ap.add_argument("--world", required=True, choices=sorted(LAYERS))
    ap.add_argument("--seam", type=int, default=64)
    ap.add_argument("--only")
    a = ap.parse_args()
    src = Path(a.src)
    out = OUT_ROOT / a.world
    out.mkdir(parents=True, exist_ok=True)
    mf_path = out / "manifest.json"
    manifest = json.loads(mf_path.read_text()) if mf_path.exists() else {}
    only = set(a.only.split(",")) if a.only else None
    total = 0
    for name, opt in LAYERS[a.world].items():
        if only and name not in only:
            continue
        f = src / f"{a.world}-{name}.png"
        if not f.exists():
            print(f"fehlt: {f.name}")
            continue
        im = Image.open(f).convert("RGBA")
        has_alpha = np.asarray(im)[..., 3].min() < 250
        if opt.get("tile"):
            im = make_seamless(im, a.seam)
        s = opt.get("scale", 1.0)
        if s != 1.0:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        dest = out / f"{name}.webp"
        if has_alpha:
            im.save(dest, "WEBP", quality=opt.get("q", 84), alpha_quality=92, method=6)
        else:
            im.convert("RGB").save(dest, "WEBP", quality=opt.get("q", 82), method=6)
        kb = dest.stat().st_size / 1024
        total += kb
        manifest[name] = {"file": f"{name}.webp", "w": im.width, "h": im.height, "alpha": bool(has_alpha), "tile": bool(opt.get("tile")), "kb": round(kb)}
        print(f"{name:16s} {im.width}×{im.height} {'RGBA' if has_alpha else 'RGB '} {kb:6.0f} KB")
    mf_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"gesamt {total / 1024:.1f} MB → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
