import type { Group } from './destination.js'
import type { Status } from './status.js'
import type { LogEntry, LogQuery } from './logs.js'

/** Everything a user interface (terminal now, web page later) is allowed to do. */
export type Controls = {
    getStatus: () => Status
    getQr: () => string | undefined
    logout: () => Promise<void>
    destinationChoices: () => Promise<Group[]>
    setDestination: (group: Group) => Promise<void>
    getDestinationId: () => string | undefined
    readLogs: (query?: LogQuery) => Promise<LogEntry[]>      // NEW
}