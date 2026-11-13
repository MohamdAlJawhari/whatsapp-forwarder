import { loadConfig, saveConfig } from './config.js'
import { log } from './logger.js'

export type Group = { id: string; name: string; members: number }

export class DestinationService {
    private current: Group | undefined

    // listGroups is passed in, so this class knows nothing about Baileys
    constructor(private listGroups: () => Promise<Group[]>) { }

    get id(): string | undefined { return this.current?.id }
    get name(): string | undefined { return this.current?.name }

    /** Groups to choose from, sorted by name */
    async choices(): Promise<Group[]> {
        const groups = await this.listGroups()
        return groups.sort((a, b) => a.name.localeCompare(b.name))
    }

    /** Use the saved destination if this account is still a member. Returns false if there is none. */
    async restore(): Promise<boolean> {
        const saved = await loadConfig()
        if (!saved.destinationJid) return false
        const group = (await this.listGroups()).find((g) => g.id === saved.destinationJid)
        if (!group) return false
        this.current = group
        log.info({ destination: group.name }, 'destination loaded')
        return true
    }

    /** Choose a destination and remember it */
    async set(group: Group): Promise<void> {
        this.current = group
        await saveConfig({ destinationJid: group.id, destinationName: group.name })
        log.info({ destination: group.name }, 'destination set')
    }

    /** Forget the current destination (after a logout) */
    clear(): void {
        this.current = undefined
    }
}