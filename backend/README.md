# JackTrade backend

Relayer, liquidador, keepers, indexer y precios para los contratos de JackTrade en Robinhood Chain (4663).

El avance está en [PROGRESO.md](PROGRESO.md). Los avisos para el equipo, en [AVISOS.md](AVISOS.md).

Para el front: [precios en vivo](docs/precios-front.md) y [operar con session keys](docs/intents-front.md). Entre piezas del backend: [interfaces](docs/interfaces.md).

## Requisitos

- Node.js 22.12 o posterior
- pnpm 10
- Foundry (anvil) para el fork local

## Arranque

```sh
pnpm install
cp .env.example .env
pnpm check:contracts
```

## Contratos

Las direcciones y ABIs salen de `main` de `jacktrade/contracts` (lo desplegado). Para regenerarlas:

```sh
pnpm sync:exports
```

Clona `main` en una carpeta temporal, compila y exporta. No usa tu copia local de `contracts`.
