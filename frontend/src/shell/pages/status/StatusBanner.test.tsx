import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { statusBannerCard } from "@/shell/pages/status/StatusBanner";

const StatusBanner = (props: Parameters<typeof statusBannerCard>[0]) => <StatusCard {...statusBannerCard(props)} />;

describe("StatusBanner", () => {
  test("renders the online headline and uptime", () => {
    const view = render(<StatusBanner summary={{ level: "online", text: "All good", problems: [] }} uptimeSeconds={3600} />);
    expect(view.getByText("We're fully operational")).toBeTruthy();
    expect(view.getByText("Everything is running. Up for 1 hour.")).toBeTruthy();
    expect(view.getByLabelText("Operational")).toBeTruthy();
  });

  test("renders degraded startup copy", () => {
    const view = render(<StatusBanner summary={{ level: "degraded", text: "Degraded", problems: ["Voice"] }} />);
    expect(view.getByText("Some parts are starting up")).toBeTruthy();
    expect(view.getByText("It should be back in a moment.")).toBeTruthy();
  });

  test("renders offline part names", () => {
    const view = render(<StatusBanner summary={{ level: "offline", text: "Something is down", problems: ["Brain", "Memory"] }} />);
    expect(view.getByText("We're having problems")).toBeTruthy();
    expect(view.getByText("Brain and Memory")).toBeTruthy();
    expect(view.getByText("We're looking into it.")).toBeTruthy();
  });

  test("renders maintenance part names and end time", () => {
    const view = render(<StatusBanner summary={{ level: "maintenance", text: "Maintenance", problems: ["Voice"] }} maintenanceEndsAt="2026-09-30T16:05:00" />);
    expect(view.getByText("Scheduled maintenance is in progress")).toBeTruthy();
    expect(view.getByText(/Voice\. Until /)).toBeTruthy();
  });
});
