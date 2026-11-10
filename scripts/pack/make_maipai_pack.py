#!/usr/bin/env python3
"""Builds the MaiPai "still plus parts" companion pack (MAKER-G) from one picture.

Cuts the red heart and the two yellow happy-arc eyes out of the picture by colour keying, fills the holes they leave with the
surrounding body and visor colour (the pack's `voice.base`), and writes pack.json that validates against
spec/schemas/companion-pack.schema.json. A soft visor sheen picture is added as a third part.

    uv run --offline --no-project --with pillow --with numpy python scripts/pack/make_maipai_pack.py \
        --source data-scratch/cast-previews/MaiPai.png --out data-scratch/packs/maipai

Everything is deterministic: the same picture gives the same bytes.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

TILE = 480
VERSION = "1"


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def fill_holes(rgb: np.ndarray, hole: np.ndarray, rounds: int = 1500) -> np.ndarray:
    """Diffuses the colours around `hole` into it (repeated 4-neighbour averaging), so a gradient continues smoothly."""
    out = rgb.copy()
    ys, xs = np.where(hole)
    y0, y1, x0, x1 = max(0, ys.min() - 3), ys.max() + 4, max(0, xs.min() - 3), xs.max() + 4
    crop, inside = out[y0:y1, x0:x1], hole[y0:y1, x0:x1]
    crop[inside] = crop[~inside].mean(axis=0)
    for _ in range(rounds):
        padded = np.pad(crop, ((1, 1), (1, 1), (0, 0)), mode="edge")
        mean = (padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:]) / 4
        crop[inside] = mean[inside]
    return out


def nearest_core_colour(rgb: np.ndarray, core: np.ndarray, region: np.ndarray) -> np.ndarray:
    """Colour of the nearest solid (core) pixel for every pixel of `region`, by growing the core outwards."""
    out = rgb.copy()
    have = core.copy()
    while True:
        need = region & ~have
        if not need.any():
            return out
        grown = False
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted = np.roll(have, (dy, dx), axis=(0, 1))
            colour = np.roll(out, (dy, dx), axis=(0, 1))
            take = need & shifted & ~have
            if take.any():
                out[take] = colour[take]
                have = have | take
                grown = True
        if not grown:
            return out


def matte(rgb, background, foreground, loose):
    """Alpha of `foreground` over `background` for each pixel: the share of (C - B) along (F - B); outside `loose` it is 0."""
    delta = foreground - background
    alpha = ((rgb - background) * delta).sum(axis=2) / np.maximum(1e-6, (delta * delta).sum(axis=2))
    return np.where(loose, np.clip(alpha, 0, 1), 0)


def downscale_rgba(rgb: np.ndarray, alpha: np.ndarray, side: int) -> Image.Image:
    """Resizes with premultiplied colour so edges carry no dark or light fringe."""
    premult = np.dstack([rgb * alpha[..., None], alpha * 255.0]).astype(np.float32)
    channels = [np.asarray(Image.fromarray(premult[..., i], mode="F").resize((side, side), Image.LANCZOS)) for i in range(4)]
    a = np.clip(channels[3], 0, 255)
    colour = np.stack(channels[:3], axis=-1) / np.maximum(a[..., None] / 255.0, 1e-3)
    return Image.fromarray(np.dstack([np.clip(colour, 0, 255), a]).astype(np.uint8), "RGBA")


def tight_box(image: Image.Image, pad: int = 3):
    bbox = image.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
    x0, y0, x1, y1 = bbox
    return max(0, x0 - pad), max(0, y0 - pad), min(image.width, x1 + pad), min(image.height, y1 + pad)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data-scratch/cast-previews/MaiPai.png")
    parser.add_argument("--out", default="data-scratch/packs/maipai")
    args = parser.parse_args()
    out = Path(args.out)
    (out / "voice").mkdir(parents=True, exist_ok=True)

    source = Image.open(args.source).convert("RGB")
    rgb = np.asarray(source).astype(np.float32)
    h, w, _ = rgb.shape
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    # Colour keys on the known colours: red heart (red well above green and blue), yellow arcs (red and green well above blue).
    red = r - np.maximum(g, b)
    yellow = np.minimum(r, g) - b
    ys, xs = np.mgrid[0:h, 0:w]
    heart_zone = (ys > 0.5 * h) & (ys < 0.85 * h) & (xs > 0.3 * w) & (xs < 0.7 * w)
    eye_zone = (ys > 0.25 * h) & (ys < 0.42 * h) & (xs > 0.2 * w) & (xs < 0.8 * w)
    heart_core, heart_loose = (red > 150) & heart_zone, (red > 22) & heart_zone
    eyes_core, eyes_loose = (yellow > 170) & eye_zone, (yellow > 6) & eye_zone

    base = rgb.copy()
    parts = {}
    for name, core, loose, side in (
        ("heart", heart_core, heart_loose, None),
        ("eye-left", eyes_core & (xs < w / 2), eyes_loose & (xs < w / 2), None),
        ("eye-right", eyes_core & (xs >= w / 2), eyes_loose & (xs >= w / 2), None),
    ):
        hole = dilate(loose, 12)  # wide: the picture has a soft glow around the heart and the arcs that the fill must not copy
        filled = fill_holes(rgb, hole)
        fg = nearest_core_colour(rgb, core, hole)
        alpha = matte(rgb, filled, fg, dilate(loose, 6))
        base[hole] = filled[hole]
        parts[name] = (fg, alpha)

    # Visor sheen: a soft diagonal band clipped to the visor (the large dark blue area), drawn above the base, below the eyes.
    visor = (base[..., 2] > base[..., 0] * 1.6) & (base[..., 2] > 60) & (ys < 0.55 * h)  # from the filled base, so the arcs leave no holes in it
    along = (xs + 0.6 * ys) / (w + 0.6 * h)
    band = np.exp(-(((along - 0.44) / 0.045) ** 2))
    sheen_alpha = (visor * band * 0.9).astype(np.float32)
    parts["visor-sheen"] = (np.full_like(rgb, 255.0), sheen_alpha)

    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).resize((TILE, TILE), Image.LANCZOS).save(out / "voice" / "base.webp", quality=92)
    source.resize((TILE, TILE), Image.LANCZOS).save(out / "rest.webp", quality=92)

    boxes = {}
    for name, (fg, alpha) in parts.items():
        full = downscale_rgba(fg, alpha, TILE)
        x0, y0, x1, y1 = tight_box(full)
        full.crop((x0, y0, x1, y1)).save(out / "voice" / f"{name}.webp", quality=95, lossless=(name != "visor-sheen"), method=6)
        boxes[name] = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}

    def effect(**kw):
        return kw

    smooth_level = {"attackMs": 40, "releaseMs": 200}
    eye_effects = [
        effect(channel="level", curve="ease-out", smoothing={"attackMs": 50, "releaseMs": 220}, scaleY=[1, 0.9], scaleX=[1, 1.04], translate={"y": [0, -3]}),
        effect(channel="state", curve="blink", blinkMs=150, scaleY=[1, 0.12], drive={
            "idle": {"hz": 0.22}, "listen": {"hz": 0.28}, "think": {"hz": 0.16}, "speak": {"hz": 0.3},
        }),
    ]
    layer = {
        "base": "voice/base.webp",
        "parts": [
            {
                "id": "visor-sheen", "file": "voice/visor-sheen.webp", "box": boxes["visor-sheen"], "z": 1,
                "effects": [effect(channel="level", curve="smooth", smoothing={"attackMs": 120, "releaseMs": 450}, opacity=[0, 0.3])],
            },
            {
                "id": "heart", "file": "voice/heart.webp", "box": boxes["heart"], "anchor": {"x": 0.5, "y": 0.55}, "z": 2,
                "glow": {"color": "#ff3b30", "blur": 26},
                "effects": [
                    effect(channel="level", curve="linear", smoothing=smooth_level, scale=[1, 1.12], glow=[0, 1]),
                    effect(channel="state", curve="pulse", scale=[1, 1.06], glow=[0, 0.5], drive={
                        "idle": {"hz": 0.25, "depth": 0.35}, "think": {"amount": 0.15, "hz": 0.9, "depth": 0.6},
                        "listen": {"beat": True, "depth": 1}, "interrupt": {"beat": True, "depth": 0.6},
                    }),
                ],
            },
            {"id": "eye-left", "file": "voice/eye-left.webp", "box": boxes["eye-left"], "z": 2, "effects": eye_effects},
            {"id": "eye-right", "file": "voice/eye-right.webp", "box": boxes["eye-right"], "z": 2, "effects": eye_effects},
        ],
        "presets": {"idle": {"gain": 1}, "listen": {"gain": 1}, "think": {"gain": 1}, "speak": {"gain": 1}, "interrupt": {"gain": 0.8}},
    }
    sizes = {p.relative_to(out).as_posix(): p.stat().st_size for p in out.rglob("*.webp")}
    total = sum(sizes.values())
    pack = {
        "version": 1, "id": "maipai", "name": "MaiPai", "tile": {"desktop": TILE},
        "rest": "rest.webp", "voice": layer,
        "budget": {"bytes": 1048576},
        "provenance": {"maker": "make_maipai_pack.py", "makerVersion": VERSION, "source": "generated", "created": datetime(2026, 11, 10, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")},
    }
    (out / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
    (out / "files.json").write_text(json.dumps({**sizes, "pack.json": (out / "pack.json").stat().st_size}, indent=2) + "\n")
    print(f"wrote {out} ({total} bytes in {len(sizes)} pictures); boxes: {boxes}")


if __name__ == "__main__":
    main()
