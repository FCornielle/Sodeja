import { z } from "zod";

/**
 * ISO 4217 currency code. Not exhaustive by design — DR commercial leases are
 * frequently quoted in USD while revenue/payroll are DOP (SODEJA_ARCHITECTURE.md).
 */
export const CurrencySchema = z.enum(["DOP", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const MoneySchema = z.object({
  amount: z.number().finite(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

/**
 * Never a point estimate (Master Plan §2, risk D1): every monetary figure
 * SODEJA displays carries a pessimistic/base/optimistic band.
 */
export const MoneyRangeSchema = z
  .object({
    pessimistic: MoneySchema,
    base: MoneySchema,
    optimistic: MoneySchema,
  })
  .refine((r) => r.pessimistic.currency === r.base.currency && r.base.currency === r.optimistic.currency, {
    message: "All bounds of a MoneyRange must share the same currency",
  })
  .refine((r) => r.pessimistic.amount <= r.base.amount && r.base.amount <= r.optimistic.amount, {
    message: "A pessimistic bound must not exceed its base, and base must not exceed optimistic",
  });
export type MoneyRange = z.infer<typeof MoneyRangeSchema>;

/** The non-monetary counterpart of MoneyRange — e.g. capacity ratios, headcounts. */
export const NumericRangeSchema = z
  .object({
    pessimistic: z.number().finite(),
    base: z.number().finite(),
    optimistic: z.number().finite(),
  })
  .refine((r) => r.pessimistic <= r.base && r.base <= r.optimistic, {
    message: "A pessimistic bound must not exceed its base, and base must not exceed optimistic",
  });
export type NumericRange = z.infer<typeof NumericRangeSchema>;

/**
 * Provenance tagging (Master Plan §2, risk D1): every assumption in the
 * system must declare where its value came from.
 */
export const ProvenanceSchema = z.enum(["usuario", "referencia_sectorial", "estimado"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Mandatory on every rule/parameter (SODEJA_ARCHITECTURE.md "Rules and rates
 * as data"): a rule or figure with no citation cannot be published.
 */
export const CitationSchema = z.object({
  sourceUrl: z.string().url().optional(),
  sourceDocument: z.string().min(1),
  article: z.string().optional(),
  retrievedAt: z.string().datetime(),
  effectiveDate: z.string().datetime().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/**
 * Per-area data-coverage score (risk D3): distinguishes "low competition"
 * from "low data" so a sparse dataset never silently reads as a real finding.
 */
export const DataConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  basis: z.string().min(1),
  asOfDate: z.string().datetime(),
});
export type DataConfidence = z.infer<typeof DataConfidenceSchema>;
