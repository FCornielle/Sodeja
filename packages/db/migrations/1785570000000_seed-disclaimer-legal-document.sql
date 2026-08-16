-- Up Migration
-- =====================================================================
-- SODEJA — B-20 minimal slice: seed exactly ONE `app.legal_document` row
-- (kind='disclaimer', locale='es-DO'), so B-19's `app.report` CHECK
-- ("status <> 'ready' OR (storage_key IS NOT NULL AND
-- disclaimer_document_id IS NOT NULL)") is satisfiable at all
-- (docs/SODEJA_MVP_BACKLOG.md Phase 0 refinements item 2: "B-19 now
-- hard-depends on B-20").
--
-- ---------------------------------------------------------------------
-- WHAT THIS IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
-- ---------------------------------------------------------------------
-- This is a GENERIC, CONSERVATIVE placeholder disclaimer, deliberately
-- written to be honest about SODEJA's output (informational/estimative,
-- unaudited, no warranty, provisional) WITHOUT citing any Dominican
-- Republic law, decree, or regulation, and WITHOUT claiming any legal
-- review took place. P0-4 ("Engage DR contador + lawyer; ToS/license legal
-- reads" — docs/SODEJA_MVP_BACKLOG.md Phase 0) is still an OPEN,
-- UN-ACTIONED item. Writing DR-specific limitation-of-liability language
-- here — the way 1785560000000_seed-permits-content.sql cites real DR
-- statutes for permits content — would misrepresent this text as reviewed
-- legal work product when it is not. Risk L1 (docs/SODEJA_RISKS.md) names
-- exactly this: "DR counsel to review limitation-of-liability language" is
-- listed as a mitigation still to be done, not one already complete.
--
-- This placeholder is sufficient to unblock B-19's schema constraint and to
-- give every export a real, honest, non-dismissible notice. It is NOT a
-- substitute for real legal review, and the product-owner decision to
-- proceed without one (same posture 1785560000000_seed-permits-content.sql
-- documents for its own "NOT REVIEWED BY A LAWYER" content) applies here
-- with equal force.
--
-- Idempotent by design, same pattern as every other B-1x/B-2x seed
-- migration: `app.legal_document` has UNIQUE (kind, version, locale), so
-- this uses ON CONFLICT DO NOTHING rather than a WHERE NOT EXISTS guard.
-- =====================================================================

INSERT INTO app.legal_document (kind, version, locale, body_md, effective_from)
VALUES (
  'disclaimer',
  '1',
  'es-DO',
  $md$# Aviso legal

**Este documento es un resumen de análisis generado de forma automática. No es un plan de negocio auditado, ni un dictamen profesional, ni un documento revisado por un abogado o contador.**

## Qué es este documento

Este informe combina datos que usted suministró con estimaciones generadas por el sistema SODEJA. Toda cifra se presenta como un rango (pesimista / base / optimista), nunca como un número único, e indica su origen: un dato que usted ingresó (`usuario`), una referencia del sector (`referencia_sectorial`), o una estimación del sistema (`estimado`).

## Qué NO es este documento

- No es una auditoría financiera, contable ni de ningún otro tipo.
- No es asesoría legal, fiscal, financiera, ni de ningún tipo profesional.
- No constituye una opinión, dictamen, certificación ni validación de ningún profesional colegiado.
- No es una garantía de exactitud, integridad, vigencia ni aplicabilidad de ninguna cifra, dato o requisito mostrado.
- No confirma que el negocio descrito pueda operar, cumpla ninguna normativa aplicable, o esté en condiciones de recibir financiamiento.
- No sustituye una cotización, un estudio de factibilidad, ni ninguna verificación directa con un proveedor, institución o autoridad.

## Limitación de responsabilidad

Este contenido se entrega "tal cual" (as-is), únicamente con fines informativos y de planificación preliminar. SODEJA no garantiza que los resultados aquí mostrados se correspondan con la realidad operativa, legal o financiera del negocio descrito. Las estimaciones pueden contener errores, quedar desactualizadas, o no aplicar al caso particular del usuario.

Cualquier decisión de inversión, financiamiento, apertura o cierre de un negocio, contratación de personal, o cumplimiento regulatorio debe basarse en asesoría profesional independiente (contable, legal, financiera) y en verificación directa con las autoridades e instituciones correspondientes — nunca únicamente en este documento.

## Estado de esta versión

Este es un texto de aviso legal genérico y conservador, redactado como salvaguarda mínima mientras el producto no ha sido revisado por asesoría legal calificada en ninguna jurisdicción. No ha sido revisado por un abogado ni adaptado a la legislación de ningún país en particular. Debe tratarse como un marcador de posición (*placeholder*) suficiente para cumplir el requisito de que todo documento exportado incluya un aviso — y no como una pieza legal definitiva.

## Vigencia

Este aviso aplica a la versión del documento que lo incluye. Una versión futura de este aviso, revisada por asesoría profesional calificada, podría reemplazar este texto en una exportación posterior.
$md$,
  CURRENT_DATE
)
ON CONFLICT (kind, version, locale) DO NOTHING;


-- Down Migration

DELETE FROM app.legal_document WHERE kind = 'disclaimer' AND version = '1' AND locale = 'es-DO';
