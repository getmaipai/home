# Design index

Every design record of MaiPai Home, with its status and the backlog row that owns it. Written in the 2026-10-17 design audit;
kept current by whoever adds, retires or supersedes a record (same commit). [RULES.md](RULES.md) is the authority;
`docs/plans/` and `docs/dev.md` are history and reasoning (`.github/docs/ARCHITECT.md`).

How to read the status column: **current** is a design still being built against or still the reason for what exists;
**built** is a design whose rows are all ticked (kept, since it explains the code); **partly superseded** carries
`> **Superseded in part` markers pointing at the rule that overrides a passage, the rest stands; **history** is a work order,
handoff, audit, bench result or research pass that was never a design and is kept as the record of what happened.

The audit's retirement rule: a record moves to [`retired/`](retired/) only when its whole content is replaced by a named
record or rule. A partly superseded record stays where it is, because the markers inside it are the record.

Cross-app platform features (keep on this device, resume and continue, the shell audio session with its sleep timer and
Media Session, search providers, Save to Home, one household trash, handoff, the Stack's heavy-job lane) are decided once in
[the media apps blend note, section 12](media-apps-blend-2026-10-17.md#12-cross-app-platform-features-from-filetube); a
design that queues work, resumes something or keeps a collection cites that section rather than defining its own.

**Live video (RULES.md V1, owner's rule 2026-10-17):** no code, test, script, bench, agent or session sends any request to
YouTube or any other live video service until Jesse has approved that request in the moment, after the Loki Doki history review
and a proposed design; otherwise the household IP gets blocked.

## Current designs in `docs/design/`

| Record | Status | Owner row(s) in `docs/BACKLOG.md` |
|---|---|---|
| [DESIGN-chat-memory-yields-to-generators-2026-10-27.md](DESIGN-chat-memory-yields-to-generators-2026-10-27.md) | owner-approved 2026-10-27; video jobs only | RULES.md rule 4 owner decision |
| [tier-evals-2026-10-30/](tier-evals-2026-10-30/) | raw evaluation data | TIER-EVAL-01 to -08 |
| [adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md) | owner ruling | adult-content-model-decides (RULES.md rule 10) |
| [alarm-ring-2026-10-30.md](alarm-ring-2026-10-30.md) | design; remaining slices open | Alarm and Reminders rows |
| [ambient-companion-2026-10-27.md](ambient-companion-2026-10-27.md) | owner ruling (RULES.md S2) | ambient companion ruling |
| [auto-close-apps-2026-10-30.md](auto-close-apps-2026-10-30.md) | proposed, not decided, not built | MEM-SPACE-07 to -12 |
| [chat-cards-2026-10-18.md](chat-cards-2026-10-18.md) | design and audit only; nothing built | chat cards rows |
| [chat-engine-comparison-2026-10-17.md](chat-engine-comparison-2026-10-17.md) | built on Stack side | ENGINE-MLX-01 |
| [clock-and-reminders-redesign-2026-10-30.md](clock-and-reminders-redesign-2026-10-30.md) | design from owner mockups | Clock and Reminders rows |
| [coding-mode-2026-10-22.md](coding-mode-2026-10-22.md) | retired by TIER-HOME-05; readiness and rollback design reused | MODE-* superseded by TIER-HOME-05 |
| [companions-dots-look-2026-10-25.md](companions-dots-look-2026-10-25.md) | partly superseded; Look and States restyle superseded by companion-three-screens | COMPANIONS-DOTS-01 |
| [dynamic-companions-2026-10-21.md](dynamic-companions-2026-10-21.md) | owner ruling (RULES.md) | RULES.md decision |
| [form-in-chat-2026-10-25.md](form-in-chat-2026-10-25.md) | design only; no schema or code | PKG-ASK-01, PKG-RESULT-01, FORM-CHAT-* |
| [home-layouts-2026-10-25.md](home-layouts-2026-10-25.md) | proposed; architect verdict pending | HOME-LAYOUT-01 |
| [household-voices-2026-10-20.md](household-voices-2026-10-20.md) | owner ruling; design | VOICES-02 to -04 |
| [image-engine-2026-10-17.md](image-engine-2026-10-17.md) | decision record; engine design not built | image engine slices |
| [look-component-2026-10-22.md](look-component-2026-10-22.md) | owner approved R1; not built beyond measurements | LOOK-* rows |
| [maipai-control-cli-2026-10-21.md](maipai-control-cli-2026-10-21.md) | design proposal | maipai CLI slices |
| [making-space-2026-10-30.md](making-space-2026-10-30.md) | proposed, not decided, not built | MEM-SPACE-01 to -06 |
| [media-detail-pages-2026-10-25.md](media-detail-pages-2026-10-25.md) | design; approved slices per note | MEDIA-DETAIL-* |
| [memory-management-2026-10-25.md](memory-management-2026-10-25.md) | built except bench slices 10 and 13 | MEMMGMT-2026-10-25 |
| [models-censor-app-protects-kids-2026-10-25.md](models-censor-app-protects-kids-2026-10-25.md) | partly superseded; child and teen protections stand | MODELS-CENSOR-01 to -05 |
| [radio-and-podcasts-port-2026-10-27.md](radio-and-podcasts-port-2026-10-27.md) | port review; rebuild decisions in note | radio and Podcasts port slices |
| [reliability-2026-10-17.md](reliability-2026-10-17.md) | design; work split across CANARY-01 and SELFHEAL-01 | CANARY-01, SELFHEAL-01 |
| [resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md) | proposed, not decided, not built | resource profile slices |
| [robot-companions-2026-10-21.md](robot-companions-2026-10-21.md) | partly superseded by dynamic-companions | robot companion slices |
| [robot-face-color-and-night-2026-10-20.md](robot-face-color-and-night-2026-10-20.md) | design note; hub, spec and bot | robot face slices |
| [robot-own-name-and-memory-2026-10-20.md](robot-own-name-and-memory-2026-10-20.md) | design note for spec, Home and bot | robot identity and memory slices |
| [robot-vision-2026-10-21.md](robot-vision-2026-10-21.md) | owner ruling (RULES.md) | ROBOT-VISION-01, -02 |
| [robots-switch-and-install-2026-10-20.md](robots-switch-and-install-2026-10-20.md) | design note; hub side | robot switch/install slices |
| [safety-factual-references-2026-10-19.md](safety-factual-references-2026-10-19.md) | investigation only; no rule change | n/a |
| [settings-layout-revamp-2026-10-22.md](settings-layout-revamp-2026-10-22.md) | partly superseded by RULES.md S1 and S4 (2026-10-23) | settings layout slices |
| [splash-chat-01-2026-10-28.md](splash-chat-01-2026-10-28.md) | opt-in chat engine design | SPLASH-CHAT-01 |
| [tier-evaluations-2026-10-30.md](tier-evaluations-2026-10-30.md) | evaluation results; see resource tiers | TIER-EVAL-01 to -08 |
| [tier-families-and-options-2026-10-30.md](tier-families-and-options-2026-10-30.md) | proposed, not decided, not built | TIER-FAMILY-2026-10-30 |
| [wake-word-ux-2026-10-27.md](wake-word-ux-2026-10-27.md) | owner ruling (RULES.md S2) | WAKEUX-01 |
| [weather-advice-port-2026-10-27.md](weather-advice-port-2026-10-27.md) | port review; rebuild decisions in note | weather port slices |
| [child-safety-text-2026-10-19.md](child-safety-text-2026-10-19.md) | built (S1 to S3); owner-approved 2026-10-19 | CSAM-TEXT-01 |
| [content-policy-2026-10-18.md](content-policy-2026-10-18.md) | approved by the architect 2026-10-27; NAT-03 built (certainty bands, "agreeing web sources" = at least 2 distinct hosts), other slices not built | CONTENT-POLICY-01 to -05; LIKENESS-SIMPLIFY-01 |
| [companion-speech-style-2026-10-25.md](companion-speech-style-2026-10-25.md) | proposed, design only; architect ruling in `data-scratch/architect/SPEECH-STYLE-2026-10-25.verdict` | SPEECH-STYLE-01 to -05 |
| [natural-speech-register-2026-10-27.md](natural-speech-register-2026-10-27.md) | approved by the architect 2026-10-27; NAT-01 to NAT-05 and NAT-06a (dials) and NAT-06b (wants_advice) built (NAT-03: "agreeing web sources" = at least 2 distinct hosts; NAT-05: the repeat note rides in the evidence because the ReplyPlan spec allows no ninth move), NAT-07 designed in its own note, not built; 2026-10-28 Dessa audit adds NAT-08 (contraction bench rows only; built, real-model run still owed) and NAT-09 (repeat sounds, not built) | NAT-01 to NAT-09 |
| [warmth-over-time-2026-10-28.md](warmth-over-time-2026-10-28.md) | approved by the architect 2026-10-28 (third ruling); NAT-07a bench rows built (five `opening_thread_*` rows, real-model run owed), 07c built (`threadOfferFloor` plus the judge's `offer_withheld` tag, spec-v0.1.269, real-model run owed), 07b built (`conversationOpening`, `chat.pick_up_threads`, `archived_reason`, spec-v0.1.270; CHAT-AB-01 rerun and real-model run owed; PREF-01's `chat.follow_up_questions` does not exist yet, so that interaction waits) | NAT-07 |
| [quick-reply-chips-2026-10-25.md](quick-reply-chips-2026-10-25.md) | current, design only; architect APPROVED 2026-10-25 (QR-DESIGN-2026-10-25) | QR-01, QR-02 |
| [full-duplex-voice-2026-10-24.md](full-duplex-voice-2026-10-24.md) | proposed, design only; architect ruling in `data-scratch/architect/DUPLEX-DESIGN-2026-10-24.verdict` | DUPLEX-00 to -03, -05, DUPLEX-BENCH-01 (rows added after the verdict) |
| [parakeet-stt-tier-2026-10-25.md](parakeet-stt-tier-2026-10-25.md) | proposed, design only; architect verdict in `data-scratch/architect/PARAKEET-STT-2026-10-25.verdict` | STT-PARAKEET-01 to -04, STT-WORDS-01 (named in the note, not yet backlog rows) |
| [RULES.md](RULES.md) | the rulebook; only Jesse changes it | n/a |
| [ELEMENTS-DECISIONS.md](ELEMENTS-DECISIONS.md) | ledger, current | ELEMENTS-ADOPT-01, -02; the ELT-T1 rows |
| [UI-DECISIONS.md](UI-DECISIONS.md) | ledger, current | KIT-ALERT-01, KIT-CAROUSEL-01, KIT-TOUR-01 |
| [home-page-2026-10-17.md](home-page-2026-10-17.md) | current, partly built | HOME-PAGE-01 (From the reference screens review) |
| [chat-throughput-2026-10-17.md](chat-throughput-2026-10-17.md) | current, measured | CHAT-TPS-01 to -07 (Chat throughput) |
| [instant-mode-2026-10-17.md](instant-mode-2026-10-17.md) | current; INSTANT-01 and -02 built | INSTANT-01 to -05 (Hardware tiers) |
| [vision-images-2026-10-17.md](vision-images-2026-10-17.md) | current, first slice built | VISION-03 rows (Hardware tiers) |
| [studio-voice-2026-10-17.md](studio-voice-2026-10-17.md) | current, slice 1 live | VOICE-STUDIO-01, REG-02 (Chat throughput) |
| [voices-2026-10-18.md](voices-2026-10-18.md) | new 2026-10-18, design only; queued after music | VOICES-01 to -08 (Voices) |
| [settings-ia-2026-10-18.md](settings-ia-2026-10-18.md) | new 2026-10-18, audit and design only; queued after music, first | SETTINGS-IA-01 to -09 (Settings information architecture) |
| [library-2026-10-18.md](library-2026-10-18.md) (with its clickable [mockup](assets/library-2026-10-18/index.html)) | new 2026-10-18, audit and design only; queued after music and the licence acknowledgement | BUG-LIBRARY-KEPT-01 and BUG-LIBRARY-SHARE-CHILD-01 first; LIBRARY-RETENTION-01, LIBRARY-DEDUP-01, LIBRARY-REVAMP-01 to -13 (Library revamp) |
| [image-tools-2026-10-17.md](image-tools-2026-10-17.md) | current; Stack half landed | IMGTOOLS-01 to -09 |
| [image-editing-2026-10-17.md](image-editing-2026-10-17.md) | current; built, live check open | IMGEDIT-01 to -06 |
| [ai-models-simple-2026-10-25.md](ai-models-simple-2026-10-25.md) | current; page built 2026-10-26 | none yet (slices in the note) |
| [ai-models-glance-2026-10-26.md](ai-models-glance-2026-10-26.md) | approved 2026-10-26 (architect); amends ai-models-simple | AIMODELS-GLANCE-2026-10-26 |
| [add-a-chat-model-2026-10-27.md](add-a-chat-model-2026-10-27.md) | approved 2026-10-27 (architect) | MODEL-ADD-01 |
| [image-model-bakeoff-2026-10-25.md](image-model-bakeoff-2026-10-25.md) | current; decided, not built | none yet (slices in section 6) |
| [household-lists-reminders-2026-10-17.md](household-lists-reminders-2026-10-17.md) | new 2026-10-17, no code | HOUSEHOLD-01 to -04 (to be cut from the note; today the four bundled plugins and GENUI-05 in Skills and Intelligent UI answers) |
| [smart-home-2026-10-17.md](smart-home-2026-10-17.md) | new 2026-10-17, no code | HOUSE-01 to -05 (to be cut; today the Integrations rows it supersedes) |
| [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md) | current, built 2026-10-17 | LIKENESS-01; closes the VIDEO-GEN-12 owner question |
| [music-generation-2026-10-17.md](music-generation-2026-10-17.md) | new 2026-10-17, measured; chat first, studio later | MUSIC-SPEC-01, MUSIC-GEN-01 to -14, MUSIC-STUDIO-01 (Music generation) |
| [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) | new 2026-10-27, decided, not built; Standard, Boost, Max and system-only Reduced for every generating feature; evaluations first | TIER-EVAL-01 to -08, TIER-SPEC-01, TIER-STACK-01 to -03, TIER-HOME-01 to -05, TIER-UI-01, TIER-STEMS-01, TIER-BENCH-01, TIER-DOC-01, TIER-SHIP-01 (Resource tiers) |
| [resource-management-review-2026-10-31.md](resource-management-review-2026-10-31.md) | review 2026-10-31 of the governor, watchdog, heavy gate and household queue as built and as they run on the live hub; 14 findings, work order in its section 5; no rule change | none yet (section 5 names nine slices) |
| [stem-splitting-2026-10-30.md](stem-splitting-2026-10-30.md) | new 2026-10-30, APPROVED, not built; stems as a task of `edit_music`, Standard `htdemucs` | TIER-STEMS-01, 01a to 01d, TIER-STEMS-02 (Resource tiers) |
| [video-speedup-and-control-eval-2026-10-20.md](video-speedup-and-control-eval-2026-10-20.md) (follows [video-generation-2026-10-17.md](video-generation-2026-10-17.md)) | new 2026-10-20, evaluation plan only, nothing scheduled; architect has not ruled | VIDEO-EVAL-01 to -06 |
| [companion-video-characters-2026-10-21.md](companion-video-characters-2026-10-21.md) (supersedes the Rive half of Q1 in [assistant-layer-2026-10-04.md](../plans/assistant-layer-2026-10-04.md)) | new 2026-10-21, proposal; nothing built; architect has not ruled | COMPANIONS-STUDIO-01 (replaced by CMEDIA-SPEC-01, CMEDIA-EDITOR-01 to 05 and the video rows, proposed in the note) |
| [isolation-2026-10-18.md](isolation-2026-10-18.md) | new 2026-10-18, measured; chat and voice always win over heavy jobs | ISOLATION-01 to -06 (Workload isolation) |
| [image-generation-2026-10-17.md](image-generation-2026-10-17.md) | new 2026-10-17, no code | PICTURES-01 to -05 (to be cut; today "Image generation (L)" and CHAT-MEDIA-01 in Generation) |
| [devices-and-robot-link-2026-10-17.md](devices-and-robot-link-2026-10-17.md) | new 2026-10-17, no code | ROBOTLINK-01, -02, ROBOTLINK-BENCH-01, DEVICES-01 to -03 (to be cut; today the Portability "Sync engine decision" and "A Device record and spec/link" rows) |
| [robot-admin-place-2026-10-20.md](robot-admin-place-2026-10-20.md) | current | ROBOT-ADMIN-PLACE-01 (built 2026-10-20) |
| [robot-register-test-configure-2026-10-20.md](robot-register-test-configure-2026-10-20.md) | new 2026-10-20, no code | ROBOT-PAIR-02, DEVICES-02, ROBOT-TEST-01, ROBOT-BODY-JOIN-01; commons SPEC-ROBOT-TEST-01; bot BOT-SELF-TEST-01 |
| [stories-2026-10-17.md](stories-2026-10-17.md) | new 2026-10-17, no code | STORIES-01 to -04 (to be cut; today PROJECT-PACK-01, -02 in Projects) |
| [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md) (and its [sources](media-apps-blend-2026-10-17-sources.md); plain-words [overview](media-apps-overview-2026-10-17.md) with the clickable [mockup](assets/media-apps-2026-10-17/index.html)) | current; section 12 is the cross-app platform record | Media apps: MEDIA-SPEC-01 to MEDIA-GO-01, AUDIO-SESSION-01, KEEP-OFFLINE-01, SAVE-TO-HOME-01, TRASH-01, HANDOFF-01 |
| [companions-app-2026-10-21.md](companions-app-2026-10-21.md) | new 2026-10-21, built | COMPANIONS-APP-01, COMPANIONS-STUDIO-01 |
| [companions-shared-chat-and-presence-2026-10-24.md](companions-shared-chat-and-presence-2026-10-24.md) | new 2026-10-24, design only; the COMPANIONS-MULTI-01 record; Jesse's seven decisions recorded 2026-10-24 (section 13); S2 edited for the launcher | COMPANIONS-MULTI-01; proposes COMPANIONS-SHELL-01, COMP-04a to -04c, COMPANIONS-YOURS-01, -DETAIL-01, -WIZARD-01, -PRESENCE-01, COMP-05 (amended), AGENTIC-DESIGN-01 |
| [companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) | proposed, design only; Jesse's decisions recorded 2026-10-26; architect has not ruled; supersedes parts of the dots-look and shared-chat notes | COMPANIONS-REVAMP-01; COMPANION-ART-MODEL-01; COMPANIONS-ART-BENCH-01 |
| [companion-three-screens-2026-10-28.md](companion-three-screens-2026-10-28.md) | proposed, design only; Jesse's mockups and answers 2026-10-28; architect APPROVED 2026-10-29 with five conditions (section 8); supersedes the wizard, editor tabs and Studio UI | COMPANION-3S-01 (IMG-PIPE-01, ANIM-SPEC-01, KIT-3S-01, LOOK-3S-01, ANIM-3S-01, SAVE-3S-01, UI-3S-01, VERIFY-3S-01) |
| [status-surfaces-review-2026-10-29.md](status-surfaces-review-2026-10-29.md) | proposed, review only; asked by Jesse 2026-10-29; four decisions open (section "Decisions for Jesse"); no rule changed | none yet |
| [media-hub-2026-10-19.md](media-hub-2026-10-19.md) | new 2026-10-19, design only; recommends a thin Media home app, awaiting Jesse | MEDIA-HUB-01 to -06 (proposed, not yet in the backlog) |
| [media-apps-audit-2026-10-20.md](media-apps-audit-2026-10-20.md) | new 2026-10-20, audit; the five media apps and the Media home against the mockup and the media hub note | order of work in the note; rows added as items are built |
| [media-handoff-2026-10-17.md](media-handoff-2026-10-17.md) | new 2026-10-17, no code | HANDOFF-01a to -01d (Continue here, Play on another screen) |
| [live-video-2026-10-17.md](live-video-2026-10-17.md) (and its [Loki Doki lessons](live-video-lessons-2026-10-17.md)) | new 2026-10-17, proposal awaiting Jesse; no code, no request made; the record for RULES.md V1 | LIVE-VIDEO-01 to -06 (to be cut from the note's section 10 once Jesse approves it; today MEDIA-SEARCH-01 and YOUTUBE-API-01) |
| [modes-and-child-protections-2026-10-17.md](modes-and-child-protections-2026-10-17.md) | new 2026-10-17, no code; MODE-BIRTHDATE-01 held behind Jesse's rule edit | MODE-NAMING-01, MODE-BIRTHDATE-01, MODE-GUEST-01, ROLE-RENAME-01 (the rung names), AGE-01, AGE-02, DOCS-GAP-02, CHILD-PROFANITY-01, TEEN-RESEARCH-01 |
| [people-roles-and-account-2026-10-17.md](people-roles-and-account-2026-10-17.md) | new 2026-10-17, no code; RAIL-SWITCH-PROFILE-01 held behind S1 | NO-OWNER-ROLE-01, GRANTS-01, RELATION-INFER-01, PARENT-CONTROLS-UI-01, DOCS-GAP-03b, ACCOUNT-PIN-CHANGE-01, DEVICE-PHONE-01, BRANCH-SEC1-01, NO-CROSS-USER-VISIBILITY-01, LOG-PRIVACY-01 |
| [security-and-data-lifecycle-2026-10-17.md](security-and-data-lifecycle-2026-10-17.md) | new 2026-10-17, no code | SEC-PRIVACY-01, CAP-06, CAP-08, SETTINGS-AUDIT-01, DIAG-REPORT-01, PERF-ALERT-01, ERASE-HUB-01, EXPORT-01, MEM-EXPORT-01, HUB-MIGRATE-01, SELF-UPDATE-TESTS-01, HOME-IMAGE-01 |
| [answer-blocks-places-and-documents-2026-10-17.md](answer-blocks-places-and-documents-2026-10-17.md) | new 2026-10-17, no code; the record of the remaining block kinds | KIT-GENUI-01 to -05, GENUI-06 to -12, PLACE-MAPS-01, PLACE-SHARE-01, DOC-BLOCKS-01, DOC-RENDER-01, SINCE-01, LEARNED-01, CHAR-01 |
| [memory-lifecycle-and-preferences-2026-10-17.md](memory-lifecycle-and-preferences-2026-10-17.md) | new 2026-10-17, no code | MEM-TIDY-01, MEM-REVIEW-02, EVAL-04, MEM-FEED-01, PI-MEM-00, MEM-SPEAKER-01, PREF-01 |
| [memory-audit-and-redesign-2026-10-31.md](memory-audit-and-redesign-2026-10-31.md) | new 2026-10-31, the code lands with the note (2026-10-31); live-hub audit of the first two weeks and the jacket reply | MEM-AUDIT-01 to MEM-AUDIT-06 |
| [notifications-and-asks-2026-10-17.md](notifications-and-asks-2026-10-17.md) | new 2026-10-17, no code | MEM-PUSH-01, NOTIFY-SOUND-01, BRAKES-02, PKG-ASK-01, PKG-RESULT-01 |
| [packages-apps-and-integrations-2026-10-17.md](packages-apps-and-integrations-2026-10-17.md) | new 2026-10-17, no code | APPSTORE-DESIGN-01, SKILLS-PAGE-02, APP-STATE-01, PKG-EXPOSE-01, RUNTIME-01, SERVICE-WALL-01, PRESENCE-FIND-01, NOTES-01, SELF-KNOW-01, MEDIA-INT-06 |
| [chat-engine-and-model-records-2026-10-17.md](chat-engine-and-model-records-2026-10-17.md) | new 2026-10-17, no code | THIN-2B, MODEL-RECORD-1.7B-01, THIN-6A, MODEL-VET-01, STACK-CATALOG-01, ENGINE-CANARY-01, STACK-LIGHT-PROFILE-01, GROUND-A-01, SEARCH-DDGS-01c, OWUI-ADOPT-06, TOOL-RESULT-TRUST-01, REVIEW-01, ACT-02, EVAL-05, IMG-PIPE-INTENT-01, IMG-VISION-SHADOW-01, IMG-VISION-VETO-01, IMG-REVERSE-01 |
| [kid-mode-app-voice-2026-10-17.md](kid-mode-app-voice-2026-10-17.md) | new 2026-10-17, no code; the look, copy, hides and asks of every app on Child controls | KID-MODE-01 to -07 (Kid mode) |
| [news-app-2026-10-17.md](news-app-2026-10-17.md) | new 2026-10-17, no code; a child's News waits on its decision 1 | NEWS-00 to NEWS-08, NEWS-LOOK-01 and -02 (News app) |
| [kiwix-reader-2026-10-29.md](kiwix-reader-2026-10-29.md) | new 2026-10-29, architect APPROVED; READER-01 and 02 first | READER-00 to READER-06 (Kiwix reader, Wikipedia app) |
| [phone-minimal-2026-10-25.md](phone-minimal-2026-10-25.md) | new 2026-10-25, design only; architect verdict pending in `data-scratch/architect/PHONE-MINIMAL-2026-10-25.verdict` | PHONE-01 to PHONE-06 (one minimal phone look, Apple News as the reference) |
| [local-coding-2026-10-17.md](local-coding-2026-10-17.md) (plain-words [overview](local-coding-overview-2026-10-17.md), clickable [mockup](assets/local-coding-2026-10-17/index.html)) | new 2026-10-17, no code; owner answers of 2026-10-17 recorded (adults by default, minors by grant, Tailscale only away, the on-demand coding model); one open question, a minor's session logs for the guardian (section 12, needs a rule change) | CODE-SPEC-01 to CODE-TEEN-01 (Local coding) |

## Current design records in `docs/plans/`

| Record | Status | Owner row(s) |
|---|---|---|
| [chat-thin-path-2026-10-02.md](../plans/chat-thin-path-2026-10-02.md) | **RULES record** (Chat turn), accepted | Thin chat path |
| [web-sources-household-2026-10-12.md](../plans/web-sources-household-2026-10-12.md) | **RULES record** (rule 0), accepted | SETTINGS-LAYERS-01c |
| [app-kind-2026-10-16.md](../plans/app-kind-2026-10-16.md) | current; APP-KIND-01 built | UI / shell |
| [assistant-layer-2026-10-04.md](../plans/assistant-layer-2026-10-04.md) | current, accepted; nothing built | Assistant layer (19 rows), Proactive |
| [browser-notifications-2026-09-30.md](../plans/browser-notifications-2026-09-30.md) | built | ENGINE-AVAIL-06a |
| [chat-engine-availability-2026-09-29.md](../plans/chat-engine-availability-2026-09-29.md) | current, partly built | ENGINE-AVAIL-00 to -06 |
| [context-compaction-2026-10-05.md](../plans/context-compaction-2026-10-05.md) | consultation behind rule 4; THIN-3F open | Thin chat path |
| [e14-follow-up-suggestions.md](../plans/e14-follow-up-suggestions.md) | current | CHAT-FOLLOWUPS-01 (folded into ELEMENTS-ADOPT-02) |
| [external-sharing-2026-09-23.md](../plans/external-sharing-2026-09-23.md) | current | SHARE-LINK-02 (Household storage) |
| [feeds-and-archive-2026-09-24.md](../plans/feeds-and-archive-2026-09-24.md) | current, owner-approved; SOURCE-SPEC-01 built | Knowledge sources |
| [fit-verdict-ui-2026-09-30.md](../plans/fit-verdict-ui-2026-09-30.md) | built (HOME-FIT-01); SETUP-SIZE-01 open | Hardware tiers |
| [guided-tour-2026-10-13.md](../plans/guided-tour-2026-10-13.md) | current draft, rev 4 | KIT-TOUR-01; tour rows |
| [hardware-tiers-2026-09-23.md](../plans/hardware-tiers-2026-09-23.md) | partly superseded (rules 1, 8); tier definitions stand | Hardware tiers |
| [harness-turns-and-projects-2026-09-26.md](../plans/harness-turns-and-projects-2026-09-26.md) | current; PROJECT-SPEC-01 built | Projects |
| [help-2026-10-14.md](../plans/help-2026-10-14.md) | current draft | HELP-AI-01 |
| [home-alive-01-2026-10-02.md](../plans/home-alive-01-2026-10-02.md) | built (01a); extended by home-page-2026-10-17 | HOME-ALIVE-01 |
| [household-memory-permissions-2026-09-26.md](../plans/household-memory-permissions-2026-09-26.md) | current, proposed | MEM-PROV-01 |
| [household-storage-2026-09-23.md](../plans/household-storage-2026-09-23.md) | current, the storage rule | Household storage |
| [hub-on-apple-silicon-2026-09-17.md](../plans/hub-on-apple-silicon-2026-09-17.md) | current, owner decision; engine half of generation | ENGINE-HOST, MEDIA-HOST rows |
| [imgq-09-2026-10-12.md](../plans/imgq-09-2026-10-12.md) | built | IMGQ-09 |
| [imgq-16-final-picture-setup-2026-10-13.md](../plans/imgq-16-final-picture-setup-2026-10-13.md) | current: the setup that runs | IMGQ-16 |
| [install-wizard-2026-10-13.md](../plans/install-wizard-2026-10-13.md) | current, rev 5, narrowed by the two notes below | SETUP-* rows |
| [wizard-two-pages-2026-10-15.md](../plans/wizard-two-pages-2026-10-15.md) | current draft (screens 2 to 5 of the wizard) | SETUP-* |
| [wizard-folder-picker-2026-10-15.md](../plans/wizard-folder-picker-2026-10-15.md) | current, awaiting its verdict | WIZ-STORAGE |
| [setup-voice-search-2026-10-17.md](../plans/setup-voice-search-2026-10-17.md) | current, partly built | SETUP-VOICE-01, SETUP-SEARCH-02, -03 |
| [knowledge-sources-2026-09-24.md](../plans/knowledge-sources-2026-09-24.md) | partly superseded (KS-02); the source catalogue stands | Knowledge sources |
| [ks-mode-01-2026-10-10.md](../plans/ks-mode-01-2026-10-10.md) | built | KS-MODE-01 |
| [media-conversation-program-2026-09-13.md](../plans/media-conversation-program-2026-09-13.md) | current (subject, evidence, composition) | The chat rebuild |
| [people-profile-2026-09-26.md](../plans/people-profile-2026-09-26.md) | current, phase one | PEOPLE-01 |
| [privacy-mode-2026-09-24.md](../plans/privacy-mode-2026-09-24.md) | current proposal (Incognito) | Incognito, THIN-INC |
| [reference-reader-and-library-settings-2026-10-15.md](../plans/reference-reader-and-library-settings-2026-10-15.md) | built | REFERENCE-READER-01a, -01b |
| [response-contract-by-surface-2026-09-21.md](../plans/response-contract-by-surface-2026-09-21.md) | current, owner ruling | rule 5's surfaces |
| [router-build-02-2026-10-12.md](../plans/router-build-02-2026-10-12.md) | current, design only (pass marks) | ROUTER-BUILD-02 |
| [search-answer-caption-veto-2026-10-13.md](../plans/search-answer-caption-veto-2026-10-13.md) | built | SEARCH-ANSWER-09 |
| [search-answer-quality-2026-10-13.md](../plans/search-answer-quality-2026-10-13.md) | diagnosis feeding open rows | SEARCH-ANSWER-01 to -03 |
| [search-resilience-2026-09-24.md](../plans/search-resilience-2026-09-24.md) | partly superseded (rule 6); health and second door stand | The chat rebuild |
| [searxng-settings-2026-10-06.md](../plans/searxng-settings-2026-10-06.md) | built (03, 04); SETUP-SEARCH-03 open | SearXNG settings |
| [settings-redesign-2026-09-30.md](../plans/settings-redesign-2026-09-30.md) | built (S1 to S7); S4 of RULES now governs the shell | Settings redesign |
| [shell-on-shadcndashboard-2026-09-21.md](../plans/shell-on-shadcndashboard-2026-09-21.md) | built (SHELL-09); the program record behind principle 6 | UI / shell |
| [shell-search-2026-09-23.md](../plans/shell-search-2026-09-23.md) | built | SHELL-SEARCH-01 to -03 |
| [simple-turn-pipeline-2026-09-22.md](../plans/simple-turn-pipeline-2026-09-22.md) | partly superseded (rules 1, 4, 13) | The chat program |
| [turn-machine-state-record-2026-09-22.md](../plans/turn-machine-state-record-2026-09-22.md) | partly superseded (rules 1, 2, 6, 8) | The chat program |
| [stack-16-design-2026-09-30.md](../plans/stack-16-design-2026-09-30.md) | current; STACK-16 open | Hardware tiers |
| [status-page-2026-09-30.md](../plans/status-page-2026-09-30.md) | current; the Status page rows built against it | Status page |
| [status-internet-services-2026-09-30.md](../plans/status-internet-services-2026-09-30.md) | current, extends the above | STATUS-SVC rows |
| [studio-day-one-2026-09-23.md](../plans/studio-day-one-2026-09-23.md) | current runbook (the `dev/studio-runbook.md` link in the backlog is dead; this is the file) | Studio day one |
| [tools-ecosystem-design-2026-10-03.md](../plans/tools-ecosystem-design-2026-10-03.md) | accepted, nothing built | TOOLS-PROGRAM, THIN-2F |
| [weather-card-and-app-2026-10-16.md](../plans/weather-card-and-app-2026-10-16.md) | current; WEATHER-CARD-01 built, WEATHER-APP-01 partly | Weather rows |
| [chat-trueup-2026-09-23.md](../plans/chat-trueup-2026-09-23.md) | built (TRUEUP-01), partly superseded (rule 12) | The chat rebuild |
| [chat-parity-2026-09-16.md](../plans/chat-parity-2026-09-16.md) | partly superseded (rule 9); the survey stands | Feature parity |
| [gpu-validation (docs/dev/gpu-validation.md)](../dev/gpu-validation.md) | history | n/a |

## History in `docs/plans/` (not designs)

Work orders, handoffs, audits, benches and research. Kept as the record of what happened; never the authority.

- Wave 1 and 2 work orders: `session-a-intelligence.md`, `session-b-ui.md`, `session-c-brain-and-voice.md`,
  `session-d-packages-and-store.md`, `session-e-ui-and-docs.md`, `session-f-platform-and-trust.md`, `wave-2.md`.
- Session A and B lanes and handoffs (2026-09-12 to 09-14): `session-a-chat-program`, `session-a-post-block`,
  `session-a-handoff`, `session-b-frontend-issues`, `session-b-frontend-lane-3` to `-5`, `session-b-lane-6` to `-14`,
  `session-b-handoff`, `baseline-fixes`, `measure-first`, `companions-design-brief` (its design is in `dev.md`),
  `conversation-competencies` (partly superseded, rules 3 and 5).
- Codex lane briefs (built): `b-reference-library-01`, `ceiling-gap-01-lane-b`, `engine-avail-00`, `engine-avail-00b`,
  `face-02*` and `face-model-pin-dedup-lane-a`, `family-badges-lane-b`, `family-nav-lane-a`, `family-tabs-lane-b`,
  `issue-166-manifest-refusal`, `next-retire-02c-port-list`, `robot-card-01-hub-half`, `route-find-04-lane-b`,
  `shortcuts-01-lane-a`, `style-bench-01`, `style-corpus-01-local-teacher`, `style-corpus-02`, `style-train-01`;
  `style-spec-01-lane-a` is still open (STYLE-SPEC-01).
- Audits, reviews and research: `arch-review-2026-09-22` and `chat-architecture-review-2026-09-16` (both partly
  superseded by RULES), `artifacts-evaluation-2026-09-21`, `codex-app-audit-2026-09-25` and `-2`,
  `catalog-marketplace-research-2026-10-03`, `mcp-connectors-survey-2026-10-03`, `tool-selection-research-2026-10-03`,
  `tools-audit-2026-10-03`, `model-review-qwen-image-2.1-and-clm-2026-09-26`, `docs-audit-2026-10-14`,
  `docs-vs-reality-2026-10-14`, `shell-09-deletion-list-2026-09-27`, `ground-2-measurement-protocol`.
- Bench results (IMGQ): `imgq-12a-bench-results`, `imgq-12b-lead-image`, `imgq-12d-vl-check`, `imgq-14-plain-search-order`,
  `imgq-15-entity-sealed`.
- `docs/dev/`: session handoffs, the ODS and reference-screens reviews, `minor-topics.md`, `gpu-validation.md`. `docs/dev.md`
  is the running design record; its sections are history and reasoning, cited by the records above.

## Retired

Moved to [`retired/`](retired/) on 2026-10-17, each with a header naming why and what replaces it.

| Record | Replaced by |
|---|---|
| [home-pages-2026-09-20.md](retired/home-pages-2026-09-20.md) | RULES.md App shell S1 to S5; home-page-2026-10-17.md |
| [gpu-card-layout-2026-09-14.md](retired/gpu-card-layout-2026-09-14.md) | hub-on-apple-silicon-2026-09-17.md; studio-day-one-2026-09-23.md |
| [image-search-01-2026-09-24.md](retired/image-search-01-2026-09-24.md) | RULES.md chat rule 7; imgq-16-final-picture-setup-2026-10-13.md |
| [issue-168-search-shape-2026-09-26.md](retired/issue-168-search-shape-2026-09-26.md) | RULES.md chat rules 5 and 7 |
| [imgq-12-picture-design-2026-10-12.md](retired/imgq-12-picture-design-2026-10-12.md) | imgq-16-final-picture-setup-2026-10-13.md |
| [imgq-13-entity-resolution-2026-10-12.md](retired/imgq-13-entity-resolution-2026-10-12.md) | imgq-16-final-picture-setup-2026-10-13.md |

## Features with no design yet, and why

Decided in the audit, so nobody writes one by reflex:

- **Email** (Integrations): a consent design of its own; none is smart home. Not written. Security against seizure
  (SEC-PRIVACY-01), modes and the teen remainder, calendar and find people now have notes in the table above.
- **Small bundled plugins** (almanac, convert, currency, joke, math, sports, translate, trivia, book, place and media
  lookups): each is a one-call lookup drawn by the existing answer blocks; no screen, no design.
- **Companions**: designed in `dev.md` ("The chat design pass", section 9) and the assistant layer; no separate note.
- **Reverse image lookup**: two rows under Vision; a tool slice, not a product; folds into image-tools and vision-images.
- **Go, pods, the TV**: built last (principle 7); nothing is designed for them until the hub's packages have schema pages.
