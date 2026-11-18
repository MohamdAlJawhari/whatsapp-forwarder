import qrcode from 'qrcode-terminal'

import { SendQueue } from './queue.js'
import { log } from './logger.js'
import { DestinationService } from './destination.js'
import { WhatsAppConnection } from './connection.js'
import { Forwarder } from './forwarder.js'
import { createStatusReader } from './status.js'
import { registerTerminalCommands } from './commands.js'
import type { Controls } from './controls.js'
import { startWebServer } from './web.js'
import { readLogs } from './logs.js'

const forwardOwn = process.env.FORWARD_OWN === '1'

// 1. Create the pieces
const connection = new WhatsAppConnection()
const queue = new SendQueue()
const destinationService = new DestinationService(() => connection.listGroups())
const forwarder = new Forwarder({
    queue,
    destination: destinationService,
    relay: (msg, toJid) => connection.relay(msg, toJid),
    forwardOwn,
})
const getStatus = createStatusReader({ connection, destination: destinationService, forwarder, queue })

// 2. What a user interface may do
const controls: Controls = {
    getStatus,
    getQr: () => connection.qr,
    logout: () => connection.logout(),
    destinationChoices: () => destinationService.choices(),
    setDestination: (group) => destinationService.set(group),
    getDestinationId: () => destinationService.id,
    readLogs,
}
registerTerminalCommands(controls)

// 3. Connect the pieces
connection.on({
    qr: (qr) => {
        log.info('QR ready, waiting for scan')
        qrcode.generate(qr, { small: true })
    },
    open: async () => {
        if (!(await destinationService.restore())) {
            log.warn('no destination saved: choose one in the web UI, or type "destination" in the terminal')
        }
    },
    loggedOut: () => destinationService.clear(),
    message: (msg) => forwarder.handle(msg),
})

// 4. Start
setInterval(() => log.info(getStatus(), 'heartbeat'), 5 * 60_000)

if (forwardOwn) log.warn('FORWARD_OWN is ON: your own messages will be forwarded (testing only)')
log.info('program starting')

await startWebServer(controls)
void connection.start()