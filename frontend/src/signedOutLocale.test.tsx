// I18N-F6: before anyone signs in, the sign-in page and /setup read the household language from GET /api/auth/locale, and nothing below the
// root's gate draws until that language is active (so no page is drawn in English and then flips, and /setup stays addressable on a fresh hub).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { activateLocale, i18n } from "@/i18n";
import { createQueryClient } from "@/lib/queryClient";
import { PersonLocale } from "@/App";
import { SignInPage } from "@/shell/pages/SignInPage";
import { SetupWizard } from "@/apps/setup/SetupWizard";

(globalThis as unknown as { __SETUP_PREVIEW__: boolean }).__SETUP_PREVIEW__ = false;
const original = globalThis.fetch;
beforeEach(() => { sessionStorage.setItem("maipai:setup-before-start-read", "true"); });
afterEach(async () => { cleanup(); globalThis.fetch = original; await activateLocale("en-US"); });

const sage = { id: "p1", display_name: "Sage", nickname: null, role: "owner", avatar_seed: "p1", source: "hub", local_only: false, enabled: true, hasSecret: true, pinDigits: null };
const now = new Date().toISOString();
const freshSetup = { id: "setup-test", source: "wizard", completed_at: null, steps: ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner"].map((id) => ({ id, status: "pending", at: now })) };

function hub(householdLocale: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (url.includes("/api/auth/locale")) { await new Promise((resolve) => setTimeout(resolve, 30)); return Response.json({ locale: householdLocale }); }
    if (url.includes("/api/auth/profiles")) return Response.json([sage]);
    if (url.includes("/api/setup/state")) return Response.json(freshSetup);
    return Response.json({});
  }) as typeof fetch;
}

/** What App mounts above the router for a signed-out visitor (`person` is null): the gate, then the page. */
function signedOutRoot(page: React.ReactElement, path: string) {
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <PersonLocale person={null}><MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={page} /></Routes></MemoryRouter></PersonLocale>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

test("signed out with the household on es: the sign-in page reads Spanish and was never drawn in English first", async () => {
  hub("es");
  const seen: string[] = [];
  const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ""));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const view = signedOutRoot(<SignInPage onSignedIn={() => {}} />, "/sign-in");
  await waitFor(() => expect(view.getByText("Sage")).toBeTruthy());
  fireEvent.click(view.getByText("Sage"));
  await waitFor(() => expect(view.getByText("Contraseña")).toBeTruthy());
  expect(view.queryByText("Password")).toBeNull();
  expect(seen.some((text) => /\bPassword\b|\bBack\b/.test(text))).toBe(false);
  observer.disconnect();
});

test("/setup on a fresh hub: household.locale es reads Spanish, unset reads English", async () => {
  hub("es");
  const spanish = signedOutRoot(<SetupWizard onDone={() => {}} />, "/setup");
  await waitFor(() => expect(spanish.getByText("Configurar mi Home")).toBeTruthy(), { timeout: 5000 });
  expect(spanish.queryByText("Set up my Home")).toBeNull();
  cleanup();
  await activateLocale("en-US");

  hub("en-US");
  const english = signedOutRoot(<SetupWizard onDone={() => {}} />, "/setup");
  await waitFor(() => expect(english.getByText("Set up my Home")).toBeTruthy(), { timeout: 5000 });
});
