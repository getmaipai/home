import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { NextChatPage } from "@/next/pages/NextChatPage";

afterEach(() => {
  cleanup();
});

describe("NextChatPage (SHELL-02's first slice)", () => {
  // findByLabelText (not getByLabelText): AuiProvider's own mount does an
  // async state update (the same "assistant-ui async init" ChatPage.test.tsx
  // already works around with findBy queries) - a synchronous get here
  // still passes but throws a React "not wrapped in act()" console warning.
  test("mounts the Elements composer, ready for a real turn", async () => {
    const { findByLabelText } = render(<NextChatPage />);
    expect(await findByLabelText("Message input")).toBeVisible();
  });
});
