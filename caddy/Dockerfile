# Immagine ufficiale pinnata per digest (index multi-arch), come backend e
# frontend. Ci si costruisce sopra per due motivi:
#   1. apk upgrade: il layer alpine dell'upstream può portare pacchetti con
#      CVE già fixate nei repo (curl, c-ares, libcurl) ma non ancora rilanciate
#      in immagine — qui si chiude subito;
#   2. la config entra nell'immagine invece che via volume: quello che gira è
#      quello committato, rebuildato e scansionabile.
FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

RUN apk upgrade --no-cache

COPY Caddyfile /etc/caddy/Caddyfile
