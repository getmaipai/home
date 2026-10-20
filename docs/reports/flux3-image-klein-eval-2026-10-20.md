# FLUX 3 Image Klein evaluation (2026-10-20)

Black Forest Labs released FLUX 3 Image Klein on 2026-10-15. This records what was measured against the shipped FLUX.2 Klein 4B so the decision can be made later on facts. Nothing in Home or the Stack changed.

## What it is

- A new model on the FLUX 3 base, not a FLUX.2 version. One size, about 5.6B parameters (the Hugging Face page says 6B), plus a separate Qwen3-VL-4B text encoder (8.9 GB).
- Two checkpoints: Base (50 steps, for fine-tuning and LoRA training) and Distilled (16 steps, no guidance). Quantized builds: FP8, NVFP4 and an INT8 build made with NVIDIA.
- Native 4K, bounding-box layout, editing with up to 10 reference images. BFL calls FLUX.2 Klein 9B its previous small model and claims +91 Elo text to picture and +70 editing with 38% fewer parameters (BFL's own numbers, no outside benchmark yet).
- mflux 0.23.0, the version the `image-gen` component already pins, runs it: `mflux-generate-flux3` and `mflux-generate-flux3-edit`, 4, 6 and 8 bit, LoRAs through `--lora` (ComfyUI, diffusers and kohya key formats). Model ids `flux3-image-klein` and `flux3-image-klein-base`.
- Weights are gated on Hugging Face (about 16 GB for the transformer and text encoder, 11.2 GB transformer in BF16).

## Measured

Same four prompts, seed 7, 1024 x 1024, 8-bit, mflux 0.23.0 with Pillow 12.3.0 and MLX 0.32.4, on an M5 Max with 128 GB while the machine was busy (so seconds are an upper bound).

| | FLUX.2 Klein 4B | FLUX 3 Image Klein |
|---|---|---|
| Steps | 4 | 16 (distilled) |
| Seconds per picture | about 7 | about 24 (29 cold) |
| Process RSS | about 9.7 GB | about 4.5 GB |

RSS leaves out MLX GPU memory, so the real peak was not measured. Pictures: the cat, bakery sign, robot illustration and portrait prompts all worked on both. Klein 3 followed the prompt more closely (a large, correct "FRESH BREAD DAILY" sign) and the 4B invented garbled text on the robot illustration that was never asked for. Four pictures from one seed are a hint, not a verdict.

## Licence (the open question)

FLUX 3 Image Klein is under the FLUX Kommunity License v1.0, not Apache-2.0 like the 4B:

- Commercial use is free only for a "Qualifying User" (under US$5M gross annualized revenue, with affiliates). Larger organizations need a separate licence from BFL.
- A Qualifying User must run content filters or review output, and must mark output as AI-generated where the law requires it.
- Distributing the model or a derivative needs the licence text and a fixed attribution notice; a derivative also needs a "modified" statement.
- Banned uses include biometric processing and surveillance (relevant to the face and likeness features), military use, and using output to improve a competing model.
- No use of the model or its output to train another similar model, which matters for LoRA training.

Home is AGPL; whether shipping or downloading this model fits that, and what the household's own use of it counts as, needs the owner's judgment (and a lawyer's if it ships in a product).

## Cost of switching

- About 3.5 times slower per picture than the 4B at 4 steps.
- Every Klein-4B feature is tied to the 4B: the adapter library (`base_model: flux2-klein-4b`), masked edits, likeness, the quality chooser. Klein 3 LoRAs are a different set; existing 4B LoRAs will not load.
- A new catalog family, install plan entry, governor peaks, install words and tests.

## Recommendation

Do not switch now. Re-evaluate when BFL publishes (a) clearer licence terms for an AGPL self-hosted product, (b) a LoRA library worth having, or (c) a 4B-class size. If the owner wants it as an optional "Detailed" or text-in-picture maker beside the 4B (like Z-Image-Turbo), that is one new family and the backlog item below.
