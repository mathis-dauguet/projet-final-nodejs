import './routes/index'
import { kernel } from './kernel'

await kernel.start()
console.log(`API listening on http://${kernel.config.host}:${kernel.port}`)
