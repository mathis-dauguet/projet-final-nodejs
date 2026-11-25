import { Kernel } from 'framework'
import { config } from './config'

/** Le kernel de l'application, exporté une seule fois. */
export const kernel = new Kernel(config)
