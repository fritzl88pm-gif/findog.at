#!/usr/bin/env python3
"""Landmark-Props (gemalte Wahrzeichen, weißer Hintergrund) freistellen und in public/fredrun2/props ablegen.

Aufruf: python3 tools/fredrun2/pack_landmarks.py --src <ordner mit <name>.png> [--only abbey,castle]
Ergebnis: props/landmark-<name>.webp + Einträge in props/manifest.json (Tag "landmark").
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PROPS = os.path.join(ROOT, "public", "fredrun2", "props")

LANDMARKS = {
    "abbey": {"tags": ["landmark", "wachau", "alpen"], "maxdim": 760},
    "castle": {"tags": ["landmark", "wachau", "alpen"], "maxdim": 700},
    "riesenrad": {"tags": ["landmark", "prater", "wien"], "maxdim": 800, "holes": True},
    "cathedral": {"tags": ["landmark", "wien", "cyber"], "maxdim": 760},
    "coaster": {"tags": ["landmark", "prater"], "maxdim": 760, "holes": True},
    "chalet": {"tags": ["landmark", "alpen"], "maxdim": 520},
    "church": {"tags": ["landmark", "alpen", "wachau"], "maxdim": 520},
    "steamship": {"tags": ["landmark", "wachau"], "maxdim": 720},
    "peak": {"tags": ["landmark", "alpen"], "maxdim": 760},
    "carousel": {"tags": ["landmark", "prater"], "maxdim": 640, "holes": True},
    "tent": {"tags": ["landmark", "prater"], "maxdim": 660},
    "hauntedhouse": {"tags": ["landmark", "prater"], "maxdim": 640},
    "vineyard": {"tags": ["landmark", "wachau"], "maxdim": 640},
}


def cutout(img: Image.Image, holes: bool = False) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(np.float32)
    mn = rgb.min(axis=2)
    near_white = mn >= 236
    lab, n = ndimage.label(near_white)
    border = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])))
    border.discard(0)
    bg = np.isin(lab, list(border))
    if holes:
        # auch eingeschlossene große Weißflächen (Radinnenraum, Looping) entfernen
        sizes = ndimage.sum(near_white, lab, index=np.arange(1, n + 1))
        big = [i + 1 for i, sz in enumerate(sizes) if sz > 600]
        bg = bg | np.isin(lab, big)
    # weiche Kante: Distanz zum Hintergrund
    dist = ndimage.distance_transform_edt(~bg)
    alpha = np.where(bg, 0.0, np.clip(dist / 2.0, 0.0, 1.0))
    # Randpixel entfärben (Weiß herausrechnen)
    a = np.clip(alpha, 0.05, 1.0)[..., None]
    edge = (alpha > 0) & (alpha < 1)
    out = rgb.copy()
    out[edge] = np.clip((rgb[edge] - 255.0 * (1 - a[edge])) / a[edge], 0, 255)
    rgba = np.dstack([out, alpha * 255.0]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    bbox = im.getbbox()
    if bbox:
        pad = 4
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
        im = im.crop(bbox)
    return im


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = [s for s in args.only.split(",") if s]
    mpath = os.path.join(PROPS, "manifest.json")
    manifest = json.load(open(mpath))
    for name, cfg in LANDMARKS.items():
        if only and name not in only:
            continue
        src = os.path.join(args.src, name + ".png")
        if not os.path.exists(src):
            print("fehlt:", src)
            continue
        im = cutout(Image.open(src), holes=bool(cfg.get("holes")))
        k = cfg["maxdim"] / max(im.size)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        pid = f"landmark-{name}"
        fn = f"{pid}.webp"
        im.save(os.path.join(PROPS, fn), "WEBP", quality=88, method=6, alpha_quality=92)
        kb = os.path.getsize(os.path.join(PROPS, fn)) // 1024
        manifest["props"][pid] = {
            "file": fn, "cols": 1, "rows": 1, "frames": 1, "cw": im.width, "ch": im.height,
            "ax": 0.5, "ay": 1.0, "fps": 0, "loop": True, "tags": cfg["tags"], "w": im.width, "h": im.height, "facing": "right", "kb": kb,
        }
        print(pid, im.size, kb, "KB")
    json.dump(manifest, open(mpath, "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
