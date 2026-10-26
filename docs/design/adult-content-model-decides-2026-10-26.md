# Adult content is the model's decision; CSAM is blocked in Home (2026-10-26)

Status: owner-approved design decision by Jesse, 2026-10-26. This record updates `docs/design/RULES.md` rule 0 and rule 10 and supersedes any earlier rule or design note that requires Home code to block ordinary adult content.

## Decision

For an adult, Home code blocks content only to prevent child sexual abuse material (CSAM). The model and its provider decide whether to answer or generate any other adult content. Home passes through a model or provider refusal and does not add a second content decision.

This applies to adult written and spoken chat, search results that are part of the answer, pictures, video, music, photo edits, companion looks, companion clips, and voice requests. No adult-side word list, topic classifier, real-person or real-voice restriction, likeness restriction, consent proof, consent prompt, or category-specific refusal is allowed except where it is part of CSAM prevention. Adults may use likenesses of household members, including family members, without a Home confirmation step. Real-person content decisions in kid lanes also belong to the model; child and teen content limits continue to apply independently.

Children and teens keep their age-specific content filters, tool and surface access rules, and finished-media checks. This record does not loosen them.

## CSAM line

CSAM prevention remains a deterministic Home protection for every age band. For adult requests, use request-aware CSAM screening; for adult model replies and media prompts use direct CSAM detection. Do not treat a minor word near a sexual word as sufficient evidence in adult text. For generated images and video, a possible minor in nude or sexual content is a CSAM candidate and is withheld. A child mention, or a possible minor in ordinary nonsexual media, does not by itself block an adult request or output. If the finished-media check cannot run for an adult-only job, withhold the unchecked output as a possible CSAM candidate rather than pass it through.

CSAM screening is distinct from the model's ordinary content policy. Do not send known or suspected CSAM to a general-purpose moderation service. Handling, retention, and any reporting follow applicable platform and legal requirements; this design does not create a reporting workflow or authorize retaining prohibited material.

## Protections that remain

This change removes content decisions, not system boundaries. Home still protects credentials, blocks prompt injection and jailbreak attempts that target Home, prevents private-data extraction, handles crisis signals, applies age and surface access, enforces household feature switches and quotas, and validates file formats, sizes, and workflow ownership. The separate CSAM and child/teen checks remain. These protections do not decide whether ordinary adult content is acceptable.

The current Stack integration still requires signed consent proofs for person-likeness LoRAs and photos. Home must stop issuing those proofs and must stop withholding jobs based on likeness metadata; the Stack API and worker need a separate change to remove their matching proof gates before these requests work end to end. The Home changes are only effective for media jobs after that Stack work lands.

The page 2 setup disclosure explains that users should respect privacy, consent, copyright, the law, and one another. It is guidance, not a content gate or per-upload acknowledgment.

## Supersedes

- `models-censor-app-protects-kids-2026-10-25.md` where it preserves adult-side `harmful_request`, `credible_threat`, real-person, real-voice, or broad minor-plus-sexual code blocks.
- `child-safety-text-2026-10-19.md` where it requires adult chat or generation wording checks broader than direct CSAM detection.
- Earlier adult-side content classifiers, word lists, consent prompts, and fail-closed checks for categories other than CSAM.

It does not supersede child or teen content filtering, age and surface gates, or non-content security and crisis protections.
