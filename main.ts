// main.ts — entrypoint for the Solmar Bay: Street Heat entry (make.fun gta6-01).
//
// Node 22, standard library only. It takes this repository's game/ folder (plain
// static files: index.html plus ES modules, three.js vendored under game/vendor/,
// no network request at play time) and the screenshots/ folder, copies both into
// the output directory, and writes dossier.json there with the kit's buildDossier
// helper from vendor/makefun-game.ts.
//
// Run locally with:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader the output directory is /output (MAKEFUN_OUTPUT_DIR unset).
// Serve the game locally with:  node serve.ts   (then open http://localhost:8080)

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root is the directory holding this file.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start from a clean output directory so stale files can never leak into a run.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// The game itself.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// The screenshots (the first by name is the cover).
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The dossier the judge reads. The caps mirror the scorer's gate so this program
// refuses exactly what the scorer would refuse: at most 4 screenshots of 256 KiB
// each, at most 993 files / 48 MiB under game/, paths under game/ at most 1000 bytes,
// and the dossier text capped at 160 KiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`wrote ${outDir}/dossier.json (${dossier.length} bytes)`);
