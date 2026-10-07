// Test runner wrapper: normalizes the working directory to its canonical case
// before launching Vitest, then forwards all CLI arguments unchanged.
//
// Why this is needed (Windows only):
// When the project is opened with a lowercase drive letter (e.g. `m:\GitHub\chitalka`
// while the real path is `M:\GitHub\chitalka`), Node treats the two spellings of
// `node_modules\vitest\dist\index.js` as *different modules*. Vitest is loaded through
// the CLI path (whatever case it was invoked with), while Vite normalizes module ids
// using `process.cwd()` (uppercase drive). The test file then imports a second copy of
// the runtime whose collector state was never populated, and every suite fails with
// `TypeError: Cannot read properties of undefined (reading 'config')` — or, in newer
// versions, `Vitest failed to find the current suite`.
//
// Upstream fix (not yet released as of vitest 5.0.3):
//   https://github.com/vitest-dev/vitest/pull/10843
//
// This script `chdir`s to `fs.realpathSync.native(process.cwd())` — the canonical
// casing — and re-resolves the Vitest entry point from the new cwd, so the CLI and
// Vite both agree on a single spelling and only one runtime instance is loaded.
// On case-sensitive platforms the chdir is a harmless no-op.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function canonicalCwd() {
  if (process.platform === 'win32') {
    try {
      return fs.realpathSync.native(process.cwd())
    } catch {
      // Fall through to the plain path if realpath fails (e.g. deleted cwd).
    }
  }
  return process.cwd()
}

process.chdir(canonicalCwd())

const root = process.cwd()
const entry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})

child.on('error', (err) => {
  console.error(`[test] failed to launch Vitest: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    // Forward termination signals (e.g. Ctrl+C in watch mode).
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})