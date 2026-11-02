import sys, os, json, mlx.core as mx
src, dst, bits = sys.argv[1], sys.argv[2], int(sys.argv[3]); os.makedirs(dst, exist_ok=True)
w = mx.load(f"{src}/model.safetensors"); out = {}
pats = (".self_attn.q", ".self_attn.k", ".self_attn.v", ".self_attn.o", ".cross_attn.q", ".cross_attn.k", ".cross_attn.v", ".cross_attn.o", ".ffn.fc1", ".ffn.fc2")
for k, v in w.items():
    if k.endswith(".weight") and any(k[:-7].endswith(p) for p in pats):
        q, sc, bi = mx.quantize(v, group_size=64, bits=bits); b = k[:-7]; out[b + ".weight"], out[b + ".scales"], out[b + ".biases"] = q, sc, bi
    else: out[k] = v
mx.save_safetensors(f"{dst}/model.safetensors", out)
c = json.load(open(f"{src}/config.json")); c["quantization"] = {"group_size": 64, "bits": bits}; json.dump(c, open(f"{dst}/config.json", "w"))
for f in ("t5_encoder.safetensors", "vae.safetensors"):
    if not os.path.exists(f"{dst}/{f}"): os.symlink(f"/usr/local/maipai-home/stack/data/models/fastwan2-2-ti2v-5b-mlx-bf16/FastWan2.2-TI2V-5B-MLX/{f}", f"{dst}/{f}")
print("ok", dst, len(out))
