// npx tsx src/forwarder.check.ts

import { Forwarder } from './forwarder.js'

const sentTo: string[] = []

const forwarder = new Forwarder({
  queue: { push: (job) => { void job(); return true }, size: 0 },   // runs the job at once
  destination: { id: 'dest@g.us' },
  relay: async (_msg, toJid) => { sentTo.push(toJid); return 'fake-id' },
  forwardOwn: false,
})

const make = (fromMe: boolean) =>
  ({ key: { remoteJid: '123@lid', fromMe, id: 'X' }, message: { conversation: 'hi' } }) as any

forwarder.handle(make(false))   // should be forwarded
forwarder.handle(make(true))    // should be skipped: sent by me

setTimeout(() => {
  console.log('sent to:', sentTo)          // expect: [ 'dest@g.us' ]
  console.log('stats:', forwarder.stats)   // expect: queued 1, forwarded 1
}, 50)