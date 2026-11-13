export const songAddress = (id: string | null): string => (id ? `/apps/audio/create?song=${encodeURIComponent(id)}` : "/apps/audio/create");
export const studioAddress = (id: string): string => `/apps/audio/studio?song=${encodeURIComponent(id)}`;
export const stemsAddress = (id: string): string => `/apps/audio/studio?song=${encodeURIComponent(id)}&split=1`;
/** Opens the song with the Remix panel showing. Nothing is made until the panel's confirm button is pressed. */
export const remixAddress = (id: string): string => `/apps/audio/create?song=${encodeURIComponent(id)}&remix=1`;
