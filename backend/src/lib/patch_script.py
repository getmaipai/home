with open("backend/src/lib/packageHost.ts", "r") as f:
    content = f.read()

# Change 1: Update import to include AgeBand type
content = content.replace(
    'import { speakerAgeBand } from "@/lib/ageBand";',
    'import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";'
)

# Change 2: Add speakerBand to SearchOptions type
content = content.replace(
    'type SearchOptions = { allowWikipediaFallback?: boolean; safeSearchLevel?: SafeSearchLevel; bypassCache?: boolean; minorBand?: MinorBand; signal?: AbortSignal; deadlineAt?: number; fallbackSignal?: AbortSignal; fallbackDeadlineAt?: number };',
    'type SearchOptions = { allowWikipediaFallback?: boolean; safeSearchLevel?: SafeSearchLevel; bypassCache?: boolean; minorBand?: MinorBand; speakerBand?: AgeBand; signal?: AbortSignal; deadlineAt?: number; fallbackSignal?: AbortSignal; fallbackDeadlineAt?: number };'
)

with open("backend/src/lib/packageHost.ts", "w") as f:
    f.write(content)

print("Changes 1-2 applied successfully")
