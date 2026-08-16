# security-demo

Stack a tre servizi — API FastAPI, frontend Next.js, proxy Caddy — dietro una
pipeline di sicurezza completa e verificabile:
`pyproject.toml → uv.lock → immagine → firma → registry → scan di produzione`.
Ogni anello è controllato in CI e ogni controllo lascia evidenza scaricabile.

Costruita per reggere un audit ISO/IEC 27001:2022 sui controlli di sviluppo
sicuro (A.8.25–A.8.30) **usando solo strumenti open source e il piano
GitHub Free su repo privato**: nessuna licenza, nessun abbonamento.

## Il flusso in un colpo d'occhio

```text
              backend/pyproject.toml    dipendenze pinnate ==, requires-python ==3.13.*
                     |
                     v
              uv.lock                committato, hash di ogni artifact PyPI
                     |
  PR / push su main / cron settimanale / PR di Dependabot
                     |
                     v
=================== CI security.yml - GitHub Free, repo privato ===================

  secrets   gitleaks sull'intera history            ->  STOP se segreto
  sast      semgrep p/python + p/security-audit     ->  STOP se finding
            bandit -ll                              (SARIF -> artefatto 90 gg,
                                                     generato anche a run rossa)
  deps      uv lock --check + uv-secure             ->  STOP se CVE/lock stale
                     |
                     v
  container
            build     python:3.13-slim@sha256:... + uv sync --frozen
            trivy     config (Dockerfile, workflow) + immagine
            sbom      CycloneDX -> artefatto 90 gg
                     |
                     |  <<< PUBLICATION GATE: oltre questa riga solo se tutto verde >>>
                     v
            push      ghcr.io/frenz86/security-demo:<sha>
            firma     cosign keyless, identita' OIDC del workflow
            digest    PROD_DIGEST (Actions variable, scritta via PAT)

=====================================================================================
                     |
                     v
  trivy-prod (settimanale o manuale)
            cosign    verify: firmata da QUESTA CI?      ->  STOP se firma assente
            trivy     scan di ghcr.io/...@PROD_DIGEST    ->  STOP se CVE nuova
                     |
                     v
         IMMAGINE IN PRODUZIONE          referenziata per digest, mai per tag

  (loop) Dependabot settimanale: bump uv / docker / actions -> PR -> torna in cima
```

## Struttura

```
security-demo/
├── backend/                # l'API FastAPI ( / , /health )
│   ├── main.py
│   ├── pyproject.toml      # dipendenze pinnate (==), requires-python ==3.13.*
│   ├── uv.lock             # committato, con hash — è questo che va in produzione
│   ├── Dockerfile          # base pinnata per digest, utente non-root, uv sync --frozen
│   └── .dockerignore       # segreti e ambiente locale mai nel contesto di build
├── frontend/               # UI Next.js (App Router, output standalone)
│   ├── app/                # una pagina che consuma l'API del backend (SSR)
│   ├── package.json        # versioni pinnate, lock committato (npm ci in build)
│   ├── package-lock.json
│   ├── Dockerfile          # multi-stage, base node pinnata per digest, utente non-root
│   └── .dockerignore
├── caddy/
│   ├── Caddyfile           # unico ingresso: /api/* -> backend, il resto -> frontend
│   └── Dockerfile          # immagine ufficiale pinnata per digest + apk upgrade
├── docker-compose.yml      # stack locale: backend + frontend non esposti, solo Caddy
├── README.md               # questo documento: pipeline + policy di sicurezza
├── .semgrepignore          # path esclusi dalla SAST (sostituisce i default)
├── .trivyignore            # eccezioni CVE: ognuna motivata e con scadenza
└── .github/
    ├── dependabot.yml      # aggiornamenti uv / npm / docker / actions, settimanali
    ├── CODEOWNERS          # owner della supply chain (review obbligatoria)
    └── workflows/
        ├── security.yml    # secrets → SAST → deps → build → scan → SBOM → push+firma
        └── trivy-prod.yml  # verifica firma + scan periodico dell'immagine nel registry
```

## La catena di fiducia

1. **`requires-python = "==3.13.*"`** — il pin esatto evita che uv risolva per
   un range: il lock resta senza rami condizionali (es. 3.14) che non useresti
   mai ma che l'audit segnala comunque.
2. **`uv.lock` committato** — hash di ogni artifact PyPI. Le versioni in
   `pyproject.toml` sono pinnate `==`: un aggiornamento è sempre una scelta
   esplicita (PR di Dependabot o a mano), mai un effetto collaterale.
3. **Docker: `uv sync --frozen`** — l'immagine contiene le versioni del lock e
   nient'altro; `pyproject.toml` toccato senza rilockare ⇒ build fallisce,
   non risolve in silenzio. Base `python:3.13-slim` pinnata **per digest**:
   rebuild riproducibile anche se il tag viene aggiornato a tua insaputa.
4. **CI: `uv lock --check`** — intercetta il lock stale prima del build.
5. **Push → digest registrato** nella variable `PROD_DIGEST`; poi l'immagine
   viene **firmata con cosign keyless** (identità = token OIDC del workflow,
   record pubblico su Rekor).
6. **`trivy-prod.yml`** verifica la firma e scansiona *quel* digest nel
   registry: l'immagine in produzione è quella firmata da questa CI, non un
   push manuale né un tag cambiato nel frattempo.

## Sviluppo locale

Stack completo con Docker — un solo ingresso (Caddy), backend e frontend
restano nella rete interna del compose:

```bash
docker compose up --build   # UI su http://localhost, API su http://localhost/api
```

Oppure i due ambienti separati:

```bash
# backend — http://localhost:8000
cd backend
uv sync
uv run uvicorn main:app --reload

# frontend — http://localhost:3000 (BACKEND_URL default: localhost:8000)
cd frontend
npm install
npm run dev
```

## La CI — `security.yml`

Su ogni PR, push su main e (settimanalmente) via schedule.

| Job | Cosa fa | Strumento |
| --- | --- | --- |
| `secrets` | segreti nell'intera history | gitleaks 8.28.0 (pinnato) |
| `sast` | analisi statica, report SARIF | semgrep `p/python` + `p/security-audit` con `--error`, bandit `-ll` |
| `deps` | lock coerente + audit vulnerabilità | `uv lock --check`, `uv-secure` |
| `container` | build, scan misconfig + vulnerabilità immagine, SBOM, push + firma | Trivy (HIGH/CRITICAL bloccanti), cosign |

Tutte le GitHub Actions sono pinnate per **SHA commit** (tag nel commento):
`trivy-action@master` & co. non esistono qui — un tag è mobile, un SHA no.

**Evidenza prodotta da ogni run** (per l'audit): SARIF di semgrep e bandit
come artefatti (`sast-sarif-<sha>`, retention 90 gg, generati anche a run
rossa), SBOM CycloneDX (`sbom-<sha>`, retention 90 gg), digest e firma
dell'immagine. La UI Code Scanning richiederebbe GitHub Advanced Security:
l'evidenza qui è l'artefatto, e il workflow ha la nota inline per riattivarla
se un giorno il repo diventa pubblico.

## Enforce senza pagare: il publication gate

La branch protection su repo **privato** richiede GitHub Pro/Team (~$4/mese);
sul piano Free la regola appare configurabile ma **non viene applicata**.
Il controllo effettivo dell'impianto sta quindi a valle, non a monte:

- nel job `container` l'ordine è rigido: build → Trivy con `exit-code: '1'`
  → **solo dopo** push, firma e registrazione del digest;
- quindi un build con segreti, CVE HIGH/CRITICAL o lock incoerente **non
  raggiunge mai il registry**: può al più lasciare `main` rossa, visibile;
- chi consuma l'immagine usa il digest `PROD_DIGEST` firmato — non esiste una
  via di pubblicazione alternativa alla pipeline.

È un controllo compensativo documentabile (A.8.25): il gate è la
pubblicazione, non il merge. Se un giorno arriva GitHub Pro o il repo diventa
pubblico, si aggiunge la branch protection su `main` con `secrets`, `sast`,
`deps`, `container` come required checks e l'enforce diventa totale.

## Dependabot

Aggiornamenti settimanali su quattro ecosistemi: `uv` (backend: pyproject +
lock insieme), `npm` (frontend: package.json + lock), `docker` (le due
Dockerfile, major escluse per policy) e `github-actions`. Con le versioni
pinnate, ogni bump è una PR singola e leggibile. (I *version updates* sono
gratuiti su ogni repo; la tab "Dependabot alerts" su privato richiede GHAS —
il ruolo di audit lo fa già `uv-secure` + Trivy in CI.)

---

# Policy di sicurezza

## Versioni supportate

| Versione | Supportata |
| -------- | ---------- |
| main     | ✅         |

## Segnalare una vulnerabilità

**Non aprire una issue pubblica.** Usa "Report a vulnerability" nella tab
*Security → Advisories* di questo repository: la segnalazione resta privata e
raggiunge chi mantiene il progetto.

Includi, se puoi:

- descrizione del problema e impatto stimato;
- passi per riprodurlo (POC, payload, comando);
- versioni coinvolte (commit SHA o digest dell'immagine, se container);
- eventuale proposta di fix.

**Tempi di risposta:** presa in carico entro 5 giorni lavorativi. Una volta
accettata, apriamo un advisory e rilasciamo il fix con crediti (salvo che tu
chieda di restare anonimo).

## Scope

In scope: codice applicativo (`backend/main.py`, `frontend/app/`), pipeline
(`backend/Dockerfile`, `frontend/Dockerfile`, `caddy/Caddyfile`,
`docker-compose.yml`, `.github/workflows/`), gestione delle dipendenze
(`backend/pyproject.toml`, `backend/uv.lock`, `frontend/package.json`,
`frontend/package-lock.json`), segreti e configurazione dei repository.

Out of scope: social engineering, DoS, report da tool automatici senza
analisi, vulnerabilità su versioni non più supportate, problemi su servizi
terzi (GitHub, ghcr.io) già notificati al provider.

## SLA di remediation

Ogni finding scansionato in CI ha una scadenza. Non fixato entro l'SLA, o si
chiude con fix o diventa una risk acceptance documentata — non resta aperto
in silenzio.

| Gravità | Fix o risk acceptance documentata entro |
| ------- | --------------------------------------- |
| CRITICAL | 72 ore                                 |
| HIGH     | 7 giorni                               |
| MEDIUM   | 30 giorni                              |
| LOW      | 90 giorni, o accettazione esplicita    |

## Eccezioni e falsi positivi

Ogni soppressione è tracciata, motivata e ha una scadenza. Le eccezioni senza
motivazione o senza data di revisione sono una non conformità, più grave del
finding che sopprimono.

1. **Inline, vicino al codice**, quando è possibile:
   `# nosemgrep: <regola> — motivo, ticket, scadenza` oppure
   `# nosec B101 — motivo, ticket, scadenza`.
2. **Nei file di ignore dedicati**, altrimenti: `.trivyignore` per le CVE,
   `.semgrepignore` per i path — una riga, una motivazione, una scadenza.
3. **Approvazione**: le modifiche ai file di ignore e le soppressioni su
   codice applicativo passano dalla review del owner (vedi `CODEOWNERS`).
4. **Scadenza**: alla data di revisione il finding riappare, e va rigiustificato.

## Evidenza per audit

- I job SAST producono SARIF (semgrep, bandit), caricati come artefatti in CI
  con retention 90 gg (Code Scanning è riservato ai repo pubblici o a GHAS).
- SBOM CycloneDX per ogni build, artefatto `sbom-<sha>` (retention 90 gg).
- Il digest dell'immagine in produzione è nella variable `PROD_DIGEST`;
  `trivy-prod.yml` scansiona esattamente quel digest, settimanalmente.

## Come vengono gestite le dipendenze

- Le versioni sono pinnate in `pyproject.toml` e fissate in `uv.lock`
  (committato, con hash).
- Il build usa `uv sync --frozen`: l'immagine contiene esattamente ciò che
  c'è nel lock, nient'altro.
- La CI verifica coerenza lock/manifest (`uv lock --check`), audita le
  dipendenze, scansiona segreti, SAST e immagine (Trivy), e produce una SBOM.
- Dependabot propone aggiornamenti settimanali (uv, docker, actions).

---

# Copertura ISO 27001:2022 (Annex A)

| Controllo | Artefatto in questo repo |
| --- | --- |
| A.8.25 ciclo di sviluppo sicuro | publication gate (un build rosso non pubblica), workflow su ogni PR/push, CODEOWNERS |
| A.8.28 secure coding | semgrep + bandit in CI, eccezioni tracciate |
| A.8.29 security testing | SAST, secret scanning, audit dipendenze, Trivy (config + immagine), SBOM, validazione locale documentata qui sotto |
| A.8.30 supply chain / sviluppo esternalizzato | lock con hash, `--frozen`, base per digest, azioni pinnate SHA, firma cosign, `PROD_DIGEST` |
| A.8.8 gestione vulnerabilità tecniche | gate HIGH/CRITICAL in CI, `trivy-prod` settimanale sull'immagine in registry, SLA di remediation, `.trivyignore` solo con motivazione e scadenza |
| A.8.9 gestione della configurazione | immagini minime multi-stage, utente non-root, digest pinnati (python, node, caddy), toolchain di build rimosse dal runtime, HEALTHCHECK, `.dockerignore` |
| A.8.20/A.8.22 sicurezza e segregazione di rete | Caddy unico ingresso, backend e frontend senza porte pubblicate sull'host, rete interna al compose |
| A.8.24 uso della crittografia | TLS automatico ACME di Caddy con hostname reale, firma cosign dell'immagine pubblicata |
| A.5.35 / A.5.37 disclosure e procedure | la policy di sicurezza qui sopra |

**Fuori scope di questa demo** (da coprire altrove): DAST, training secure
coding con record, ambienti dev/test/prod separati (A.8.31), policy di
sviluppo sicuro completa e owner nominato.

## Validazione degli step (2026-08-16, post-ristrutturazione)

Ogni step della pipeline rieseguito in locale con i parametri della CI,
sul layout backend/ + frontend/ + caddy/:

| Step CI | Verifica locale | Esito |
| --- | --- | --- |
| `secrets` | gitleaks 8.28.0 sull'intera history | ✅ 11 commit, nessun leak |
| `sast` | semgrep `p/python` + `p/security-audit --error` | ✅ 222 regole su 34 file, 0 finding |
| `sast` | bandit `-r backend -ll` | ✅ 0 issue |
| `deps` | `uv lock --check` | ✅ lock coerente col manifest |
| `deps` | `uv-secure uv.lock` | ✅ 42 dipendenze, nessuna CVE |
| `container` | build delle 3 immagini (`docker compose build`) | ✅ |
| `container` | Trivy config scan (`backend/Dockerfile`, `frontend/Dockerfile`) | ✅ 0 misconfiguration |
| `container` | Trivy image scan backend (HIGH/CRITICAL) | ✅ 0 |
| — | Trivy image scan frontend (non ancora in CI) | ✅ 0 dopo rimozione del toolchain npm dal runtime |
| — | Trivy image scan caddy (non in CI) | ⚠️ vedi sotto |
| runtime | `docker compose up`: UI e API servite da Caddy | ✅ `/api/health` e `/` OK |

Due note oneste su ciò che la validazione ha prodotto:

1. **Il toolchain npm non appartiene al runtime.** Il primo scan del frontend
   segnava 7 CVE (tar, undici, brace-expansion…) tutte in
   `usr/local/lib/node_modules/npm` — l'npm **della base image**, non delle
   dipendenze dell'app. Rimosso dallo stage runner, come il backend fa con
   pip/setuptools: fix alla radice, zero eccezioni in `.trivyignore`.
2. **Caddy: risk acceptance documentata.** L'immagine è pinnata per digest e
   il layer alpine è bonificato in build (`apk upgrade`), ma il binario porta
   14 CVE HIGH della stdlib Go 1.26.3, fixate in Go 1.26.6/1.25.13: alla data
   odierna non esiste ancora un release caddy ricostruita con Go patchato.
   Rimedio: la PR di digest di Dependabot (`/caddy`) appena upstream rilascia.
   Contesto: proxy di sviluppo, ingresso unico, senza TLS in locale — non è
   l'immagine che la CI pubblica in produzione.

**Gap noti** (da chiudere, non da nascondere): la CI builda, scansiona, firma
e pubblica **solo l'immagine backend**. Frontend e caddy sono validati
localmente (tabella sopra); portarli nel job `container` — build, Trivy, SBOM,
push e firma — è l'estensione naturale della pipeline.

# Setup richiesto (una tantum)

1. **Secret `GH_PAT_VARIABLES`** — fine-grained PAT → *Variables: Read and
   write* sul repo. Serve perché il `GITHUB_TOKEN` di default non può
   creare/leggere le Actions variables (limitazione GitHub, non di piano).
   Lo usano la scrittura di `PROD_DIGEST` (security.yml) e la lettura
   (trivy-prod.yml). Il PAT gratuito, come tutto il resto.
2. **Nient'altro.** La branch protection è opzionale futura (vedi sopra).

# Accensione (prime 1–2 settimane)

1. Scannerizzazioni non bloccanti: `exit-code: '0'` su Trivy e semgrep senza
   `--error` — si raccolgono i finding, non si ferma nulla.
2. Bonifica i finding veri; documenta i falsi positivi in `.trivyignore` /
   `.semgrepignore` con motivazione e scadenza.
3. Stringi: `exit-code: '1'`, `--error` su semgrep.
4. Da qui il publication gate è attivo: nessuna immagine pubblicata senza
   scan verde.

# Costi: zero, e dove stanno i limiti

Tutto lo stack è open source: semgrep (engine LGPL, ruleset `p/*` liberi),
bandit, gitleaks, Trivy, uv, cosign (Apache-2.0, keyless su infrastruttura
pubblica Sigstore). Su GitHub Free con repo privato:

| Risorsa | Quota Free | Uso di questa pipeline |
| --- | --- | --- |
| Actions | 2.000 min/mese | ~10–15 min per run → centinaia di run/mese |
| Artefatti | 500 MB | SARIF e SBOM sono KB |
| ghcr (immagini private) | 500 MB | 1 immagine ≈ 150–250 MB: **pruna le versioni vecchie** |

Unica funzione a pagamento dell'ecosistema che questo setup non usa:
branch protection su privato (Pro ~$4/mese) — sostituita dal publication
gate. Le funzioni GHAS (Code Scanning, Dependabot alerts) sono già rimpiazzate
da artefatti SARIF, `uv-secure` e Trivy.

# Push diretto su `main` non bloccato: scelta consapevole, non una mancanza

Su questo repo non c'è il blocco dei push diretti su `main` (la branch
protection su repo privato richiede GitHub Pro). È una decisione accettata e
documentata, con questa motivazione:

- **il gate effettivo è a valle, non a monte**: nessun build con scan rosso
  può pubblicare un'immagine (publication gate, sezione dedicata);
- **ogni push su `main` fa girare l'intera pipeline comunque**: un main
  non conformante è immediatamente visibile come check rosso, con SARIF e
  report scaricabili;
- **esiste un solo canale di pubblicazione**: l'immagine consumabile è
  identificata dal digest `PROD_DIGEST` firmato da questa CI — un push
  diretto su main non crea vie di rilascio alternative.

**Rischio residuo accettato**: codice con finding aperti può sostare su
`main` finché non viene corretto o derubricato secondo gli SLA della policy
qui sopra; non può però raggiungere il registry né la produzione.

**Rivedere questa scelta se**: il repo diventa pubblico o arriva GitHub Pro
(→ attivare la branch protection con i required checks), oppure arrivano
contributor esterni al maintainer.

*Accettato da: @Frenz86 — 2026-08-16*
