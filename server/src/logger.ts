import type { Request, Response, NextFunction } from 'express'

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  [key: string]: unknown
}

function formatLog(entry: LogEntry): string {
  const { timestamp, level, message, ...extra } = entry
  const extraStr = Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : ''
  return `[${timestamp}] ${level.toUpperCase()} ${message}${extraStr}`
}

function now(): string {
  return new Date().toISOString()
}

export const logger = {
  info(message: string, extra?: Record<string, unknown>) {
    console.log(formatLog({ timestamp: now(), level: 'info', message, ...extra }))
  },
  warn(message: string, extra?: Record<string, unknown>) {
    console.warn(formatLog({ timestamp: now(), level: 'warn', message, ...extra }))
  },
  error(message: string, extra?: Record<string, unknown>) {
    console.error(formatLog({ timestamp: now(), level: 'error', message, ...extra }))
  },
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  const { method, path: reqPath } = req

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    logger[level](`${method} ${reqPath} ${status}`, { duration: `${duration}ms` })
  })

  next()
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const stack = err instanceof Error ? err.stack : undefined
      logger.error(`Unhandled error in ${req.method} ${req.path}`, { error: message, stack })
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    })
  }
}
