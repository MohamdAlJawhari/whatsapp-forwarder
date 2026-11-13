import type { Group } from './destination.js'
import type { Status } from './status.js'

/** Everything a user interface (terminal now, web page later) is allowed to do. */
export type Controls = {
    getStatus: () => Status
    logout: () => Promise<void>
    destinationChoices: () => Promise<Group[]>
    setDestination: (group: Group) => Promise<void>
}