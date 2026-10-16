import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { ApiError, api } from "@/lib/api";

afterEach(cleanup);

test("capability removal uses the kit dialog and confirms the same server message", async () => {
  const key = SettingsKey.parse({ key: "engines.image.choice", scope: "household", selector: "boolean", default: true, label: "Pictures", help: "Use pictures.", level: "basic", lives_in: "household.ai", honoured_by: ["home"] });
  const registry = spyOn(api, "settingsRegistry").mockResolvedValue([key] as never);
  const values = spyOn(api, "settingsValues").mockResolvedValue([{ key: key.key, value: true, source: "default", label: key.label, level: "basic", secret: false }] as never);
  const message = "Turning off Pictures removes Art. The following will be uninstalled and users will lose access. Anything made with them stays in Library.";
  const set = spyOn(api, "setSetting")
    .mockRejectedValueOnce(new ApiError(message, 409))
    .mockResolvedValueOnce({ key: key.key, value: false, source: "user", label: key.label, level: "basic", secret: false } as never);
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter><SettingsRenderer scope="household" scopeValue="household" only={["household.ai"]} /></MemoryRouter></QueryClientProvider>);
    const control = await view.findByRole("switch", { name: "Pictures" });
    fireEvent.click(control);
    expect(await view.findByText(message)).toBeTruthy();
    expect(set).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenLastCalledWith("household", key.key, false, true);
  } finally { registry.mockRestore(); values.mockRestore(); set.mockRestore(); }
});
