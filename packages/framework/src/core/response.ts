import type { ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { HttpResponse } from './types'

/** Un sérialiseur transforme le corps d'une réponse en texte. */
export interface Serializer {
  contentType: string
  serialize(body: unknown): string
}

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const asText = (body: unknown): string => (typeof body === 'string' ? body : JSON.stringify(body))

// Un nom de balise XML valide : on remplace les caractères interdits.
const xmlTag = (key: string): string => {
  const tag = key.replace(/[^A-Za-z0-9_.-]/g, '_')
  return /^[A-Za-z_]/.test(tag) ? tag : `_${tag}`
}

const toXml = (value: unknown, tag: string): string => {
  if (value === null || value === undefined) return `<${tag}/>`
  if (Array.isArray(value)) {
    return `<${tag}>${value.map((item) => toXml(item, 'item')).join('')}</${tag}>`
  }
  if (typeof value === 'object') {
    const children = Object.entries(value)
      .map(([key, child]) => toXml(child, xmlTag(key)))
      .join('')
    return `<${tag}>${children}</${tag}>`
  }
  return `<${tag}>${escapeHtml(String(value))}</${tag}>`
}

const serializers = new Map<string, Serializer>()

const builtins: Record<string, Serializer> = {
  json: { contentType: 'application/json; charset=utf-8', serialize: (body) => JSON.stringify(body) },
  text: { contentType: 'text/plain; charset=utf-8', serialize: asText },
  html: { contentType: 'text/html; charset=utf-8', serialize: asText },
  xml: {
    contentType: 'application/xml; charset=utf-8',
    serialize: (body) => `<?xml version="1.0" encoding="UTF-8"?>${toXml(body, 'response')}`,
  },
}

/** Ajoute (ou remplace) un format de réponse : le framework reste ouvert. */
export const registerSerializer = (format: string, serializer: Serializer): void => {
  serializers.set(format, serializer)
}

/** Remet les sérialiseurs d'origine (utile entre deux tests). */
export const resetSerializers = (): void => {
  serializers.clear()
  for (const [format, serializer] of Object.entries(builtins)) serializers.set(format, serializer)
}
resetSerializers()

export const getSerializer = (format: string): Serializer => {
  const serializer = serializers.get(format)
  if (serializer === undefined) throw new Error(`No serializer registered for format "${format}"`)
  return serializer
}

// ---------- Aides pour les contrôleurs ----------

export const respond = (
  format: string,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): HttpResponse => ({ status, headers, body, format })

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  respond('json', body, status, headers)

export const text = (body: string, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  respond('text', body, status, headers)

export const html = (body: string, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  respond('html', body, status, headers)

export const xml = (body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse =>
  respond('xml', body, status, headers)

export const noContent = (headers: Record<string, string> = {}): HttpResponse =>
  respond('json', undefined, 204, headers)

// ---------- Écriture sur le socket ----------

/** Corps final : texte sérialisé, Buffer déjà prêt, ou flux (fichiers). */
export interface Payload {
  status: number
  headers: Record<string, string>
  body: string | Buffer | Readable | undefined
}

/** Prépare la réponse : choisit le sérialiseur et le Content-Type. */
export const toPayload = (response: HttpResponse): Payload => {
  const serializer = getSerializer(response.format)
  const headers: Record<string, string> = { 'content-type': serializer.contentType }
  for (const [name, value] of Object.entries(response.headers)) headers[name.toLowerCase()] = value

  const { body, status } = response
  if (status === 204 || status === 304 || body === undefined) {
    delete headers['content-type']
    return { status, headers, body: undefined }
  }
  if (Buffer.isBuffer(body) || body instanceof Readable) return { status, headers, body }
  return { status, headers, body: serializer.serialize(body) }
}

/**
 * Écrit la réponse une seule fois : si un middleware a déjà répondu
 * directement sur `res`, on ne fait rien (pas d'erreur "headers already sent").
 */
export const writePayload = async (res: ServerResponse, payload: Payload): Promise<void> => {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(payload.status, payload.headers)
  if (payload.body instanceof Readable) {
    await pipeline(payload.body, res).catch(() => res.destroy())
    return
  }
  res.end(payload.body)
}
