import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupWizard } from "@/apps/setup/SetupWizard";
import type { HardwareInfo, ModelFit } from "@/lib/api";

afterEach(cleanup);

beforeEach(() => {
  sessionStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(byPath: Record<string, unknown | (() => Response)>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const value = match[1];
    return Promise.resolve(typeof value === "function" ? value() : jsonResponse(value));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// A no-resume-state render checks `/api/auth/profiles` first (the real
// fix for a code review finding: `/setup` used to be reachable
// unconditionally even once a household already had an owner) - every
// test starting cold needs this stubbed, same as a genuinely empty
// household's first-ever visit.
function stubFreshHousehold(extra: Record<string, unknown | (() => Response)> = {}): () => void {
  return stubFetch({ "/api/auth/profiles": [], ...extra });
}

function renderWizard(onDone: () => void = () => {}) {
  return render(
    <MemoryRouter>
      <SetupWizard onDone={onDone} />
    </MemoryRouter>,
  );
}

const HARDWARE: HardwareInfo = {
  platform: "darwin",
  arch: "arm64",
  totalRamGb: 16,
  cpuCount: 8,
  isAppleSilicon: true,
  unifiedMemoryGb: 16,
  cudaDevices: [],
};

const MODEL_FITS: ModelFit[] = [
  {
    model: {
      id: "small-chat",
      role: "chat",
      label: "Small Chat Model",
      license: "apache-2.0",
      engine: "llama-server",
      implemented: true,
      sizing: { paramsB: 3, quant: "q4_k_m", diskBytes: 2_000_000_000, ramBytes: 3_000_000_000 },
    } as ModelFit["model"],
    fits: true,
    requiredBytes: 3_000_000_000,
    budgetBytes: 12_000_000_000,
  },
];

async function goToOwnerStep(rendered: ReturnType<typeof render>) {
  await rendered.findByRole("heading", { name: "Household" });
  await act(async () => {
    fireEvent.change(rendered.getByPlaceholderText(/household/i), { target: { value: "The Bramble household" } });
  });
  await act(async () => {
    fireEvent.click(rendered.getByRole("button", { name: "Continue" }));
  });
}

describe("SetupWizard", () => {
  test("steps run in order: household, then owner", async () => {
    const restore = stubFreshHousehold();
    try {
      const rendered = renderWizard();
      await goToOwnerStep(rendered);
      expect(rendered.getByRole("heading", { name: "Your profile" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("Back returns to the previous step without losing what was entered there", async () => {
    const restore = stubFreshHousehold();
    try {
      const rendered = renderWizard();
      await goToOwnerStep(rendered);
      await act(async () => {
        fireEvent.click(rendered.getByRole("button", { name: "Back" }));
      });
      expect(rendered.getByRole("heading", { name: "Household" })).toBeTruthy();
      expect((rendered.getByPlaceholderText(/household/i) as HTMLInputElement).value).toBe("The Bramble household");
    } finally {
      restore();
    }
  });

  test("the owner step creates the household, real API call, then advances", async () => {
    const restore = stubFreshHousehold({ "/api/auth/setup": { person: { id: "p1" } } });
    try {
      const rendered = renderWizard();
      await goToOwnerStep(rendered);
      await act(async () => {
        fireEvent.change(rendered.getByPlaceholderText("Your name"), { target: { value: "Sage" } });
      });
      await act(async () => {
        fireEvent.change(rendered.getByPlaceholderText("Choose a PIN or password"), { target: { value: "correcthorse" } });
      });
      await act(async () => {
        fireEvent.click(rendered.getByRole("button", { name: "Continue" }));
      });
      await waitFor(() => expect(rendered.getByRole("heading", { name: "Before you start" })).toBeTruthy());
    } finally {
      restore();
    }
  });

  test("a failed owner submission shows the error and does not advance", async () => {
    const restore = stubFreshHousehold({ "/api/auth/setup": () => jsonResponse({ error: "Name taken" }, 400) });
    try {
      const rendered = renderWizard();
      await goToOwnerStep(rendered);
      await act(async () => {
        fireEvent.change(rendered.getByPlaceholderText("Your name"), { target: { value: "Sage" } });
      });
      await act(async () => {
        fireEvent.change(rendered.getByPlaceholderText("Choose a PIN or password"), { target: { value: "correcthorse" } });
      });
      await act(async () => {
        fireEvent.click(rendered.getByRole("button", { name: "Continue" }));
      });
      await waitFor(() => expect(rendered.getByText("Name taken")).toBeTruthy());
      expect(rendered.getByRole("heading", { name: "Your profile" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("the acknowledgment gate blocks Continue until checked, and is shown only once per browser", async () => {
    const restore = stubFreshHousehold({ "/api/auth/setup": { person: { id: "p1" } } });
    try {
      const rendered = renderWizard();
      await goToOwnerStep(rendered);
      await act(async () => {
        fireEvent.change(rendered.getByPlaceholderText("Your name"), { target: { value: "Sage" } });
        fireEvent.change(rendered.getByPlaceholderText("Choose a PIN or password"), { target: { value: "correcthorse" } });
      });
      await act(async () => {
        fireEvent.click(rendered.getByRole("button", { name: "Continue" }));
      });
      await waitFor(() => expect(rendered.getByRole("heading", { name: "Before you start" })).toBeTruthy());

      const continueButton = rendered.getByRole("button", { name: "Continue" });
      expect(continueButton.hasAttribute("disabled")).toBe(true);

      await act(async () => {
        fireEvent.click(rendered.getByRole("checkbox"));
      });
      expect(continueButton.hasAttribute("disabled")).toBe(false);

      expect(sessionStorage.getItem("maipai:unrestricted-acknowledged")).not.toBe("true");
      await act(async () => {
        fireEvent.click(continueButton);
      });
      expect(sessionStorage.getItem("maipai:unrestricted-acknowledged")).toBe("true");
    } finally {
      restore();
    }
  });

  test("resuming mid-wizard (a reload) starts back on the step reached, with earlier steps marked done", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "2");
    sessionStorage.setItem("maipai:setup-wizard-completed", "2");
    const rendered = renderWizard();
    expect(rendered.getByRole("heading", { name: "Before you start" })).toBeTruthy();
    // Both earlier steps are done and jumpable.
    fireEvent.click(rendered.getByRole("button", { name: /Household/ }));
    expect(rendered.getByRole("heading", { name: "Household" })).toBeTruthy();
  });

  test("jumping back to review a completed step and reloading does not re-lock later completed steps", async () => {
    // Simulates: finished through hardware (completed=4), jumped back to
    // review "Owner" (index 1) - a code review (2026-09-06) found the
    // original version only ever persisted the resumed index, so a
    // reload here re-derived completedCount from it (1) instead of from
    // what had really finished (4), silently re-locking acknowledgment
    // and hardware.
    sessionStorage.setItem("maipai:setup-wizard-step", "1");
    sessionStorage.setItem("maipai:setup-wizard-completed", "4");
    const rendered = renderWizard();
    expect(rendered.getByRole("heading", { name: "Your profile" })).toBeTruthy();
    fireEvent.click(rendered.getByRole("button", { name: /Hardware/ }));
    expect(rendered.getByRole("heading", { name: "Hardware" })).toBeTruthy();
  });

  test("the hardware step loads real detection data and requires a model pick before continuing", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "3");
    const restore = stubFetch({
      // Most specific first: `stubFetch` matches by substring in
      // insertion order, and "/api/host/models" is itself a prefix of
      // both of the more specific paths below - listed after them, it
      // would swallow their requests too (a real bug found live in this
      // exact test the first time it was written).
      "/api/host/models/selection": { modelId: null },
      // The real select route returns a job, not an instant success (a
      // code review finding); "ready" here simulates a model whose
      // files are already fully cached, the same already-ready path
      // ModelsSection.tsx's own tests cover.
      "/api/host/models/small-chat/select": { modelId: "small-chat", status: "ready", phase: "", completedBytes: 0, totalBytes: 0, error: null, postLoadCheck: null },
      "/api/host/hardware": HARDWARE,
      "/api/host/models": MODEL_FITS,
    });
    try {
      const rendered = renderWizard();
      await rendered.findByText(/Apple Silicon/);
      const continueButton = rendered.getByRole("button", { name: "Continue" });
      expect(continueButton.hasAttribute("disabled")).toBe(true);

      await act(async () => {
        fireEvent.click(rendered.getByText("Small Chat Model"));
      });
      await waitFor(() => expect(rendered.getByText("Selected")).toBeTruthy());
      expect(continueButton.hasAttribute("disabled")).toBe(false);
      // Found live 2026-09-06: an already-selected model's own button
      // wasn't disabled, so clicking it again fired a redundant re-select
      // job whose early phases have no byte count yet - all a household
      // member saw was a second, wordless spinner appear from nowhere.
      const modelButton = rendered.getByText("Small Chat Model").closest("button");
      expect(modelButton?.hasAttribute("disabled")).toBe(true);
    } finally {
      restore();
    }
  });

  // Found live 2026-09-06: a real model download sat at a static "Setting
  // up…" with no phase or percentage, indistinguishable from a genuinely
  // stuck job - the backend already tracks a human phase and a real byte
  // count (ModelsSection.tsx's own settings-page card already shows
  // both), this step just never read either.
  test("a real download job shows its phase and byte progress, not a static 'Setting up…'", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "3");
    const restore = stubFetch({
      "/api/host/models/selection": { modelId: null },
      "/api/host/models/small-chat/select": {
        modelId: "small-chat",
        status: "downloading_model",
        phase: "downloading model weights",
        completedBytes: 1024 * 1024 * 1024,
        totalBytes: 2 * 1024 * 1024 * 1024,
        error: null,
        postLoadCheck: null,
      },
      "/api/host/hardware": HARDWARE,
      "/api/host/models": MODEL_FITS,
    });
    try {
      const rendered = renderWizard();
      await rendered.findByText(/Apple Silicon/);
      const continueButton = rendered.getByRole("button", { name: "Continue" });
      await act(async () => {
        fireEvent.click(rendered.getByText("Small Chat Model"));
      });
      await waitFor(() => expect(rendered.getByText("Downloading the model…")).toBeTruthy());
      expect(rendered.queryByText("Setting up…")).toBeNull();
      expect(rendered.getByText(/1 GB of 2 GB/)).toBeTruthy();
      // Jesse, 2026-09-06: picking a model shouldn't force a wait on this
      // screen for the whole download/verify/load/test cycle - the job
      // keeps running on the server regardless of which step the wizard
      // is on, so Continue only needs a job in progress, not "ready".
      expect(continueButton.hasAttribute("disabled")).toBe(false);
    } finally {
      restore();
    }
  });

  test("a hardware fit list with nothing that fits offers Skip instead of trapping the household", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "3");
    const restore = stubFetch({
      "/api/host/models/selection": { modelId: null },
      "/api/host/hardware": HARDWARE,
      "/api/host/models": [{ ...MODEL_FITS[0], fits: false }],
    });
    try {
      const rendered = renderWizard();
      await rendered.findByText(/no model in the default set fits/i);
      expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
      await act(async () => {
        fireEvent.click(rendered.getByRole("button", { name: "Skip - choose a model later" }));
      });
      expect(rendered.getByRole("heading", { name: "Trust this hub" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("a not-yet-built step (trust) is skippable and says why, and cannot be completed with Continue", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "4");
    const rendered = renderWizard();
    expect(rendered.getByRole("heading", { name: "Trust this hub" })).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.click(rendered.getByRole("button", { name: "Skip - not built yet" }));
    });
    expect(rendered.getByRole("heading", { name: "Packages" })).toBeTruthy();
  });

  test("the done step calls onDone and navigates away, so the app cannot get stuck on /setup", async () => {
    sessionStorage.setItem("maipai:setup-wizard-step", "9");
    sessionStorage.setItem("maipai:setup-wizard-completed", "9");
    const onDone = mock(() => {});
    const rendered = renderWizard(onDone);
    expect(rendered.getByRole("heading", { name: "Done" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(rendered.getByRole("button", { name: "Go to MaiPai Home" }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    // Resume state is cleared once the wizard is genuinely finished, so a
    // later fresh visit to /setup does not resume a done wizard forever.
    expect(sessionStorage.getItem("maipai:setup-wizard-step")).toBeNull();
    expect(sessionStorage.getItem("maipai:setup-wizard-completed")).toBeNull();
  });

  test("a fresh visit to /setup with an existing household redirects away instead of re-running setup", async () => {
    const restore = stubFetch({ "/api/auth/profiles": [{ id: "p1", display_name: "Sage", hasSecret: true }] });
    try {
      const rendered = renderWizard();
      await waitFor(() => expect(rendered.container.querySelector("h1")).toBeNull());
    } finally {
      restore();
    }
  });
});
