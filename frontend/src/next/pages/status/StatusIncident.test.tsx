import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { StatusIncident } from "@/next/pages/status/StatusIncident";

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
});
