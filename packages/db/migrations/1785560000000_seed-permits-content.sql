-- Up Migration
-- =====================================================================
-- SODEJA — B-18 seed content: Module 12 permits checklist.
-- First migration to write content.rule_pack / content.rule (domain
-- 'permits'). B-10 built the interpreter (packages/rules/src/permits.ts) and
-- deliberately seeded NO permit content; this migration is that content.
--
-- Idempotent by design (safe to re-run), same pattern as
-- 1785510924741_seed-rules-content.sql: content.citation, content.rule_pack
-- and content.rule inserts use WHERE NOT EXISTS guards on their natural key
-- (rule_pack has UNIQUE (jurisdiction_id, domain, version); rule has
-- UNIQUE (rule_pack_id, code)).
--
-- ---------------------------------------------------------------------
-- THE STANDARD THIS FILE HOLDS ITSELF TO — READ THIS FIRST
-- ---------------------------------------------------------------------
-- This is legal/regulatory content that real users may act on. A wrong
-- permit claim is not an imprecise number — it can cost someone a fine or a
-- closed business. So every rule below cites a source whose PRIMARY TEXT was
-- read directly during this work item (verification pass 2026-08-16), not a
-- summary, a law-firm blog, or a "requisitos para abrir un negocio" listicle.
-- Where a requirement could not be verified that way, it is NOT SEEDED and
-- the gap is documented in the "DELIBERATELY NOT SEEDED" section below —
-- exactly the discipline 1785520000000_seed-capacity-parameters.sql set for
-- parameter content and 1785550000000_seed-layout-parameters.sql applied to
-- layout_template.
--
-- The requirement vocabulary has no 'compliant' member and must never gain
-- one (content.permit_requirement, SODEJA_RISKS.md L3). Nothing here tells a
-- user they are cleared; it tells them what applies to them and who to ask.
-- The checklist is non-exhaustive BY CONSTRUCTION, and Ley 176-07's own
-- Art. 16 is the legal statement of why: a licence from one public body
-- never exempts its holder from the others. That article is cited on the
-- municipal-licence rule for exactly that reason.
--
-- NOT REVIEWED BY A LAWYER. No DR-qualified counsel has been or will be
-- engaged for this project (product-owner decision). This content is a
-- research-grade starting point built from official primary sources, not
-- legal advice, and the UI must keep saying so.
--
-- ---------------------------------------------------------------------
-- CORRECTION TO THE MASTER PLAN'S OWN CITATION
-- ---------------------------------------------------------------------
-- docs/SODEJA_MASTER_PLAN.md §1 Module 12 said to "use MOPC R-007 (Decreto
-- 284-91)" for this module. That is wrong and is corrected in that file by
-- this work item. R-007 under Decreto 284-91 is the "Reglamento para
-- Proyectar sin Barreras Arquitectónicas" — accessibility, not land use.
-- Land use is governed by Ley 368-22 (2022), which post-dates and is
-- unrelated to it. Nothing in this migration cites R-007.
--
-- ---------------------------------------------------------------------
-- DELIBERATELY NOT SEEDED — each of these lacks a verifiable source today
-- ---------------------------------------------------------------------
--   - PLAN DE AUTOPROTECCIÓN THRESHOLDS (200 m² / 25 personas / 4 pisos /
--     12 m). Could not be verified in ANY retrievable text. The MOPC portal
--     (portalweb.mopc.gob.do) refused connection on every attempt and
--     www.mopc.gob.do's copy of the Decreto 347-19 version 404s to an HTML
--     shell; transparencia.mived.gob.do returns HTTP 473. The only complete
--     R-032 text obtainable is the ORIGINAL Decreto 85-11 (2011) version
--     mirrored by MINERD, and that text contains no "plan de autoprotección"
--     concept at all. Since Decretos 364-16 and 347-19 modified R-032 and
--     could have changed any threshold, seeding a number from the superseded
--     85-11 text — or from the unverified figures — would be a fabricated
--     requirement wearing a real regulation's name. Fire safety is instead
--     covered below by Decreto 316-06 Art. 15, whose text WAS read in full.
--   - CERTIFICACIÓN DE OCUPACIÓN DEL CUERPO DE BOMBEROS, 1-year validity.
--     Every source that describes this instrument in those terms turned out
--     to be PANAMANIAN (bomberos.gob.pa), not Dominican. No DR source was
--     found establishing an ex-ante fire certificate or its validity period.
--     The DR instrument that IS verifiable is an inspection regime, and the
--     rule below says "inspección", never "certificado".
--   - MUNICIPAL CLOSING HOURS. Decreto 316-06 Art. 16 does set a national
--     ceiling on commercial closing time, but the retrievable text reads
--     "no debiendo exceder las doce (12:00 a.m.) de la noche de domingos a
--     jueves y dos de la mañana (2:00 a.m.) los sábados y domingos" — which
--     lists Sunday in both brackets and so contradicts itself as extracted.
--     The hours are not seeded until a clean copy resolves the overlap.
--   - RST (RÉGIMEN SIMPLIFICADO DE TRIBUTACIÓN) ELIGIBILITY CAPS. Ley 30-26
--     (promulgada 2026-06-18) amended Art. 290 of the Código Tributario and
--     raised the caps, but DGII has stated its implementing regulation is
--     still pending and the new RST's entry into force depends on it. This
--     confirms 1785510924741_seed-rules-content.sql's existing RST gap is
--     still open — it has not been closed by Ley 30-26. Also: RST is a tax
--     regime election, not a permit, so it would not belong in this pack
--     even once the figures settle.
--   - ENVIRONMENTAL AUTHORISATION (Ley 64-00). Whether a colmado, ferretería
--     or restaurante needs one turns on Medio Ambiente's categorisation
--     listing, which was not obtained. Guessing would produce either a false
--     alarm or a false all-clear; both are worse than silence.
--   - ALCOHOL AND TOBACCO SALE LICENSING. Applicability depends on whether a
--     given business sells them — a fact SODEJA does not collect — and no
--     primary text was verified. Left out entirely rather than attached to
--     'restaurante'/'colmado' on an assumption about what they stock.
--   - PER-CHAMBER REGISTRO MERCANTIL ROUTING. The Cámara de Comercio y
--     Producción de Santiago was confirmed from its own site; the Santo
--     Domingo chamber's page redirected and was not confirmed. Seeding one
--     municipal override and not the other would make the checklist read as
--     though DN had no chamber, so neither is seeded and the national rule
--     names the chamber the way Ley 3-02 Art. 7 itself does: the one with
--     jurisdiction over the applicant's domicile.
--
-- ---------------------------------------------------------------------
-- CONFLICTING INFORMATION FOUND (recorded, not silently resolved)
-- ---------------------------------------------------------------------
--   - Secondary sources attribute the municipal licensing competence to
--     "Artículo 8" of Ley 176-07. Reading the primary text shows the
--     provision is Art. 60, numeral 8º (attributions of the alcalde) — the
--     numeral was mistaken for the article number. The citation below uses
--     the article as it actually reads.
--   - Secondary sources describe R-032 as "Decreto 347-19". The regulation's
--     own title page attributes it to Decreto 85-11; 364-16 and 347-19 are
--     modifying decrees. Not cited here either way (see gaps above).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Citations. Every row's source_url is the copy whose text was actually
-- read and quoted from during verification — not a nicer-looking URL that
-- was never opened. Where the canonical government copy was unreachable,
-- verification_note says so and names what was read instead, so a reviewer
-- can re-run the same check.
-- No UNIQUE constraint exists on content.citation (specs/db/schema.sql), so
-- these guard on (source_name, document_title) as the natural key.
-- ---------------------------------------------------------------------
INSERT INTO content.citation
  (source_name, document_title, article_ref, source_url, published_on, retrieved_on,
   is_verified, verification_note)
SELECT v.source_name, v.document_title, v.article_ref, v.source_url,
       v.published_on::date, '2026-08-16'::date, true, v.note
FROM (VALUES
  (
    'Congreso Nacional de la República Dominicana',
    'Ley núm. 3-02 sobre Registro Mercantil',
    'Art. 5 (plazo); Arts. 2, 3, 7 y 12',
    'https://faolex.fao.org/docs/pdf/dom187720.pdf',
    '2002-01-18',
    'Texto primario leído íntegro. Art. 5: "La solicitud de Registro Mercantil será presentada ' ||
    'dentro del mes en que se inicien las actividades de comercio o el establecimiento de ' ||
    'negocios fue abierto, si se tratase de personas naturales o sociedades de hecho." ' ||
    'Art. 2: el registro es "público y obligatorio". Art. 3: a cargo de las Cámaras de Comercio ' ||
    'y Producción. Art. 7: la Cámara con jurisdicción en el domicilio del interesado. ' ||
    'Art. 12: renovación cada dos (2) años desde la matrícula inicial. ' ||
    'La copia oficial del MICM devolvió HTTP 403 en cada intento; se leyó el facsímil de la ' ||
    'Gaceta Oficial alojado en FAOLEX (base legal de la FAO/ONU), cuya paginación coincide ' ||
    'con la G.O. Promulgada el 18 de enero de 2002.'
  ),
  (
    'Dirección General de Impuestos Internos (DGII)',
    'Ley núm. 11-92 — Código Tributario de la República Dominicana',
    'Art. 50, literales c) y d)',
    'https://dgii.gov.do/legislacion/leyesTributarias/Documents/Codigo%20Tributario%20y%20Leyes%20que%20lo%20modifican%20y%20complementan/11-92.pdf',
    '1992-05-16',
    'Texto primario leído en la copia oficial publicada por la propia DGII. Art. 50 lit. c): ' ||
    '"Inscribirse en el Registro Nacional de Contribuyentes y los registros especiales ' ||
    'pertinentes, a los que aportarán los datos necesarios y comunicarán oportunamente sus ' ||
    'modificaciones, debiendo acreditar esta inscripción para la realización de todos los actos ' ||
    'señalados por la ley, reglamentos o normas administrativas." Art. 50 lit. d): solicitar ' ||
    '"permisos previos de instalación o de habilitación de locales" e informar el inicio de ' ||
    'actividades "dentro de los dos meses siguientes a la iniciación de sus actividades".'
  ),
  (
    'Ministerio de Economía, Planificación y Desarrollo (MEPyD) / Consultoría Jurídica del Poder Ejecutivo',
    'Ley núm. 368-22 de Ordenamiento Territorial, Uso de Suelo y Asentamientos Humanos',
    'Art. 24, Párrafo I',
    'https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1',
    '2022-12-22',
    'Texto primario leído en el portal oficial consultoria.gov.do y cotejado contra una segunda ' ||
    'copia independiente: idénticos. G. O. núm. 11092 del 22 de diciembre de 2022. ' ||
    'Art. 24 Párrafo I: los gobiernos locales con población mayor a quince mil habitantes ' ||
    '"gestionan y autorizan el uso de suelo, a través de la Oficina de Planeamiento Urbano ' ||
    'creada para tales fines, y en coordinación con el MEPyD para el ordenamiento territorial." ' ||
    'Esta ley —no el MOPC R-007/Decreto 284-91— es la base legal del uso de suelo; ver la ' ||
    'corrección al plan maestro en el encabezado de esta migración.'
  ),
  (
    'Sistema de Monitoreo de la Administración Pública Municipal (SISMAP Municipal)',
    'Ley núm. 176-07 del Distrito Nacional y los Municipios',
    'Art. 60, numeral 8º; Art. 16',
    'https://www.sismap.gob.do/Municipal/uploads/Marco%20Legal/Otras/0-Ley%20176-07%20del%20Distrito%20Nacional%20y%20los%20Municipios.pdf',
    '2007-07-17',
    'Texto primario leído íntegro en la copia oficial del SISMAP. Art. 60, numeral 8º (atribuciones ' ||
    'del alcalde): "La concesión de licencias de apertura de establecimientos fabriles, ' ||
    'industriales, comerciales o de cualquier índole y de licencias de obras en general..." ' ||
    'Art. 16: "Las licencias o autorizaciones otorgadas por otros organismos públicos no eximen ' ||
    'a sus titulares de obtener las correspondientes licencias municipales, respetándose en todo ' ||
    'caso lo dispuesto en las leyes sectoriales." G.O. 10426; promulgada el 17 de julio de 2007. ' ||
    'NOTA: fuentes secundarias citan esto como "Artículo 8"; el texto primario muestra que el 8 ' ||
    'es el numeral dentro del Art. 60, no el artículo.'
  ),
  (
    'Ministerio de Interior y Policía (MIP)',
    'Decreto núm. 316-06, que establece el Reglamento General de los Bomberos',
    'Art. 15 y sus Párrafos I y II',
    'https://mip.gob.do/wp-content/uploads/marcolegal/Decretos/Decreto%20No.%20316-06,%20Que%20establece%20el%20Reglamento%20General%20de%20los%20Bomberos.pdf',
    '2006-07-28',
    'Texto primario leído en la copia oficial del MIP. Art. 15: "Los Cuerpos de Bomberos, además ' ||
    'de la atención a incendios y emergencias, realizarán inspecciones técnicas y emitirán ' ||
    'informes sobre las condiciones de seguridad en espacios públicos comerciales o privados de ' ||
    'uso público." Párrafo II: ninguna persona física o moral puede oponerse a las inspecciones; ' ||
    'de no obtemperar, procede la suspensión temporal del establecimiento o su clausura. ' ||
    'Se cita este decreto —y NO el R-032— porque el texto vigente del R-032 no fue recuperable; ' ||
    'ver la sección de brechas en el encabezado.'
  ),
  (
    'Ministerio de Salud Pública (MISPAS)',
    'Ley General de Salud núm. 42-01',
    'Arts. 127 y 128, literales a) y b)',
    'https://www.dida.gob.do/wp-content/uploads/2024/05/Ley-42-01-General-de-Salud.pdf',
    '2001-03-08',
    'Texto primario leído en la copia oficial de la DIDA. Art. 127: los alimentos deben provenir ' ||
    '"de establecimientos autorizados por SESPAS". Art. 128 lit. a): velar por que quienes se ' ||
    'dediquen a la fabricación, manipulación, transporte, almacenaje y comercio de alimentos lo ' ||
    'hagan "en los establecimientos debidamente autorizados". Art. 128 lit. b): el certificado de ' ||
    'salud de los manipuladores "constituirá un requisito indispensable para esta ocupación, ' ||
    'deberá ser renovado periódicamente". G.O. 10075; promulgada el 8 de marzo de 2001. ' ||
    'La ley dice SESPAS; ese órgano es hoy el Ministerio de Salud Pública (MISPAS).'
  ),
  (
    'Ayuntamiento del Distrito Nacional (ADN)',
    'Solicitud de Certificación de Uso de Suelo — Dirección de Planeamiento Urbano',
    NULL,
    'https://adn.gob.do/solicitud-de-certificacion-de-uso-de-suelo-2/',
    NULL,
    'Página de servicio oficial del ADN, leída directamente. Instrumento: "Certificación de Uso ' ||
    'de Suelo", emitido por la Dirección de Planeamiento Urbano. Costo RD$4,500; plazo 30 a 45 ' ||
    'días laborables; presencial. Requiere título de propiedad, plano de mensura catastral, ' ||
    'poder de autorización notarizado y documentos de identidad. La página no cita base legal ' ||
    'propia; la base legal nacional es la Ley 368-22 Art. 24 Párrafo I (citada aparte). ' ||
    'published_on queda NULL: la página no publica fecha de vigencia, y datarla sería inventar.'
  ),
  (
    'Ayuntamiento del Municipio de Santiago de los Caballeros',
    'Solicitudes de No Objeción al Uso de Suelo — Oficina Municipal de Planeamiento Urbano (OMPU)',
    NULL,
    'https://santiago.seurd.com/servicios/proyectos-de-construccion/no-objecion-al-uso-de-suelo/',
    NULL,
    'Página de servicio de la Oficina Virtual del Ayuntamiento de Santiago, leída directamente ' ||
    '(el mismo servicio aparece listado en ayuntamientosantiago.gob.do). Instrumento: "No ' ||
    'Objeción al Uso de Suelo" —nombre distinto del de la Certificación del ADN—, emitido por la ' ||
    'OMPU. Costo RD$1,000; plazo 10 a 15 días laborables. Requiere carta de solicitud firmada ' ||
    'por arquitecto colegiado (CODIA), título de propiedad y mensura catastral actualizada. ' ||
    'published_on queda NULL por la misma razón que la fila del ADN.'
  )
) AS v(source_name, document_title, article_ref, source_url, published_on, note)
WHERE NOT EXISTS (
  SELECT 1 FROM content.citation c
  WHERE c.source_name = v.source_name AND c.document_title = v.document_title
);


-- ---------------------------------------------------------------------
-- Rule packs: one per jurisdiction. Packs are append-only and publishing
-- supersedes rather than mutates (specs/db/schema.sql), so this is v1 for
-- each. The two municipal packs exist ONLY to carry genuine local
-- divergence — see the note on the 'uso-suelo' overrides below.
-- valid_from is the date this content was verified and published, not the
-- date the underlying laws took force; the laws' own dates live on their
-- citations' published_on.
-- ---------------------------------------------------------------------
INSERT INTO content.rule_pack
  (jurisdiction_id, domain, version, status, valid_from, published_at, notes)
SELECT j.id, 'permits', 1, 'published', '2026-08-16'::date, now(), v.notes
FROM (VALUES
  (
    'nacional',
    'B-18. Requisitos de apertura de alcance nacional para los 5 tipos de negocio del MVP. ' ||
    'Lista NO exhaustiva por diseño (SODEJA_RISKS.md L3) y no revisada por abogado.'
  ),
  (
    'distrito-nacional',
    'B-18. Solo contiene las reglas donde el Distrito Nacional diverge realmente de la norma ' ||
    'nacional. Todo lo demás se hereda del pack nacional por la cadena de jurisdicciones.'
  ),
  (
    'santiago',
    'B-18. Solo contiene las reglas donde Santiago diverge realmente de la norma nacional. ' ||
    'Cubre el municipio de Santiago de los Caballeros; la jurisdicción sembrada en B-10 es la ' ||
    'provincia, y los demás municipios de la provincia no fueron verificados.'
  )
) AS v(jurisdiction_slug, notes)
JOIN content.jurisdiction j ON j.slug = v.jurisdiction_slug
WHERE NOT EXISTS (
  SELECT 1 FROM content.rule_pack rp
  WHERE rp.jurisdiction_id = j.id AND rp.domain = 'permits' AND rp.version = 1
);


-- ---------------------------------------------------------------------
-- National rules.
--
-- `condition` is JSONLogic, interpreted by evaluateCondition (never executed
-- as code). `true` means "applies to every commercial business at this stage
-- of the product" — which is the honest shape for these five: none of them
-- turns on a fact SODEJA collects. The food rules are the only conditional
-- ones, and they key on `businessTypeSlug`, the fact name already used
-- across apps/api and packages/calc. If that fact is absent, `var` yields
-- null, `in` yields false, and the rule simply does not fire — a missing
-- fact can never manufacture a requirement.
--
-- `consequence` is '{}' throughout: evaluatePermitRules reads `requirement`
-- off the row and does not interpret consequence for permits. An empty
-- object is the honest placeholder; inventing a payload the engine ignores
-- would be dead content.
-- ---------------------------------------------------------------------
INSERT INTO content.rule
  (rule_pack_id, code, title_es, description_es, condition, consequence,
   requirement, agency_name, citation_id, display_order)
SELECT rp.id, v.code, v.title_es, v.description_es, v.condition::jsonb, '{}'::jsonb,
       v.requirement::content.permit_requirement, v.agency_name, c.id, v.display_order
FROM (VALUES
  (
    'registro-mercantil',
    'Matriculación en el Registro Mercantil',
    'El Registro Mercantil es público y obligatorio (Ley 3-02, Art. 2). La solicitud debe ' ||
    'presentarse dentro del mes en que se inicien las actividades de comercio o se abra el ' ||
    'establecimiento. Se tramita ante la Cámara de Comercio y Producción con jurisdicción en el ' ||
    'domicilio del negocio (Art. 7) y se renueva cada dos años desde la matrícula inicial ' ||
    '(Art. 12). Las tarifas las fija cada Cámara, por lo que SODEJA no publica un monto.',
    'true',
    'required',
    'Cámara de Comercio y Producción con jurisdicción en el domicilio del negocio',
    'Congreso Nacional de la República Dominicana',
    'Ley núm. 3-02 sobre Registro Mercantil',
    10
  ),
  (
    'rnc-inscripcion',
    'Inscripción en el Registro Nacional de Contribuyentes (RNC)',
    'Inscribirse en el RNC es un deber formal de todo contribuyente (Código Tributario, ' ||
    'Art. 50 lit. c), y la inscripción debe acreditarse para realizar los actos que la ley y los ' ||
    'reglamentos señalan. La Ley 3-02 (Art. 28) exige además acompañar la solicitud de RNC con ' ||
    'copia del certificado de Registro Mercantil, por lo que en la práctica este paso va después ' ||
    'de aquél.',
    'true',
    'required',
    'Dirección General de Impuestos Internos (DGII)',
    'Dirección General de Impuestos Internos (DGII)',
    'Ley núm. 11-92 — Código Tributario de la República Dominicana',
    20
  ),
  (
    'dgii-inicio-actividades',
    'Comunicación a la DGII del inicio de actividades y permisos de local',
    'El Código Tributario (Art. 50 lit. d) obliga a solicitar a la Administración Tributaria los ' ||
    'permisos previos de instalación o de habilitación de locales y a informarle el inicio de ' ||
    'actividades susceptibles de generar obligaciones tributarias, dentro de los dos meses ' ||
    'siguientes a esa iniciación. Es un deber distinto de la inscripción en el RNC.',
    'true',
    'required',
    'Dirección General de Impuestos Internos (DGII)',
    'Dirección General de Impuestos Internos (DGII)',
    'Ley núm. 11-92 — Código Tributario de la República Dominicana',
    30
  ),
  (
    'uso-suelo',
    'Autorización municipal de uso de suelo',
    'El uso de suelo lo gestionan y autorizan los gobiernos locales a través de su Oficina de ' ||
    'Planeamiento Urbano (Ley 368-22, Art. 24 Párrafo I). Antes de comprometer capital en un ' ||
    'local conviene confirmar que la actividad prevista es compatible con la calificación de uso ' ||
    'de suelo de esa parcela: una autorización expedida en desconocimiento de los requisitos ' ||
    'legales es nula (Art. 45). El nombre del trámite, su costo y su plazo varían por municipio.',
    'true',
    'required',
    'Oficina de Planeamiento Urbano del ayuntamiento correspondiente',
    'Ministerio de Economía, Planificación y Desarrollo (MEPyD) / Consultoría Jurídica del Poder Ejecutivo',
    'Ley núm. 368-22 de Ordenamiento Territorial, Uso de Suelo y Asentamientos Humanos',
    40
  ),
  (
    'licencia-apertura-municipal',
    'Licencia municipal de apertura del establecimiento',
    'La concesión de licencias de apertura de establecimientos comerciales "o de cualquier ' ||
    'índole" corresponde al ayuntamiento (Ley 176-07, Art. 60 numeral 8º). Importante: el ' ||
    'Art. 16 de esa misma ley establece que las licencias otorgadas por otros organismos ' ||
    'públicos NO eximen de obtener las municipales correspondientes — es decir, cumplir con ' ||
    'DGII, Salud Pública o Bomberos no sustituye este paso. El nombre y los requisitos del ' ||
    'trámite los fija cada ayuntamiento por ordenanza.',
    'true',
    'required',
    'Ayuntamiento del municipio donde opera el establecimiento',
    'Sistema de Monitoreo de la Administración Pública Municipal (SISMAP Municipal)',
    'Ley núm. 176-07 del Distrito Nacional y los Municipios',
    50
  ),
  (
    'bomberos-inspeccion',
    'Inspección técnica de seguridad contra incendios',
    'Los Cuerpos de Bomberos realizan inspecciones técnicas y emiten informes sobre las ' ||
    'condiciones de seguridad en espacios públicos comerciales o privados de uso público ' ||
    '(Decreto 316-06, Art. 15). Ninguna persona física o moral puede oponerse a la inspección ni ' ||
    'a las medidas de prevención que de ella emanen; de no cumplirse, procede la suspensión ' ||
    'temporal del establecimiento o su clausura (Párrafo II). SODEJA no publica requisitos ' ||
    'técnicos de sistemas contra incendios: el reglamento vigente que los fija (R-032) no fue ' ||
    'recuperable de una fuente oficial durante esta verificación.',
    'true',
    'required',
    'Cuerpo de Bomberos con jurisdicción en el municipio',
    'Ministerio de Interior y Policía (MIP)',
    'Decreto núm. 316-06, que establece el Reglamento General de los Bomberos',
    60
  ),
  (
    'salud-establecimiento-alimentos',
    'Autorización sanitaria del establecimiento (manejo de alimentos)',
    'Los alimentos deben provenir de establecimientos autorizados por la autoridad sanitaria ' ||
    '(Ley 42-01, Art. 127), y quienes se dediquen a la fabricación, manipulación, almacenaje, ' ||
    'comercio en cualquiera de sus formas o preparación de alimentos para suministro directo al ' ||
    'público deben hacerlo "en los establecimientos debidamente autorizados" (Art. 128 lit. a). ' ||
    'Aplica tanto a quien prepara como a quien solo expende. No confundir con el Registro ' ||
    'Sanitario, que recae sobre los productos envasados, no sobre el local.',
    '{"in": [{"var": "businessTypeSlug"}, ["restaurante", "colmado", "minimarket"]]}',
    'required',
    'Ministerio de Salud Pública (MISPAS)',
    'Ministerio de Salud Pública (MISPAS)',
    'Ley General de Salud núm. 42-01',
    70
  ),
  (
    'salud-certificado-manipuladores',
    'Certificado de salud para manipuladores de alimentos',
    'Las personas que manipulan artículos alimentarios y bebidas deben someterse a examen ' ||
    'médico inicial y a exámenes periódicos; el certificado de salud correspondiente ' ||
    '"constituirá un requisito indispensable para esta ocupación" y debe renovarse ' ||
    'periódicamente (Ley 42-01, Art. 128 lit. b). Es un requisito del personal, no del local, ' ||
    'por lo que alcanza a cada empleado que manipule alimentos.',
    '{"in": [{"var": "businessTypeSlug"}, ["restaurante", "colmado", "minimarket"]]}',
    'required',
    'Ministerio de Salud Pública (MISPAS)',
    'Ministerio de Salud Pública (MISPAS)',
    'Ley General de Salud núm. 42-01',
    80
  )
) AS v(code, title_es, description_es, condition, requirement, agency_name,
       cite_source, cite_doc, display_order)
JOIN content.jurisdiction j ON j.slug = 'nacional'
JOIN content.rule_pack rp
  ON rp.jurisdiction_id = j.id AND rp.domain = 'permits' AND rp.version = 1
JOIN content.citation c
  ON c.source_name = v.cite_source AND c.document_title = v.cite_doc
WHERE NOT EXISTS (
  SELECT 1 FROM content.rule r WHERE r.rule_pack_id = rp.id AND r.code = v.code
);


-- ---------------------------------------------------------------------
-- Municipal overrides.
--
-- These reuse the code 'uso-suelo', which is what makes evaluatePermitRules
-- drop the national row in favour of the municipal one (a rule whose pack
-- sits at a more specific jurisdiction wins on shared code). This is not a
-- demonstration of the mechanism — DN and Santiago genuinely differ: the
-- instrument has a different NAME ("Certificación" vs "No Objeción"), is
-- issued by a differently-named office, and carries a different fee and
-- turnaround (RD$4,500 / 30-45 días vs RD$1,000 / 10-15 días). Sending a
-- Santiago user to ask for a "Certificación de Uso de Suelo" would be
-- sending them to ask for something that office does not issue.
--
-- Only 'uso-suelo' is overridden. Every other rule above is national law and
-- applies identically in both jurisdictions, so duplicating it here would
-- add drift risk for no benefit.
-- ---------------------------------------------------------------------
INSERT INTO content.rule
  (rule_pack_id, code, title_es, description_es, condition, consequence,
   requirement, agency_name, citation_id, display_order)
SELECT rp.id, 'uso-suelo', v.title_es, v.description_es, 'true'::jsonb, '{}'::jsonb,
       'required'::content.permit_requirement, v.agency_name, c.id, 40
FROM (VALUES
  (
    'distrito-nacional',
    'Certificación de Uso de Suelo (Distrito Nacional)',
    'En el Distrito Nacional el trámite se llama "Certificación de Uso de Suelo" y lo emite la ' ||
    'Dirección de Planeamiento Urbano del ADN. Según la página de servicio del ADN: costo ' ||
    'RD$4,500 y plazo de 30 a 45 días laborables, de forma presencial. Entre los documentos ' ||
    'exigidos están el título de propiedad, el plano de mensura catastral, la ubicación del ' ||
    'inmueble y un poder de autorización notarizado del propietario. Los inmuebles en Gazcue o ' ||
    'la Zona Colonial requieren además una no objeción de Patrimonio Monumental. El ADN se ' ||
    'reserva el derecho de solicitar documentación adicional, así que trate esta lista como el ' ||
    'punto de partida y confirme con la Dirección antes de presentarse.',
    'Ayuntamiento del Distrito Nacional (ADN) — Dirección de Planeamiento Urbano',
    'Ayuntamiento del Distrito Nacional (ADN)',
    'Solicitud de Certificación de Uso de Suelo — Dirección de Planeamiento Urbano'
  ),
  (
    'santiago',
    'No Objeción al Uso de Suelo (Santiago)',
    'En Santiago el trámite NO se llama "certificación": es una "No Objeción al Uso de Suelo" y ' ||
    'la emite la Oficina Municipal de Planeamiento Urbano (OMPU) del Ayuntamiento de Santiago. ' ||
    'Según la página de servicio del ayuntamiento: costo RD$1,000 y plazo de 10 a 15 días ' ||
    'laborables. La solicitud debe ir firmada por un arquitecto colegiado (CODIA) e incluir la ' ||
    'identificación catastral del inmueble, su ubicación, el título de propiedad y la mensura ' ||
    'catastral actualizada. Datos verificados para el municipio de Santiago de los Caballeros; ' ||
    'los demás municipios de la provincia no fueron verificados.',
    'Ayuntamiento del Municipio de Santiago — Oficina Municipal de Planeamiento Urbano (OMPU)',
    'Ayuntamiento del Municipio de Santiago de los Caballeros',
    'Solicitudes de No Objeción al Uso de Suelo — Oficina Municipal de Planeamiento Urbano (OMPU)'
  )
) AS v(jurisdiction_slug, title_es, description_es, agency_name, cite_source, cite_doc)
JOIN content.jurisdiction j ON j.slug = v.jurisdiction_slug
JOIN content.rule_pack rp
  ON rp.jurisdiction_id = j.id AND rp.domain = 'permits' AND rp.version = 1
JOIN content.citation c
  ON c.source_name = v.cite_source AND c.document_title = v.cite_doc
WHERE NOT EXISTS (
  SELECT 1 FROM content.rule r WHERE r.rule_pack_id = rp.id AND r.code = 'uso-suelo'
);


-- Down Migration

DELETE FROM content.rule r
USING content.rule_pack rp, content.jurisdiction j
WHERE r.rule_pack_id = rp.id
  AND rp.jurisdiction_id = j.id
  AND rp.domain = 'permits'
  AND rp.version = 1
  AND j.slug IN ('nacional', 'distrito-nacional', 'santiago');

DELETE FROM content.rule_pack rp
USING content.jurisdiction j
WHERE rp.jurisdiction_id = j.id
  AND rp.domain = 'permits'
  AND rp.version = 1
  AND j.slug IN ('nacional', 'distrito-nacional', 'santiago');

DELETE FROM content.citation
WHERE (source_name, document_title) IN (
  ('Congreso Nacional de la República Dominicana', 'Ley núm. 3-02 sobre Registro Mercantil'),
  ('Dirección General de Impuestos Internos (DGII)', 'Ley núm. 11-92 — Código Tributario de la República Dominicana'),
  ('Ministerio de Economía, Planificación y Desarrollo (MEPyD) / Consultoría Jurídica del Poder Ejecutivo', 'Ley núm. 368-22 de Ordenamiento Territorial, Uso de Suelo y Asentamientos Humanos'),
  ('Sistema de Monitoreo de la Administración Pública Municipal (SISMAP Municipal)', 'Ley núm. 176-07 del Distrito Nacional y los Municipios'),
  ('Ministerio de Interior y Policía (MIP)', 'Decreto núm. 316-06, que establece el Reglamento General de los Bomberos'),
  ('Ministerio de Salud Pública (MISPAS)', 'Ley General de Salud núm. 42-01'),
  ('Ayuntamiento del Distrito Nacional (ADN)', 'Solicitud de Certificación de Uso de Suelo — Dirección de Planeamiento Urbano'),
  ('Ayuntamiento del Municipio de Santiago de los Caballeros', 'Solicitudes de No Objeción al Uso de Suelo — Oficina Municipal de Planeamiento Urbano (OMPU)')
);
