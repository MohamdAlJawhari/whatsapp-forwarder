import { open, stat } from 'node:fs/promises'

const LOG_FILE = 'logs/app.log'
const TAIL_BYTES = 512 * 1024            // only the end of the file is read

const LEVEL_NUMBERS: Record<string, number> = { debug: 20, info: 30, warn: 40, error: 50 }
const LEVEL_NAMES: Record<number, string> = {
    10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
}

export type LogEntry = {
    time: string                           // ISO time, the page shows it in local time
    level: string
    msg: string
    details: Record<string, unknown>
}

export type LogQuery = { level?: string; limit?: number }

async function readTail(): Promise<string> {
    const { size } = await stat(LOG_FILE)
    const start = Math.max(0, size - TAIL_BYTES)
    const file = await open(LOG_FILE, 'r')
    try {
        const buffer = Buffer.alloc(size - start)
        await file.read(buffer, 0, buffer.length, start)
        const text = buffer.toString('utf8')
        // If we started in the middle of the file, the first line may be cut in half: drop it
        return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
    } finally {
        await file.close()
    }
}

export async function readLogs(query: LogQuery = {}): Promise<LogEntry[]> {
    const minLevel = LEVEL_NUMBERS[query.level ?? 'info'] ?? LEVEL_NUMBERS.info
    const limit = Math.min(500, Math.max(1, query.limit ?? 200))

    let text: string
    try {
        text = await readTail()
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []   // no log file yet
        throw err
    }

    const entries: LogEntry[] = []
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
            // pid and hostname are taken out so they do not end up in details
            const { level, time, msg, pid, hostname, ...details } = JSON.parse(line)
            if (level < minLevel) continue
            entries.push({
                time: new Date(time).toISOString(),
                level: LEVEL_NAMES[level] ?? String(level),
                msg: msg ?? '',
                details,
            })
        } catch {
            // not valid JSON (for example a line still being written): skip it
        }
    }
    return entries.slice(-limit).reverse()   // newest first
}