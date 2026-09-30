import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { RecentProblems, StatusIncident } from "@/next/pages/status/StatusIncident";

describe("StatusIncident", () => {
  test("shows offline singular title and meta", () => {
    const view = render(<StatusIncident level="offline" problems={["Brain"]} />);
    expect(view.getByText("Brain isn't running")).toBeTruthy();
    expect(view.getByText("MaiPai is checking on it.")).toBeTruthy();
    expect(view.getByText("Investigating · Affects Brain")).toBeTruthy();
  });

  test("shows offline plural title", () => {
    const view = render(<StatusIncident level="offline" problems={["Brain", "Memory"]} />);
    expect(view.getByText("Brain and Memory aren't running")).toBeTruthy();
  });

  test("shows degraded title and hides online and maintenance incidents", () => {
    const degraded = render(<StatusIncident level="degraded" problems={["Voice"]} />);
    expect(degraded.getByText("Voice is starting up")).toBeTruthy();
    degraded.unmount();
    expect(render(<StatusIncident level="online" problems={[]} />).container.firstChild).toBeNull();
    expect(render(<StatusIncident level="maintenance" problems={[]} />).container.firstChild).toBeNull();
  });

  test("hides recent problems when the history has no incidents", () => {
    const view = render(<RecentProblems history={{ generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: [] }} />);
    expect(view.container.firstChild).toBeNull();
  });
});
