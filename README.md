# Framework Node.js — carnet de voyage partagé

Framework HTTP écrit from scratch en TypeScript (`packages/framework`) et API métier construite uniquement avec lui (`apps/api`).

## Démarrage

```bash
cp .env.example .env      # puis remplir POSTGRES_PASSWORD et JWT_SECRET
npm install
npm run dev               # tsx watch
```

| Commande            | Rôle                                                        |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | lance l'API en développement (tsx, rechargement automatique) |
| `npm run typecheck` | vérification des types (`tsc --noEmit`)                     |
| `npm test`          | tests vitest, échoue sous 100 % de couverture               |
| `npm run build`     | build de production avec rolldown                           |
| `npm run check`     | les trois à la suite                                        |

## Arborescence

```
packages/framework/src
  core/         types, erreurs, sérialiseurs, configuration, pipeline, kernel
  routing/      compilation des motifs, registre de routes
  middlewares/  limitation de débit, logs, compression, CORS...
  validation/   validateur maison
  database/     Query Builder
  security/     JWT, hachage
  files/        upload et service de fichiers
apps/api
  database/schema.sql
  src/          config, kernel, routes, contrôleurs
```

## Utilisation du framework

### Configuration

`loadConfig(process.env)` est le seul endroit qui lit l'environnement. Le kernel valide la configuration au démarrage et refuse de démarrer en nommant chaque valeur fautive (`JWT_SECRET is required...`). Aucun secret n'a de valeur par défaut.

### Kernel

```ts
// apps/api/src/kernel.ts
export const kernel = new Kernel(config, { middlewares: [/* globaux */], database })
await kernel.start()   // valide la config, compile les routes, ouvre la base, écoute
await kernel.stop()    // arrêt gracieux (aussi sur SIGINT / SIGTERM)
```

### Routes

```ts
Route.get('/journeys', list).name('journeys.index')
Route.get('/journeys', listV2, { version: 'v2' }).name('journeys.v2.index')

Route.group({ prefix: '/journeys/{journeyId}', middlewares: [auth], name: 'steps.' }, () => {
  Route.post('/steps', addStep).name('store')            // nom final : steps.store
})

Route.url('steps.store', { journeyId: 3 })               // "/v1/journeys/3/steps"
```

Motifs acceptés : littéraux, `{id}` (un segment non vide), `{nom}.json`, `{path*}` (fin de chemin entière, en dernier). Une route statique gagne toujours sur une route dynamique. 404 si aucun chemin ne correspond, 405 avec l'en-tête `Allow` si seule la méthode diffère.

Versions : une route sans version prend la version par défaut (`API_DEFAULT_VERSION`). `/journeys` et `/v1/journeys` mènent à la même route ; la version résolue est dans `ctx.version`.

### Contrôleurs et réponses

```ts
const show: Handler = ({ params, query }) => json({ id: params.id, page: query.get('page') })
```

Formats fournis : `json` (par défaut), `text`, `html`, `xml`. Un autre format s'ajoute sans toucher au framework : `registerSerializer('csv', { contentType: 'text/csv', serialize })`. Un `Buffer` ou un flux `Readable` est envoyé tel quel (streaming).

### Middlewares

```ts
const timer: Middleware = async (ctx, next) => {
  const response = await next()        // le reste de la chaîne s'exécute ici
  return { ...response, headers: { ...response.headers, 'x-time': '...' } }
}
```

Ordre : globaux → groupes (du plus externe au plus interne) → route. Un middleware peut répondre sans appeler `next()`. Toute erreur (même après `next()`, même asynchrone) est transformée en réponse au format unique :

```json
{ "error": { "code": "NOT_FOUND", "message": "...", "details": null } }
```

En production, une erreur interne renvoie un message générique.

## Base de données

Schéma : [apps/api/database/schema.sql](apps/api/database/schema.sql) (users, journeys, steps, comments, tags). Suppression logique via `deleted_at`.

## Déploiement

_À compléter._
