import { getContentType, type WAMessage } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'

import { SendQueue } from './queue.js'
import { ask, onCommand } from './terminal.js'
import { log } from './logger.js'
import { skipReason } from './filter.js'
import { DestinationService } from './destination.js'
import { WhatsAppConnection } from './connection.js'

const forwardOwn = process.env.FORWARD_OWN === '1'
const startedAt = Date.now()

const connection = new WhatsAppConnection()
const queue = new SendQueue()
const destinationService = new DestinationService(() => connection.listGroups())

const status = {
    lastMessageAt: null as string | null,
    queued: 0,
    forwarded: 0,
}

function snapshot() {
    return {
        connection: connection.state,
        account: connection.account,
        destination: destinationService.name ?? '',
        uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
        lastMessageAt: status.lastMessageAt,
        queued: status.queued,
        forwarded: status.forwarded,
        waiting: queue.size,
        failedAttempts: queue.stats.failedAttempts,
        gaveUp: queue.stats.gaveUp,
    }
}

async function promptForDestination() {
    const groups = await destinationService.choices()
    groups.forEach((g, i) => console.log(`${i + 1}. ${g.name}  (${g.members} members)`))

    while (true) {
        const n = Number(await ask('Type the number of the destination group: '))
        const group = groups[n - 1]
        if (group) {
            await destinationService.set(group)
            return
        }
        console.log('Not a valid number, try again.')
    }
}

function handleMessage(msg: WAMessage) {
    const target = destinationService.id

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

    queue.push(async () => {
        const currentTarget = destinationService.id   // read when the job RUNS, not when it was queued
        if (!currentTarget) throw new Error('no destination')
        const sentId = await connection.relay(msg, currentTarget)
        status.forwarded++
        log.info({ from: msg.key.id, to: sentId }, 'forwarded')
    })
    status.queued++
    status.lastMessageAt = new Date().toISOString()
    log.info({ id: msg.key.id, type: getContentType(msg.message ?? undefined), waiting: queue.size }, 'queued')
}

// Connect the pieces
connection.on({
    qr: (qr) => {
        log.info('QR ready, waiting for scan')
        qrcode.generate(qr, { small: true })
    },
    open: async () => {
        if (!(await destinationService.restore())) await promptForDestination()
    },
    loggedOut: () => destinationService.clear(),
    message: handleMessage,
})

onCommand('logout', async () => {
    try {
        console.log('logging out...')
        await connection.logout()
    } catch (err) {
        console.error('logout failed:', err)
    }
})
onCommand('destination', promptForDestination)
onCommand('status', () => console.log(snapshot()))

setInterval(() => log.info(snapshot(), 'heartbeat'), 5 * 60_000)

if (forwardOwn) log.warn('FORWARD_OWN is ON: your own messages will be forwarded (testing only)')
log.info('program starting')
void connection.start()