# Base pinnata per digest (index multi-arch), come il backend: rebuild
# riproducibile anche se il tag 24-alpine viene aggiornato a tua insaputa.
# 24 è l'LTS attiva di Node.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base

# Stage dipendenze: layer invalidato solo se cambia il lock.
# npm ci installa esattamente package-lock.json — l'equivalente npm di
# `uv sync --frozen`: nessuna risoluzione, nessuna sorpresa.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage di build: compila con le devDependencies (next, typescript), che il
# runtime non vedrà mai.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Nessuna telemetria in CI.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage runtime: solo l'output standalone (server.js + node_modules ridotti),
# utente non-root, niente sorgenti né toolchain. L'immagine `node` porta già
# l'utente `node` (uid 1000): lo riusiamo invece di crearne uno.
FROM base AS runner
WORKDIR /app

# La base `node` porta npm (con le sue dipendenze: tar, undici,
# brace-expansion...) nella directory di sistema: il runtime gira solo
# server.js e non lo tocca mai. Rimuoverlo elimina alla radice le CVE dello
# toolchain npm — senza eccezioni in .trivyignore — e riduce la superficie
# dell'immagine. Stessa mossa del backend con pip/setuptools.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/.next/standalone ./
# standalone non include static e public: si copiano a parte.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
