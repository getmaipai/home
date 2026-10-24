import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Wizard } from "@maipai/ui/src/primitives/Wizard";
import { CardGrid } from "@maipai/ui/src/primitives/CardGrid";
import { Input } from "@maipai/ui/src/ui/input";
import { useCompanionShells } from "@/lib/companionShells";

const templates = [
  { id: "chat-buddy", name: "Chat buddy", tagline: "A friendly voice for everyday questions." },
  { id: "research", name: "Research", tagline: "Find useful facts and explain where they came from." },
  { id: "shopping", name: "Shopping", tagline: "Compare options and keep track of what you need. (coming soon)" },
  { id: "homework-helper", name: "Homework helper", tagline: "Work through school questions one step at a time." },
  { id: "storyteller", name: "Storyteller", tagline: "Make up characters, worlds, and stories together." },
  { id: "custom", name: "Custom", tagline: "Choose the style and interests yourself." },
] as const;
const steps = [
  { id: "template", title: "Pick a template" },
  { id: "name", title: "Name and look" },
] as const;

export function CompanionWizardPage() {
  const navigate = useNavigate();
  const enabled = useCompanionShells();
  const [step, setStep] = useState<string>(steps[0].id);
  const [template, setTemplate] = useState<string>(templates[0].id);
  const [name, setName] = useState("");
  if (enabled === undefined) return null;
  if (enabled === false) return <Navigate to="/companions/new" replace />;
  const selected = templates.find((entry) => entry.id === template)!;
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
            <p>Finish opens the editor; templates set the dials, coming soon.</p>
          </div>
        )}
        <span className="sr-only">{selected.name}</span>
      </div>
    </Wizard>
  );
}
