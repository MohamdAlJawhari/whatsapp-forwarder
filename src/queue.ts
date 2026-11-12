import { log } from './logger.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Job = () => Promise<void>

export class SendQueue {
    private jobs: Job[] = []
    private running = false
    stats = { failedAttempts: 0, gaveUp: 0 }

    constructor(private opts = { delayMs: 1500, jitterMs: 1000, maxRetries: 3, maxSize: 500 }) { }

    push(job: Job): boolean {
        if (this.jobs.length >= this.opts.maxSize) {
            log.warn('queue full, dropping message')
            return false
        }
        this.jobs.push(job)
        void this.drain()
        return true
    }

    get size() { 
        return this.jobs.length 
    }

    // drain the queue, one job at a time, with delay and retry
    private async drain() {
        if (this.running) return          // only one worker, so sends stay in order
        this.running = true
        while (this.jobs.length > 0) {
            const job = this.jobs.shift()!
            await this.runWithRetry(job)
            await sleep(this.opts.delayMs + Math.random() * this.opts.jitterMs)
        }
        this.running = false
    }

    private async runWithRetry(job: Job) {
        for (let attempt = 1; attempt <= this.opts.maxRetries; attempt++) {
            try {
                await job()
                return
            } catch (err) {
                log.error({ err, attempt }, 'job attempt failed') // was console.error('job failed (attempt ...')
                this.stats.failedAttempts++
                if (attempt < this.opts.maxRetries) await sleep(2000 * attempt) // backoff
            }
        }
        log.error('job gave up') // was console.error('job gave up')
        this.stats.gaveUp++
    }
}