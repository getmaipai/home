import { describe, expect, test, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { setupI18n } from "@lingui/core";
import { I18nProvider, Trans } from "@lingui/react";

afterEach(cleanup);

// A real production outage, not a hypothetical: Lingui's documented
// Vite+React setup wires its `<Trans>`/`t` MACRO transform through
// `@vitejs/plugin-react`'s `babel.plugins` option, which the installed
// version of that plugin doesn't have at all (it moved to
// `oxc-transform-react` and dropped Babel). The option was accepted
// silently - no type error, no build error - and every macro call fell
// through to its own runtime guard, which throws the moment React
// renders one. That broke every page in the app, since the affected
// component (`Shell.tsx`'s nav rail) is on every signed-in route.
// Fixed by dropping macros for Lingui's plain runtime API instead
// (`<Trans id= message=>`, `i18n._()`), which needs no build-time
// transform at all - this test proves exactly that path still works. A
// throwaway `setupI18n()` instance, not `@/i18n`'s own real one: `bun
// test` has no `.po`-file loader (that's `@lingui/vite-plugin`'s own
// Vite-only compile-on-import transform), so importing `@/i18n` here
// would fail for an unrelated reason before this test ever ran; a hand-
// built catalog exercises the exact same `<Trans>`/`i18n._()` runtime
// path this bug broke, just without depending on `.po` file loading.
describe("i18n runtime API (no macros)", () => {
  function makeI18n() {
    const inst = setupI18n({
      locale: "en-US",
      messages: { "en-US": { Search: "Search" } },
    });
    return inst;
  }

  test("Trans renders real translated text through a real I18nProvider, without throwing", () => {
    const inst = makeI18n();
    const { getByText } = render(
      <I18nProvider i18n={inst}>
        <Trans id="Search" message="Search" />
      </I18nProvider>,
    );
    expect(getByText("Search")).toBeTruthy();
  });

  test("i18n._() returns real translated text", () => {
    const inst = makeI18n();
    expect(inst._("Search")).toBe("Search");
  });
});
