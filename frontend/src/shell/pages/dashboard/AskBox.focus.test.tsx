import { afterEach, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AskBox } from "@/shell/pages/dashboard/AskBox";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";

afterEach(cleanup);

test("the Home ask box has focus on arrival", async () => {
  const view = renderWithQueryClient(<MemoryRouter><AskBox /></MemoryRouter>);
  await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText("Ask")));
});
