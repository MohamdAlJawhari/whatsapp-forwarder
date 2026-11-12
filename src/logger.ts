import pino from 'pino'
import pretty from 'pino-pretty'
import { mkdirSync } from 'node:fs'

mkdirSync('logs', { recursive: true })

// Our own events: readable on the console, JSON lines in the file
export const log = pino(
  { level: 'info' },
  pino.multistream([
    { stream: pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }) },
    { stream: pino.destination({ dest: 'logs/app.log', sync: false }) },
  ])
)

// Baileys' internal messages: file only, warnings and above
export const baileysLog = pino(
  { level: 'warn' },
  pino.destination({ dest: 'logs/baileys.log', sync: false })
)