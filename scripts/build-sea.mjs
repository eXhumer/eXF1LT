// Build eXF1LT as a Node single executable application (SEA).
//
// 1. Bundle src/cli.tsx and every dependency into dist-sea/exf1lt.mjs.
// 2. Write a SEA config for this platform and run `node --build-sea`, which
//    copies this Node binary and injects the bundle into it.
// 3. On macOS, re-sign the binary (ad hoc), since injecting breaks its signature.
//
// The executable is built from the Node that runs this script, for the
// platform and architecture it runs on.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = 'dist-sea';
const MAIN = join(OUT_DIR, 'exf1lt.mjs');
const EXECUTABLE = join(OUT_DIR, process.platform === 'win32' ? 'exf1lt.exe' : 'exf1lt');
const CONFIG = join(OUT_DIR, 'sea-config.json');

// Ask this Node rather than guessing from its version.
const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' }).stdout;
if (!help.includes('--build-sea')) {
  console.error(`This Node.js (${process.version}) has no --build-sea; use a newer release to build the executable.`);
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

/** tsdown's CLI script, run with this Node rather than through npx and a shell. */
async function tsdownBin() {
  const pkg = JSON.parse(await readFile(join('node_modules', 'tsdown', 'package.json'), 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsdown;
  return join('node_modules', 'tsdown', bin);
}

try {
  await rm(OUT_DIR, { recursive: true, force: true });
} catch (error) {
  // Windows locks a running executable, so the old build cannot be replaced.
  if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
  console.error(`Cannot replace ${EXECUTABLE}: it is in use. Quit eXF1LT (q) and build again.`);
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });

run(process.execPath, [await tsdownBin(), '-c', 'tsdown.sea.config.ts']);

await writeFile(
  CONFIG,
  `${JSON.stringify(
    {
      main: MAIN,
      // The bundle is ESM: Ink's layout engine (yoga) uses top-level await.
      mainFormat: 'module',
      output: EXECUTABLE,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  )}\n`,
);

run(process.execPath, ['--build-sea', CONFIG]);

if (process.platform === 'darwin') run('codesign', ['--sign', '-', '--force', EXECUTABLE]);

const { size } = await stat(EXECUTABLE);
console.log(`\n${EXECUTABLE} (${(size / 1024 / 1024).toFixed(1)} MB, ${process.platform}-${process.arch}, Node ${process.version})`);
