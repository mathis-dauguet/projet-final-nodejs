import type { Context, Handler, HttpResponse, Middleware } from './types'

/**
 * Compose les middlewares en oignon autour d'un contrôleur.
 *
 * `next()` exécute le reste de la chaîne puis rend la main : le middleware
 * peut donc agir après le contrôleur. Chaque étape est `async`, donc une
 * erreur synchrone ou asynchrone devient une promesse rejetée, remontée
 * jusqu'à l'appelant (aucune promesse perdue).
 */
export const compose = (middlewares: Middleware[], handler: Handler): Handler => {
  return (ctx: Context): Promise<HttpResponse> => {
    let index = -1

    const dispatch = async (i: number): Promise<HttpResponse> => {
      if (i <= index) throw new Error('next() called multiple times')
      index = i
      const middleware = middlewares[i]
      if (middleware === undefined) return handler(ctx)
      return middleware(ctx, () => dispatch(i + 1))
    }

    return dispatch(0)
  }
}
