import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { SettingField } from "@/kit/settings/SettingField";
import type { MergedSetting } from "@/kit/settings/groupSettings";

afterEach(cleanup);

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time (`typeof document !== 'undefined' && document.body`,
// dist/screen.js), before Bun's test preload has necessarily finished
// registering happy-dom's globals - it permanently falls back to a
// stub that throws "a global document has to be available" no matter
// how real `document` is by the time a test actually runs. render()'s
// own returned queries are bound to the real rendered container instead
// of that stale singleton, so every query here comes from `render()`,
// never from an `import { screen } from "@testing-library/react"`.

function numberSetting(value: number, source: "user" | "default" = "default"): MergedSetting {
  return {
    def: {
      key: "household.conversation_retention_days",
      scope: "household",
      selector: "number",
      range: { min: 7, max: 365 },
      default: 90,
      label: "Conversation history retention",
      level: "advanced",
      secret: false,
      lives_in: "household.system",
      honoured_by: ["home"],
    },
    resolved: {
      key: "household.conversation_retention_days",
      value,
      source,
      label: "Conversation history retention",
      level: "advanced",
      secret: false,
    },
  };
}

describe("SettingField - number selector", () => {
  // Real bug, found live testing the Settings page (2026-09-04): a reset
  // or any external re-fetch updated the stored value but the input kept
  // showing whatever was last typed, because the local `draft` string
  // only ever synced from `resolved.value` once, on mount.
  test("re-syncs the input when resolved.value changes from outside (a reset)", () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByLabelText, rerender } = render(
      <SettingField setting={numberSetting(45, "user")} onChange={onChange} onReset={() => {}} />,
    );
    expect(getByLabelText("Conversation history retention")).toHaveValue(45);

    // Simulates SettingsRenderer re-rendering this field with a fresh
    // resolved value after a successful reset - not a local edit.
    rerender(<SettingField setting={numberSetting(90, "default")} onChange={onChange} onReset={() => {}} />);
    expect(getByLabelText("Conversation history retention")).toHaveValue(90);
  });

  test("does not clobber an in-progress, uncommitted edit", () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByLabelText, rerender } = render(
      <SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />,
    );
    const input = getByLabelText("Conversation history retention");
    fireEvent.change(input, { target: { value: "120" } });
    expect(input).toHaveValue(120);

    // Re-rendering with the SAME resolved.value (nothing external
    // changed) must not stomp the still-uncommitted draft.
    rerender(<SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />);
    expect(getByLabelText("Conversation history retention")).toHaveValue(120);
  });

  // Second bug from the same review pass: Number("") is 0, not NaN, so
  // clearing the field and blurring used to silently commit 0.
  test("clearing the field and blurring reverts instead of committing 0", async () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByLabelText } = render(
      <SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />,
    );
    const input = getByLabelText("Conversation history retention");
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(90);
  });

  test("a non-numeric draft reverts instead of committing NaN", async () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByLabelText } = render(
      <SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />,
    );
    const input = getByLabelText("Conversation history retention");
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(90);
  });

  // Third bug from the same review pass: a rejected write (below min,
  // etc.) left the invalid draft on screen forever, since resolved.value
  // never changes on failure and the resync effect only fires when it does.
  test("a rejected write reverts the draft back to the last known value", async () => {
    const onChange = mock(() => Promise.resolve(false));
    const { getByLabelText } = render(
      <SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />,
    );
    const input = getByLabelText("Conversation history retention");
    fireEvent.change(input, { target: { value: "3" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(onChange).toHaveBeenCalledWith(3);
    expect(input).toHaveValue(90);
  });

  test("a successful write is not reverted", async () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByLabelText } = render(
      <SettingField setting={numberSetting(90)} onChange={onChange} onReset={() => {}} />,
    );
    const input = getByLabelText("Conversation history retention");
    fireEvent.change(input, { target: { value: "30" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(input).toHaveValue(30);
  });
});
