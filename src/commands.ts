import { ask, onCommand } from './terminal.js'
import type { Controls } from './controls.js'

export function registerTerminalCommands(controls: Controls) {
    async function chooseDestination() {
        const groups = await controls.destinationChoices()
        groups.forEach((g, i) => console.log(`${i + 1}. ${g.name}  (${g.members} members)`))

        while (true) {
            const n = Number(await ask('Type the number of the destination group: '))
            const group = groups[n - 1]
            if (group) {
                await controls.setDestination(group)
                return
            }
            console.log('Not a valid number, try again.')
        }
    }

    onCommand('logout', async () => {
        try {
            console.log('logging out...')
            await controls.logout()
        } catch (err) {
            console.error('logout failed:', err)
        }
    })
    onCommand('destination', chooseDestination)
    onCommand('status', () => console.log(controls.getStatus()))

    // The program also needs this at first start, when no destination is saved yet
    return { chooseDestination }
}