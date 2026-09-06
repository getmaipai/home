import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { SettingField, titleCaseOption, localeDisplayName } from "@/kit/settings/SettingField";
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

// A code review on tts.voice_id (2026-09-04, "per user selection of
// voice") found every `select`-selector value rendered as its raw
// machine token ("quantized", "bill_boerst") with no label transform at
// all - the same rough edge the People page's role picker already fixed
// for its own raw role slugs, just never generalized here.
describe("titleCaseOption (select option labels)", () => {
  test("capitalizes a single word", () => {
    expect(titleCaseOption("auto")).toBe("Auto");
    expect(titleCaseOption("vera")).toBe("Vera");
  });

  test("splits underscores into separate capitalized words", () => {
    expect(titleCaseOption("bill_boerst")).toBe("Bill Boerst");
  });

  test("leaves an empty string alone", () => {
    expect(titleCaseOption("")).toBe("");
  });
});

describe("localeDisplayName", () => {
  test("renders a real BCP-47 tag as its language name, not a title-cased split", () => {
    expect(localeDisplayName("en-US")).toBe("American English");
    expect(localeDisplayName("en-GB")).toBe("British English");
  });

  test("falls through to titleCaseOption for anything Intl doesn't recognize as a locale", () => {
    expect(localeDisplayName("bill_boerst")).toBe(titleCaseOption("bill_boerst"));
  });
});

function localeSelectSetting(value: string): MergedSetting {
  return {
    def: {
      key: "household.locale",
      scope: "household",
      selector: "select",
      range: { options: ["en-US", "en-GB"] },
      default: "en-US",
      label: "Language and region",
      level: "basic",
      secret: false,
      lives_in: "household.system",
      honoured_by: ["home"],
    },
    resolved: {
      key: "household.locale",
      value,
      source: "default",
      label: "Language and region",
      level: "basic",
      secret: false,
    },
  };
}

describe("SettingField - select selector", () => {
  // A code review, 2026-09-05, found the BCP-47 display-name fix scoped
  // to the wrong key entirely (`core.locale`, which does not exist - the
  // real key is `household.locale`), caught only by looking at the
  // running app, not by any test - this is that test, rendering the real
  // component against the real key so a future rename of either has
  // somewhere to fail loudly instead of silently.
  test("renders household.locale's value as a real language name, not a raw BCP-47 tag", () => {
    const { getByRole } = render(
      <SettingField setting={localeSelectSetting("en-US")} onChange={async () => true} onReset={() => {}} />,
    );
    expect(getByRole("combobox", { name: "Language and region" })).toHaveTextContent("American English");
  });
});

// Session B step 7: a `secret: true` key with no dedicated backend route
// (unlike voice.hf_token) had no way to be set at all - the generic
// renderer only ever showed a static "Set"/"Not set" status. This is the
// regression suite for the write-only paste-and-confirm flow that fixes
// that, found live (2026-09-06) checking notifications.telegram.bot_token
// in the running app.
function secretSetting(isSet: boolean, source: "user" | "default" = isSet ? "user" : "default"): MergedSetting {
  return {
    def: {
      key: "notifications.telegram.bot_token",
      scope: "household",
      selector: "text",
      default: "",
      label: "Telegram bot token",
      level: "advanced",
      secret: true,
      lives_in: "household.notifications",
      honoured_by: ["home"],
    },
    resolved: {
      key: "notifications.telegram.bot_token",
      value: null,
      source,
      label: "Telegram bot token",
      level: "advanced",
      secret: true,
      isSet,
    },
  };
}

describe("SettingField - secret write-only flow", () => {
  test("not set: shows status and a Set button, no input", () => {
    const { getByText, getByRole, queryByLabelText } = render(
      <SettingField setting={secretSetting(false)} onChange={async () => true} onReset={() => {}} />,
    );
    expect(getByText("Not set")).toBeTruthy();
    expect(getByRole("button", { name: "Set" })).toBeTruthy();
    expect(queryByLabelText("Telegram bot token")).toBeNull();
  });

  test("already set: shows status and a Change button", () => {
    const { getByText, getByRole } = render(
      <SettingField setting={secretSetting(true)} onChange={async () => true} onReset={() => {}} />,
    );
    expect(getByText("Set")).toBeTruthy();
    expect(getByRole("button", { name: "Change" })).toBeTruthy();
  });

  test("clicking Set reveals a masked input with Save disabled until something is typed", () => {
    const { getByRole, getByLabelText } = render(
      <SettingField setting={secretSetting(false)} onChange={async () => true} onReset={() => {}} />,
    );
    fireEvent.click(getByRole("button", { name: "Set" }));
    const input = getByLabelText("Telegram bot token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "123:abc" } });
    expect(getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  test("saving calls onChange with the typed value and collapses back to status on success", async () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <SettingField setting={secretSetting(false)} onChange={onChange} onReset={() => {}} />,
    );
    fireEvent.click(getByRole("button", { name: "Set" }));
    fireEvent.change(getByLabelText("Telegram bot token"), { target: { value: "123:abc" } });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });
    expect(onChange).toHaveBeenCalledWith("123:abc");
    expect(queryByLabelText("Telegram bot token")).toBeNull();
  });

  test("a rejected save keeps the input open with the typed draft, not the never-returned old value", async () => {
    const onChange = mock(() => Promise.resolve(false));
    const { getByRole, getByLabelText } = render(
      <SettingField setting={secretSetting(false)} onChange={onChange} onReset={() => {}} />,
    );
    fireEvent.click(getByRole("button", { name: "Set" }));
    const input = getByLabelText("Telegram bot token") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123:abc" } });
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Save" }));
    });
    expect(getByLabelText("Telegram bot token")).toHaveValue("123:abc");
  });

  test("Cancel discards the draft without calling onChange", () => {
    const onChange = mock(() => Promise.resolve(true));
    const { getByRole, getByLabelText, queryByLabelText } = render(
      <SettingField setting={secretSetting(false)} onChange={onChange} onReset={() => {}} />,
    );
    fireEvent.click(getByRole("button", { name: "Set" }));
    fireEvent.change(getByLabelText("Telegram bot token"), { target: { value: "123:abc" } });
    fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(queryByLabelText("Telegram bot token")).toBeNull();
  });

  // A code review (2026-09-06) found this write flow made voice.hf_token
  // writable a second way, bypassing HuggingFaceTokenSection.tsx's
  // dedicated route (needed to restart pocket-tts after a save) - a
  // household member using this row instead would see "Set" succeed
  // while voice cloning silently kept failing.
  test("voice.hf_token stays a static status row - its real write path is a dedicated section", () => {
    const setting: MergedSetting = {
      def: {
        key: "voice.hf_token",
        scope: "household",
        selector: "text",
        default: "",
        label: "Hugging Face token (for voice cloning)",
        level: "advanced",
        secret: true,
        lives_in: "household.ai",
        honoured_by: ["home"],
      },
      resolved: {
        key: "voice.hf_token",
        value: null,
        source: "default",
        label: "Hugging Face token (for voice cloning)",
        level: "advanced",
        secret: true,
        isSet: false,
      },
    };
    const { getByText, queryByRole } = render(
      <SettingField setting={setting} onChange={async () => true} onReset={() => {}} />,
    );
    expect(getByText("Not set")).toBeTruthy();
    expect(queryByRole("button", { name: "Set" })).toBeNull();
    expect(queryByRole("button", { name: "Change" })).toBeNull();
  });
});
