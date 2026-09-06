// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/content-ceiling.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**How explicit a generated reply may be for one age band (session-c-brain-and-voice.md step 7). One record per band (child, teen, adult) - not a per-household custom profile yet (that authoring UI is future, deferred work, docs/BACKLOG.md's own 'nine sliders' entry). Governs REGISTER only: how graphic, how frank, how unfiltered a reply's own generated content may be. It is a completely separate, additive concern from spec/safety/ts/classifier.ts's own hard refuse/allow_with_resources categories (self_harm, harmful_request, csam, credible_threat, grooming, pii_extraction, prompt_injection, jailbreak) - checkSafety() never reads a ceiling and never will; `floor` below documents that invariant, it does not implement it. There is no 'unrestricted' band today: reaching past the adult ceiling needs a one-time signed adult acknowledgment (a Grant, session-f-platform-and-trust.md step 7, not yet built) this record does not yet gate - safe-by-default in the meantime, since nothing can set a ceiling higher than what ships here.*/
export const ContentCeiling = z
  .object({
    /**Matches turnEngine.ts's own AgeBand type exactly (birthdate-derived, falling back to role) - one record per value, never a custom slug.*/
    band: z
      .enum(["child", "teen", "adult"])
      .describe(
        "Matches turnEngine.ts's own AgeBand type exactly (birthdate-derived, falling back to role) - one record per value, never a custom slug.",
      ),
    /**Per-category register ceilings, the architecture docs/dev.md's own redesign table names as sound and worth reusing (home-legacy.git's lib/contentPolicy.ts) - each dial's value is this band's MAXIMUM for that category, a household setting may only lower it further, never raise it past what's recorded here.*/
    dials: z
      .object({
        profanity: z.enum(["off", "mild", "unrestricted"]),
        sexual: z.enum(["off", "suggestive", "unrestricted"]),
        violence: z.enum(["off", "moderate", "unrestricted"]),
        substances: z.enum(["off", "discuss", "unrestricted"]),
        crime: z.enum(["off", "discuss", "unrestricted"]),
        hate: z.enum(["off", "fiction", "unrestricted"]),
        self_harm: z.enum(["off", "discuss", "unrestricted"]),
        privacy: z.enum(["off", "public", "unrestricted"]),
      })
      .strict()
      .describe(
        "Per-category register ceilings, the architecture docs/dev.md's own redesign table names as sound and worth reusing (home-legacy.git's lib/contentPolicy.ts) - each dial's value is this band's MAXIMUM for that category, a household setting may only lower it further, never raise it past what's recorded here.",
      ),
    /**Documentation, not enforcement: the classifier's own hard-refuse category names (spec/schemas/safety-result.schema.json's own enum, minus self_harm which is allow_with_resources, never refuse) that no dial value on ANY band, including a future unrestricted one, can ever reach - checkSafety() enforces this unconditionally in code, before any ceiling is ever consulted. Every band's record carries the IDENTICAL array (a fixture/test asserts this); it exists here so a generated binding can display the floor beside the dials it sits under, not to make it configurable.*/
    floor: z
      .array(
        z.enum([
          "harmful_request",
          "credible_threat",
          "csam",
          "grooming",
          "pii_extraction",
          "prompt_injection",
          "jailbreak",
        ]),
      )
      .min(1)
      .describe(
        "Documentation, not enforcement: the classifier's own hard-refuse category names (spec/schemas/safety-result.schema.json's own enum, minus self_harm which is allow_with_resources, never refuse) that no dial value on ANY band, including a future unrestricted one, can ever reach - checkSafety() enforces this unconditionally in code, before any ceiling is ever consulted. Every band's record carries the IDENTICAL array (a fixture/test asserts this); it exists here so a generated binding can display the floor beside the dials it sits under, not to make it configurable.",
      ),
    hlc: z.string().regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$")),
  })
  .strict()
  .describe(
    "How explicit a generated reply may be for one age band (session-c-brain-and-voice.md step 7). One record per band (child, teen, adult) - not a per-household custom profile yet (that authoring UI is future, deferred work, docs/BACKLOG.md's own 'nine sliders' entry). Governs REGISTER only: how graphic, how frank, how unfiltered a reply's own generated content may be. It is a completely separate, additive concern from spec/safety/ts/classifier.ts's own hard refuse/allow_with_resources categories (self_harm, harmful_request, csam, credible_threat, grooming, pii_extraction, prompt_injection, jailbreak) - checkSafety() never reads a ceiling and never will; `floor` below documents that invariant, it does not implement it. There is no 'unrestricted' band today: reaching past the adult ceiling needs a one-time signed adult acknowledgment (a Grant, session-f-platform-and-trust.md step 7, not yet built) this record does not yet gate - safe-by-default in the meantime, since nothing can set a ceiling higher than what ships here.",
  );
export type ContentCeiling = z.infer<typeof ContentCeiling>;
