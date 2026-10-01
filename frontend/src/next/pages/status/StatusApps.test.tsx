import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { StatusApps } from "@/next/pages/status/StatusApps";
import { appStatusPresentation } from "@/shell/statusApps";
import type { Roster, StatusApp } from "@/lib/api";

afterEach(cleanup);

const person = (role: Roster["role"]) => ({ role }) as Roster;
const app = (state: "operational" | "degraded" | "down" | "waiting_for_internet"): StatusApp => ({
  id: "chat", name: "Chat", state,
  reason: state === "operational" ? null : "Chat is having trouble because Brain is down.",
  needs: [{ kind: "engine", id: "chat", name: "Brain", state: "down", required: true }],
  history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-09-${String((index % 30) + 1).padStart(2, "0")}`, state, uptime: 0.5 })),
  uptimePercent: 99.5,
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
    expect(view.getByText(label).getAttribute("data-status")).toBe(status);
    expect(view.getByRole("img", { name: /Last 90 days: 99.500% uptime/ })).toBeInTheDocument();
  });

  test.each(["degraded", "down", "waiting_for_internet"] as const)("renders %s for the household without dependency names or controls", (state) => {
    const view = render(<TooltipProvider><StatusApps person={person("adult")} apps={[app(state)]} /></TooltipProvider>);
    expect(view.getByText("Chat")).toBeInTheDocument();
    expect(view.getByText("Chat is having trouble because Brain is down.")).toBeInTheDocument();
    expect(view.queryByText(/Needs: Brain/)).not.toBeInTheDocument();
    expect(view.queryByText("Behind the scenes")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: /Restart|Stop|Start/ })).not.toBeInTheDocument();
  });

  test("shows admin needs and raw parts under Behind the scenes", () => {
    const view = render(<TooltipProvider><StatusApps person={person("admin")} apps={[app("down")]} behindTheScenes={<div>Brain raw part</div>} /></TooltipProvider>);
    expect(view.getByText("Needs: Brain (down)")).toBeInTheDocument();
    expect(view.getByText("Behind the scenes")).toBeInTheDocument();
    expect(view.getByText("Brain raw part")).toBeInTheDocument();
  });
});
