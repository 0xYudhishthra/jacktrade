#!/bin/sh
# Arranque en Railway: elige el servicio por SERVICE o, si no está, por el nombre del servicio en Railway
# (RAILWAY_SERVICE_NAME, por ejemplo "@hm/liquidator"). Así no depende del "Railway Config File" de la UI.
set -e
name="${SERVICE:-$RAILWAY_SERVICE_NAME}"
case "$name" in
  *prices*) exec pnpm prices:server ;;
  *relayer*) exec pnpm relayer ;;
  *liquidator*) exec pnpm liquidator ;;
  *keeper*) exec pnpm keepers ;;
  *indexer*) exec pnpm indexer ;;
  *)
    echo "No sé qué servicio arrancar: SERVICE='${SERVICE}' RAILWAY_SERVICE_NAME='${RAILWAY_SERVICE_NAME}'. Poné SERVICE=prices|relayer|liquidator|keepers|indexer" >&2
    exit 1
    ;;
esac
