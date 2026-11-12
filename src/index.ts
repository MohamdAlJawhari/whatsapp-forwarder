import makeWASocket, { useMultiFileAuthState, DisconnectReason, getContentType, type WASocket } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'

import { SendQueue } from './queue.js'
import { buildContent } from './relay.js'

import { rm } from 'node:fs/promises'
import readline from 'node:readline'

const AUTH_DIR = 'auth'
const queue = new SendQueue()

const DEST_GROUP_JID = process.env.DEST_GROUP_JID ?? '120363409777555529@g.us'
const logger = pino({ level: 'warn' }) // quiet Baileys' internal logs; try 'debug' later to see the protocol

let currentSock: WASocket | undefined   // always points to the latest socket

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (line.trim() !== 'logout') return
    try {
        console.log('logging out...')
        await currentSock?.logout()
    } catch (err) {
        console.error('logout failed:', err)
    }
})


async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const sock = makeWASocket({ auth: state, logger })
    currentSock = sock

    sock.ev.on('creds.update', saveCreds)

    // listen to connection updates 
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true })   // render the QR in the terminal

        if (connection === 'open') {
            console.log('connected')
            // Safe to call API methods only once the connection is open
            const groups = await sock.groupFetchAllParticipating()
            for (const [jid, meta] of Object.entries(groups)) console.log(jid, '→', meta.subject)
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error as Boom)?.output?.statusCode
            console.log('closed, code:', code)

            if (code === DisconnectReason.loggedOut) {
                console.log('logged out: deleting the session')
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
            const jid = msg.key.remoteJid
            if (!jid || jid === DEST_GROUP_JID) continue
            if (jid.endsWith('@broadcast')) continue        // status + broadcast lists
            // skip WhatsApp's internal messages
            const kind = getContentType(msg.message)
            if (kind === 'protocolMessage' || kind === 'senderKeyDistributionMessage') continue

            queue.push(async () => {
                const content = await buildContent(sock, msg, logger)
                await sock.sendMessage(DEST_GROUP_JID, content)
            })
            console.log('queued, size:', queue.size)
        }
    })
}

start()