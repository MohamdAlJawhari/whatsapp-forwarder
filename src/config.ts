import { readFile, writeFile, mkdir } from 'node:fs/promises'

const CONFIG_PATH = 'data/config.json'

export type Config = { destinationJid?: string; destinationName?: string }

export async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  } catch {
    return {} // file missing or broken: start with an empty config
  }
}

export async function saveConfig(config: Config) {
  await mkdir('data', { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
}