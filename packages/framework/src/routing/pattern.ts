/**
 * Compilation d'un chemin de route en expression régulière.
 *
 * Formes acceptées :
 *  - littéraux               /users           comparés exactement
 *  - paramètre seul          /users/{id}      un segment, jamais vide
 *  - paramètre + extension   /export/{nom}.json
 *  - fin de chemin entière   /files/{path*}   peut contenir des "/", en dernier uniquement
 */
export interface CompiledPattern {
  path: string
  isStatic: boolean
  regex: RegExp
  paramNames: string[]
  /** Nom du paramètre "fin de chemin" ({path*}), s'il y en a un. */
  wildcard: string | undefined
}

const PARAM = /\{(\w+)(\*?)\}/g

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "/users/" → "/users", "users" → "/users", "" → "/" */
export const normalizePath = (path: string): string => {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}

export const compilePattern = (rawPath: string): CompiledPattern => {
  const path = normalizePath(rawPath)
  const paramNames: string[] = []
  let wildcard: string | undefined
  let source = ''
  let last = 0

  // Un littéral ne doit jamais contenir d'accolade : "{id" ou "{a-b}" sont des fautes de frappe.
  const literal = (value: string): string => {
    if (/[{}]/.test(value)) throw new Error(`Invalid parameter syntax in route "${path}"`)
    return escapeRegex(value)
  }

  for (const match of path.matchAll(PARAM)) {
    const [whole, name = '', star] = match
    if (paramNames.includes(name)) throw new Error(`Duplicate parameter "{${name}}" in route "${path}"`)
    const end = match.index + whole.length
    if (star === '*') {
      if (end !== path.length || path[match.index - 1] !== '/') {
        throw new Error(`Wildcard parameter "{${name}*}" must be a whole last segment in route "${path}"`)
      }
      wildcard = name
    }
    source += literal(path.slice(last, match.index))
    source += star === '*' ? '(.+)' : '([^/]+)'
    paramNames.push(name)
    last = end
  }
  source += literal(path.slice(last))

  return {
    path,
    isStatic: paramNames.length === 0,
    regex: new RegExp(`^${source}$`),
    paramNames,
    wildcard,
  }
}

/** Décode un paramètre ; une fin de chemin est décodée segment par segment. */
const decode = (value: string): string => decodeURIComponent(value)

/** Extrait les paramètres décodés d'un chemin qui correspond au motif. */
export const extractParams = (pattern: CompiledPattern, match: RegExpExecArray): Record<string, string> => {
  const params: Record<string, string> = {}
  pattern.paramNames.forEach((name, i) => {
    // Tous les groupes sont obligatoires : match[i + 1] existe forcément.
    const raw = String(match[i + 1])
    params[name] = name === pattern.wildcard ? raw.split('/').map(decode).join('/') : decode(raw)
  })
  return params
}

/** Encodage identique à celui de la résolution : une valeur reste dans son segment. */
export const encodeParam = (value: string, wildcard: boolean): string =>
  wildcard ? value.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(value)
