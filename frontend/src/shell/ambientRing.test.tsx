import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { CompanionPreview } from "@maipai/ui/src/elements/companion-preview";
import { AmbientRingProvider, ambientRingFromWake, effectiveAmbientRing, useAmbientRing, useAmbientRingValue, useAmbientWake } from "@/shell/ambientRing";

const clips = { idle: { h264: "/idle.mp4", still: "/idle.png", loop: true } };

function ShellWakeRing() {
  const setRing = useAmbientRing();
  useEffect(() => { setRing(ambientRingFromWake({ listening: "Listening for the wake word" })); }, [setRing]);
  const ring = useAmbientRingValue();
  return <CompanionAvatar name="Companion" clips={clips} size="xs" animated={false} ring={ring} />;
}

function WakePreview() {
  const wake = useAmbientWake();
  return <CompanionPreview
    name="Companion"
    trigger={<button type="button" aria-label="Companion">Companion</button>}
    askPlaceholder="Ask Companion"
    onAsk={() => {}}
    open={Boolean(wake)}
    listeningLine={wake?.listening}
    onTurnOff={wake?.onTurnOff}
    onOpenChange={() => {}}
  />;
}

afterEach(() => { cleanup(); mock.restore(); });

describe("ambient ring and wake preview", () => {
  test("pane activity takes precedence, then Chat, then wake listening", () => {
    expect(effectiveAmbientRing("thinking", "speaking", "listening")).toBe("thinking");
    expect(effectiveAmbientRing("speaking", null, "listening")).toBe("speaking");
    expect(effectiveAmbientRing(null, "thinking", "listening")).toBe("thinking");
    expect(effectiveAmbientRing(null, null, "listening")).toBe("listening");
    expect(effectiveAmbientRing(null, null, null)).toBeNull();
  });
  test("shell wake state drives the listening ring", async () => {
    const view = render(<AmbientRingProvider><ShellWakeRing /></AmbientRingProvider>);
    const avatar = await view.findByRole("img", { name: "Companion, listening" });
    expect(avatar.getAttribute("data-ring")).toBe("listening");
  });

  test("wake preview exposes Turn off and calls the indicator handler", async () => {
    const onTurnOff = mock(() => {});
    const view = render(<AmbientRingProvider wake={{ listening: "Listening for the wake word", onTurnOff }}><WakePreview /></AmbientRingProvider>);
    fireEvent.click(await view.findByRole("button", { name: "Turn off" }));
    expect(onTurnOff).toHaveBeenCalledTimes(1);
  });
});
