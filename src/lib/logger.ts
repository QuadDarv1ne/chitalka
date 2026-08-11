/**
 * Simple structured logger.
 * In dev all levels are emitted to stderr (with colors).
 * In production only info+ are emitted; debug/silly go nowhere.
 */

const LEVELS = ['silly', 'debug', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

const LEVEL_ORDER: Record<Level, number> = { silly: 0, debug: 1, info: 2, warn: 3, error: 4 }

const COLORS: Record<Level, string> = {
  silly: '\x1b[38;5;245m',
  debug: '\x1b[38;5;245m',
  info: '\x1b[38;5;34m',
  warn: '\x1b[38;5;220m',
  error: '\x1b[38;5;196m',
}
const RESET = '\x1b[0m'

// Production threshold: only info, warn, error
const PROD_THRESHOLD = LEVEL_ORDER['info']

function _log(level: Level, ...args: unknown[]) {
  const threshold = process.env.NODE_ENV === 'production' ? PROD_THRESHOLD : 0
  if (LEVEL_ORDER[level] < threshold) return

  const ts = new Date().toISOString()
  const prefix = process.env.NODE_ENV !== 'production'
    ? `${COLORS[level]}[${level.toUpperCase()}]${RESET} ${ts} `
    : `${level.toUpperCase()} ${ts} `

  const fn = level === 'error' ? console.error : console.warn
  if (level === 'info' || level === 'debug' || level === 'silly') {
    console[level](prefix, ...args)
  } else {
    fn(prefix, ...args)
  }
}

export const logger = {
  silly: (...args: unknown[]) => _log('silly', ...args),
  debug: (...args: unknown[]) => _log('debug', ...args),
  info: (...args: unknown[]) => _log('info', ...args),
  warn: (...args: unknown[]) => _log('warn', ...args),
  error: (...args: unknown[]) => _log('error', ...args),
}
