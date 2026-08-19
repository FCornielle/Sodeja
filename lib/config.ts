/**
 * Lectura de configuracion del servidor.
 *
 * IMPORTANTE: este modulo lee `GOOGLE_MAPS_SERVER_KEY`, que nunca debe llegar
 * al navegador. Solo se importa desde Server Components y Route Handlers.
 * `serverKeyStatus()` existe precisamente para poder informar del estado de la
 * clave sin exponer su valor.
 */

export type KeyStatus = 'configurada' | 'ausente';

export interface ConfigStatus {
  jsKey: KeyStatus;
  serverKey: KeyStatus;
  projectId: string | null;
  monthlyBudgetUsd: number;
  databasePath: string;
}

const DEFAULT_MONTHLY_BUDGET_USD = 50;
const DEFAULT_DATABASE_PATH = './data/esodeja.db';

function statusOf(value: string | undefined): KeyStatus {
  return value && value.trim().length > 0 ? 'configurada' : 'ausente';
}

/**
 * Presupuesto mensual de API en USD.
 *
 * Un presupuesto mal parseado que caiga silenciosamente a 0 bloquearia todas
 * las llamadas de pago; uno que caiga a Infinity dejaria el gasto sin techo.
 * Ante un valor invalido volvemos al defecto explicito, que es el
 * comportamiento menos sorprendente de los tres.
 */
export function monthlyBudgetUsd(): number {
  const raw = process.env.MONTHLY_BUDGET_USD;
  if (!raw) return DEFAULT_MONTHLY_BUDGET_USD;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MONTHLY_BUDGET_USD;
  }
  return parsed;
}

export function databasePath(): string {
  return process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
}

/**
 * Estado de la configuracion, sin revelar ningun valor secreto.
 * Seguro de pasar a un componente cliente.
 */
export function configStatus(): ConfigStatus {
  return {
    jsKey: statusOf(process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY),
    serverKey: statusOf(process.env.GOOGLE_MAPS_SERVER_KEY),
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID?.trim() || null,
    monthlyBudgetUsd: monthlyBudgetUsd(),
    databasePath: databasePath(),
  };
}

/**
 * Devuelve la clave de servidor, o lanza con un mensaje accionable.
 *
 * Lanzar es deliberado: el proyecto anterior degradaba silenciosamente a un
 * proveedor mock cuando faltaba la clave, y el resultado fue una aplicacion
 * que parecia funcionar mientras devolvia datos inventados. Preferimos fallar
 * ruidosamente.
 */
export function requireServerKey(): string {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY?.trim();
  if (!key) {
    throw new Error(
      'GOOGLE_MAPS_SERVER_KEY no esta configurada. Copia .env.local.example a ' +
        '.env.local y anade la clave de servidor de Google Maps Platform.',
    );
  }
  return key;
}
