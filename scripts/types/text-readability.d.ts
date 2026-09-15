// `text-readability` ships no type declarations, so this is the repo's own
// ambient module declaration covering the one call `reading-level.ts` uses.
declare module "text-readability" {
  export interface TextReadability {
    fleschKincaidGrade(text: string): number;
  }
  const textReadability: TextReadability;
  export default textReadability;
}
