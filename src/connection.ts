import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    type WAMessage,
    type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { rm } from 'node:fs/promises'
import { log, baileysLog } from './logger.js'
import { buildContent } from './relay.js'
import type { Group } from './destination.js'

const AUTH_DIR = 'auth'
const RECONNECT_DELAY_MS = 3000

const CLOSE_REASONS: Record<number, string> = {
    401: 'logged out',
    408: 'connection lost or timed out',
    428: 'connection closed',
    440: 'connection replaced (another copy uses this session)',
    500: 'bad session',
    515: 'restart required (normal right after scanning the QR)',
}

export type ConnectionState = 'starting' | 'open' | 'closed'

export type ConnectionHandlers = {
    qr: (qr: string) => void
    open: () => void | Promise<void>
    loggedOut: () => void
    message: (msg: WAMessage) => void
}

export class WhatsAppConnection {
    state: ConnectionState = 'starting'
    account = ''
    qr: string | undefined

    private sock: WASocket | undefined
    private handlers: Partial<ConnectionHandlers> = {}

    on(handlers: Partial<ConnectionHandlers>): void {
        Object.assign(this.handlers, handlers)
    }

    async start(): Promise<void> {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
        const sock = makeWASocket({ auth: state, logger: baileysLog })
        this.sock = sock

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                this.qr = qr
                this.handlers.qr?.(qr)
            }

            if (connection === 'open') {
                this.qr = undefined
                const number = sock.user?.id.split(':')[0] ?? ''
                this.state = 'open'
                this.account = `…${number.slice(-4)}`
                log.info({ account: this.account }, 'connected')
                try {
                    await this.handlers.open?.()
                } catch (err) {
                    log.error({ err }, 'open handler failed')
                }
            }

            if (connection === 'close') {
                this.qr = undefined
                this.state = 'closed'
                const code = (lastDisconnect?.error as Boom)?.output?.statusCode
                log.warn({ code, reason: CLOSE_REASONS[code ?? 0] ?? 'unknown' }, 'connection closed')

                if (code === DisconnectReason.loggedOut) {
                    log.warn('logged out, deleting the session')
                    await rm(AUTH_DIR, { recursive: true, force: true })
                    this.account = ''
                    this.handlers.loggedOut?.()
                }
                setTimeout(() => void this.start(), RECONNECT_DELAY_MS)
            }
        })

        sock.ev.on('messages.upsert', ({ messages, type }) => {
            if (type !== 'notify') {
                log.debug({ type, count: messages.length }, 'upsert ignored (not a live message)')
                return
            }
            for (const msg of messages) this.handlers.message?.(msg)
        })
    }

    async logout(): Promise<void> {
        if (this.state !== 'open') throw new Error('not connected')
        await this.sock?.logout()
    }

    async listGroups(): Promise<Group[]> {
        if (!this.sock) throw new Error('not connected')
        const groups = await this.sock.groupFetchAllParticipating()
        return Object.values(groups).map((g) => ({
            id: g.id,
            name: g.subject,
            members: g.participants.length,
        }))
    }

    /** Re-sends an incoming message to another chat. Returns the id of the sent message, or throws. */
    async relay(msg: WAMessage, toJid: string): Promise<string> {
        const sock = this.sock                      // read now, so it is always the newest socket
        if (!sock) throw new Error('not connected')
        const content = await buildContent(sock, msg, baileysLog)
        const sent = await sock.sendMessage(toJid, content)
        if (!sent?.key?.id) throw new Error('send was not confirmed (no message id)')
        return sent.key.id
    }
}