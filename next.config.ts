import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 es un modulo nativo: Next debe dejarlo fuera del bundle
  // del servidor y cargarlo en tiempo de ejecucion.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
