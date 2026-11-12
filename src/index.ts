import makeWASocket, { useMultiFileAuthState, DisconnectReason, getContentType, type WASocket } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'

import { rm } from 'node:fs/promises'

import { SendQueue } from './queue.js'
import { buildContent } from './relay.js'
import { ask, onCommand } from './terminal.js'
import { loadConfig, saveConfig } from './config.js'
import { log, baileysLog } from './logger.js'

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
let destination: string | undefined     // replaces DEST_GROUP_JID

const status = {
  connection: 'starting' as 'starting' | 'open' | 'closed',
  account: '',
  destination: '',
  lastMessageAt: null as string | null,
  queued: 0,
  forwarded: 0,
}

function snapshot() {
  return {
    connection: status.connection,
    account: status.account,
    destination: status.destination,
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

onCommand('destination', async () => {
    if (currentSock) await chooseDestination(currentSock)
})

onCommand('status', () => console.log(snapshot()))


async function chooseDestination(sock: WASocket) {
    const groups = Object.values(await sock.groupFetchAllParticipating())
    groups.sort((a, b) => a.subject.localeCompare(b.subject))

    groups.forEach((g, i) => {
        console.log(`${i + 1}. ${g.subject}  (${g.participants.length} members)`)
    })

    while (true) {
        const n = Number(await ask('Type the number of the destination group: '))
        const group = groups[n - 1]                  // an invalid number gives undefined
        if (group) {
            destination = group.id
            status.destination = group.subject
            await saveConfig({ destinationJid: group.id, destinationName: group.subject })
            log.info({ destination: group.subject }, 'destination set')
            return
        }
        console.log('Not a valid number, try again.')
    }
}

async function ensureDestination(sock: WASocket) {
    const saved = await loadConfig()
    const groups = await sock.groupFetchAllParticipating()
    const found = saved.destinationJid ? groups[saved.destinationJid] : undefined

    if (found) {
        destination = found.id
        status.destination = found.subject
        log.info({ destination: found.subject }, 'destination loaded')
    } else {
        await chooseDestination(sock)       // nothing saved, or this number is not in that group
    }
}

async function start() {
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
            await ensureDestination(sock)
        }

        if (connection === 'close') {
            status.connection = 'closed'
            const code = (lastDisconnect?.error as Boom)?.output?.statusCode
            log.warn({ code, reason: CLOSE_REASONS[code ?? 0] ?? 'unknown' }, 'connection closed')

            if (code === DisconnectReason.loggedOut) {
                log.warn('logged out, deleting the session')
                await rm(AUTH_DIR, { recursive: true, force: true })
            }
            start()   // after a logout this shows a fresh QR; otherwise it reconnects
        }
    })

    // listen to incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
            if (!msg.message) continue
            // if (msg.key.fromMe) continue
            if (!destination) {
                log.warn('no destination yet, message skipped')
                continue
            }

            const jid = msg.key.remoteJid
            if (jid === destination) continue  // still protects against a forwarding loop
            if (!jid || jid.endsWith('@broadcast')) continue  // status + broadcast lists

            // skip WhatsApp's internal messages
            const kind = getContentType(msg.message)
            if (kind === 'protocolMessage' || kind === 'senderKeyDistributionMessage') continue

            queue.push(async () => {
                const content = await buildContent(sock, msg, baileysLog)
                const target = destination  // read when the job RUNS, not when it was queued
                if (!target) throw new Error('no destination')
                const sent = await sock.sendMessage(target, content) // test the failure case using: const sent = undefined as any
                if (!sent?.key?.id) throw new Error('send was not confirmed (no message id)')
                status.forwarded++ 
                log.info({ from: msg.key.id, to: sent.key.id }, 'forwarded')
            })
            status.queued++
            status.lastMessageAt = new Date().toISOString()
            log.info({ id: msg.key.id, type: getContentType(msg.message), waiting: queue.size }, 'queued')
        }
    })
}
setInterval(() => log.info(snapshot(), 'heartbeat'), 5 * 60_000)
log.info('program starting')
setTimeout(start, 3000)   // wait 3 seconds before reconnecting
