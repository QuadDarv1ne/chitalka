// Cross-platform command runner with optional log file and env flag.
// Usage: node scripts/run.mjs [--prod] [--log FILE] -- <cmd> [args...]
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

let prod = false
let logFile = null
while (args[0] && args[0].startsWith('--')) {
  const flag = args.shift()
  if (flag === '--prod') prod = true
  else if (flag === '--log') logFile = args.shift()
  else {
    console.error(`Unknown flag: ${flag}`)
    process.exit(2)
  }
}

const cmd = args[0]
if (!cmd) {
  console.error('No command specified')
  process.exit(2)
}

const child = spawn(cmd, args.slice(1), {
  cwd: root,
  env: { ...process.env, ...(prod ? { NODE_ENV: 'production' } : {}) },
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
})

let log = null
if (logFile) log = createWriteStream(join(root, logFile), { flags: 'a' })
const stamp = () => `[${new Date().toISOString()}] `

child.stdout.on('data', (d) => {
  process.stdout.write(d)
  log?.write(stamp() + d)
})
child.stderr.on('data', (d) => {
  process.stderr.write(d)
  log?.write(stamp() + d)
})

child.on('exit', (code) => {
  log?.end()
  process.exit(code ?? 1)
})
child.on('error', (e) => {
  console.error(`Failed to run "${cmd}":`, e.message)
  process.exit(1)
})
