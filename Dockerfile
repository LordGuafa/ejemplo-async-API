# syntax=docker/dockerfile:1

##########
# deps: dependencias completas (incluye devDependencies para compilar)
##########
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
# Se copian primero los manifiestos para aprovechar la caché de capas:
# solo se reinstala si cambian package.json, el lockfile o la allowlist de builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

##########
# build: compila TypeScript a dist/ (excluye test/ vía tsconfig.build.json)
##########
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.build.json

##########
# prod-deps: solo dependencias de producción
##########
FROM node:22-alpine AS prod-deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

##########
# runtime: imagen final mínima, sin código fuente ni dependencias de desarrollo
##########
FROM node:22-alpine AS runtime
WORKDIR /app

# NOTA: deliberadamente NO se fija NODE_ENV=production.
# En este proyecto "production" exige MQTT_URL con mqtts:// (TLS) y el broker
# de desarrollo (Mosquitto en compose.yaml) no usa TLS; fijarlo aquí haría
# que el contenedor no arrancara contra ese broker. Configúralo desde el
# entorno (compose o -e) solo cuando haya TLS de verdad.
# ENV NODE_ENV=production  # ← no hacer esto

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# El contrato se lee en tiempo de ejecución vía ASYNCAPI_PATH (relativo al WORKDIR)
COPY asyncapi.yaml ./asyncapi.yaml

USER node

# Por defecto corre el suscriptor; el publicador se lanza sobrescribiendo el comando:
#   docker compose run --rm publisher
CMD ["node", "dist/subscriber.js"]
