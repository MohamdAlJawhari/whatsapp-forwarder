import {
    downloadMediaMessage,
    getContentType,
    type WAMessage,
    type WASocket,
    type AnyMessageContent,
} from '@whiskeysockets/baileys'

const MAX_BYTES = 50 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 90_000

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms)
    })
    try {
        return await Promise.race([p, timeout])   // whichever finishes first wins
    } finally {
        clearTimeout(timer!)                      // don't leave the timer running
    }
}

// Build the content for forwarding based on the message type
export async function buildContent(sock: WASocket, msg: WAMessage, logger: any): Promise<AnyMessageContent> {
    const type = getContentType(msg.message!)   // e.g. 'imageMessage', 'conversation'
    if (!type) return { forward: msg }          // no known type: nothing to inspect
    const content = (msg.message as any)[type]
    const caption: string | undefined = content?.caption
    const from = msg.pushName ?? 'unknown'

    const size = Number(content?.fileLength?.toString() ?? 0)
    if (size > MAX_BYTES) {
        return { text: `${from} sent a large file (${Math.round(size / 1048576)} MB), skipped` }
    }

    const download = () =>
        withTimeout(
            downloadMediaMessage(msg, 'buffer', {}, {
                logger,
                reuploadRequest: sock.updateMediaMessage,   // re-fetches media if the URL expired
            }), DOWNLOAD_TIMEOUT_MS)

    switch (type) {
        case 'imageMessage':
            return { image: await download(), caption: `${caption ?? ''}`.trim() }
        case 'videoMessage':
            return { video: await download(), caption: `${caption ?? ''}`.trim(), mimetype: content.mimetype }
        case 'documentMessage':
            return {
                document: await download(),
                mimetype: content.mimetype,
                fileName: content.fileName ?? 'file',
                caption: `${caption ?? ''}`.trim(),
            }
        default:
            return { forward: msg }   // text, voice notes, etc. already work with forward
    }
}