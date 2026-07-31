// Copies build artifacts into .next/standalone. Fails loudly if build is missing.
import { cpSync, existsSync } from 'node:fs'

const standalone = '.next/standalone'
if (!existsSync(standalone)) {
  console.error('ERROR: .next/standalone not found — run "next build" first')
  process.exit(1)
}

const targets = [
  ['.next/static', '.next/standalone/.next/static'],
  ['public', '.next/standalone/public'],
]

for (const [from, to] of targets) {
  if (!existsSync(from)) continue
  cpSync(from, to, { recursive: true, force: true })
  console.log(`Copied ${from} -> ${to}`)
}
