import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CharacterHero } from "@maipai/ui/src/elements/character-hero";
import { List } from "@maipai/ui/src/primitives/List";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import { Wizard } from "@maipai/ui/src/primitives/Wizard";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { useCompanionShells } from "@/lib/companionShells";
import { companionTemplates } from "@/shell/pages/companionTemplates";
const templates = companionTemplates;
const steps = [
  { id: "template", title: "Pick a template" },
  { id: "name", title: "Name and look" },
] as const;
const introRows = [
  { id: "starting-point", icon: "sparkles", hue: "--hue-purple", title: "Pick a starting point", description: "Start from a template, then change anything." },
  { id: "name-look", icon: "palette", hue: "--hue-orange", title: "Give it a name and a look", description: "Pictures and short clips, made for you here." },
  { id: "home", icon: "home", hue: "--hue-green", title: "It stays in your home", description: "Your companion runs on your own hardware. Nothing is sent out." },
] as const;

const UserIcon = getIcon("user");

export function CompanionWizardPage() {
  const navigate = useNavigate();
  const enabled = useCompanionShells();
  const [stage, setStage] = useState<"intro" | "wizard">("intro");
  const [step, setStep] = useState<string>(steps[0].id);
  const [template, setTemplate] = useState<string>("chat-buddy");
  const [name, setName] = useState("");
  if (enabled === undefined) return null;
  if (enabled === false) return <Navigate to="/companions/new" replace />;
  if (stage === "intro") return (
    <>
      <CharacterHero name="New companion" media={<UserIcon className="size-16 text-muted-foreground" aria-hidden="true" />} />
      <div className="mx-auto max-w-md flex flex-col items-center gap-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">Create your companion</h1>
        <p className="text-muted-foreground">A companion is how your assistant sounds. Make one that fits your home.</p>
      </div>
      <div className="w-full text-left">
      <List
        items={introRows}
        getKey={(item) => item.id}
        dividers={false}
        renderItem={(item) => <>
          <IconTile icon={item.icon} hue={item.hue} />
          <div className="flex min-w-0 flex-col gap-1">
            <strong>{item.title}</strong>
            <span className="text-sm text-muted-foreground">{item.description}</span>
          </div>
        </>}
      />
      </div>
      <Button onClick={() => setStage("wizard")}>Continue</Button>
      </div>
    </>
  );
  const selected = templates.find((entry) => entry.id === template) ?? templates[0]!;
  return (
    <Wizard
      steps={[...steps]}
      currentStepId={step}
      completedCount={step === "name" ? 1 : 0}
      onJumpTo={setStep}
      onBack={() => setStep("template")}
      onNext={() => step === "template"
        ? setStep("name")
        : navigate("/companions/new", { state: { name: name.trim(), template } })}
      nextLabel={step === "name" ? "Finish" : "Continue"}
      nextDisabled={step === "name" && !name.trim()}
      heading={steps.find((entry) => entry.id === step)?.title}
    >
      <div data-testid="companion-wizard">
        {step === "template" ? (
          <CardGrid
            label="Companion templates"
            items={[...templates]}
            getKey={(item) => item.id}
            getLabel={(item) => item.name}
            isSelected={(item) => item.id === template}
            onSelect={(item) => setTemplate(item.id)}
            renderItem={(item) => (
              <div className="flex flex-col gap-2">
                <strong>{item.name}</strong>
                <span className="text-sm text-muted-foreground">{item.tagline}</span>
              </div>
            )}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <label htmlFor="companion-wizard-name">Name</label>
            <Input id="companion-wizard-name" value={name} onChange={(event) => setName(event.target.value)} />
            <p>Finish opens the editor with this template&apos;s style filled in. You can change anything.</p>
          </div>
        )}
        <span className="sr-only">{selected.name}</span>
      </div>
    </Wizard>
  );
}
