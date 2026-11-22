# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/framework/package.json packages/framework/
COPY apps/api/package.json apps/api/

FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/framework packages/framework
COPY apps/api apps/api
RUN npm run build

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/framework node_modules/api

FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/api/dist dist
COPY --chown=node:node package.json ./
RUN install -d -o node -g node uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/main.js"]
