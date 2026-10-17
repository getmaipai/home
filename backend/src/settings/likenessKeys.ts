// LIKENESS-01: the two consent switches a household adult has about their own likeness (docs/design/likeness-consent-2026-10-17.md).
// Declared here like the picture keys (pictureKeys.ts) and written to the spec registry by `scripts/gen-settings-registry.ts`.
// Both default off for every band, only the person themselves changes them and only an adult (lib/likeness/consent.ts and
// `assertCanSetLikeness` in lib/settings.ts), and a minor's value is never read: the policy refuses a minor subject outright.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const LIKENESS_ADULTS_KEY = "likeness.adults";
export const LIKENESS_ADULT_CONTENT_KEY = "likeness.adult_content";

export const LIKENESS_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    "key": "likeness.adults",
    "scope": "person",
    "selector": "boolean",
    "default": false,
    "label": "Let other adults in this household make pictures, videos and styles that look like me",
    "help": "Other adults here can make pictures and videos that look like you, from a photo of you or a saved style of you. You are told each time, and the list is in this page. Turn this off and nobody can, right away, and any saved style of you is removed. Children and teens never can, whatever this says. Only you can change this.",
    "copy": {
      "does": "Lets the grown-ups here create images and clips that resemble you.",
      "title": "Pictures and videos that look like you",
      "what_is_stored": "This Home keeps a dated note each time you switch this, and a list of each time someone makes something that looks like you.",
      "consent_adult_self": "I agree that other adults in this household can make pictures, videos and styles that look like me.",
      "consent_teen_self": "Teens cannot turn this on.",
      "consent_child_parent": "Children cannot turn this on.",
      "consent_guest": "Guests cannot turn this on."
    },
    "control": {
      "child": "guardian",
      "teen": "guardian",
      "adult": "self"
    },
    "band_default": {
      "child": false,
      "teen": false,
      "adult": false
    },
    "level": "basic",
    "secret": false,
    "lives_in": "person.likeness",
    "honoured_by": [
      "home"
    ]
  }),
  SettingsKey.parse({
    "key": "likeness.adult_content",
    "scope": "person",
    "selector": "boolean",
    "default": false,
    "label": "Including adult content",
    "help": "Off by default, and only counts while the switch above is on. When it is on, other adults can also use your likeness in adult-only pictures and videos. Turning it off takes effect right away.",
    "copy": {
      "does": "Allows grown-up content in what is made of you, once the first switch is on."
    },
    "control": {
      "child": "guardian",
      "teen": "guardian",
      "adult": "self"
    },
    "band_default": {
      "child": false,
      "teen": false,
      "adult": false
    },
    "level": "basic",
    "secret": false,
    "lives_in": "person.likeness",
    "honoured_by": [
      "home"
    ]
  }),
];
