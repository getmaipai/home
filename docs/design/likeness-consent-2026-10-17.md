# Pictures, videos and styles that look like a household member (2026-10-17)

Owner's ruling, 2026-10-17 (Jesse, in the session that closed VIDEO-GEN-12's open question): an adult may make a video, a picture
or a likeness style (LoRA) of a household member. Adults may use any household member without an option. The absence of a per-person agreement and the
model-decides rule for adults are in [adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md) and
[RULES.md](RULES.md) rule 0. This note keeps what still holds.

## The lines that stay

- Nothing sexual involving a minor or a minor-looking person. A possible minor in nude or sexual generated media is a CSAM candidate
  and is withheld.
- The adult audience gate is the picture policy's own. A request that is not an adult on their own written chat screen (child,
  teen, guest, spoken turn, shared screen) never reaches an adult-only style.
- A child's and a teen's lanes keep their age filters and the no-real-people rules in [content-policy-2026-10-18.md](content-policy-2026-10-18.md).

## What the Stack checks (`stack/backend/src/lib/likeness.ts`)

An Ed25519 proof per request, signed by Home with a key derived from a seed in the keystore, bound to the picture's sha256, at most 30
minutes, used once, checked when the request arrives and again when the job starts. Whether Home still issues it is a Stack change
tracked in the Stack's own backlog; Home adds no content decision of its own.

## Not built, and limits

- No post-render check of the output for the minor line beyond the finished-item check (VIDEO-GEN-12).
- An adult-only style folder at the household level (`generation.adult_adapters: restricted`) hides adult-only styles for everyone.
