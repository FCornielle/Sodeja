import type { ReactElement } from "react";
import type {
  CapacityEstimate,
  Currency,
  FinancialProjection,
  FitoutEstimate,
  LayoutParameters,
  MarketStudy,
  OpexEstimate,
  PermitChecklist,
  PermitChecklistItem,
  ResolvedParameter,
} from "@sodeja/schemas";
import { renderMarkdownLite } from "./markdown.js";
import type { ReportRenderInput, ReportSection } from "./types.js";

const REQUIREMENT_LABEL_ES: Record<string, string> = {
  required: "Requerido",
  likely_required: "Probablemente requerido",
  not_applicable: "No aplica",
  unknown: "Desconocido",
};

function fmtNumber(n: number): string {
  return n.toLocaleString("es-DO", { maximumFractionDigits: 2 });
}

function fmtMoney(amount: number, currency: Currency): string {
  return `${currency} ${fmtNumber(amount)}`;
}

function RangeText({ low, base, high, unit }: { low: number; base: number; high: number; unit?: string }): ReactElement {
  const u = unit ? ` ${unit}` : "";
  return (
    <span className="range">
      {fmtNumber(low)}
      {u} – {fmtNumber(base)}
      {u} (base) – {fmtNumber(high)}
      {u}
    </span>
  );
}

function MoneyRangeText({
  low,
  base,
  high,
  currency,
}: {
  low: number;
  base: number;
  high: number;
  currency: Currency;
}): ReactElement {
  return (
    <span className="range">
      {fmtMoney(low, currency)} – {fmtMoney(base, currency)} (base) – {fmtMoney(high, currency)}
    </span>
  );
}

function Missing({ reason }: { reason: string }): ReactElement {
  return <p className="missing">No calculado aún — {reason}</p>;
}

function Section({ titleEs, children }: { titleEs: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div className="section">
      <h2>{titleEs}</h2>
      {children}
    </div>
  );
}

function Header({ input }: { input: ReportRenderInput }): ReactElement {
  return (
    <div>
      <div className="banner">RESUMEN DE ANÁLISIS — NO ES UN PLAN DE NEGOCIO AUDITADO</div>
      <h1>{input.project.name}</h1>
      <p>
        {input.project.businessTypeNameEs ?? "Tipo de negocio no establecido"} ·{" "}
        {input.project.jurisdictionName ?? "Jurisdicción no establecida"}
      </p>
    </div>
  );
}

function DisclaimerBlock({ disclaimer }: { disclaimer: ReportRenderInput["disclaimer"] }): ReactElement {
  return (
    <div className="disclaimer-block">
      {renderMarkdownLite(disclaimer.bodyMd)}
      <p className="citation">
        Aviso legal versión {disclaimer.version} · {disclaimer.locale} · vigente desde {disclaimer.effectiveFrom}
      </p>
    </div>
  );
}

function MetadataBlock({ input }: { input: ReportRenderInput }): ReactElement {
  return (
    <table className="meta-table">
      <tbody>
        <tr>
          <td className="label">Generado el:</td>
          <td>{input.generatedAt}</td>
        </tr>
        <tr>
          <td className="label">Versión del motor de cálculo:</td>
          <td>{input.engineVersion}</td>
        </tr>
        <tr>
          <td className="label">Área confirmada:</td>
          <td>
            {fmtNumber(input.location.areaSqm)} m² (origen: {input.location.areaSource}, confirmada el{" "}
            {input.location.areaConfirmedAt})
          </td>
        </tr>
        <tr>
          <td className="label">Moneda de reporte:</td>
          <td>{input.project.reportingCurrency}</td>
        </tr>
      </tbody>
    </table>
  );
}

function MarketStudyBlock({ section }: { section: ReportSection<MarketStudy> }): ReactElement {
  if (!section.available) return <Section titleEs="Entorno del mercado"><Missing reason={section.reason} /></Section>;
  const s = section.data;
  return (
    <Section titleEs="Entorno del mercado">
      <table className="meta-table">
        <tbody>
          <tr>
            <td className="label">Radio analizado:</td>
            <td>{s.radiusM} m</td>
          </tr>
          <tr>
            <td className="label">Población estimada:</td>
            <td>
              {fmtNumber(s.populationEst)} (censo {s.censusYear})
            </td>
          </tr>
          <tr>
            <td className="label">Competidores (dataset + agregados):</td>
            <td>
              {s.competitorCount} + {s.competitorsUserAdded} agregados manualmente
            </td>
          </tr>
          <tr>
            <td className="label">Confianza de los datos:</td>
            <td>{s.confidence}</td>
          </tr>
          <tr>
            <td className="label">Índice de demanda:</td>
            <td>
              {s.demandIndexLow !== null && s.demandIndexBase !== null && s.demandIndexHigh !== null ? (
                <RangeText low={s.demandIndexLow} base={s.demandIndexBase} high={s.demandIndexHigh} />
              ) : (
                "No disponible (confianza insuficiente o sin competidores comparables)"
              )}
            </td>
          </tr>
          <tr>
            <td className="label">Vintage de datos POI:</td>
            <td>{s.poiVintage ?? "No disponible"}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function CapacityBlock({ section }: { section: ReportSection<CapacityEstimate> }): ReactElement {
  if (!section.available) return <Section titleEs="Capacidad estimada"><Missing reason={section.reason} /></Section>;
  const c = section.data;
  return (
    <Section titleEs="Capacidad estimada">
      <table className="data">
        <thead>
          <tr>
            <th>Figura</th>
            <th>Pesimista</th>
            <th>Base</th>
            <th>Optimista</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Asientos</td>
            <td>{c.seatsLow ?? "—"}</td>
            <td>{c.seatsBase ?? "—"}</td>
            <td>{c.seatsHigh ?? "—"}</td>
          </tr>
          <tr>
            <td>Personal</td>
            <td>{c.staffLow ?? "—"}</td>
            <td>{c.staffBase ?? "—"}</td>
            <td>{c.staffHigh ?? "—"}</td>
          </tr>
          <tr>
            <td>Clientes diarios</td>
            <td>{c.dailyCustomersLow ?? "—"}</td>
            <td>{c.dailyCustomersBase ?? "—"}</td>
            <td>{c.dailyCustomersHigh ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="citation">Calculado el {c.asOfDate}.</p>
    </Section>
  );
}

function DensityParamRow({ p }: { p: ResolvedParameter }): ReactElement {
  return (
    <tr>
      <td>{p.parameterTableSlug}</td>
      <td>
        <RangeText low={p.valueLow} base={p.valueBase} high={p.valueHigh} />
      </td>
      <td className="provenance">{p.provenance}</td>
      <td className="citation">{p.citation.sourceDocument}</td>
    </tr>
  );
}

function LayoutBlock({ section }: { section: ReportSection<LayoutParameters> }): ReactElement {
  if (!section.available) return <Section titleEs="Distribución y densidad"><Missing reason={section.reason} /></Section>;
  const l = section.data;
  return (
    <Section titleEs="Distribución y densidad">
      <p>
        La distribución de zonas (salón, cocina, almacén, baños, circulación) sobre los {fmtNumber(l.areaSqm)} m²
        confirmados es un dato ingresado por el usuario en el cliente y no se almacena en el servidor — este
        documento no reproduce esa distribución, únicamente los parámetros de densidad de referencia usados para
        validarla.
      </p>
      {l.densityParameters.length === 0 ? (
        <p className="missing">Sin parámetros de densidad citados para este tipo de negocio.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Parámetro</th>
              <th>Rango</th>
              <th>Origen</th>
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {l.densityParameters.map((p) => (
              <DensityParamRow key={p.parameterTableSlug} p={p} />
            ))}
          </tbody>
        </table>
      )}
      <p>
        Ocupantes esperados (para comparación de densidad):{" "}
        {l.expectedOccupants ?? `no disponible — ${l.expectedOccupantsReason ?? "sin razón registrada"}`}
      </p>
    </Section>
  );
}

function FitoutBlock({ section }: { section: ReportSection<FitoutEstimate> }): ReactElement {
  if (!section.available) return <Section titleEs="Costo de habilitación"><Missing reason={section.reason} /></Section>;
  const f = section.data;
  return (
    <Section titleEs="Costo de habilitación">
      <p>
        <MoneyRangeText low={f.totalLowAmount} base={f.totalBaseAmount} high={f.totalHighAmount} currency={f.currency} />
      </p>
      <p className="citation">
        Índice de construcción con fecha base {f.indexBaseDate}; calculado el {f.asOfDate}. Estimado, no sustituye
        una cotización.
      </p>
    </Section>
  );
}

function OpexBlock({ section }: { section: ReportSection<OpexEstimate> }): ReactElement {
  if (!section.available) return <Section titleEs="Costos operativos mensuales"><Missing reason={section.reason} /></Section>;
  const o = section.data;
  return (
    <Section titleEs="Costos operativos mensuales">
      <p>
        <MoneyRangeText low={o.monthlyLowAmount} base={o.monthlyBaseAmount} high={o.monthlyHighAmount} currency={o.currency} />
      </p>
      <p className="citation">Calculado el {o.asOfDate}.</p>
    </Section>
  );
}

interface SensitivityLine {
  assumptionKey: string;
  labelEs: string;
  rank: number;
  breakevenMonthShift: number | null;
  terminalCashDeltaAmount: number;
}

function FinancialProjectionBlock({
  section,
  currency,
}: {
  section: ReportSection<FinancialProjection>;
  currency: Currency;
}): ReactElement {
  if (!section.available) return <Section titleEs="Proyección financiera"><Missing reason={section.reason} /></Section>;
  const p = section.data;
  const results = p.resultsJson as { sensitivity?: SensitivityLine[]; rankedBy?: string };
  const sensitivity = [...(results.sensitivity ?? [])].sort((a, b) => a.rank - b.rank);
  return (
    <Section titleEs="Proyección financiera">
      <table className="meta-table">
        <tbody>
          <tr>
            <td className="label">Punto de equilibrio (meses):</td>
            <td>
              {p.breakevenMonthLow === null && p.breakevenMonthBase === null && p.breakevenMonthHigh === null
                ? "No alcanza el punto de equilibrio en el horizonte proyectado."
                : `${p.breakevenMonthLow ?? "—"} – ${p.breakevenMonthBase ?? "—"} (base) – ${p.breakevenMonthHigh ?? "—"}`}
            </td>
          </tr>
        </tbody>
      </table>
      <h3>Lo que más mueve su resultado</h3>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Supuesto</th>
            <th>Impacto en punto de equilibrio (meses)</th>
            <th>Impacto en caja terminal</th>
          </tr>
        </thead>
        <tbody>
          {sensitivity.map((line) => (
            <tr key={line.assumptionKey}>
              <td>{line.rank}</td>
              <td>{line.labelEs}</td>
              <td>{line.breakevenMonthShift ?? "N/D"}</td>
              <td>{fmtMoney(line.terminalCashDeltaAmount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="citation">Calculado el {p.asOfDate}.</p>
    </Section>
  );
}

function PermitItemRow({ item }: { item: PermitChecklistItem }): ReactElement {
  return (
    <tr>
      <td>{item.titleEs}</td>
      <td>{REQUIREMENT_LABEL_ES[item.requirement] ?? item.requirement}</td>
      <td>{item.agencyName ?? "—"}</td>
      <td className="citation">
        {item.citation.sourceDocument}
        {item.citation.article ? `, ${item.citation.article}` : ""}
      </td>
    </tr>
  );
}

function PermitsBlock({ section }: { section: ReportSection<PermitChecklist> }): ReactElement {
  if (!section.available) return <Section titleEs="Checklist de permisos"><Missing reason={section.reason} /></Section>;
  const p = section.data;
  return (
    <Section titleEs="Checklist de permisos">
      <p className="missing">{p.disclaimerEs}</p>
      <table className="data">
        <thead>
          <tr>
            <th>Trámite</th>
            <th>Estado</th>
            <th>Institución</th>
            <th>Fuente</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((item) => (
            <PermitItemRow key={item.ruleCode} item={item} />
          ))}
        </tbody>
      </table>
      <p className="citation">
        Jurisdicción: {p.jurisdictionName} · Evaluado el {p.asOfDate}. Lista no exhaustiva.
      </p>
    </Section>
  );
}

function AssumptionsAppendix({ assumptions }: { assumptions: ReportRenderInput["assumptions"] }): ReactElement {
  return (
    <Section titleEs="Apéndice de supuestos">
      {assumptions.length === 0 ? (
        <p className="missing">No hay supuestos registrados para este proyecto.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Supuesto</th>
              <th>Rango</th>
              <th>Origen</th>
              <th>Modificado por usuario</th>
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a) => (
              <tr key={a.id}>
                <td>{a.labelEs}</td>
                <td>
                  <RangeText low={a.valueLow} base={a.valueBase} high={a.valueHigh} unit={a.unit} />
                </td>
                <td className="provenance">{a.provenance}</td>
                <td>{a.isOverridden ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Footer({ input }: { input: ReportRenderInput }): ReactElement {
  return (
    <div className="footer-note">
      <p>
        SODEJA — Resumen de Análisis (reporte {input.reportId}). Este documento corresponde exclusivamente a la
        oferta actual de SODEJA; el "Plan de Negocio" apto para financiamiento bancario está marcado
        "Próximamente" y no está disponible en esta versión del producto.
      </p>
    </div>
  );
}

/**
 * The full report document. Every section either has real, stored data or
 * an honest "no calculado aún" — see `ReportSection` (types.ts) and
 * `apps/api/src/reports/reports.service.ts`'s `renderReportJob` for which
 * gracefully degrade versus the one hard prerequisite (confirmed area).
 */
export function ReportDocument({ input }: { input: ReportRenderInput }): ReactElement {
  return (
    <div className="report">
      <Header input={input} />
      <DisclaimerBlock disclaimer={input.disclaimer} />
      <MetadataBlock input={input} />
      <MarketStudyBlock section={input.marketStudy} />
      <CapacityBlock section={input.capacity} />
      <LayoutBlock section={input.layout} />
      <FitoutBlock section={input.fitout} />
      <OpexBlock section={input.opex} />
      <FinancialProjectionBlock section={input.financialProjection} currency={input.project.reportingCurrency} />
      <PermitsBlock section={input.permits} />
      <AssumptionsAppendix assumptions={input.assumptions} />
      <Footer input={input} />
    </div>
  );
}
