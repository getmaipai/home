import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { StatusIncidentBody, statusIncidentFacts } from "@/shell/pages/status/StatusIncident";

describe("statusIncidentFacts", () => {
  test("shows offline singular title and meta", () => {
    const facts = statusIncidentFacts({ level: "offline", problems: ["Brain"] });
    expect(facts?.title).toBe("Brain isn't running");
    const view = render(<StatusIncidentBody facts={facts!} />);
    expect(view.getByText("MaiPai is checking on it.")).toBeTruthy();
    expect(view.getByText("Investigating · Affects Brain")).toBeTruthy();
  });

  test("shows offline plural title", () => {
    expect(statusIncidentFacts({ level: "offline", problems: ["Brain", "Memory"] })?.title).toBe("Brain and Memory aren't running");
  });

  test("shows degraded title and has nothing for online and maintenance", () => {
    expect(statusIncidentFacts({ level: "degraded", problems: ["Voice"] })?.title).toBe("Voice is starting up");
    expect(statusIncidentFacts({ level: "online", problems: [] })).toBeNull();
    expect(statusIncidentFacts({ level: "maintenance", problems: [] })).toBeNull();
  });

  test("search trouble keeps Chat amber and says Chat still works", () => {
    const facts = statusIncidentFacts({ level: "degraded", problems: ["Chat"], appReason: "Chat is working, but search is limited right now." });
    expect(facts?.title).toBe("Chat is working");
    expect(facts?.amber).toBe(true);
    const view = render(<StatusIncidentBody facts={facts!} />);
    expect(view.getByText("Search is limited right now.")).toBeTruthy();
    expect(statusIncidentFacts({ level: "offline", problems: ["Brain"] })?.amber).toBe(false);
  });
});
