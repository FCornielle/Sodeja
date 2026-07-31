/**
 * Domain types mirroring `specs/db/schema.sql`'s `content.*` tables
 * (camelCase, JS-native dates-as-ISO-strings). This package never alters that
 * schema; these types are read-side projections of it only.
 */

export type JurisdictionLevel = "nacional" | "provincia" | "municipio";

export interface Jurisdiction {
  id: number;
  parentId: number | null;
  level: JurisdictionLevel;
  slug: string;
  name: string;
}

export interface CitationRow {
  id: number;
  sourceName: string;
  documentTitle: string;
  articleRef: string | null;
  sourceUrl: string | null;
  /** ISO date (YYYY-MM-DD) or null */
  publishedOn: string | null;
  /** ISO date (YYYY-MM-DD) */
  retrievedOn: string;
  isVerified: boolean;
  verificationNote: string | null;
}

export type PackStatus = "draft" | "in_review" | "published" | "superseded";
export type RuleDomain = "permits" | "tax" | "labor" | "zoning";

export interface RulePack {
  id: number;
  jurisdictionId: number;
  domain: RuleDomain;
  version: number;
  status: PackStatus;
  /** ISO date */
  validFrom: string;
  /** ISO date, or null = currently in force */
  validTo: string | null;
}

/**
 * No 'compliant' / 'cleared' member — Module 12 is a non-exhaustive checklist
 * by design (risk L3). This vocabulary is a hard product/legal constraint,
 * not a style choice; do not add to it without re-reading SODEJA_RISKS.md L3.
 */
export type PermitRequirement = "required" | "likely_required" | "not_applicable" | "unknown";

export interface Rule {
  id: number;
  rulePackId: number;
  code: string;
  titleEs: string;
  descriptionEs: string | null;
  /** JSONLogic, interpreted — never executed as code. */
  condition: unknown;
  consequence: unknown;
  /** Nullable in the schema; treated as 'unknown' rather than crashing when absent. */
  requirement: PermitRequirement | null;
  agencyName: string | null;
  citationId: number;
  displayOrder: number;
}

export type ParameterDomain =
  | "tax"
  | "labor"
  | "construction"
  | "capacity"
  | "layout"
  | "rent"
  | "utilities";

export interface ParameterTable {
  id: number;
  slug: string;
  nameEs: string;
  unit: string;
  domain: ParameterDomain;
}

export type Provenance = "usuario" | "referencia_sectorial" | "estimado";
export type CurrencyCode = "DOP" | "USD";

export interface ParameterValue {
  id: number;
  parameterTableId: number;
  businessTypeId: number | null;
  jurisdictionId: number | null;
  valueLow: number;
  valueBase: number;
  valueHigh: number;
  currency: CurrencyCode | null;
  /** ISO date */
  validFrom: string;
  /** ISO date, or null = currently in force */
  validTo: string | null;
  citationId: number;
  provenance: Provenance;
}

export interface BusinessType {
  id: number;
  slug: string;
  nameEs: string;
  descriptionEs: string | null;
  isActive: boolean;
  displayOrder: number;
}
