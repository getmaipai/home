# STYLE-TRAIN-01: training and converting the companion voice adapters

## Why

`backend/scripts/voice/corpus.ts` (STYLE-CORPUS-01b, STYLE-CORPUS-02)
produces one JSONL per companion of (system prompt, user prompt,
companion-voice rewrite) rows. This runbook turns that corpus into a
LoRA adapter per companion and converts it to GGUF, so the pinned
llama-server build can load it with `--lora`. Everything here is a
one-time developer operation, never runtime code and never run in a
household turn.

Read `docs/BACKLOG.md`'s `STYLE-TRAIN-01` row and
`docs/dev.md`'s "Training (STYLE-TRAIN-01)" section first - they name
the parameters this runbook implements (rank 16, alpha 32, attention
projections only, three epochs, sequence length 1024, 4-bit base,
`Qwen/Qwen3-8B`, the pinned llama.cpp tag, the `pal, tutor, buddy,
default` order) and the reasoning behind them (VOICE-CLASS-01's
class-aware corpus, why a document-shaped row's body trains at near-zero
loss by design).

## Hardware

Runs on the tier-2 bench laptop (Linux, CUDA, two 8 GB cards - one
internal, one external over Thunderbolt) or the Studio once pinned, per
`docs/plans/hardware-tiers-2026-09-23.md`. A 4-bit QLoRA fine-tune of an
8B model at rank 16 fits one 8 GB card with room to spare when that card
is otherwise idle. It does **not** fit when the card is already serving
another resident model - check `nvidia-smi` before starting a real
training run, not just before the first one, since another household
engine (chat, embed, judge) can be resident on the same card between
runs.

## Setup

Everything below is user-level. No system package (`apt`) was needed in
the end - see "The `python3.12-dev` finding" below for why an earlier
attempt looked like it would need one.

1. **A standalone Python with headers**, via [uv](https://docs.astral.sh/uv/)
   (Apache-2.0/MIT, downloaded and run per-machine, never vendored):

   ```sh
   curl -LsSf https://astral.sh/uv/install.sh | sh
   source "$HOME/.local/bin/env"
   uv python install 3.12
   ```

2. **The training venv**, built on that Python (not the OS's `/usr/bin/python3.12`
   - see the finding below):

   ```sh
   uv venv --python 3.12 ~/style-train-venv
   source ~/style-train-venv/bin/activate
   uv pip install torch numpy transformers accelerate peft trl bitsandbytes datasets sentencepiece protobuf
   ```

   Verified on the bench laptop, 2026-09-29: `torch==2.14.0+cu130`
   (`torch.cuda.is_available()` True, both cards visible, driver CUDA
   13.0), `transformers==5.17.0`, `accelerate==1.15.0`, `peft==0.21.1`,
   `trl==1.14.0`, `bitsandbytes==0.50.2`, `datasets==5.0.1`. Package
   versions move; if a newer install prints different ones, that's
   fine - the API surfaces this script calls (`SFTConfig`'s
   `max_length`/`packing`/`completion_only_loss`, `SFTTrainer`'s
   `processing_class`/`peft_config` constructor args, `LoraConfig`,
   `BitsAndBytesConfig`) are all checked directly against `trl`'s and
   `peft`'s own installed source before this script relies on them, not
   assumed from documentation or memory - if a version bump changes one
   of those names, `train.sh` fails loudly at that line, not silently.

3. **The `Qwen/Qwen3-8B` base weights** (the checkpoint the pinned GGUF
   was quantized from - never a different Qwen3-8B variant):

   ```sh
   export HF_HOME=/data/models/hf-cache   # or wherever this machine keeps large model files
   hf download Qwen/Qwen3-8B
   ```

   16 GB, public, no token needed. `train.sh` calls
   `AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-8B", ...)`, which
   resolves from this cache automatically once downloaded (respects
   `HF_HOME`) - set the same `HF_HOME` before running `train.sh`.

4. **A local `ggml-org/llama.cpp` checkout at the pinned tag**, for
   `convert_lora_to_gguf.py` (never vendored into this repo - org rule,
   "download, don't vendor" - this is exactly the release binary's own
   source tag, fetched the same way the binary itself was):

   ```sh
   git clone --depth 1 --branch b10797 https://github.com/ggml-org/llama.cpp ~/scratch/llama.cpp-b10797
   ```

   Confirmed the clone's `HEAD` (`832fd6f17`) matches the commit the
   pinned `llama-server --version` on this machine already reports
   (`build 10797, commit 832fd6f17`) - same build, source form.

   `convert_lora_to_gguf.py` imports its own `conversion` package and
   `gguf-py` from the same checkout (`sys.path.insert` at the top of
   the script), so the full clone is required, not just the one file.
   Its own dependency pins
   (`requirements/requirements-convert_lora_to_gguf.txt`, chained to
   `requirements-convert_hf_to_gguf.txt` and
   `requirements-convert_legacy_llama.txt`) pin `torch==2.11.0` (CPU
   wheel) and `numpy~=1.26.4` - **do not `pip install -r` that file
   into the training venv**, it would downgrade the CUDA `torch` build
   training depends on. `train.sh` instead reuses the training venv's
   already-installed `torch`/`numpy`/`transformers` for the conversion
   step too; this was verified to work against the newer versions
   above (the strict pins in llama.cpp's requirements files are for
   its general-purpose `convert_hf_to_gguf.py`, which covers dozens of
   architectures - `convert_lora_to_gguf.py`'s own actual imports are
   narrower: `torch`, `transformers.AutoConfig`/`AutoTokenizer`, and
   the local `gguf` package).

### The `python3.12-dev` finding (2026-09-29)

The bench laptop's Python ML stack did not exist at all before this
item - no `pip`, no `uv`, no venv anywhere in `$PATH` (confirmed via
`ssh` before writing a line of this script). `python3 -m ensurepip` and
`python3 -m venv` both worked, so the first attempt built the venv on
the OS's own `/usr/bin/python3.12` and installed the stack via `pip`
(`torch==2.14.0+cu130`, CUDA available, both cards visible - this part
worked fine).

Training itself never got the chance to prove that setup broken: even
a tiny CPU-only smoke test (`SFTTrainer.train()` on a 2-layer random
Qwen3 config, no real training) failed - `trl`'s chunked
cross-entropy path reaches for a Triton-compiled CUDA kernel whenever
CUDA is visible on the machine, regardless of the model's own device,
and Triton's JIT needs `gcc` to compile a small driver extension against
`Python.h`. The OS's `/usr/bin/python3.12` has no `Python.h` -
`python3.12-dev` is not installed, and installing it needs
`sudo apt install python3.12-dev`, outside this item's four pre-granted
NOPASSWD commands. Per the row's own instruction ("if it needs anything
beyond user-level pip/uv... stop and ask"), this looked like a stop-and-ask
system-package need at first - but a genuinely user-level fix existed:
`uv python install` downloads a self-contained `python-build-standalone`
CPython that **includes** `Python.h` (confirmed:
`~/.local/share/uv/python/cpython-3.12.14-linux-x86_64-gnu/include/python3.12/Python.h`
exists after `uv python install 3.12`, no `apt`, no `sudo`, nothing
outside `$HOME`). Rebuilding the venv on that Python instead of
`/usr/bin/python3.12` (step 2 above) fixed the smoke test with no system
package touched. This is why "Setup" above uses `uv`'s own Python, not
`python3 -m venv` against the OS interpreter, even though the latter
also technically works right up until the first real training step.

## Training

```sh
export HF_HOME=/data/models/hf-cache   # match step 3 above
backend/scripts/voice/train.sh pal
backend/scripts/voice/train.sh tutor
backend/scripts/voice/train.sh buddy
backend/scripts/voice/train.sh default
```

Order matters (`docs/dev.md`): Pal first (the strongest lexical
markers, the hardest case), then Tutor (the formality case), then
Buddy, then default.

Each invocation trains and converts one companion's adapter
end-to-end. `train.sh <companion> --train-only` or
`train.sh <companion> --convert-only` split the two steps (useful if
the corpus for one companion isn't ready yet, or to re-run just the
conversion after tweaking `--outtype`).

`STYLE_TRAIN_GPU` (default `0`) picks which of the two cards to train
on - torch's own CUDA device index, which is not necessarily
`nvidia-smi`'s PCI-bus order (found live, 2026-09-29: `nvidia-smi`'s
index 0 was the internal Turing card, but torch's own `cuda:0` was the
external Ampere one - both were idle by the time training ran, so it
never mattered in practice, but check both `nvidia-smi` and
`python -c "import torch; print(torch.cuda.get_device_capability(0),
torch.cuda.get_device_capability(1))"` before assuming which is which
if only one card is free). Every card check in "Hardware" above is
still required before starting - this only controls which free card
gets used, it doesn't wait for one to free up.

**Parameters, and where each one comes from:**

| Parameter | Value | Source |
|---|---|---|
| Base model | `Qwen/Qwen3-8B` | the row (`docs/BACKLOG.md`) - the checkpoint the pinned GGUF was quantized from |
| Quantization | 4-bit, `nf4`, double quant, bf16 compute | QLoRA (Dettmers et al. 2023, arxiv.org/abs/2305.14314) - the paper's own recipe, and `peft`/`transformers`' `BitsAndBytesConfig` docstring, checked against the installed source on this machine |
| LoRA rank / alpha | 16 / 32 | the row |
| LoRA target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj` (attention projections only) | the row ("attention projections only"); module names verified against the installed `transformers`' `Qwen3Attention` (`modeling_qwen3.py`) on this machine, 2026-09-29 |
| Epochs | 3 | the row |
| Sequence length | 1024 (`SFTConfig.max_length`) | the row - `max_length` is `trl` 1.14.0's actual field name, verified against the installed source (older `trl` docs/tutorials call this `max_seq_length`, which no longer exists on this version's `SFTConfig`) |
| Packing | off | not named by the row; off keeps each row's prompt/completion boundary exact for `completion_only_loss` masking, at the cost of some padding waste on a corpus this size (a few thousand short rows) - packing multiple rows per sequence is the usual mitigation but adds boundary-masking complexity this corpus's size doesn't need |
| Batch size / accumulation | 1 / 8 (effective 8) | this session's own choice, sized for an 8 GB card at 4-bit with `gradient_checkpointing` on; not specified by the row |
| Learning rate | 2e-4, cosine schedule, 3% warmup | the standard LoRA fine-tuning rate from the QLoRA paper and `peft`'s own examples; not specified by the row - the warmup is `warmup_steps`, computed from the real step count, not `warmup_ratio`: the installed `transformers` (5.17.0) dropped that field from `TrainingArguments` entirely, found live on the first real training run (`TypeError: SFTConfig.__init__() got an unexpected keyword argument 'warmup_ratio'`) and confirmed by inspecting the installed `TrainingArguments.__init__` signature, 2026-09-29 |
| Seed | 42 (`STYLE_TRAIN_SEED`) | the row says "seed fixed", this session picked 42 |
| GGUF `--outtype` | `f16` | this session's choice - a LoRA delta is small (rank 16 attention-only), so `f32`'s extra precision over `f16` isn't worth double the file size; llama.cpp's converter defaults to `f32` |

**Dataset construction** (`train.sh`'s embedded Python, from each
corpus row): a row's `system_prompt` (when present) plus `prompt`
become the `"prompt"` messages, `rewrite` (plus `tool_calls` when
present) becomes the `"completion"` message. This is `trl`'s own
"prompt-completion" conversational format
(`trl.data_utils.is_conversational`, verified against the installed
source) - `SFTTrainer` auto-enables `completion_only_loss` when both
columns are present (also verified in the installed
`trainer/sft_trainer.py`), masking the loss to the rewrite only, never
the system/user prompt.

A voice row (`class` is `typed` or `spoken`) always has `system_prompt`
- `corpus.ts`'s own `neutralReplySystem()`. A tool row (`class: "tool"`)
does **not**: `corpus.ts`'s tool-row collection calls the engine with a
bare `[{role: "user", content: row.utterance}]`, no system message at
all (`corpus.ts`, the `toolRows` loop in `run()`) - `train.sh` reproduces
that exactly (no system message for a tool row) rather than inventing a
fallback, so training matches what actually produced the row.

A tool row's `tool_calls` (`{tool, args}[]`, `corpus.ts`'s own shape) is
translated to the wire shape `backend/src/lib/llm.ts`'s
`toolCallFromWire()` reads from the real engine
(`{id, type: "function", function: {name, arguments}}`, `arguments` a
JSON string) before being handed to the tokenizer's `tool_calls` field.
Verified against the actual downloaded `Qwen/Qwen3-8B` tokenizer,
2026-09-29: `apply_chat_template` on a message with `tool_calls` renders
`<tool_call>{"name": ..., "arguments": {...}}</tool_call>`, the tag
llama.cpp's own Hermes-style tool-call parser recognizes (this is a
different, more specific case than the `<function_call>`-wrapped-prose
failure `ENGINE-CONTRACT-03` in `docs/dev.md` describes - that finding
is about the model writing a call as ordinary content outside any real
tool-call field; here the call goes through the template's own
`tool_calls` rendering path). Also verified: whether `enable_thinking`
is passed to `apply_chat_template` makes no difference to how an
already-complete assistant turn renders (both produce an identical
empty `<think>\n\n</think>\n\n` prefix before the content) - only
generation-time behavior depends on it, so `train.sh` doesn't need to
set it for training data.

Each run prints the row count and a `class:shape` breakdown
(`typed:document`, `typed:conversational`, `spoken:conversational`,
`tool:tool`) before training starts - the run report's evidence for
"the share of rows per class/shape" the row's own acceptance asks for.

## Conversion

`train.sh` calls `~/scratch/llama.cpp-b10797/convert_lora_to_gguf.py`
against the saved PEFT adapter directory
(`data-scratch/voice/adapters/<companion>/adapter/`, produced by
`trainer.save_model()` - a `PeftModel.save_pretrained()` under the
hood, which writes only the adapter weights, `adapter_config.json` +
`adapter_model.safetensors`, never the full base model - verified in
the installed `peft` source and by inspecting the actual output
directory after a run), producing
`data-scratch/voice/adapters/<companion>-qwen3-8b-instruct-q4-k-m.gguf`
and a `.sha256` sidecar next to it.

## Verification (never assumed from conversion succeeding)

Start a throwaway instance of the pinned `llama-server`
(`/opt/llama/bin/llama-server` on the bench laptop, confirmed
`build 10797, commit 832fd6f17` - the exact pinned tag) on a spare
port, pointed at the same base GGUF production uses plus the new
adapter, **never** the laptop's live `maipai-chat` unit:

```sh
/opt/llama/bin/llama-server \
  --model /data/models/qwen3-8b-instruct-q4-k-m.gguf \
  --lora data-scratch/voice/adapters/<companion>-qwen3-8b-instruct-q4-k-m.gguf \
  --lora-init-without-apply \
  --port <spare port> --host 127.0.0.1 --no-webui &
curl -s http://127.0.0.1:<spare port>/lora-adapters
kill %1   # stop the throwaway instance
```

Passes when `GET /lora-adapters` lists the adapter. This is a real
engine load, not inferred from the GGUF conversion step exiting zero -
a conversion can produce a file llama-server still refuses (a bad
tensor shape, a missing metadata key), and only actually starting the
engine catches that.

## Output

`data-scratch/voice/adapters/<companion>/adapter/` (the PEFT adapter,
git-ignored - never committed) and
`data-scratch/voice/adapters/<companion>-qwen3-8b-instruct-q4-k-m.gguf`
plus its `.sha256`. Per the org's "large artifacts ship as release
assets, never tracked files" rule, only each file's sha256, size, the
training loss curve's final value, and wall time are recorded in
`docs/dev.md` - never the files themselves.
