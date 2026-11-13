// npx tsx src/filter.check.ts

import { skipReason } from './filter.js'

const ctx = { destination: 'dest@g.us', forwardOwn: false }
const make = (remoteJid: string, fromMe = false) =>
  ({ key: { remoteJid, fromMe }, message: { conversation: 'hi' } }) as any

console.log('status         →', skipReason(make('status@broadcast'), ctx))     // expect: status update
console.log('broadcast list →', skipReason(make('1794252421@broadcast'), ctx)) // expect: null (forwarded)
console.log('private chat   →', skipReason(make('123@lid'), ctx))              // expect: null (forwarded)
console.log('my own message →', skipReason(make('123@lid', true), ctx))        // expect: sent by me