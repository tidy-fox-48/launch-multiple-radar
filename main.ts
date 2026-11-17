// Launch Multiple Radar: the token-radar-01 entry program (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), scores every pre-token
// protocol with the peer-multiple model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard's data to /output/data.js, copies dashboard/ and
// screenshots/ beside it, and finishes with /output/dossier.json, built by the vendored
// make.fun library exactly as the gate rebuilds it. Deterministic: the same snapshot always
// produces the same bytes, so the grader's two runs agree.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier caps the gate rebuilds with: 64 KiB of source text, at most 4 screenshots. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into the output, skipping dotfiles; returns the names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: the scorer rebuilds it from this same output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

// With --verify, read the written board back and prove it still satisfies the gate's rules
// before reporting success: a local smoke test that the output on disk is the board intended.
if (process.argv.includes('--verify')) {
  const written = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')) as { rows: typeof board };
  const again = boardIssue(written.rows, snapshot);
  if (again !== null) fail(`--verify: the board on disk fails the gate: ${again}`);
  const dossierBytes = statSync(join(out, 'dossier.json')).size;
  if (dossierBytes > 1_572_864) fail(`--verify: dossier.json is ${dossierBytes} bytes, past the 1.5 MiB cap`);
  process.stdout.write(`launch radar: --verify passed: ${written.rows.length} rows on disk, dossier ${dossierBytes} bytes\n`);
}

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols scanned, ${radar.live_count} already trading and ${radar.derivative_count} derivative products set aside, ` +
    `${board.length} pre-token protocols ranked (${snapshot.watchlist.length} of them on the watchlist), ` +
    `total implied launch value ${radar.total_implied} dollars\n`,
);
