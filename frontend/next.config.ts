import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Il build produce .next/standalone: il runtime porta con sé solo server.js
  // e le dipendenze che gli servono. È quello che il Dockerfile copia nello
  // stage finale — l'equivalente "minimo indispensabile" del venv del backend.
  output: "standalone",
};

export default nextConfig;
