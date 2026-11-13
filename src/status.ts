import type { WhatsAppConnection } from './connection.js'
import type { DestinationService } from './destination.js'
import type { Forwarder } from './forwarder.js'
import type { SendQueue } from './queue.js'

type StatusSources = {
    connection: Pick<WhatsAppConnection, 'state' | 'account'>
    destination: Pick<DestinationService, 'name'>
    forwarder: Pick<Forwarder, 'stats'>
    queue: Pick<SendQueue, 'size' | 'stats'>
}

export type Status = ReturnType<ReturnType<typeof createStatusReader>>

export function createStatusReader(sources: StatusSources) {
    const startedAt = Date.now()

    return function getStatus() {
        const { connection, destination, forwarder, queue } = sources
        return {
            connection: connection.state,
            account: connection.account,
            destination: destination.name ?? '',
            uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
            lastMessageAt: forwarder.stats.lastMessageAt,
            queued: forwarder.stats.queued,
            forwarded: forwarder.stats.forwarded,
            waiting: queue.size,
            failedAttempts: queue.stats.failedAttempts,
            gaveUp: queue.stats.gaveUp,
        }
    }
}