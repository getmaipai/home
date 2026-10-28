// MODEL-ADD-01 S4: add a chat model from a pasted Hugging Face link, inside the Chat row's "Choose a model" dialog (owner and
// admin only, like the page). Paste, read (nothing downloads yet), see name, licence, size and fit, then "Download and use".
// Kit Elements as shipped (rule 9). The words come from the card's `copy`; the English defaults cover a spec without them.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { ApiError } from "@/lib/api";
import { aiChoicesApi, type InspectedChatModel } from "@/lib/aiChoicesApi";
import { sizeGb } from "../../../../shared/diskPlanMath";

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : "The model could not be read. Check the link, then try again.");

export function AddChatModel({ copy, onAdded }: { copy: Record<string, string>; onAdded?: () => void }) {
  const [link, setLink] = useState("");
  const [found, setFound] = useState<InspectedChatModel | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const inspect = useMutation({ mutationFn: () => aiChoicesApi.inspectModel(link.trim()), onSuccess: (result) => { setFound(result); setAdded(null); } });
  const add = useMutation({ mutationFn: () => aiChoicesApi.addModel(link.trim()), onSuccess: (result) => { setAdded(result.label); setFound(null); setLink(""); onAdded?.(); } });
  const error = inspect.isError ? inspect.error : add.isError ? add.error : null;
  return (
    <div data-testid="ai-add-model">
      <p className="text-base font-medium">{copy.add_model_title ?? "Add a model from a link"}</p>
      <p className="text-sm text-muted-foreground">{copy.add_model_note ?? "Paste a Hugging Face link to a GGUF file. Nothing downloads until you confirm."}</p>
      <Input
        aria-label={copy.add_model_title ?? "Add a model from a link"}
        placeholder="https://huggingface.co/owner/repo"
        value={link}
        onChange={(event) => { setLink(event.target.value); setFound(null); inspect.reset(); add.reset(); }}
      />
      <Button type="button" variant="outline" disabled={link.trim() === "" || inspect.isPending} onClick={() => inspect.mutate()}>
        {inspect.isPending ? (copy.add_model_reading ?? "Reading") : (copy.add_model_read ?? "Read the link")}
      </Button>
      {error ? <Alert variant="destructive"><AlertTitle>{copy.add_model_failed ?? "That model was not added"}</AlertTitle><AlertDescription>{messageOf(error)}</AlertDescription></Alert> : null}
      {added ? <Alert><AlertTitle>{added}</AlertTitle><AlertDescription>{copy.add_model_started ?? "Downloading now. It appears in the list above while it downloads."}</AlertDescription></Alert> : null}
      {found ? (
        <Item variant="outline" data-testid="ai-add-model-found">
          <ItemContent>
            <ItemTitle>{found.repo} <Badge variant="outline" tone="warning">{copy.not_tested ?? "Not tested by MaiPai"}</Badge></ItemTitle>
            <ItemDescription>{found.file}</ItemDescription>
            <ItemDescription>{sizeGb(found.sizeBytes)} · {found.licence ?? "Licence not stated"} · {found.architecture}</ItemDescription>
            <ItemDescription>{found.fits === "fits" ? (copy.add_model_fits ?? "A known design: MaiPai can size it.") : (copy.add_model_estimate ?? "An estimate: the engine checks the fit before it loads.")}</ItemDescription>
          </ItemContent>
          <Button type="button" disabled={add.isPending} onClick={() => add.mutate()}>{copy.add_model_confirm ?? "Download and use"}</Button>
        </Item>
      ) : null}
    </div>
  );
}
