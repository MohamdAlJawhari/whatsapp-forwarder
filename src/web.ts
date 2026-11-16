import Fastify from 'fastify'
import QRCode from 'qrcode'
import { readFile } from 'node:fs/promises'
import { log } from './logger.js'
import type { Controls } from './controls.js'

const HOST = process.env.UI_HOST ?? '127.0.0.1'   // this computer only
const PORT = Number(process.env.UI_PORT ?? 3000)

// Browsers remember Basic Auth credentials, so another website could make your browser
// send a request to us. Other sites cannot add this custom header, so we require it
// on every request that changes something.
const GUARD_HEADER = 'x-requested-with'
const GUARD_VALUE = 'forwarder-ui'

export async function startWebServer(controls: Controls): Promise<void> {
    const app = Fastify()

    app.addHook('onRequest', async (req, reply) => {
        if (req.method !== 'GET' && req.headers[GUARD_HEADER] !== GUARD_VALUE) {
            return reply.code(403).send({ error: 'forbidden' })
        }
    })

    // The page is read on every request, so you can edit the HTML without restarting
    app.get('/', async (_req, reply) => {
        const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
        return reply.type('text/html; charset=utf-8').send(page)
    })

    app.get('/api/status', async (_req, reply) => {
        reply.header('Cache-Control', 'no-store')
        return controls.getStatus()
    })

    app.get('/api/qr', async (_req, reply) => {
        reply.header('Cache-Control', 'no-store')
        const qr = controls.getQr()
        if (!qr) return reply.code(204).send()          // nothing to scan right now
        return { image: await QRCode.toDataURL(qr, { margin: 2, width: 280 }) }
    })

    app.post('/api/logout', async () => {
        log.info('logout requested from the web UI')
        await controls.logout()
        return { ok: true }
    })

    app.get('/api/groups', async (_req, reply) => {
        reply.header('Cache-Control', 'no-store')
        return { groups: await controls.destinationChoices(), currentId: controls.getDestinationId() }
    })

    app.post<{ Body: { id?: string } }>('/api/destination', async (req, reply) => {
        const groups = await controls.destinationChoices()
        const group = groups.find((g) => g.id === req.body?.id)
        if (!group) return reply.code(404).send({ error: 'unknown group' })
        await controls.setDestination(group)
        return { ok: true }
    })

    await app.listen({ host: HOST, port: PORT })
    log.info({ url: `http://${HOST}:${PORT}` }, 'web UI listening')
}