import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { EngineLinkCredentialSection, addressProblem, groupCode, pairCommand } from "@/apps/settings/EngineLinkCredentialSection";

afterEach(cleanup);

const HTTPS_MESSAGE = "Pairing only works when Home is opened at a secure address that starts with https://. Open Home through its https:// address, then try again.";

interface Hub {
  puts: Array<{ key: string; value: unknown }>;
  confirmed: string[];
  calls: string[];
}

type Options = { confirmStatus?: number; issueError?: string; hostError?: string; connection?: Array<{ id: number; pass: boolean; detail?: string; fix: string }> };

function stubFetch(hub: Hub, options: Options = {}) {
  const values: Record<string, unknown> = { "engines.stack.where": "this_computer", "engines.stack.remote.host": "", "engines.stack.remote.ssh_port": 22 };
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    hub.calls.push(`${method} ${url}`);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.endsWith("/api/engine-link/credentials") && method === "GET") return json({ paired: false });
    if (url.includes("/api/settings?scope=household")) return json(Object.entries(values).map(([key, value]) => ({ key, value, source: "default", label: key, level: "basic", secret: false })));
    if (url.endsWith("/api/settings") && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as { key: string; value: unknown };
      if (body.key === "engines.stack.remote.host" && options.hostError) return json({ error: options.hostError }, 400);
      hub.puts.push({ key: body.key, value: body.value });
      values[body.key] = body.value;
      return json({ key: body.key, value: body.value, source: "user", label: body.key, level: "basic", secret: false });
    }
    if (url.endsWith("/api/engine-link/pair") && method === "POST") {
      return options.issueError ? json({ error: options.issueError }, 400) : json({ code: "ABCDEFGHJKLM", expires_at: new Date(Date.now() + 600_000).toISOString() });
    }
    if (url.endsWith("/api/engine-link/host-key/scan")) return json({ scanned: true });
    if (url.endsWith("/api/engine-link/host-key/confirm")) {
      hub.confirmed.push((JSON.parse(String(init?.body)) as { check_code: string }).check_code);
      const status = options.confirmStatus ?? 200;
      return status === 200 ? json({ paired: true }) : json({ error: "The check code did not match the engine computer" }, status);
    }
    if (url.endsWith("/api/engines/connection-check")) return json({ hops: options.connection ?? [{ id: 1, pass: true, fix: "" }, { id: 2, pass: false, detail: "no answer", fix: "Check that the engine computer is on." }] });
    return Promise.reject(new Error(`unstubbed fetch: ${url} ${method}`));
  }) as unknown as typeof fetch;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><EngineLinkCredentialSection /></QueryClientProvider>);
  return Object.assign(view, within(document.body));
}

async function withHub(options: Options, body: (view: ReturnType<typeof mount>, hub: Hub) => Promise<void>) {
  const original = globalThis.fetch;
  const hub: Hub = { puts: [], confirmed: [], calls: [] };
  globalThis.fetch = stubFetch(hub, options);
  try { await body(mount(), hub); }
  finally { globalThis.fetch = original; }
}

const stepLine = (n: number, title: string) => `Step ${n} of 5: ${title}`;
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); };

async function chooseAnotherComputer(view: ReturnType<typeof mount>) {
  await click(view.getByRole("combobox", { name: "Where the engine runs" }));
  const option = await view.findByRole("option", { name: "Another computer" });
  await act(async () => { fireEvent.pointerDown(option); fireEvent.pointerUp(option); fireEvent.click(option); });
}

async function openWizard(view: ReturnType<typeof mount>) {
  await click(await view.findByRole("button", { name: "Pair engine computer" }));
  await view.findByText(stepLine(1, "Where the engine runs"));
}

async function toAddressStep(view: ReturnType<typeof mount>) {
  await openWizard(view);
  await chooseAnotherComputer(view);
  await click(view.getByRole("button", { name: "Next" }));
  await view.findByText(stepLine(2, "The engine computer's address"));
}

async function toCommandStep(view: ReturnType<typeof mount>) {
  await toAddressStep(view);
  fireEvent.change(view.getByLabelText("Engine computer name or address"), { target: { value: "192.168.1.20" } });
  await click(view.getByRole("button", { name: "Next" }));
  await view.findByText(stepLine(3, "Run one command on the engine computer"));
}

async function toCheckStep(view: ReturnType<typeof mount>) {
  await toCommandStep(view);
  await click(view.getByRole("button", { name: "Next" }));
  await view.findByText(stepLine(4, "Check the engine computer"));
}

describe("the pairing helpers", () => {
  test("the code is grouped in fours and the command is built from the address Home was opened at", () => {
    expect(groupCode("ABCDEFGHJKLM")).toBe("ABCD-EFGH-JKLM");
    expect(pairCommand("https://home.example", "ABCDEFGHJKLM")).toBe("sudo maipai-engine pair https://home.example ABCD-EFGH-JKLM");
  });
  test("an address and port that are wrong say what to fix; good ones say nothing", () => {
    expect(addressProblem("", "22").host).toContain("Enter the engine computer's name or its home network address");
    expect(addressProblem("http://192.168.1.20", "22").host).toContain("no http:// in front");
    expect(addressProblem("my box", "22").host).toContain("no spaces");
    expect(addressProblem("192.168.1.20", "70000").port).toContain("between 1 and 65535");
    expect(addressProblem("192.168.1.20", "").port).toContain("usually 22");
    expect(addressProblem("192.168.1.20", "2222")).toEqual({ host: null, port: null });
    expect(addressProblem("engine-box.local", "22")).toEqual({ host: null, port: null });
  });
});

describe("the pairing wizard (ENGINES-AI-01)", () => {
  test("opens on step 1 of 5, one screen per step, and starts with where the engine runs", async () => {
    await withHub({}, async (view) => {
      await openWizard(view);
      expect(view.getByRole("heading", { name: "Pair engine computer" })).toBeTruthy();
      expect(view.getByRole("combobox", { name: "Where the engine runs" }).textContent).toContain("This computer");
      expect(view.queryByRole("button", { name: "Back" })).toBeNull();
    });
  });

  test("step 1 with This computer says what to choose and saves nothing", async () => {
    await withHub({}, async (view, hub) => {
      await openWizard(view);
      await click(view.getByRole("button", { name: "Next" }));
      expect((await view.findByRole("alert")).textContent).toContain("Choose Another computer to continue");
      expect(hub.puts).toEqual([]);
      expect(view.getByText(stepLine(1, "Where the engine runs"))).toBeTruthy();
    });
  });

  test("choosing Another computer saves it and opens the address step; Back returns with the choice kept", async () => {
    await withHub({}, async (view, hub) => {
      await toAddressStep(view);
      expect(hub.puts).toEqual([{ key: "engines.stack.where", value: "another_computer" }]);
      await click(view.getByRole("button", { name: "Back" }));
      await view.findByText(stepLine(1, "Where the engine runs"));
      expect(view.getByRole("combobox", { name: "Where the engine runs" }).textContent).toContain("Another computer");
    });
  });

  test("the address step checks as you type: it says what to fix, blocks Next, and sends nothing", async () => {
    await withHub({}, async (view, hub) => {
      await toAddressStep(view);
      const next = view.getByRole("button", { name: "Next" }) as HTMLButtonElement;
      expect(next.disabled).toBe(true);
      fireEvent.change(view.getByLabelText("Engine computer name or address"), { target: { value: "http://192.168.1.20" } });
      expect(view.getByText(/no http:\/\/ in front/)).toBeTruthy();
      expect(next.disabled).toBe(true);
      fireEvent.change(view.getByLabelText("Engine computer name or address"), { target: { value: "192.168.1.20" } });
      fireEvent.change(view.getByLabelText("Secure connection port"), { target: { value: "70000" } });
      expect(view.getByText(/between 1 and 65535/)).toBeTruthy();
      expect(next.disabled).toBe(true);
      expect(hub.puts.map((put) => put.key)).toEqual(["engines.stack.where"]);
    });
  });

  test("an address the hub refuses shows the hub's words and stays on the address step", async () => {
    const refusal = "That address is outside your home network. Enter the engine computer's name or its home network address, for example 192.168.1.20.";
    await withHub({ hostError: refusal }, async (view) => {
      await toAddressStep(view);
      fireEvent.change(view.getByLabelText("Engine computer name or address"), { target: { value: "8.8.8.8" } });
      await click(view.getByRole("button", { name: "Next" }));
      expect((await view.findByRole("alert")).textContent).toBe(refusal);
      expect(view.getByText(stepLine(2, "The engine computer's address"))).toBeTruthy();
    });
  });

  test("step 3 shows the one-time code and ONE copyable command built from Home's own address", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } });
    await withHub({}, async (view, hub) => {
      await toCommandStep(view);
      expect(hub.puts.map((put) => put.key)).toEqual(["engines.stack.where", "engines.stack.remote.host", "engines.stack.remote.ssh_port"]);
      const command = `sudo maipai-engine pair ${window.location.origin} ABCD-EFGH-JKLM`;
      expect(view.getByLabelText("Pairing command").textContent).toBe(command);
      expect(view.getAllByLabelText("Pairing command")).toHaveLength(1);
      await click(view.getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(written).toEqual([command]));
      expect(view.getByRole("button", { name: "Copied" })).toBeTruthy();
    });
  });

  test("on an address that is not https the hub's own message, with its fix, is shown on step 3", async () => {
    await withHub({ issueError: HTTPS_MESSAGE }, async (view) => {
      await toCommandStep(view);
      expect((await view.findByRole("alert")).textContent).toBe(HTTPS_MESSAGE);
      expect((view.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
      expect(view.queryByLabelText("Pairing command")).toBeNull();
    });
  });

  test("step 4 checks the computer, takes the check code and lands on Done with the connection check", async () => {
    await withHub({}, async (view, hub) => {
      await toCheckStep(view);
      await click(view.getByRole("button", { name: "Check the engine computer" }));
      const input = await view.findByLabelText("Check code from the engine computer");
      fireEvent.change(input, { target: { value: "abcd-efgh-jklm" } });
      await click(view.getByRole("button", { name: "Pin this computer" }));
      await view.findByText(stepLine(5, "Done"));
      expect(hub.confirmed).toEqual(["abcd-efgh-jklm"]);
      expect(view.getByText("Paired. Home now trusts this engine computer.")).toBeTruthy();
      await waitFor(() => expect(view.getByText(/^PASS hop 1/)).toBeTruthy());
      expect(view.getByText(/^FAIL hop 2: no answer\. To fix: Check that the engine computer is on\./)).toBeTruthy();
      // The dialog's own corner Close and the step's Close button.
      expect(view.getAllByRole("button", { name: "Close" }).length).toBe(2);
    });
  });

  test("a wrong check code shows the error and clears the box", async () => {
    await withHub({ confirmStatus: 400 }, async (view) => {
      await toCheckStep(view);
      await click(view.getByRole("button", { name: "Check the engine computer" }));
      const input = (await view.findByLabelText("Check code from the engine computer")) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "WRONGWRONGWR" } });
      await click(view.getByRole("button", { name: "Pin this computer" }));
      expect((await view.findByRole("alert")).textContent).toBe("The check code did not match the engine computer");
      expect(input.value).toBe("");
    });
  });

  test("a locked pairing (429) goes back to the command step to start again", async () => {
    await withHub({ confirmStatus: 429 }, async (view) => {
      await toCheckStep(view);
      await click(view.getByRole("button", { name: "Check the engine computer" }));
      fireEvent.change(await view.findByLabelText("Check code from the engine computer"), { target: { value: "WRONGWRONGWR" } });
      await click(view.getByRole("button", { name: "Pin this computer" }));
      await view.findByText(stepLine(3, "Run one command on the engine computer"));
      expect(view.getByRole("button", { name: "Get a one-time code" })).toBeTruthy();
    });
  });
});
