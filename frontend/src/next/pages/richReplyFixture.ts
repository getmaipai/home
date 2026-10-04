// UI-1 (gap matrix A3): one reply that carries every element a chat reply
// has to render - fenced code with a language, an unlabelled fence, inline
// code, inline and block math, a wide table, a task list, nested lists, a
// link, a quote and a Mermaid diagram. The frontend test and the screenshot
// scenario (scripts/screenshot.ts --next-chat-rich-review) share it so the
// two never drift. Plain data: no imports, so the script can load it too.

export const RICH_REPLY_PROMPT = "Show me a rich reply sample for juniper's homework.";

export const RICH_REPLY_MARKDOWN = [
  "## Homework helper",
  "",
  "Use `Array.map` to double each number, then read the [MDN guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript) for more.",
  "",
  "```typescript",
  "const doubled = [1, 2, 3].map((n) => n * 2);",
  "console.log(doubled);",
  "```",
  "",
  "```",
  "plain fence with no language",
  "```",
  "",
  "The area of a circle is $A = \\pi r^2$, and the quadratic formula is:",
  "",
  "$$",
  "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  "$$",
  "",
  "| Planet | Distance from the sun (million km) | Moons | Day length (hours) | Surface temperature (C) |",
  "| --- | ---: | ---: | ---: | ---: |",
  "| Mercury | 57.9 | 0 | 4222.6 | 167 |",
  "| Venus | 108.2 | 0 | 2802.0 | 464 |",
  "| Earth | 149.6 | 1 | 24.0 | 15 |",
  "",
  "| Shape | Area |",
  "| --- | --- |",
  "| Circle | $\\pi r^2$ |",
  "",
  "- Remember that $e^{i\\pi} + 1 = 0$ in a list",
  "",
  "> [!NOTE]",
  "> Callouts are plain quotes until the kit ships an alerts plugin.",
  "",
  "- [x] Read the chapter",
  "- [ ] Finish the worksheet",
  "",
  "1. First step",
  "   - nested point",
  "2. Second step",
  "",
  "> Practice a little every day.",
  "",
  "```mermaid",
  "graph TD",
  "  A[Question] --> B[Think]",
  "  B --> C[Answer]",
  "```",
].join("\n");
