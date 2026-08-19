import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configStatus, databasePath, monthlyBudgetUsd, requireServerKey } from './config';

const KEYS = [
  'NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY',
  'GOOGLE_MAPS_SERVER_KEY',
  'GOOGLE_CLOUD_PROJECT_ID',
  'MONTHLY_BUDGET_USD',
  'DATABASE_PATH',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('monthlyBudgetUsd', () => {
  it('usa el defecto cuando no esta definido', () => {
    expect(monthlyBudgetUsd()).toBe(50);
  });

  it('lee un valor valido', () => {
    process.env.MONTHLY_BUDGET_USD = '120.5';
    expect(monthlyBudgetUsd()).toBe(120.5);
  });

  it('acepta cero, que significa bloquear todo gasto', () => {
    process.env.MONTHLY_BUDGET_USD = '0';
    expect(monthlyBudgetUsd()).toBe(0);
  });

  // Un presupuesto invalido no debe caer a 0 (bloquearia todo) ni a Infinity
  // (dejaria el gasto sin techo). Vuelve al defecto explicito.
  it.each(['no-es-un-numero', '-10', ''])('vuelve al defecto ante %j', (raw) => {
    process.env.MONTHLY_BUDGET_USD = raw;
    expect(monthlyBudgetUsd()).toBe(50);
  });
});

describe('databasePath', () => {
  it('usa el defecto cuando no esta definido', () => {
    expect(databasePath()).toBe('./data/esodeja.db');
  });

  it('ignora un valor de solo espacios', () => {
    process.env.DATABASE_PATH = '   ';
    expect(databasePath()).toBe('./data/esodeja.db');
  });
});

describe('configStatus', () => {
  it('reporta ausentes cuando no hay claves', () => {
    const cfg = configStatus();
    expect(cfg.jsKey).toBe('ausente');
    expect(cfg.serverKey).toBe('ausente');
    expect(cfg.projectId).toBeNull();
  });

  it('reporta configuradas cuando las hay', () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY = 'AIza-js';
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIza-server';
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'esodeja-prod';

    const cfg = configStatus();
    expect(cfg.jsKey).toBe('configurada');
    expect(cfg.serverKey).toBe('configurada');
    expect(cfg.projectId).toBe('esodeja-prod');
  });

  // Guardarrail: el estado de configuracion se pasa a componentes cliente.
  // Si alguna vez incluyera el valor de la clave de servidor, se filtraria al
  // navegador en el HTML renderizado.
  it('nunca expone el valor de la clave de servidor', () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'valor-secreto-de-la-clave';
    expect(JSON.stringify(configStatus())).not.toContain('valor-secreto-de-la-clave');
  });
});

describe('requireServerKey', () => {
  it('lanza con un mensaje accionable si falta', () => {
    expect(() => requireServerKey()).toThrow(/GOOGLE_MAPS_SERVER_KEY/);
    expect(() => requireServerKey()).toThrow(/\.env\.local/);
  });

  it('devuelve la clave recortada cuando existe', () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = '  AIza-server  ';
    expect(requireServerKey()).toBe('AIza-server');
  });
});
