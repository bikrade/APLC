import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import * as appInsights from 'applicationinsights'
import type { Request, Response, NextFunction } from 'express'

type LogLevel = 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

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

const logContextStorage = new AsyncLocalStorage<LogContext>()

function currentContext(): LogContext {
  return logContextStorage.getStore() ?? {}
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error: error.message,
      stack: error.stack,
      ...(typeof (error as Error & { code?: string }).code === 'string' ? { code: (error as Error & { code?: string }).code } : {}),
    }
  }

  return {
    error: String(error),
  }
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [key, sanitizeValue(entryValue)]),
    )
  }
  return value
}

function mergeContext(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...sanitizeValue(currentContext()) as Record<string, unknown>,
    ...sanitizeValue(extra) as Record<string, unknown>,
  }
}

export function getLoggerContext(): LogContext {
  return currentContext()
}

export function withLogContext<T>(extra: LogContext, fn: () => T): T {
  return logContextStorage.run({ ...currentContext(), ...extra }, fn)
}

export function getRequestId(): string | undefined {
  const requestId = currentContext().requestId
  return typeof requestId === 'string' ? requestId : undefined
}

export const logger = {
  info(message: string, extra?: Record<string, unknown>) {
    console.log(formatLog({ timestamp: now(), level: 'info', message, ...mergeContext(extra) }))
  },
  warn(message: string, extra?: Record<string, unknown>) {
    console.warn(formatLog({ timestamp: now(), level: 'warn', message, ...mergeContext(extra) }))
  },
  error(message: string, extra?: Record<string, unknown>) {
    console.error(formatLog({ timestamp: now(), level: 'error', message, ...mergeContext(extra) }))
  },
}

export const telemetry = {
  trackMetric(name: string, value: number, properties?: Record<string, string>) {
    appInsights.defaultClient?.trackMetric({
      name,
      value,
      ...(properties ? { properties } : {}),
    })
  },
  trackEvent(name: string, properties?: Record<string, string>) {
    appInsights.defaultClient?.trackEvent({
      name,
      ...(properties ? { properties } : {}),
    })
  },
  trackException(error: unknown, properties?: Record<string, string>) {
    if (error instanceof Error) {
      appInsights.defaultClient?.trackException({
        exception: error,
        ...(properties ? { properties } : {}),
      })
      return
    }
    appInsights.defaultClient?.trackTrace({
      message: String(error),
      ...(properties ? { properties } : {}),
      severity: 'Error',
    })
  },
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  const { method, path: reqPath } = req

  const requestIdHeader = req.header('x-request-id')
  const requestId = requestIdHeader && requestIdHeader.trim() ? requestIdHeader.trim() : randomUUID()
  res.setHeader('x-request-id', requestId)

  withLogContext({ requestId, method, path: reqPath }, () => {
    res.on('finish', () => {
      const duration = Date.now() - start
      const status = res.statusCode
      const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      logger[level](`${method} ${reqPath} ${status}`, { durationMs: duration })
      telemetry.trackMetric('http.request.duration_ms', duration, {
        method,
        path: reqPath,
        status: String(status),
      })
    })

    next()
  })
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error'
      const stack = err instanceof Error ? err.stack : undefined
      logger.error(`Unhandled error in ${req.method} ${req.path}`, { error: message, stack })
      telemetry.trackException(err, { method: req.method, path: req.path })
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' })
      }
    })
  }
}
