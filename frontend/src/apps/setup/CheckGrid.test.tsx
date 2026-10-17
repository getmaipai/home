import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { CheckGrid, visibleCheckRows } from "./CheckGrid";

const rows = [
  { id: "engine", title: "AI engine", state: "green" as const, text: "answering" },
  { id: "memory", title: "Computer", state: "red" as const, text: "Too small." },
  { id: "clock", title: "Clock", state: "idle" as const, text: "later" },
  { id: "hub-disk", title: "Hub disk", state: "green" as const, text: "ok" },
  { id: "home-network", title: "Home network", state: "amber" as const, text: "Only this computer." },
];

describe("CheckGrid", () => {
  test("idle rows and rows the storage page already covers are not shown", () => {
    expect(visibleCheckRows(rows).map((row) => row.id)).toEqual(["engine", "memory", "home-network"]);
  });
  test("the disk row shows when it is not green, with the words the installer uses, and hides when it is", () => {
    const disk = { id: "model-disk", title: "Free disk space", state: "red" as const, text: "This computer needs about 85 GB free for the recommended setup; it has 61 GB. Free up space, or choose a smaller plan." };
    expect(visibleCheckRows([disk]).map((row) => row.id)).toEqual(["model-disk"]);
    expect(visibleCheckRows([{ ...disk, state: "amber" as const }]).map((row) => row.id)).toEqual(["model-disk"]);
    expect(visibleCheckRows([{ ...disk, state: "green" as const }])).toEqual([]);
    expect(render(<CheckGrid rows={[disk]} split={false} />).container.textContent).toContain("it has 61 GB");
  });
  test("ready tiles show only the name; tiles that need a look say why", () => {
    const { container } = render(<CheckGrid rows={rows} split={false} />);
    expect(container.textContent).not.toContain("answering");
    expect(container.textContent).toContain("Too small.");
    expect(container.querySelectorAll("[data-check-state]")).toHaveLength(3);
  });
  test("a two-computer setup labels the Home and AI server groups", () => {
    const { container } = render(<CheckGrid rows={rows} split />);
    expect(container.textContent).toContain("Home computer");
    expect(container.textContent).toContain("AI server");
  });
});
