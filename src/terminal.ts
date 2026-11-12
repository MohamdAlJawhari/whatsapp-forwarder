import readline from 'node:readline'
import { log } from './logger.js'

const rl = readline.createInterface({ input: process.stdin })

const commands = new Map<string, () => void | Promise<void>>()
let waitingForAnswer: ((text: string) => void) | null = null

rl.on('line', (line) => {
    const text = line.trim()

    if (waitingForAnswer) {            // a question is open: this line is the answer
        const resolve = waitingForAnswer
        waitingForAnswer = null
        resolve(text)
        return
    }

    // no question is open: this line is a command
    const command = commands.get(text)
    if (command) {
        log.info({ command: text }, 'terminal command')
        void command()
    }
})

export function onCommand(name: string, action: () => void | Promise<void>) {
    commands.set(name, action)
}

export function ask(question: string): Promise<string> {
    console.log(question)
    return new Promise((resolve) => { waitingForAnswer = resolve })
}