import type { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";

export function fitWording(plan: StackFitPlan): { verdict: "yes" | "slow" | "no" | "unknown"; headline: string; detail: string } {
  const headline = {
    yes: "Runs well on this computer",
    slow: "Runs, but slowly",
    no: "Won't fit",
    unknown: "Can't tell yet",
  }[plan.verdict];

  let detail: string;
  switch (plan.verdict) {
    case "no": {
      const shortfalls = plan.paths.flatMap((path) => path.shortfall && typeof path.shortfall.high === "number" ? [path.shortfall.high] : []);
      detail = shortfalls.length
        ? `Needs about ${Math.max(1, Math.ceil(Math.max(...shortfalls) / 1024 ** 3))} GB more memory.`
        : "There is not enough memory for it here.";
      break;
    }
    case "yes":
      detail = typeof plan.total.high === "number" && typeof plan.cap.high === "number"
        ? `About ${Math.max(1, Math.ceil(plan.total.high / 1024 ** 3))} GB of the ${Math.floor(plan.cap.high / 1024 ** 3)} GB this computer can give to models.`
        : "There is room for it.";
      break;
    case "slow":
      detail = "It fits only by using the processor, so answers will be slower.";
      break;
    case "unknown":
      detail = "Nobody has measured a model like this on a computer like yours yet.";
      break;
  }
  return { verdict: plan.verdict, headline, detail };
}

export function fitUnavailableWording(): { verdict: "unknown"; headline: string; detail: string } {
  return {
    verdict: "unknown",
    headline: "Can't check right now",
    detail: "The model size checker did not answer. Try again in a moment.",
  };
}

export function fitNoStackWording(): { verdict: "unknown"; headline: string; detail: string } {
  return {
    verdict: "unknown",
    headline: "Needs the MaiPai Stack",
    detail: "Checking a model's size uses the MaiPai Stack, which is not set up on this computer yet.",
  };
}

export function fitNotFoundWording(): { verdict: "unknown"; headline: string; detail: string } {
  return {
    verdict: "unknown",
    headline: "Can't find that model",
    detail: "Check the link and try again.",
  };
}
