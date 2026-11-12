import makeWASocket, { useMultiFileAuthState, DisconnectReason, getContentType, type WASocket } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'

import { rm } from 'node:fs/promises'

import { SendQueue } from './queue.js'
import { buildContent } from './relay.js'
import { ask, onCommand } from './terminal.js'
import { loadConfig, saveConfig } from './config.js'

const AUTH_DIR = 'auth'
const queue = new SendQueue()

// const DEST_GROUP_JID = process.env.DEST_GROUP_JID ?? '120363409777555529@g.us'
const logger = pino({ level: 'warn' }) // quiet Baileys' internal logs; try 'debug' later to see the protocol

let currentSock: WASocket | undefined
let destination: string | undefined     // replaces DEST_GROUP_JID

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
            await saveConfig({ destinationJid: group.id, destinationName: group.subject })
            console.log(`destination set: ${group.subject}`)
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
        console.log(`destination: ${found.subject}`)
    } else {
        await chooseDestination(sock)       // nothing saved, or this number is not in that group
    }
}

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
            await ensureDestination(sock)
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
            if (!destination) { console.log('no destination yet, message skipped'); continue }

            const jid = msg.key.remoteJid
            if (jid === destination) continue  // still protects against a forwarding loop
            if (!jid || jid.endsWith('@broadcast')) continue  // status + broadcast lists

            // skip WhatsApp's internal messages
            const kind = getContentType(msg.message)
            if (kind === 'protocolMessage' || kind === 'senderKeyDistributionMessage') continue

            queue.push(async () => {
                const content = await buildContent(sock, msg, logger)
                const target = destination  // read when the job RUNS, not when it was queued
                if (!target) throw new Error('no destination')
                await sock.sendMessage(target, content)
            })
            console.log('queued, size:', queue.size)
        }
    })
}

start()