# Minimal MLX port of the TAEHV decoder (taew2_1 / taew2_2, non-super and super), for the bench only. NHWC, parallel over time.
import zipfile, pickle, io, numpy as np, mlx.core as mx, mlx.nn as nn, time

def load_pth(path):
    z = zipfile.ZipFile(path); names = z.namelist()
    pkl = [n for n in names if n.endswith("data.pkl")][0]; root = pkl[:-len("data.pkl")]
    class Storage:
        def __init__(s, dtype): s.dtype = dtype
    def rebuild(storage, offset, size, stride, *a):
        arr = storage; size = tuple(size); stride = tuple(stride)
        return np.lib.stride_tricks.as_strided(arr[offset:], shape=size, strides=[x * arr.itemsize for x in stride]).copy()
    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if name == "_rebuild_tensor_v2": return rebuild
            if name == "OrderedDict": import collections; return collections.OrderedDict
            if name.endswith("Storage"): return {"FloatStorage": np.float32, "HalfStorage": np.float16}[name]
            return super().find_class(mod, name)
        def persistent_load(self, pid):
            _, dt, key, loc, n = pid
            return np.frombuffer(z.read(f"{root}data/{key}"), dtype=dt)
    return U(io.BytesIO(z.read(pkl))).load()

def conv_w(w): return mx.array(np.transpose(w, (0, 2, 3, 1)))

class TAE:
    """Decoder only. arch: 'taew2_2' | 'taew2_1' (16ch, patch 1) | with super flag."""
    def __init__(self, path, latent_channels, patch, sup=False, dtype=mx.float16):
        sd = load_pth(path); self.sd = {k: v for k, v in sd.items() if k.startswith("decoder.")}
        self.patch, self.sup, self.dtype = patch, sup, dtype
        self.layers = []
        # structure from taehv.py
        if sup:
            nf = [512, 256, 128, 64]
            seq = [("c1", 0), ("sm", 1), ("sm", 2), ("sm", 3), ("conv", 4), ("relu", 5), ("ps", 6), ("tg", 7),
                   ("sm", 8), ("sm", 9), ("sm", 10), ("conv", 11), ("relu", 12), ("ps", 13), ("tg", 14),
                   ("sm", 15), ("sm", 16), ("sm", 17), ("conv", 18), ("relu", 19), ("ps", 20), ("tg", 21), ("conv", 22)]
            self.tg_strides = {7: 1, 14: 2, 21: 2}
        else:
            seq = [("clamp", 0), ("conv", 1), ("relu", 2), ("mem", 3), ("mem", 4), ("mem", 5), ("up", 6), ("tg", 7), ("conv", 8),
                   ("mem", 9), ("mem", 10), ("mem", 11), ("up", 12), ("tg", 13), ("conv", 14),
                   ("mem", 15), ("mem", 16), ("mem", 17), ("up", 18), ("tg", 19), ("conv", 20), ("relu", 21), ("conv", 22)]
            self.tg_strides = {7: 1, 13: 2, 19: 2}
        self.seq = seq; self.W = {}
        for k, v in self.sd.items():
            a = v.astype(np.float32)
            self.W[k] = mx.array(a if a.ndim < 4 else np.transpose(a, (0, 2, 3, 1))).astype(dtype)
        for i, s in self.tg_strides.items():
            w = self.W[f"decoder.{i}.conv.weight"]; cin = w.shape[3]; need = cin * s
            if w.shape[0] > need: self.W[f"decoder.{i}.conv.weight"] = w[-need:]
        self.t_up = 2 ** sum(1 for s in self.tg_strides.values() if s == 2)
    def conv(self, i, x, k=None, pad=1, groups=1, name=None):
        base = name or f"decoder.{i}"
        y = mx.conv2d(x, self.W[base + ".weight"], padding=pad, groups=groups)
        b = self.W.get(base + ".bias")
        return y + b if b is not None else y
    def past(self, x): return mx.concatenate([mx.zeros_like(x[:1]), x[:-1]], axis=0)
    def decode(self, z):
        """z: [T,H,W,C] normalized latents (what the diffusion model emits). Returns [T',H',W',3] in 0..1."""
        x = z.astype(self.dtype)
        for kind, i in self.seq:
            p = f"decoder.{i}"
            if kind == "clamp": x = mx.tanh(x / 3) * 3
            elif kind == "c1": x = self.conv(i, x, pad=0)
            elif kind == "conv": x = self.conv(i, x)
            elif kind == "relu": x = nn.relu(x)
            elif kind == "mem":
                c = mx.concatenate([x, self.past(x)], axis=-1)
                h = nn.relu(self.conv(None, c, name=p + ".conv.0")); h = nn.relu(self.conv(None, h, name=p + ".conv.2")); h = self.conv(None, h, name=p + ".conv.4")
                skip = self.conv(None, x, pad=0, name=p + ".skip") if (p + ".skip.weight") in self.W else x
                x = nn.relu(h + skip)
            elif kind == "sm":
                c = mx.concatenate([x, self.past(x)], axis=-1)
                h = mx.conv2d(c, self.W[p + ".conv.0.weight"], padding=3, groups=c.shape[-1])
                h = nn.relu(self.conv(None, h, pad=0, name=p + ".conv.1")); h = mx.conv2d(h, self.W[p + ".conv.3.weight"], padding=0)
                x = h + x
            elif kind == "up":
                x = mx.repeat(mx.repeat(x, 2, axis=1), 2, axis=2)
            elif kind == "ps":
                T, H, W, C = x.shape; x = x.reshape(T, H, W, C // 4, 2, 2).transpose(0, 1, 4, 2, 5, 3).reshape(T, H * 2, W * 2, C // 4)
            elif kind == "tg":
                s = self.tg_strides[i]; T, H, W, C = x.shape
                y = mx.conv2d(x, self.W[p + ".conv.weight"], padding=0)
                x = y.reshape(T, H, W, s, C).transpose(0, 3, 1, 2, 4).reshape(T * s, H, W, C)
        if self.patch > 1:
            T, H, W, C = x.shape; q = self.patch; x = x.reshape(T, H, W, C // (q * q), q, q).transpose(0, 1, 4, 2, 5, 3).reshape(T, H * q, W * q, C // (q * q))
        x = mx.clip(x.astype(mx.float32), 0, 1)
        return x[self.t_up - 1:]
