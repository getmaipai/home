import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { scenarioList } from "./scenarios";
import { handlersFor } from "./handlers";

export function SetupPreviewBar({ currentScreen, onJump }: { currentScreen: number; onJump: (index: number) => void }) {
  const [selectedScenario, setSelectedScenario] = useState(new URLSearchParams(window.location.search).get("scenario") ?? "happy-local");
  const [speed, setSpeed] = useState("1");
  const [pretendTailnetDone, setPretendTailnetDone] = useState(false);
  useEffect(() => {
    const jump = (event: Event) => onJump((event as CustomEvent<number>).detail);
    window.addEventListener("setup-preview-jump", jump);
    return () => window.removeEventListener("setup-preview-jump", jump);
  }, [onJump]);
  const choose = (id: string) => {
    setSelectedScenario(id);
    const url = new URL(window.location.href); url.searchParams.set("scenario", id); window.history.replaceState(null, "", url);
    const scenario = scenarioList.find((item) => item.id === id);
    if (scenario) window.__setupPreviewWorker?.use(...handlersFor(scenario));
  };
  return <aside aria-label="Setup preview controls">
    <Alert><AlertDescription>Preview. Nothing is downloaded, installed or saved.</AlertDescription></Alert>
    <div>
      <label htmlFor="setup-preview-scenario">Scenario</label>
      <Select value={selectedScenario} onValueChange={choose}>
        <SelectTrigger id="setup-preview-scenario"><SelectValue /></SelectTrigger>
        <SelectContent>{scenarioList.map((scenario) => <SelectItem key={scenario.id} value={scenario.id}>{scenario.label}</SelectItem>)}</SelectContent>
      </Select>
      <label htmlFor="setup-preview-screen">Jump to screen</label>
      <Select value={String(currentScreen)} onValueChange={(value) => onJump(Number(value) - 1)}>
        <SelectTrigger id="setup-preview-screen"><SelectValue placeholder="Jump to screen" /></SelectTrigger>
        <SelectContent>{Array.from({ length: 10 }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{index + 1}</SelectItem>)}</SelectContent>
      </Select>
      <span>Speed</span>
      <ToggleGroup type="single" value={speed} onValueChange={(value) => { if (value) { setSpeed(value); window.__setupPreviewWorker?.use(...handlersFor({ ...scenarioList.find((item) => item.id === selectedScenario)!, progress: scenarioList.find((item) => item.id === selectedScenario)?.progress ? { ...scenarioList.find((item) => item.id === selectedScenario)!.progress!, bytesPerSecond: 6_250_000 * Number(value) } : undefined })); } }}>
        {["1", "10", "60"].map((value) => <ToggleGroupItem key={value} value={value}>{value}x</ToggleGroupItem>)}
      </ToggleGroup>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>Restart</Button>
      {currentScreen === 6 ? <Button type="button" variant={pretendTailnetDone ? "secondary" : "outline"} onClick={() => setPretendTailnetDone(true)}>Pretend the next Tailscale step is done</Button> : null}
    </div>
  </aside>;
}
