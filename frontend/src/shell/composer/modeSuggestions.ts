import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";

// The three example chips under the Home composer follow the chosen mode: what to ask, a picture, a clip, a song or a sound to try.
// GENERIC and fixed for everyone (never drawn from memory, history or a profile), like the chat starters. A chip fills the words;
// it never starts anything. A mode this list does not know shows no chips.
export interface ModeSuggestion { title: string; label: string; prompt: string }

const SUGGESTIONS: Record<string, readonly ModeSuggestion[]> = {
  ask: STARTER_SUGGESTIONS.slice(0, 3),
  picture: [
    { title: "A cozy", label: "reading nook at golden hour", prompt: "A cozy reading nook by a window at golden hour, soft light, warm colors." },
    { title: "A friendly", label: "robot watering plants", prompt: "A friendly little robot watering plants in a sunny kitchen, storybook style." },
    { title: "A quiet", label: "mountain lake at dawn", prompt: "A quiet mountain lake at dawn with mist on the water." },
  ],
  video: [
    { title: "A paper boat", label: "floating down a rainy street", prompt: "A paper boat floating down a rainy street gutter, slow and gentle." },
    { title: "A dog", label: "running on a sunny beach", prompt: "A happy dog running along a sunny beach, waves in the background." },
    { title: "Clouds", label: "drifting over a green valley", prompt: "Time-lapse of clouds drifting over a green valley at sunset." },
  ],
  song: [
    { title: "A gentle", label: "lullaby with soft piano", prompt: "A gentle lullaby with soft piano and a warm, quiet voice." },
    { title: "An upbeat", label: "road trip song with guitar", prompt: "An upbeat road trip song with acoustic guitar and clapping." },
    { title: "A slow", label: "jazz tune for a rainy evening", prompt: "A slow jazz tune with brushed drums and a mellow saxophone, for a rainy evening." },
  ],
  sound: [
    { title: "Rain", label: "on a tin roof", prompt: "Rain falling on a tin roof." },
    { title: "A door", label: "creaking open slowly", prompt: "A heavy wooden door creaking open slowly." },
    { title: "A crackling", label: "campfire at night", prompt: "A crackling campfire at night with crickets." },
  ],
};

/** The example chips for a mode id (the same list on every visit). */
export function suggestionsFor(modeId: string): readonly ModeSuggestion[] {
  return SUGGESTIONS[modeId] ?? [];
}
