/** CHAT-CALM-ERRORS-01d: true when any element under `root` is painted red
 * by an unconditional class (`bg-destructive`, `text-red-600`, ...). A
 * variant-prefixed class such as the kit Badge's `aria-invalid:border-destructive`
 * paints nothing until that state applies, so it does not count. */
export function paintsRed(root: ParentNode): Element | null {
  const red = /^(bg|text|border|ring|fill|stroke|outline)-(destructive|red-\d)/;
  for (const element of Array.from(root.querySelectorAll("[class]"))) {
    const tokens = (element.getAttribute("class") ?? "").split(/\s+/);
    if (tokens.some((token) => red.test(token))) return element;
  }
  return null;
}
