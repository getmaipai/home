/** The words of `full` that were heard, cut back to a whole word; `cutOff` adds an ellipsis when something was left unsaid. */
export function heardText(full: string, heard: number, cutOff: boolean): string {
  if (heard >= full.length) return full;
  let prefix = full.slice(0, Math.max(0, heard));
  if (full[heard]?.trim() !== "") {
    const space = prefix.search(/\s\S*$/);
    prefix = space < 0 ? "" : prefix.slice(0, space);
  }
  prefix = prefix.trimEnd();
  return cutOff ? `${prefix}…` : prefix;
}
