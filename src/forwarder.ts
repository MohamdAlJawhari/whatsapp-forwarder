import { getContentType, type WAMessage } from '@whiskeysockets/baileys'
import { skipReason } from './filter.js'
import { log } from './logger.js'
import type { SendQueue } from './queue.js'

type Relay = (msg: WAMessage, toJid: string) => Promise<string>

export type ForwarderDeps = {
    queue: Pick<SendQueue, 'push' | 'size'>
    destination: { readonly id: string | undefined }
    relay: Relay
    forwardOwn: boolean
}

export class Forwarder {
    readonly stats = {
        queued: 0,
        forwarded: 0,
        lastMessageAt: null as string | null,
    }

    constructor(private deps: ForwarderDeps) { }

    handle(msg: WAMessage): void {
        const { queue, destination, relay, forwardOwn } = this.deps
        const target = destination.id

        const reason = skipReason(msg, { destination: target, forwardOwn })
        if (reason) {
            log.debug({ id: msg.key.id, reason, chat: msg.key.remoteJid?.split('@')[1] }, 'skipped')
            return
        }

        // Only a message that WOULD have been forwarded reaches this warning
        if (!target) {
            log.warn({ id: msg.key.id }, 'no destination yet, message NOT forwarded')
            return
        }

        const accepted = queue.push(async () => {
            const currentTarget = destination.id        // read when the job RUNS, not when it was queued
            if (!currentTarget) throw new Error('no destination')
            const sentId = await relay(msg, currentTarget)
            this.stats.forwarded++
            log.info({ from: msg.key.id, to: sentId }, 'forwarded')
        })

        if (!accepted) {
            log.warn({ id: msg.key.id }, 'queue full, message dropped')
            return
        }

        this.stats.queued++
        this.stats.lastMessageAt = new Date().toISOString()
        log.info({ id: msg.key.id, type: getContentType(msg.message ?? undefined), waiting: queue.size }, 'queued')
    }
}