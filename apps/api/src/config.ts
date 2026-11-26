import { loadConfig } from 'framework'

/** Le seul endroit de l'application qui lit l'environnement. */
export const config = loadConfig(process.env)
