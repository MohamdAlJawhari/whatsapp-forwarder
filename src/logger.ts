import pino from 'pino'
import pretty from 'pino-pretty'
import { mkdirSync } from 'node:fs'

mkdirSync('logs', { recursive: true })

// Application messages: info and above, plus debug to console. This is the main logger for this app, and is used in most files.
export const log = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { level: 'debug', stream: pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }) },
    { level: 'debug', stream: pino.destination({ dest: 'logs/app.log', sync: false }) },
  ])
)

// Baileys' internal messages: file only, warnings and above
export const baileysLog = pino(
  { level: 'warn' },
  pino.destination({ dest: 'logs/baileys.log', sync: false })
)