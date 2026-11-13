import makeWASocket, { useMultiFileAuthState, DisconnectReason, getContentType, type WASocket } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'

import { rm } from 'node:fs/promises'

import { SendQueue } from './queue.js'
import { buildContent } from './relay.js'
import { ask, onCommand } from './terminal.js'
import { log, baileysLog } from './logger.js'
import { skipReason } from './filter.js'
import { DestinationService } from './destination.js'

const destinationService = new DestinationService(async () => {
    if (!currentSock) throw new Error('not connected')
    const groups = await currentSock.groupFetchAllParticipating()
    return Object.values(groups).map((g) => ({
        id: g.id,
        name: g.subject,
        members: g.participants.length,
    }))
})

const forwardOwn = process.env.FORWARD_OWN === '1'

const CLOSE_REASONS: Record<number, string> = {
    401: 'logged out',
    408: 'connection lost or timed out',
    428: 'connection closed',
    440: 'connection replaced (another copy uses this session)',
    500: 'bad session',
    515: 'restart required (normal right after scanning the QR)',
}

const AUTH_DIR = 'auth'
const queue = new SendQueue()
const startedAt = Date.now()

let currentSock: WASocket | undefined

const status = {
    connection: 'starting' as 'starting' | 'open' | 'closed',
    account: '',
    lastMessageAt: null as string | null,
    queued: 0,
    forwarded: 0,
}

function snapshot() {
    return {
        connection: status.connection,
        account: status.account,
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

onCommand('logout', async () => {
    try {
        console.log('logging out...')
        await currentSock?.logout()
    } catch (err) {
        console.error('logout failed:', err)
    }
})

onCommand('destination', promptForDestination)

onCommand('status', () => console.log(snapshot()))

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

async function start() {
    if (forwardOwn) log.warn('FORWARD_OWN is ON: your own messages will be forwarded (testing only)')

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const sock = makeWASocket({ auth: state, logger: baileysLog })
    currentSock = sock

    sock.ev.on('creds.update', saveCreds)

    // listen to connection updates 
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            log.info('QR ready, waiting for scan')
            qrcode.generate(qr, { small: true })   // render the QR in the terminal
        }
        if (connection === 'open') {
            const number = sock.user?.id.split(':')[0] ?? ''
            status.connection = 'open'
            status.account = `…${number.slice(-4)}`
            log.info({ account: `…${number.slice(-4)}` }, 'connected')
            if (!(await destinationService.restore())) await promptForDestination()
        }

        if (connection === 'close') {
            status.connection = 'closed'
            const code = (lastDisconnect?.error as Boom)?.output?.statusCode
            log.warn({ code, reason: CLOSE_REASONS[code ?? 0] ?? 'unknown' }, 'connection closed')

            if (code === DisconnectReason.loggedOut) {
                log.warn('logged out, deleting the session')
                await rm(AUTH_DIR, { recursive: true, force: true })
                destinationService.clear()
            }
            setTimeout(start, 3000)   // after a logout this shows a fresh QR; otherwise it reconnects
        }
    })

    // listen to incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') {
            log.debug({ type, count: messages.length }, 'upsert ignored (not a live message)')
            return
        }
        for (const msg of messages) {
            const target = destinationService.id
            if (!target) {
                log.warn('no destination yet, message skipped')
                continue
            }

            const reason = skipReason(msg, { destination: target, forwardOwn })
            if (reason) {
                log.debug({ id: msg.key.id, reason, chat: msg.key.remoteJid?.split('@')[1] }, 'skipped')
                continue
            }

            queue.push(async () => {
                const content = await buildContent(sock, msg, baileysLog)
                const currentTarget = destinationService.id  // read when the job RUNS, not when it was queued
                if (!currentTarget) throw new Error('no destination')
                const sent = await sock.sendMessage(currentTarget, content) // test the failure case using: const sent = undefined as any
                if (!sent?.key?.id) throw new Error('send was not confirmed (no message id)')
                status.forwarded++
                log.info({ from: msg.key.id, to: sent.key.id }, 'forwarded')
            })
            status.queued++
            status.lastMessageAt = new Date().toISOString()
            log.info({ id: msg.key.id, type: getContentType(msg.message ?? undefined), waiting: queue.size }, 'queued')
        }
    })
}
setInterval(() => log.info(snapshot(), 'heartbeat'), 5 * 60_000)
log.info('program starting')
start()
