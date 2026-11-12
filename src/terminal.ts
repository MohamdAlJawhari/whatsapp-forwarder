import readline from 'node:readline'

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

    const command = commands.get(text) // otherwise, is this line a known command?
    if (command) void command()
})

export function onCommand(name: string, action: () => void | Promise<void>) {
    commands.set(name, action)
}

export function ask(question: string): Promise<string> {
    console.log(question)
    return new Promise((resolve) => { waitingForAnswer = resolve })
}