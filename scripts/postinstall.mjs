// Cross-package-manager postinstall (works with both npm and bun).
// 1. Generates the Prisma client (repo previously relied on `bunx`).
// 2. Copies the PDF.js worker and its runtime assets into public/ so they are
//    served statically: without the CMaps and the standard fonts, Cyrillic PDFs
//    render as blank glyphs and the generated cover is an empty page.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
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

// Character maps and standard fonts, fetched by the worker while rendering.
for (const asset of ['cmaps', 'standard_fonts']) {
  const src = join('node_modules', 'pdfjs-dist', asset)
  const dest = join('public', 'pdfjs', asset)
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true })
    console.log(`PDF ${asset} copied`)
  } else {
    console.warn(`PDF ${asset} not found in pdfjs-dist`)
  }
}
