// Copies every screenshot named in screenshots.json from docs/assets/screens
// (made by `bun run screenshots` in the repo root) into public/screens.
// Fails when a listed file is missing, so a page can never show a stale id.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const shots = JSON.parse(readFileSync('screenshots.json', 'utf8')) as Record<string, { file: string }>;
let missing = 0;
for (const [id, s] of Object.entries(shots)) {
  const from = join('..', 'assets', 'screens', s.file);
  if (!existsSync(from)) { console.error(`Missing screenshot for "${id}": ${from}. Run bun run screenshots in the repo root.`); missing++; continue; }
  copyFileSync(from, join('public', 'screens', s.file));
}
if (missing) process.exit(1);
console.log(`Synced ${Object.keys(shots).length} screenshots.`);
