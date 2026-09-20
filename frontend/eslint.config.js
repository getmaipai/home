// The kit's lint (docs/plans/session-b-ui.md step 1): frameworks catch
// what memory can't. Every rule here enforces something docs/UI.md or
// ENGINEERING.md already states in prose; this is what makes it actually
// true instead of just written down.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

// A hand-written rule, not a config option: no shipped plugin checks
// "does this className string pair every hover: variant with a focus
// equivalent" (docs/UI.md's floor - a control reachable only on hover is
// unreachable by keyboard, touch, or TV remote). Best-effort on purpose:
// it reads className string and template literals directly, so a
// hover:/focus: pair built by string concatenation across two `cn(...)`
// arguments is invisible to it, the same limitation `no-restricted-
// classes` below has for the same reason.
const hoverNeedsFocus = {
  create(context) {
    function check(node, raw) {
      if (typeof raw !== "string") return;
      if (/\bhover:/.test(raw) && !/\bfocus/.test(raw)) {
        context.report({
          node,
          message:
            "a hover: variant needs a focus/focus-visible equivalent (docs/UI.md) - hover-only controls are unreachable by keyboard, touch, or a TV remote.",
        });
      }
    }
    return {
      JSXAttribute(node) {
        if (node.name.name !== "className" || !node.value) return;
        // Only native DOM elements (div, span, a hand-styled button):
        // the kit's own components (Button, Input...) already pair their
        // internal hover states with a focus-visible ring centrally, so
        // a `hover:` in a className passed *to* one of them is not the
        // hover-only-reachable case this rule exists to catch, and this
        // rule has no way to see a component's own internal classes.
        const tagName = node.parent?.name?.name;
        if (typeof tagName === "string" && /^[A-Z]/.test(tagName)) return;
        if (node.value.type === "Literal") check(node, node.value.value);
        if (node.value.type === "JSXExpressionContainer") {
          const expr = node.value.expression;
          if (expr.type === "TemplateLiteral") {
            for (const quasi of expr.quasis) check(node, quasi.value.raw);
          } else if (expr.type === "Literal") {
            check(node, expr.value);
          }
        }
      },
    };
  },
};

// Lane 7 item 3 (2026-09-13): the 49 `text-xs`/`text-[10px]`-shaped
// instances BACKLOG.md's type-floor note named, swept - each moved to
// `text-base` (16px, docs/UI.md's own floor) or left with a comment
// naming why it's a deliberate exception (a badge/chip/token, a
// compact size variant, a typographic convention like `<sup>` that is
// supposed to be smaller than body text). This rule is what keeps that
// sweep from regressing: same best-effort shape as `hoverNeedsFocus`
// above (string/template literals and `cn(...)` call arguments, not a
// full data-flow analysis), scoped to `src/apps` and `src/shell` only -
// the kit itself moved to `@maipai/ui` (ui-v0.1.0/0.1.1) and is audited
// by shared/ui's own gate now, not this one; `src/kit/assistant-ui`
// (still vendored here) is exempted below the same way. A sub-floor
// class there still needs the SAME exception comment by convention
// (every instance in this sweep has one), just not lint-enforced, the
// same "hand-fixed where it mattered" posture the kit
// already takes for the 48px/focus-ring floors.
const SUB_FLOOR_TEXT_CLASS = /\btext-xs\b|\btext-\[(\d+)px\]/g;
const EXCEPTION_MARKER = /type-floor/i;
const typeFloor = {
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    function hasNearbyException(node) {
      const startLine = node.loc.start.line;
      const windowStart = Math.max(0, startLine - 8);
      const nearby = sourceCode.lines.slice(windowStart, startLine).join("\n");
      return EXCEPTION_MARKER.test(nearby) && /exception/i.test(nearby);
    }
    function check(node, raw) {
      if (typeof raw !== "string") return;
      SUB_FLOOR_TEXT_CLASS.lastIndex = 0;
      let match;
      while ((match = SUB_FLOOR_TEXT_CLASS.exec(raw)) !== null) {
        if (match[1] !== undefined && Number(match[1]) >= 16) continue;
        if (hasNearbyException(node)) continue;
        context.report({
          node,
          message: `"${match[0]}" is under the kit's 16px type floor (docs/UI.md) with no nearby "deliberate type-floor exception" comment explaining why (lane 7 item 3, 2026-09-13). Move it to text-base, or add the exception comment if this is a badge, a token, or a compact size variant.`,
        });
      }
    }
    function checkExpression(node, expr) {
      if (!expr) return;
      if (expr.type === "Literal") check(node, expr.value);
      else if (expr.type === "TemplateLiteral") {
        for (const quasi of expr.quasis) check(node, quasi.value.raw);
      } else if (expr.type === "CallExpression") {
        for (const arg of expr.arguments) checkExpression(node, arg);
      }
    }
    return {
      JSXAttribute(node) {
        if (node.name.name !== "className" || !node.value) return;
        if (node.value.type === "Literal") check(node, node.value.value);
        if (node.value.type === "JSXExpressionContainer") checkExpression(node, node.value.expression);
      },
    };
  },
};

const HEX_OR_RGB_ARBITRARY = "\\[(#[0-9a-fA-F]{3,8}|rgba?\\()";
const localPlugin = { rules: { "hover-needs-focus": hoverNeedsFocus, "type-floor": typeFloor } };

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/ort/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      local: localPlugin,
    },
    rules: {
      // react-hooks@7's "recommended" is the full React Compiler rule
      // set (static-components, set-state-in-effect, immutability,
      // purity...), which flags this codebase's existing data-fetching
      // shape (a `useEffect` calling `setState` from a fetch) wholesale -
      // exactly the pattern step 3 (the TanStack Query data layer)
      // replaces on its own schedule. Enabling the full set here would
      // mean either a speculative refactor ahead of that step or a wall
      // of per-line suppressions; the two classic, uncontroversial
      // correctness rules are what a hooks lint actually needs today.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...jsxA11y.flatConfigs.recommended.rules,
      // Every existing suppression already carries the reason it's safe
      // (an intentional one-shot effect, a stable ref); a new one needs
      // the same, not a blanket disable.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // docs/UI.md > Icons: "lucide only, by name; the lint fails any other
    // import or pasted SVG." The kit owns the name -> component registry
    // (@maipai/ui/src/icons); nothing else imports lucide-react directly.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/kit/ui/**", "src/kit/assistant-ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "Import icons by name from @maipai/ui/src/icons (getIcon), never lucide-react directly.",
            },
          ],
        },
      ],
    },
  },
  {
    // Generated by the shadcn CLI (src/kit/ui) and the assistant-ui
    // registry (src/kit/assistant-ui, step 4), not authored here: a lint
    // this session added is for app code built on top of these files, not
    // a mandate to hand-patch every accessibility nuance of vendored
    // component internals (input-group.tsx's click-to-focus convenience
    // click handler, markdown-text.tsx's passthrough heading/anchor
    // renderers, thread.aui.tsx's composer autofocus). `src/kit/ui` now
    // holds only `textarea.tsx` (assistant-ui's own composer field) -
    // the rest of the kit moved to `@maipai/ui` (ui-v0.1.0/0.1.1), where
    // the same 48px/focus-ring/16px floor was applied by hand and is
    // shared/ui's own gate's concern now, not this repo's.
    files: ["src/kit/ui/**/*.tsx", "src/kit/assistant-ui/**/*.tsx"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    // A package's pages compose the kit's primitives (docs/UI.md > Pages
    // are data); a raw <button>/<input> in src/apps is exactly the
    // hand-rolled widget org standard 6 forbids. src/kit/ui and
    // @maipai/ui/src/ui are where these elements are legitimately defined.
    files: ["src/apps/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use @maipai/ui/src/ui/button's Button, not a raw <button>, in src/apps.",
        },
        {
          selector: "JSXOpeningElement[name.name='input']",
          message: "Use @maipai/ui/src/ui/input's Input, not a raw <input>, in src/apps.",
        },
      ],
    },
  },
  {
    // docs/UI.md > Design tokens: "no raw values in packages." Rule scope
    // is .tsx only, so it never reaches src/shell/tokens.css or
    // @maipai/ui itself, exactly where a real color value has to be
    // declared once.
    files: ["src/apps/**/*.tsx", "src/shell/**/*.tsx"],
    plugins: {
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": { entryPoint: "src/shell/tokens.css" },
    },
    rules: {
      // Only the three correctness rules the plan names, not the full
      // "recommended" config: that config also enables stylistic
      // auto-formatting rules (class ordering, line-wrapping, canonical
      // class rewriting) that would reformat every className in the kit
      // as a side effect of adding a lint - a much bigger diff than this
      // step asks for. Those are worth adopting deliberately later, with
      // their autofix run once as its own reviewed change.
      "better-tailwindcss/no-unknown-classes": [
        "error",
        // The two logo-swap classes are real CSS in tokens.css, just not
        // Tailwind utilities (docs/dev.md's brand-logo comment explains
        // why they're plain rules rather than a Tailwind variant).
        // `surface-far` is the TV type-scale class (@maipai/ui's own
        // tokens.css), applied directly rather than as a Tailwind
        // utility since it's driven by `useSurface().far`, not a media
        // query.
        { ignore: ["brand-logo-light", "brand-logo-dark", "surface-far"] },
      ],
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: HEX_OR_RGB_ARBITRARY,
              message:
                "No raw hex or rgb() literals (docs/UI.md > Design tokens). Reference a kit token instead, e.g. bg-primary or [var(--primary)].",
            },
          ],
        },
      ],
      "local/hover-needs-focus": "error",
      "local/type-floor": "error",
    },
  },
);
