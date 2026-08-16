import styles from "./page.module.css";

// È il server Next (SSR) a chiamare il backend: nel compose il DNS interno
// è il nome del servizio (http://backend:8000), in dev locale il default.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

// Nessun fetch a build time: il backend non c'è ancora quando l'immagine si
// costruisce. La pagina si rende a ogni richiesta.
export const dynamic = "force-dynamic";

interface BackendState {
  ok: boolean;
  message: string | null;
  health: string | null;
}

async function fetchBackend(): Promise<BackendState> {
  try {
    const [root, health] = await Promise.all([
      fetch(`${BACKEND_URL}/`, { cache: "no-store" }),
      fetch(`${BACKEND_URL}/health`, { cache: "no-store" }),
    ]);
    if (!root.ok || !health.ok) {
      throw new Error(`HTTP ${root.status} / ${health.status}`);
    }
    const rootJson = (await root.json()) as { message?: string };
    const healthJson = (await health.json()) as { status?: string };
    return {
      ok: true,
      message: rootJson.message ?? null,
      health: healthJson.status ?? null,
    };
  } catch {
    return { ok: false, message: null, health: null };
  }
}

export default async function Home() {
  const backend = await fetchBackend();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>security-demo</h1>
        <p className={styles.subtitle}>Next.js &rarr; FastAPI</p>

        {backend.ok ? (
          <dl className={styles.card}>
            <div className={styles.row}>
              <dt>
                <code>GET {BACKEND_URL}/</code>
              </dt>
              <dd>{backend.message}</dd>
            </div>
            <div className={styles.row}>
              <dt>
                <code>GET {BACKEND_URL}/health</code>
              </dt>
              <dd>
                <span className={styles.badge}>{backend.health}</span>
              </dd>
            </div>
          </dl>
        ) : (
          <div className={`${styles.card} ${styles.error}`}>
            <p>
              Backend non raggiungibile su <code>{BACKEND_URL}</code>.
            </p>
            <p>
              Avvialo con <code>docker compose up</code> dalla root del repo,
              oppure <code>cd backend &amp;&amp; uv run uvicorn main:app</code>{" "}
              per lo sviluppo locale.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
