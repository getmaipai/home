import { useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@maipai/ui/src/ui/collapsible";
import { SEARCH_RESULT_ICON, SEARCH_ROW_STATE_WORD, type SearchTestResultData } from "@/shell/components/searchTestResult";

const RESULT_ICONS = { pass: getIcon(SEARCH_RESULT_ICON.pass), warn: getIcon(SEARCH_RESULT_ICON.warn), fail: getIcon(SEARCH_RESULT_ICON.fail) };
/** The icon for a Test result level, for the Alert the caller renders. */
export const SearchResultIcon = ({ level }: { level: SearchTestResultData["level"] }) => { const Icon = RESULT_ICONS[level]; return <Icon aria-hidden="true" />; };

/** The words of a SearXNG Test result, shared so the setup Web search screen and Settings > Search > Web search say the
 * same thing: headline naming host:port, verdict, the "Recommended:" line, a Details disclosure. Each screen renders the
 * kit Alert itself (RULES.md rule 9: no Home wrapper around an Element) and puts this inside its AlertDescription. */
export function SearchTestResultBody({ result }: { result: SearchTestResultData }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <>
      <p className="text-base font-medium text-foreground">{result.headline}</p>
      <p>{result.verdict}</p>
      <p className="font-medium text-foreground">{result.recommendation}</p>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild><Button type="button" variant="link" size="sm">{detailsOpen ? "Hide details" : "Details"}</Button></CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 flex flex-col gap-1">
            {result.details.map((row) => <li key={row.id}><span className="font-medium text-foreground">{row.title}: {SEARCH_ROW_STATE_WORD[row.state]}.</span> {row.detail}{row.fix ? ` ${row.fix}` : ""}</li>)}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
