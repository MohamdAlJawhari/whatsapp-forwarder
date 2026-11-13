import {
    downloadMediaMessage,
    getContentType,
    type AnyMessageContent,
    type WAMessage,
    type WASocket,
} from '@whiskeysockets/baileys'

const MAX_BYTES = 50 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 120_000

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms)
    })
    try {
        return await Promise.race([p, timeout])
    } finally {
        clearTimeout(timer!)
    }
}

// What every handler receives
type HandlerInput = {
    content: any                       // the inner object, e.g. msg.message.imageMessage
    download: () => Promise<Buffer>    // downloads this message's media when called
}
type Handler = (input: HandlerInput) => Promise<AnyMessageContent>

// One entry per media type we re-send. Anything not listed is forwarded as it is.
const handlers: Record<string, Handler> = {
    imageMessage: async ({ content, download }) => ({
        image: await download(),
        caption: content.caption,
    }),
    videoMessage: async ({ content, download }) => ({
        video: await download(),
        caption: content.caption,
        mimetype: content.mimetype, 
    }),
    documentMessage: async ({ content, download }) => ({
        document: await download(),
        mimetype: content.mimetype,
        fileName: content.fileName ?? 'file',
        caption: content.caption,
    }),
}

export async function buildContent(
    sock: WASocket,
    msg: WAMessage,
    logger: any
): Promise<AnyMessageContent> {
    const type = getContentType(msg.message ?? undefined)
    const content = type ? (msg.message as any)[type] : undefined

    // Size guard for any message that carries a file
    const size = Number(content?.fileLength?.toString() ?? 0)
    if (size > MAX_BYTES) {
        const from = msg.pushName ?? 'unknown'
        return { text: `${from} sent a large file (${Math.round(size / 1048576)} MB), skipped` }
    }

    const handler = type ? handlers[type] : undefined
    if (!handler) return { forward: msg }          // text, voice notes, and everything else

    const download = () =>
        withTimeout(
            downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
            DOWNLOAD_TIMEOUT_MS
        )

    return handler({ content, download })
}