import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { StatusApps } from "@/shell/pages/status/StatusApps";
import { appStatusPresentation } from "@/shell/statusApps";
import type { Roster, StatusApp } from "@/lib/api";

afterEach(cleanup);

const person = (role: Roster["role"]) => ({ role }) as Roster;
const app = (state: "operational" | "degraded" | "down" | "waiting_for_internet"): StatusApp => ({
  id: "chat", name: "Chat", state,
  reason: state === "operational" ? null : "Chat isn't working right now.",
  needs: [{ kind: "engine", id: "chat", name: "Brain", state: state === "waiting_for_internet" ? "waiting" : state, purpose: "Chat model", required: true }],
  history: Array.from({ length: 90 }, (_, index) => ({
    date: `2026-09-${String((index % 30) + 1).padStart(2, "0")}`, state, uptime: 0.5,
    minutes: { operational: 0, degraded: state === "degraded" || state === "waiting_for_internet" ? 1 : 0, outage: state === "down" ? 1 : 0, maintenance: 0 },
  })),
  uptimePercent: 99.5,
});

const appWithNeeds = (needs: NonNullable<StatusApp["needs"]>, state: StatusApp["state"] = "operational"): StatusApp => ({
  ...app(state), needs, reason: state === "operational" ? null : "Chat isn't working right now.",
});

describe("app status presentation", () => {
  test.each([
    ["operational", "online", "Working"],
    ["degraded", "degraded", "Degraded"],
    ["down", "offline", "Not working"],
    ["waiting_for_internet", "degraded", "Waiting for internet"],
  ] as const)("maps %s into the shipped status vocabulary", (state, status, label) => {
    expect(appStatusPresentation(state)).toEqual({ status, label });
  });

  test.each([
    ["operational", "online", "Working"],
    ["degraded", "degraded", "Degraded"],
    ["down", "offline", "Not working"],
    ["waiting_for_internet", "degraded", "Waiting for internet"],
  ] as const)("renders the app %s state", (state, status, label) => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[app(state)]} /></TooltipProvider>);
    expect(view.getByText("Chat")).toBeInTheDocument();
    expect(view.getAllByText(label).some((element) => element.getAttribute("data-status") === status)).toBe(true);
    expect(view.getByRole("img", { name: /Last 90 days: 99.500% uptime/ })).toBeInTheDocument();
  });

  test.each(["degraded", "down", "waiting_for_internet"] as const)("renders %s for the household without dependency names or controls", (state) => {
    const view = render(<TooltipProvider><StatusApps person={person("adult")} apps={[{ ...app(state), needs: undefined }]} /></TooltipProvider>);
    expect(view.getByText("Chat")).toBeInTheDocument();
    expect(view.getByText("Chat isn't working right now.")).toBeInTheDocument();
    expect(view.queryByText(/Needs: Brain/)).not.toBeInTheDocument();
    expect(view.queryByText("Behind the scenes")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: /Restart|Stop|Start/ })).not.toBeInTheDocument();
  });

  test("admins see a compact collapsed row when no need has a problem", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[appWithNeeds([
      { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "operational", required: true },
    ])]} /></TooltipProvider>);
    const trigger = view.getByRole("button", { name: /Show details/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.getAttribute("aria-controls")).toBe("app-needs-chat");
    expect(Boolean(view.container.querySelector(`#${trigger.getAttribute("aria-controls")}`))).toBe(true);
    expect(trigger.parentElement).toHaveClass("min-h-12");
    expect(view.getByTestId("app-details-chevron")).not.toHaveClass("rotate-180");
    expect(view.getByText("All fine.")).toBeInTheDocument();
    expect(view.getByText("MaiPai's AI")).not.toBeVisible();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(view.getByRole("button", { name: /Hide details/ })).toBe(trigger);
    expect(view.getByTestId("app-details-chevron")).toHaveClass("rotate-180");
    expect(view.getByText("MaiPai's AI")).toBeInTheDocument();
  });

  test("unknown-only needs stay collapsed and do not appear in the summary", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[appWithNeeds([
      { kind: "service", id: "musicbrainz.org", name: "MusicBrainz", purpose: "Look up music", state: "unknown", required: false },
    ])]} /></TooltipProvider>);
    const trigger = view.getByRole("button", { name: /Show details/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(view.getByText("No recent problems.")).toBeInTheDocument();
    expect(view.queryByText("MusicBrainz")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const noRecent = view.getByRole("button", { name: "No recent use: 1 services" });
    expect(noRecent).toHaveAttribute("data-size", "sm");
    fireEvent.click(noRecent);
    expect(view.getByText("MusicBrainz")).toBeInTheDocument();
  });

  test("auto-expands a problem and groups attention, working, and unused needs", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[appWithNeeds([
      { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "down", required: true, last_success_at: "2026-10-01T09:15:00.000Z", last_error_class: "process_exited" },
      { kind: "engine", id: "memory", name: "Memory", purpose: "Recall context", state: "operational", required: false },
      { kind: "service", id: "musicbrainz.org", name: "MusicBrainz", purpose: "Look up music", state: "unknown", required: false },
      { kind: "service", id: "en.wikipedia.org", name: "Wikipedia", purpose: "Look up facts", state: "unknown", required: false },
    ], "down")]} behindTheScenes={<div>Brain raw part</div>} /></TooltipProvider>);
    const trigger = view.getByRole("button", { name: /Hide details/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(view.getByTestId("app-details-chevron")).toHaveClass("rotate-180");
    expect(view.getByText("Needs attention")).toBeInTheDocument();
    expect(view.getByText("MaiPai's AI")).toBeInTheDocument();
    expect(view.getByText("Last success: 2026-10-01T09:15:00.000Z")).toBeInTheDocument();
    expect(view.getByText("Last error: process exited")).toBeInTheDocument();
    expect(view.getByText("Working")).toBeInTheDocument();
    expect(view.getByText("Memory")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "No recent use: 2 services" })).toBeInTheDocument();
    expect(view.queryByText("MusicBrainz")).not.toBeInTheDocument();
    expect(view.getByText("Behind the scenes")).toBeInTheDocument();
    expect(view.getByText("Brain raw part")).toBeInTheDocument();
  });

  test("members see the summary without an expander or need names", () => {
    const view = render(<TooltipProvider><StatusApps person={person("adult")} apps={[{
      ...app("down"), reason: "Chat isn't working right now.",
    }]} /></TooltipProvider>);
    expect(view.getByText("Chat isn't working right now.")).toBeInTheDocument();
    expect(view.queryByRole("button")).not.toBeInTheDocument();
    expect(view.queryByText("Brain")).not.toBeInTheDocument();
  });

  test("admins get no expander when an app has no needs to show", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[appWithNeeds([])]} /></TooltipProvider>);
    expect(view.queryByRole("button", { name: /Show details|Hide details/ })).not.toBeInTheDocument();
  });

  test.each(["Enter", " "])("the details button toggles with keyboard key %s", (key) => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[appWithNeeds([
      { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "operational", required: true },
    ])]} /></TooltipProvider>);
    const trigger = view.getByRole("button", { name: /Show details/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    // happy-dom does not synthesize a native button click from keyboard input.
    // Dispatch the browser's native activation event after the key event.
    fireEvent.click(trigger);
    fireEvent.keyUp(trigger, { key });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(view.getByRole("button", { name: /Hide details/ })).toBe(trigger);
  });

  test("keeps raw parts under Behind the scenes", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[app("down")]} behindTheScenes={<div>Brain raw part</div>} /></TooltipProvider>);
    expect(view.getByText("Behind the scenes")).toBeInTheDocument();
    expect(view.getByText("Brain raw part")).toBeInTheDocument();
  });
});
