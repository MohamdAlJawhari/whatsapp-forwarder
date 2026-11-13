import { getContentType, type WAMessage } from '@whiskeysockets/baileys'

export type FilterContext = {
    destination: string | undefined // the group we forward to
    forwardOwn: boolean // true only for testing with yourself
}

// A rule returns a reason to SKIP the message, or null to let it pass
type SkipRule = (msg: WAMessage, ctx: FilterContext) => string | null

const rules: SkipRule[] = [
    (msg) => (msg.message ? null : 'no content (failed decryption or stub)'),
    (msg, ctx) => (msg.key.fromMe && !ctx.forwardOwn ? 'sent by me' : null),
    (msg, ctx) => (msg.key.remoteJid === ctx.destination ? 'from the destination group (loop protection)' : null),
    (msg) => (msg.key.remoteJid ? null : 'no chat id'),
    (msg) => (msg.key.remoteJid === 'status@broadcast' ? 'status update' : null),
    (msg) => {
        const kind = getContentType(msg.message ?? undefined)
        return kind === 'protocolMessage' || kind === 'senderKeyDistributionMessage'
            ? `internal message (${kind})`
            : null
    },
    (msg) => (getContentType(msg.message ?? undefined) === 'albumMessage' ? 'album header (the images come separately)' : null),
]

/** Why this message should be skipped, or null if it should be forwarded. */
export function skipReason(msg: WAMessage, ctx: FilterContext): string | null {
    for (const rule of rules) {
        const reason = rule(msg, ctx)
        if (reason) return reason
    }
    return null
}
