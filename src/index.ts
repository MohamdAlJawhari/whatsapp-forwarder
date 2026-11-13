import qrcode from 'qrcode-terminal'

import { SendQueue } from './queue.js'
import { ask, onCommand } from './terminal.js'
import { log } from './logger.js'
import { DestinationService } from './destination.js'
import { WhatsAppConnection } from './connection.js'
import { Forwarder } from './forwarder.js'
import { createStatusReader } from './status.js'

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

// 2. Terminal interaction (moves out in R6)
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

onCommand('logout', async () => {
    try {
        console.log('logging out...')
        await connection.logout()
    } catch (err) {
        console.error('logout failed:', err)
    }
})
onCommand('destination', promptForDestination)
onCommand('status', () => console.log(getStatus()))

// 3. Connect the pieces
connection.on({
    qr: (qr) => {
        log.info('QR ready, waiting for scan')
        qrcode.generate(qr, { small: true })
    },
    open: async () => {
        if (!(await destinationService.restore())) await promptForDestination()
    },
    loggedOut: () => destinationService.clear(),
    message: (msg) => forwarder.handle(msg),
})

// 4. Start
setInterval(() => log.info(getStatus(), 'heartbeat'), 5 * 60_000)

if (forwardOwn) log.warn('FORWARD_OWN is ON: your own messages will be forwarded (testing only)')
log.info('program starting')
void connection.start()