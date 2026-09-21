import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";

afterEach(cleanup);

mock.module("@/next/useShellNext", () => ({ useShellNext: () => "on" }));

describe("next Manage routes", () => {
  test.each([
    ["/next/engines", NextEnginesPage],
    ["/next/updates", NextUpdatesPage],
    ["/next/repairs", NextRepairsPage],
    ["/next/backups", NextBackupsPage],
  ])("%s renders the template tables view", (_route, Page) => {
    render(
      <MemoryRouter initialEntries={[_route]}>
        <Page />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain("Tables");
  });
});
