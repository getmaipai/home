#!/usr/bin/env bash
# STYLE-TRAIN-01 (docs/BACKLOG.md, docs/plans/style-train-01-2026-09-29.md):
# trains one LoRA adapter for one companion from that companion's own
# corpus.jsonl (backend/scripts/voice/corpus.ts's output), then converts
# it to GGUF so the pinned llama-server build can load it with --lora.
#
# Usage, from anywhere (paths are resolved relative to this script):
#   backend/scripts/voice/train.sh <companion> [--convert-only|--train-only]
#
# <companion> is one of: pal, tutor, buddy, default - run in that order
# (docs/dev.md "Training (STYLE-TRAIN-01)": Pal first, the strongest
# lexical markers and the hardest case, then Tutor, then Buddy, then
# default).
#
# Requires (see train.md for the full setup):
#   - a Python venv with torch/transformers/peft/trl/bitsandbytes/
#     datasets installed (STYLE_TRAIN_VENV, default ~/style-train-venv)
#   - the real corpus at data-scratch/voice/<companion>/corpus.jsonl
#     (backend/scripts/voice/corpus.ts)
#   - a local clone of ggml-org/llama.cpp at the pinned tag, for
#     convert_lora_to_gguf.py (STYLE_TRAIN_LLAMACPP, default
#     ~/scratch/llama.cpp-b10797) - see train.md for how to get it;
#     never vendored into this repo (org rule: download, don't vendor)
#
# Env overrides (all optional, defaults match the row's own parameters):
#   STYLE_TRAIN_VENV        default: $HOME/style-train-venv
#   STYLE_TRAIN_LLAMACPP    default: $HOME/scratch/llama.cpp-b10797
#   STYLE_TRAIN_GPU         default: 0 (torch's own CUDA device index,
#                           not necessarily nvidia-smi's PCI-bus order -
#                           check nvidia-smi AND `python -c "import
#                           torch; print(torch.cuda.get_device_
#                           capability(0), torch.cuda.get_device_
#                           capability(1))"` if the two disagree on
#                           which physical card is idle; the review
#                           finding this fixes: with no override, a run
#                           OOMs on an occupied card 0 even when card 1
#                           is free)
#   STYLE_TRAIN_BASE_MODEL  default: Qwen/Qwen3-8B (the row's own pin -
#                           never override this one without updating the
#                           row and this comment together)
#   STYLE_TRAIN_SEED        default: 42
#   STYLE_TRAIN_EPOCHS      default: 3
#   STYLE_TRAIN_MAX_LENGTH  default: 1024
#   STYLE_TRAIN_LORA_R      default: 16
#   STYLE_TRAIN_LORA_ALPHA  default: 32
#   STYLE_TRAIN_GGUF_OUTTYPE default: f16 (LoRA deltas are small; f16
#                           keeps them lossless relative to the training
#                           dtype without the size of f32 - llama.cpp's
#                           own convert_lora_to_gguf.py --outtype default
#                           is f32, chosen here as the documented
#                           lower-size alternative, see train.md)
#
# Output: data-scratch/voice/adapters/<companion>/adapter/ (the PEFT
# adapter: adapter_config.json, adapter_model.safetensors,
# train_metrics.json) and data-scratch/voice/adapters/
# <companion>-qwen3-8b-instruct-q4-k-m.gguf (the row's own naming) plus
# its sha256 sidecar file. All git-ignored (data-scratch/); only the
# sha256, size, final loss and wall time go in dev.md, never the files
# themselves (org rule: large artifacts ship as release assets, never
# tracked files).

set -euo pipefail

usage() {
  echo "usage: $0 <pal|tutor|buddy|default> [--train-only|--convert-only]" >&2
  exit 1
}

[ $# -ge 1 ] || usage
COMPANION="$1"
MODE="${2:-all}"
case "$COMPANION" in
  pal | tutor | buddy | default) ;;
  *) usage ;;
esac
case "$MODE" in
  all | --train-only | --convert-only) ;;
  *) usage ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

CORPUS="$REPO_ROOT/data-scratch/voice/$COMPANION/corpus.jsonl"
ADAPTERS_DIR="$REPO_ROOT/data-scratch/voice/adapters"
OUT_DIR="$ADAPTERS_DIR/$COMPANION"
ADAPTER_DIR="$OUT_DIR/adapter"
GGUF_OUT="$ADAPTERS_DIR/$COMPANION-qwen3-8b-instruct-q4-k-m.gguf"

VENV="${STYLE_TRAIN_VENV:-$HOME/style-train-venv}"
LLAMACPP_DIR="${STYLE_TRAIN_LLAMACPP:-$HOME/scratch/llama.cpp-b10797}"
BASE_MODEL="${STYLE_TRAIN_BASE_MODEL:-Qwen/Qwen3-8B}"
SEED="${STYLE_TRAIN_SEED:-42}"
EPOCHS="${STYLE_TRAIN_EPOCHS:-3}"
MAX_LENGTH="${STYLE_TRAIN_MAX_LENGTH:-1024}"
LORA_R="${STYLE_TRAIN_LORA_R:-16}"
LORA_ALPHA="${STYLE_TRAIN_LORA_ALPHA:-32}"
GGUF_OUTTYPE="${STYLE_TRAIN_GGUF_OUTTYPE:-f16}"
GPU="${STYLE_TRAIN_GPU:-0}"

[ -f "$VENV/bin/activate" ] || {
  echo "missing venv: $VENV (see train.md \"Setup\" for how to build it)" >&2
  exit 1
}
# shellcheck source=/dev/null
source "$VENV/bin/activate"

if [ "$MODE" != "--convert-only" ]; then
  [ -f "$CORPUS" ] || {
    echo "missing corpus: $CORPUS (run backend/scripts/voice/corpus.ts first, see train.md)" >&2
    exit 1
  }
  mkdir -p "$OUT_DIR"

  echo "[$COMPANION] training: base=$BASE_MODEL corpus=$CORPUS epochs=$EPOCHS max_length=$MAX_LENGTH lora_r=$LORA_R lora_alpha=$LORA_ALPHA seed=$SEED gpu=$GPU"

  MAIPAI_STYLE_COMPANION="$COMPANION" \
    MAIPAI_STYLE_CORPUS="$CORPUS" \
    MAIPAI_STYLE_OUT_DIR="$OUT_DIR" \
    MAIPAI_STYLE_ADAPTER_DIR="$ADAPTER_DIR" \
    MAIPAI_STYLE_BASE_MODEL="$BASE_MODEL" \
    MAIPAI_STYLE_SEED="$SEED" \
    MAIPAI_STYLE_GPU="$GPU" \
    MAIPAI_STYLE_EPOCHS="$EPOCHS" \
    MAIPAI_STYLE_MAX_LENGTH="$MAX_LENGTH" \
    MAIPAI_STYLE_LORA_R="$LORA_R" \
    MAIPAI_STYLE_LORA_ALPHA="$LORA_ALPHA" \
    python3 - <<'PYEOF'
import json
import os
import random
import time

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

companion = os.environ["MAIPAI_STYLE_COMPANION"]
corpus_path = os.environ["MAIPAI_STYLE_CORPUS"]
out_dir = os.environ["MAIPAI_STYLE_OUT_DIR"]
adapter_dir = os.environ["MAIPAI_STYLE_ADAPTER_DIR"]
base_model = os.environ["MAIPAI_STYLE_BASE_MODEL"]
seed = int(os.environ["MAIPAI_STYLE_SEED"])
epochs = int(os.environ["MAIPAI_STYLE_EPOCHS"])
max_length = int(os.environ["MAIPAI_STYLE_MAX_LENGTH"])
lora_r = int(os.environ["MAIPAI_STYLE_LORA_R"])
lora_alpha = int(os.environ["MAIPAI_STYLE_LORA_ALPHA"])
gpu = int(os.environ["MAIPAI_STYLE_GPU"])

random.seed(seed)
torch.manual_seed(seed)

# ── Load the corpus (backend/scripts/voice/corpus.ts's row shape:
# id, companion, class, shape, kind, system_prompt, prompt, neutral,
# rewrite - system_prompt only on voice rows; a tool row (class="tool")
# has none, because corpus.ts's own tool-call collection (run(), the
# toolRows loop) calls complete() with a bare [{role:"user",...}] and no
# system message at all - reproduced here exactly, not a fallback, so
# training matches what actually produced the row) ────────────────────
rows = []
with open(corpus_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
if not rows:
    raise SystemExit(f"empty corpus: {corpus_path}")


def tool_call_wire(call: dict, index: int) -> dict:
    # Matches ToolCallWire (backend/src/lib/llm.ts, @maipai/spec/llm/ts/
    # types.js): {id, type: "function", function: {name, arguments}},
    # the same shape llm.ts's toolCallFromWire() reads from the real
    # engine - arguments is a JSON *string*, not a nested object.
    return {
        "id": f"call_{index}",
        "type": "function",
        "function": {
            "name": call["tool"],
            "arguments": json.dumps(call.get("args") if call.get("args") is not None else {}),
        },
    }


def to_example(row: dict) -> dict:
    prompt_messages = []
    system_prompt = row.get("system_prompt")
    if system_prompt:
        prompt_messages.append({"role": "system", "content": system_prompt})
    prompt_messages.append({"role": "user", "content": row["prompt"]})

    assistant_message: dict = {"role": "assistant", "content": row["rewrite"]}
    tool_calls = row.get("tool_calls")
    if tool_calls:
        assistant_message["tool_calls"] = [tool_call_wire(c, i) for i, c in enumerate(tool_calls)]

    return {"prompt": prompt_messages, "completion": [assistant_message]}


dataset = Dataset.from_list([to_example(r) for r in rows])
class_counts: dict[str, int] = {}
for r in rows:
    key = f"{r['class']}:{r['shape']}"
    class_counts[key] = class_counts.get(key, 0) + 1
print(f"[{companion}] {len(dataset)} training rows loaded from {corpus_path}")
print(f"[{companion}] rows by class:shape: {json.dumps(class_counts, sort_keys=True)}")

# ── Base model, 4-bit (QLoRA: Dettmers et al. 2023, "QLoRA: Efficient
# Finetuning of Quantized LLMs", https://arxiv.org/abs/2305.14314 - nf4
# + double quant + bf16 compute is that paper's own recipe, verified
# against peft/transformers' own BitsAndBytesConfig docstrings on this
# machine, 2026-09-29) ──────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained(base_model)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    base_model,
    quantization_config=bnb_config,
    device_map={"": gpu},
    torch_dtype=torch.bfloat16,
)
model.config.use_cache = False

# q_proj/k_proj/v_proj/o_proj verified against the installed
# transformers' Qwen3Attention (modeling_qwen3.py) on this machine,
# 2026-09-29 - "attention projections only", per the row.
lora_config = LoraConfig(
    r=lora_r,
    lora_alpha=lora_alpha,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

# completion_only_loss auto-enables because the dataset has "prompt"
# and "completion" columns (trl.trainer.sft_trainer.SFTTrainer.__init__,
# verified in the installed source on this machine, 2026-09-29) - the
# loss is masked to the rewrite only, never the system/user prompt.
#
# warmup_steps, not warmup_ratio: this machine's installed transformers
# (5.17.0) dropped TrainingArguments.warmup_ratio - verified against the
# installed source, 2026-09-29 (`inspect.signature(TrainingArguments
# .__init__)` has warmup_steps only) - so the 3% warmup the row's own
# QLoRA recipe calls for is computed by hand from the real step count.
per_device_batch_size = 1
grad_accum_steps = 8
steps_per_epoch = max(1, -(-len(dataset) // (per_device_batch_size * grad_accum_steps)))
total_steps = steps_per_epoch * epochs
warmup_steps = max(1, round(total_steps * 0.03))
print(f"[{companion}] steps_per_epoch={steps_per_epoch} total_steps={total_steps} warmup_steps={warmup_steps}")

sft_config = SFTConfig(
    output_dir=os.path.join(out_dir, "checkpoints"),
    num_train_epochs=epochs,
    max_length=max_length,
    packing=False,
    per_device_train_batch_size=per_device_batch_size,
    gradient_accumulation_steps=grad_accum_steps,
    gradient_checkpointing=True,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_steps=warmup_steps,
    logging_steps=10,
    save_strategy="no",
    bf16=True,
    seed=seed,
    report_to=[],
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    train_dataset=dataset,
    processing_class=tokenizer,
    peft_config=lora_config,
)

start = time.time()
train_result = trainer.train()
wall_seconds = time.time() - start
metrics = dict(train_result.metrics)
metrics["wall_seconds"] = wall_seconds
metrics["row_count"] = len(dataset)
metrics["class_shape_counts"] = class_counts
print(f"[{companion}] final training loss: {metrics.get('train_loss')}, wall_seconds={wall_seconds:.1f}")

trainer.save_model(adapter_dir)
tokenizer.save_pretrained(adapter_dir)

with open(os.path.join(out_dir, "train_metrics.json"), "w") as f:
    json.dump(metrics, f, indent=2)

print(f"[{companion}] adapter saved to {adapter_dir}")
PYEOF
fi

if [ "$MODE" != "--train-only" ]; then
  [ -d "$ADAPTER_DIR" ] || {
    echo "missing adapter: $ADAPTER_DIR (run without --convert-only first)" >&2
    exit 1
  }
  CONVERTER="$LLAMACPP_DIR/convert_lora_to_gguf.py"
  [ -f "$CONVERTER" ] || {
    echo "missing $CONVERTER (see train.md \"Setup\" for the pinned llama.cpp checkout)" >&2
    exit 1
  }

  echo "[$COMPANION] converting $ADAPTER_DIR -> $GGUF_OUT (outtype=$GGUF_OUTTYPE)"
  python3 "$CONVERTER" "$ADAPTER_DIR" --outfile "$GGUF_OUT" --outtype "$GGUF_OUTTYPE"

  SHA256_OUT="$GGUF_OUT.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$GGUF_OUT" >"$SHA256_OUT"
  else
    shasum -a 256 "$GGUF_OUT" >"$SHA256_OUT"
  fi
  echo "[$COMPANION] gguf: $GGUF_OUT"
  echo "[$COMPANION] sha256: $(cat "$SHA256_OUT")"
  echo "[$COMPANION] size: $(du -h "$GGUF_OUT" | cut -f1)"
fi

echo "[$COMPANION] done ($MODE)"
