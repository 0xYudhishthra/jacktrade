# Una sola imagen para todos los servicios; cada servicio de Railway elige su comando en railway/<servicio>.json.
FROM node:22.20.0-bookworm-slim

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app
# Primero los manifiestos: si no cambian las dependencias, la capa del install queda en caché.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Parches de dependencias (pnpm patchedDependencies): tienen que estar antes del install.
COPY patches/ patches/
COPY shared/package.json shared/
COPY prices/package.json prices/
COPY relayer/package.json relayer/
COPY liquidator/package.json liquidator/
COPY keepers/package.json keepers/
COPY indexer/package.json indexer/
# tsx y ponder son devDependencies o herramientas de ejecución: se instala todo (el código se corre sin compilar).
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
# Ponder escribe archivos generados en indexer/ al arrancar; el resto es de solo lectura para el usuario node.
RUN chown -R node:node /app/indexer
USER node

# El comando sale de railway/<servicio>.json o, si la UI no lo tiene cargado, de scripts/start.sh según el nombre del servicio.
CMD ["sh", "scripts/start.sh"]
