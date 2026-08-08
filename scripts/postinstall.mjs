// Cross-package-manager postinstall (works with both npm and bun).
// 1. Generates the Prisma client (repo previously relied on `bunx`).
// 2. Copies the PDF.js worker into public/ so it is served statically.
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const prismaCli = join('node_modules', 'prisma', 'build', 'index.js')
const worker = join('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')

if (existsSync(prismaCli)) {
  console.log('Generating Prisma client...')
  const res = spawnSync(process.execPath, [prismaCli, 'generate'], {
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    console.error('prisma generate failed')
    process.exit(res.status ?? 1)
  }
} else {
  console.warn('prisma CLI not found — skipping client generation')
}

if (existsSync(worker)) {
  cpSync(worker, join('public', 'pdf.worker.min.mjs'))
  console.log('PDF worker copied')
} else {
  console.log('PDF worker not found')
}