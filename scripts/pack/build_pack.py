#!/usr/bin/env python
"""PACK-02: build a companion pack (man, clay or pixar) from the POC demo assets.

Interpreter: needs PyAV, numpy and Pillow, for example
  data-scratch/poc-companions/refs/venv/bin/python scripts/pack/build_pack.py clay

Only files the demo page really fetches are copied. Size cuts, in order, each reported in build-report.json:
  (a) mouth atlases and emotion pictures become lossy WebP (quality 92, alpha_quality 100, method 6) with a per-file PSNR and alpha check;
      masks, weight maps, rest and eye pictures stay lossless WebP (pixel-identical or kept as PNG);
  (b) every flow.bin is stored zlib-deflated as flow.bin.z (what DecompressionStream("deflate") reads); pack.json says int16-deflate;
  (c) only when the desktop tier is still over 12 MiB: the shout atlas keeps its letter tiles and the t=0.4 and t=0.6 in-betweens.
Clips get a 320x640 phone twin; clips with identical bytes are stored once. Packs go to <main>/data-scratch/packs/<id>/.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zlib
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image

LETTERS = "ABCDEFGH"
STATE_CLIPS = {"idle": ["idle1", "idle2"], "listen": ["listen"], "think": ["think"], "speak": ["speak"]}
LIFE_KEYS = [
    "nod",
    "brow",
    "gazeL",
    "gazeR",
    "gazeU",
    "eyeWide",
    "eyeSquint",
    "eyeClosed",
    "eyeHalf",
    "mCorner",
    "mAsymL",
    "mAsymR",
    "mUpper",
    "mPress",
    "mNostril",
    "mWrinkle",
    "smile",
    "mBrow",
]
NAMES = {"man": "Man", "clay": "Clay", "pixar": "Pixar"}
SOURCE = {"man": "photo", "clay": "stylised", "pixar": "stylised"}
MAKER_VERSION = "poc-companions"
BUDGET = 12582912
LOSSY = {"quality": 92, "alpha_quality": 100, "method": 6}
MIN_PSNR = 38.0
KEEP_T = (0.4, 0.6)
ENCODING = "int16-deflate"


def main_checkout() -> Path:
    """The main checkout of this repo (the worktree's git common dir parent), or the current directory."""
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True,
            text=True,
            check=True,
            cwd=Path(__file__).resolve().parent,
        ).stdout.strip()
        return Path(common).parent
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


class Builder:
    def __init__(self, cid: str, src: Path, out: Path, opts: argparse.Namespace, trim: bool = False):
        self.cid, self.src, self.out = cid, src / cid, out / cid
        self.root = src
        self.effort, self.skip_phone = opts.webp_effort, opts.skip_phone
        self.lossy, self.deflate, self.trim = opts.lossy, opts.deflate, trim
        self.converted: list[dict] = []
        self.flows: list[dict] = []
        self.trimmed: list[dict] = []
        self.seen_clips: dict[str, str] = {}

    # ---- file helpers
    def rel(self, path: Path) -> str:
        return path.relative_to(self.out).as_posix()

    def copy(self, src: Path, dst: Path) -> Path:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        return dst

    def picture(self, src: Path, dst_stem: Path, lossy: bool = False) -> Path:
        """Copy a PNG as lossless WebP when smaller and pixel-identical (RGBA compare), else as the PNG; lossy=True uses LOSSY."""
        if lossy and self.lossy:
            with Image.open(src) as im:
                im.load()
                return self.save_lossy(im.convert("RGBA"), dst_stem, src.stat().st_size)
        dst_stem.parent.mkdir(parents=True, exist_ok=True)
        webp = dst_stem.with_suffix(".webp")
        png = dst_stem.with_suffix(".png")
        with Image.open(src) as im:
            im.load()
            im.save(webp, "WEBP", lossless=True, exact=True, quality=100, method=self.effort)
            a = np.asarray(im.convert("RGBA"))
        with Image.open(webp) as wi:
            same = np.array_equal(a, np.asarray(wi.convert("RGBA")))
        before, after = src.stat().st_size, webp.stat().st_size
        if same and after < before:
            self.converted.append({"file": self.rel(webp), "png": before, "webp": after})
            return webp
        webp.unlink()
        shutil.copyfile(src, png)
        self.converted.append({"file": self.rel(png), "png": before, "webp": after, "kept": "png", "pixelsEqual": same})
        return png

    def save_lossy(self, im: Image.Image, dst_stem: Path, png_bytes: int) -> Path:
        """Lossy WebP at quality 92; checks alpha error and RGB PSNR (where the source is not fully transparent) and records both.

        If a file is under MIN_PSNR the quality steps up (95, 98) and then falls back to lossless; the quality used is in the report.
        """
        dst_stem.parent.mkdir(parents=True, exist_ok=True)
        webp = dst_stem.with_suffix(".webp")
        a = np.asarray(im)
        vis = a[..., 3] > 0
        for q in (LOSSY["quality"], 95, 98, None):
            if q is None:
                im.save(webp, "WEBP", lossless=True, exact=True, method=self.effort)
            else:
                im.save(webp, "WEBP", **{**LOSSY, "quality": q})
            with Image.open(webp) as wi:
                b = np.asarray(wi.convert("RGBA"))
            alpha_err = int(np.abs(a[..., 3].astype(int) - b[..., 3].astype(int)).max())
            d = (a[..., :3].astype(np.float64) - b[..., :3].astype(np.float64))[vis]
            mse = float((d * d).mean()) if d.size else 0.0
            psnr = 99.0 if mse == 0 else 10 * float(np.log10(255.0 * 255.0 / mse))
            if q is None or (psnr >= MIN_PSNR and alpha_err <= 1):
                break
        rec = {"file": self.rel(webp), "png": png_bytes, "webp": webp.stat().st_size, "quality": q or "lossless",
               "psnr": round(psnr, 2), "alphaErr": alpha_err}
        self.converted.append(rec)
        print(f"  lossy {rec['file']}: {png_bytes} -> {rec['webp']} bytes, q{rec['quality']}, PSNR {rec['psnr']} dB, alpha err {alpha_err}/255")
        return webp

    def flow(self, src: Path, dst: Path) -> Path:
        """Copy a flow.bin, zlib-deflated to <name>.z unless --no-deflate."""
        raw = src.read_bytes()
        if not self.deflate:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(raw)
            return dst
        z = zlib.compress(raw, 9)
        assert zlib.decompress(z) == raw
        dst = dst.with_name(dst.name + ".z")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(z)
        self.flows.append({"file": self.rel(dst), "raw": len(raw), "deflated": len(z)})
        return dst

    # ---- clips
    def clip(self, name: str) -> dict:
        src = self.src / "clips" / f"{name}.mp4"
        digest = hashlib.sha256(src.read_bytes()).hexdigest()
        first = self.seen_clips.get(digest)  # identical bytes under another name (clay and pixar speak = idle1): store once
        stored = first or name
        if not first:
            self.seen_clips[digest] = name
            self.copy(src, self.out / "clips" / f"{name}.mp4")
        tj = json.loads((self.src / "clips" / f"{name}.track.json").read_text())
        with av.open(str(src)) as ct:
            vs = ct.streams.video[0]
            frames = sum(1 for _ in ct.decode(vs))
            fps = float(vs.average_rate)
        if tj["fps"] != fps or tj["frames"] != frames or len(tj["res"]) != frames or len(tj["m"]) != frames:
            raise SystemExit(f"{self.cid}/{name}: track.json disagrees with the video ({tj['fps']}/{tj['frames']} vs {fps}/{frames})")
        side = {"fps": fps, "frames": frames, "res": tj["res"], "m": tj["m"]}
        (self.out / "clips" / f"{name}.track.json").write_text(json.dumps(side, separators=(",", ":")))
        entry = {
            "id": f"{self.cid}-{name}",
            "file": f"clips/{stored}.mp4",
            "fps": fps,
            "frames": frames,
            "rest": {"first": 0, "last": frames - 1},
            "track": tj["res"],
            "trackFile": f"clips/{name}.track.json",
            "encoding": "stacked-alpha-h264",
        }
        if not self.skip_phone:
            if not first:
                self.phone(src, self.out / "clips" / f"{name}.phone.mp4", frames)
            entry["phone"] = f"clips/{stored}.phone.mp4"
        return entry

    def phone(self, src: Path, dst: Path, frames: int) -> None:
        """480x960 stacked clip -> 320x640: scale the colour half and the matte half apart so the seam never bleeds."""
        with av.open(str(src)) as ci, av.open(str(dst), "w") as co:
            vi = ci.streams.video[0]
            rate = Fraction(vi.average_rate).limit_denominator(1000)
            vo = co.add_stream("libx264", rate=rate)
            vo.width, vo.height, vo.pix_fmt = 320, 640, "yuv420p"
            cc = vo.codec_context
            cc.colorspace, cc.color_primaries = vi.codec_context.colorspace, vi.codec_context.color_primaries
            cc.color_trc, cc.color_range = vi.codec_context.color_trc, vi.codec_context.color_range
            cc.options = {"crf": "20", "preset": "slow", "profile": "high", "movflags": "+faststart"}
            vo.time_base = Fraction(1, 12288)
            n = 0
            for fr in ci.decode(vi):
                nf = av.VideoFrame.from_ndarray(self.half_scale(fr.to_ndarray(format="yuv420p")), format="yuv420p")
                nf.pts = n * 12288 // int(rate)
                nf.time_base = vo.time_base
                nf.colorspace, nf.color_range = vi.codec_context.colorspace, vi.codec_context.color_range
                for pkt in vo.encode(nf):
                    co.mux(pkt)
                n += 1
            for pkt in vo.encode():
                co.mux(pkt)
        if n != frames:
            raise SystemExit(f"{dst.name}: wrote {n} frames, expected {frames}")

    @staticmethod
    def half_scale(a: np.ndarray) -> np.ndarray:
        """yuv420p ndarray of a 480x960 frame -> the same for a 320x640 frame; each square half is scaled on its own."""
        w, h = 480, 960
        flat = a[h:].reshape(-1)
        quarter = (h // 2) * (w // 2)
        planes = [(a[:h], 320), (flat[:quarter].reshape(h // 2, w // 2), 160), (flat[quarter:].reshape(h // 2, w // 2), 160)]
        out = []
        for plane, size in planes:
            half = plane.shape[0] // 2
            halves = [Image.fromarray(np.ascontiguousarray(plane[k * half : (k + 1) * half])) for k in (0, 1)]
            out.append(np.concatenate([np.asarray(im.resize((size, size), Image.LANCZOS)) for im in halves]))
        return np.concatenate([out[0], out[1].reshape(-1, 320), out[2].reshape(-1, 320)])

    # ---- the rest of the live set
    def trim_atlas(self, meta: dict, atlas_png: Path) -> Image.Image:
        """Keep the 8 letter tiles and only the t=0.4 and t=0.6 in-between tiles; repack the rows and fix meta (ts, nt)."""
        base, ts, cols, tw, th = meta["base"], meta["ts"], meta["cols"], meta["tw"], meta["th"]
        keep = [ts.index(t) for t in KEEP_T]
        with Image.open(atlas_png) as im:
            im.load()
            old = im.convert("RGBA")
        n_old = base + 64 * len(ts)
        assert old.size == (cols * tw, -(-n_old // cols) * th), f"{atlas_png}: atlas {old.size} does not match meta"
        slots = list(range(base)) + [base + p * len(ts) + k for p in range(64) for k in keep]
        out = Image.new("RGBA", (cols * tw, -(-len(slots) // cols) * th), (0, 0, 0, 0))
        for n, slot in enumerate(slots):
            x, y = (slot % cols) * tw, (slot // cols) * th
            out.paste(old.crop((x, y, x + tw, y + th)), ((n % cols) * tw, (n // cols) * th))
        meta["ts"] = list(KEEP_T)
        if "nt" in meta:
            meta["nt"] = len(KEEP_T)
        self.trimmed.append({"atlas": atlas_png.parent.name, "tilesBefore": n_old, "tilesAfter": len(slots), "keptT": list(KEEP_T)})
        return out

    def mouth_set(self, name: str, folder: str) -> tuple[dict, Path]:
        d, out = self.src / folder, self.out / "mouth" / name
        meta = json.loads((d / "meta.json").read_text())
        trim = self.trim and name == "shout"
        atlas = None
        if trim:
            atlas = self.trim_atlas(meta, d / "atlas.png")
        out.mkdir(parents=True, exist_ok=True)
        (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
        for png in sorted(d.glob("*.png")):
            if png.stem == "atlas":
                if atlas is not None and self.lossy:
                    self.save_lossy(atlas, out / "atlas", png.stat().st_size)
                elif atlas is not None:
                    atlas.save(out / "atlas.webp", "WEBP", lossless=True, exact=True, method=self.effort)
                else:
                    self.picture(png, out / "atlas", lossy=True)
            else:
                self.picture(png, out / png.stem)
        if (d / "flow.bin").exists():
            self.flow(d / "flow.bin", out / "flow.bin")
        self.check_atlas(meta, out)
        return meta, out

    def check_atlas(self, meta: dict, out: Path) -> None:
        """meta.json (tw, th, cols, base, ts) must agree with the atlas picture: width = cols*tw, rows = ceil(tiles / cols)."""
        with Image.open(out / "atlas.webp") as im:
            w, h = im.size
        tiles = meta["base"] + 64 * len(meta["ts"])
        want = (meta["cols"] * meta["tw"], -(-tiles // meta["cols"]) * meta["th"])
        if (w, h) != want or ("nt" in meta and meta["nt"] != len(meta["ts"])):
            raise SystemExit(f"{out}: atlas is {w}x{h} but meta.json says {want} (ts {meta['ts']}); fix the atlas or the meta.")

    def mouth(self, cfg: dict, pos: dict) -> dict:
        warp_calm, warp_wide = cfg.get("warp"), cfg.get("warpWide")
        shout = warp_wide or cfg.get("morphDirLoud")
        self.mouth_set("calm", warp_calm or cfg["morphDir"])
        if shout:
            self.mouth_set("shout", shout)
        letters = {k: i for i, k in enumerate(LETTERS)} | {"wide": len(LETTERS)}
        m = {"letters": letters, "anchor": pos["mouthAnchor"], "calm": {"dir": "mouth/calm"}}
        if shout:
            m["shout"] = {"dir": "mouth/shout"}
        if warp_calm:  # the warp sets carry flow, weight, samples and rest next to the atlas; the cartoon sets bake in-betweens into it
            m["warp"] = True
        m["flowEncoding"] = ENCODING if self.deflate else "int16"
        return m

    def head(self, folder: str) -> dict:
        d, out = self.src / folder, self.out / "head"
        self.copy(d / "meta.json", out / "meta.json")
        self.flow(d / "flow.bin", out / "flow.bin")
        self.picture(d / "weight.png", out / "weight")
        return {"dir": "head", "flowEncoding": ENCODING if self.deflate else "int16"}

    def eyes(self) -> dict:
        d, out = self.src / "eyes", self.out / "eyes"
        self.copy(d / "meta.json", out / "meta.json")
        for n in ("closed", "half", "ref", "ring"):
            self.picture(d / f"{n}.png", out / n)
        return {"dir": "eyes"}

    def emotion(self) -> dict:
        d, out = self.src / "emotion", self.out / "emotion"
        meta = json.loads((d / "meta.json").read_text())
        for k in meta["kinds"].values():  # the page never reads these, and they point into the demo's source folders
            k.pop("pic", None)
            k.pop("src", None)
        out.mkdir(parents=True, exist_ok=True)
        (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
        for kind in meta["kinds"]:
            self.flow(d / kind / "flow.bin", out / f"{kind}.flow.bin")
            self.picture(d / kind / "patch.png", out / kind, lossy=True)
        return {"dir": "emotion", "kinds": list(meta["kinds"]), "flowEncoding": ENCODING if self.deflate else "int16"}

    def build(self) -> dict:
        chars = json.loads((self.root / "characters.json").read_text())["chars"][self.cid]
        pos = json.loads((self.root / "chars.json").read_text())[self.cid]
        if self.out.exists():
            shutil.rmtree(self.out)
        self.out.mkdir(parents=True)
        names = json.loads((self.src / "clips" / "manifest.json").read_text())["clips"]
        states = {s: [self.clip(n) for n in ns if n in names] for s, ns in STATE_CLIPS.items()}
        mouth = self.mouth(chars, pos)
        head = self.head(chars["head"])
        eyes = self.eyes()
        emotion = self.emotion()
        rest = self.rel(self.picture(self.src / "rest-keyed.png", self.out / "rest"))
        fx = chars.get("fx", {})
        pack = {
            "version": 1,
            "id": self.cid,
            "name": NAMES[self.cid],
            "tile": {"desktop": 480, "phone": 320},
            "states": states,
            "mouth": mouth,
            "head": head,
            "eyes": eyes,
            "emotion": emotion,
            "rest": rest,
            "life": {k: float(fx.get(k, 1.0)) for k in LIFE_KEYS},
            "budget": {"bytes": 0},
            "provenance": {
                "maker": "MaiPai",
                "makerVersion": MAKER_VERSION,
                "source": SOURCE[self.cid],
                "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        }
        pack_json = self.out / "pack.json"
        pack_json.write_text(json.dumps(pack, indent=1))
        files = [f for f in self.out.rglob("*") if f.is_file() and f.name != "pack.json"]
        phone = sum(f.stat().st_size for f in files if ".phone." in f.name)
        desktop = sum(f.stat().st_size for f in files if ".phone." not in f.name and f.name != "build-report.json")
        pack["budget"] = {"bytes": min(BUDGET, -(-(desktop + 16384) // 1024) * 1024), "phoneBytes": phone}
        pack_json.write_text(json.dumps(pack, indent=1))
        desktop += pack_json.stat().st_size
        report = {"desktopBytes": desktop, "phoneBytes": phone, "lossy": self.lossy, "deflate": self.deflate,
                  "converted": self.converted, "flows": self.flows, "trimmedShoutAtlas": self.trimmed}
        (self.out / "build-report.json").write_text(json.dumps(report, indent=1))
        print(f"{self.cid}: desktop tier {desktop} bytes (budget {BUDGET}), phone twins {phone} bytes -> {self.out}")
        self.desktop = desktop
        return pack


def main() -> None:
    main_dir = main_checkout()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("id", choices=sorted(NAMES))
    ap.add_argument("--src", type=Path, default=main_dir / "data-scratch/poc-companions/assets")
    ap.add_argument("--out", type=Path, default=main_dir / "data-scratch/packs")
    ap.add_argument("--webp-effort", type=int, default=6, help="lossless WebP method 0 to 6 (6 is smallest and slowest)")
    ap.add_argument("--skip-phone", action="store_true", help="do not write the 320x640 phone clips")
    ap.add_argument("--no-lossy", dest="lossy", action="store_false", help="cut (a) off: keep the mouth atlases and emotion pictures lossless")
    ap.add_argument("--no-deflate", dest="deflate", action="store_false", help="cut (b) off: store flow.bin raw")
    ap.add_argument("--trim", choices=["auto", "always", "never"], default="auto", help="cut (c): trim the shout atlas (auto: only if over budget)")
    a = ap.parse_args()
    b = Builder(a.id, a.src, a.out, a, trim=a.trim == "always")
    b.build()
    if a.trim == "auto" and b.desktop > BUDGET:
        print(f"{a.id}: over budget; rebuilding with the shout atlas trimmed to letters plus t={KEEP_T}")
        b = Builder(a.id, a.src, a.out, a, trim=True)
        b.build()


if __name__ == "__main__":
    sys.exit(main())
