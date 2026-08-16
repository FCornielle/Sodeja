import type { Currency, Provenance } from "@sodeja/schemas";

/**
 * The one way this app renders a money band — a required convention per
 * apps/web/README.md's "no bare numbers" boundary: every figure carries its
 * range and provenance chip. Reused by `CostsStep`/`ProjectionStep` rather
 * than each formatting a range inline, same discipline `CitationLine`
 * establishes for citations.
 */
export function MoneyRangeDisplay({
  label,
  low,
  base,
  high,
  currency,
  provenance,
}: {
  label: string;
  low: number;
  base: number;
  high: number;
  currency: Currency;
  provenance: Provenance;
}) {
  return (
    <div>
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="text-lg font-semibold text-neutral-900">{formatMoney(base, currency)}</p>
      <p className="text-xs text-neutral-500">
        {formatMoney(low, currency)} – {formatMoney(high, currency)}
      </p>
      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{provenance}</span>
    </div>
  );
}

export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
