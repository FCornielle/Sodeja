import { configStatus } from '@/lib/config';

export const dynamic = 'force-dynamic';

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <tr>
      <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
        {label}
      </td>
      <td
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--border)',
          whiteSpace: 'nowrap',
          color: ok ? 'var(--accent)' : 'var(--muted)',
          fontWeight: 600,
        }}
      >
        {ok ? 'OK' : 'pendiente'}
      </td>
      <td
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
      >
        {detail}
      </td>
    </tr>
  );
}

export default function Home() {
  const cfg = configStatus();
  const jsKeyOk = cfg.jsKey === 'configurada';
  const serverKeyOk = cfg.serverKey === 'configurada';
  const ready = jsKeyOk && serverKeyOk;

  return (
    <main>
      <h1>Esodeja</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Estudios de mercado geográficos para República Dominicana.
      </p>

      <h2 style={{ fontSize: '1.1rem', marginTop: '2.5rem' }}>Estado de la configuración</h2>

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.95rem' }}>
        <tbody>
          <StatusRow
            label="Clave de navegador (Maps JS)"
            ok={jsKeyOk}
            detail="NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY — restringida por referrer HTTP"
          />
          <StatusRow
            label="Clave de servidor"
            ok={serverKeyOk}
            detail="GOOGLE_MAPS_SERVER_KEY — Places, Routes, Geocoding, Static, Street View"
          />
          <StatusRow
            label="Proyecto de Google Cloud"
            ok={cfg.projectId !== null}
            detail={cfg.projectId ?? 'GOOGLE_CLOUD_PROJECT_ID sin definir'}
          />
          <StatusRow
            label="Presupuesto mensual de API"
            ok
            detail={`$${cfg.monthlyBudgetUsd} USD — se bloquean llamadas Pro/Enterprise al 100%`}
          />
          <StatusRow label="Base de datos" ok detail={`SQLite — ${cfg.databasePath}`} />
        </tbody>
      </table>

      {!ready && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem 1.25rem',
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            borderRadius: 8,
          }}
        >
          <strong>Falta configurar las claves de Google.</strong>
          <p style={{ margin: '0.5rem 0 0' }}>
            Copia <code>.env.local.example</code> a <code>.env.local</code> y rellena las
            dos claves. Son <strong>dos claves distintas</strong> del mismo proyecto de
            Cloud, con restricciones opuestas — el fichero de ejemplo explica cómo
            configurar cada una en la consola.
          </p>
        </div>
      )}

      <h2 style={{ fontSize: '1.1rem', marginTop: '2.5rem' }}>Siguiente paso</h2>
      <p style={{ color: 'var(--muted)' }}>
        <strong>E-3</strong> — medidor de coste y presupuesto duro, antes de la primera
        llamada facturable. Después <strong>E-2</strong> (mapa y selección) y{' '}
        <strong>E-4</strong> (competencia), que es donde se responde la pregunta que
        decide el producto: si Google Places tiene cobertura real de negocios en Santo
        Domingo y Santiago.
      </p>
      <p style={{ color: 'var(--muted)' }}>
        El backlog completo está en <code>docs/BACKLOG.md</code>.
      </p>
    </main>
  );
}
