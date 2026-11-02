// FUENTE ÚNICA de las reglas de datos legales de una marca para firmar documentos (NDA).
//
//   Empresa        → brands.rut + brands.address_street/city/region/country  (razón social: brands.name)
//   Representante  → profiles.full_name + profiles.signer_rut + profiles.signer_role  (del owner que firma)
//   Captura/edición → UN solo lugar: /brand-settings/organization (Perfil legal). Nadie más pide estos datos.
//   Copia histórica → brand_documents.content_snapshot + signer_* + metadata.signed_legal_data (al firmar).
//
// Módulo PURO (sin imports de servidor): lo usan rutas API y componentes cliente. Las consultas a la base las
// hace cada ruta con BRAND_LEGAL_SELECT / PROFILE_LEGAL_SELECT; no dupliques aquí listas de obligatorios.

export const BRAND_LEGAL_FIX_URL = '/brand-settings/organization'

export const BRAND_LEGAL_SELECT =
  'id, organization_id, name, rut, address_street, address_number, address_city, address_region, address_country'
export const PROFILE_LEGAL_SELECT = 'full_name, signer_rut, signer_role'

export type LegalSection = 'empresa' | 'representante'
export type CompanyLegalKey = 'rut' | 'address_street' | 'address_city' | 'address_region' | 'address_country'
export type RepresentativeLegalKey = 'full_name' | 'signer_rut' | 'signer_role'
export type LegalFieldKey = CompanyLegalKey | RepresentativeLegalKey
export type MissingLegalField = { key: LegalFieldKey; label: string; section: LegalSection }

export const COMPANY_LEGAL_FIELDS: ReadonlyArray<{ key: CompanyLegalKey; label: string }> = [
  { key: 'rut', label: 'RUT de la empresa' },
  { key: 'address_street', label: 'Calle del domicilio legal' },
  { key: 'address_city', label: 'Comuna o ciudad del domicilio legal' },
  { key: 'address_region', label: 'Región o estado del domicilio legal' },
  { key: 'address_country', label: 'País del domicilio legal' },
]

export const REPRESENTATIVE_LEGAL_FIELDS: ReadonlyArray<{ key: RepresentativeLegalKey; label: string }> = [
  { key: 'full_name', label: 'Nombre completo del representante legal' },
  { key: 'signer_rut', label: 'RUT personal del representante legal' },
  { key: 'signer_role', label: 'Cargo del representante legal' },
]

type Maybe = string | null | undefined
export type BrandLegalRow = {
  id?: string; organization_id?: string | null; name?: Maybe; rut?: Maybe
  address_street?: Maybe; address_number?: Maybe; address_city?: Maybe; address_region?: Maybe; address_country?: Maybe
}
export type RepresentativeRow = { full_name?: Maybe; signer_rut?: Maybe; signer_role?: Maybe }

const blank = (value: unknown) => !String(value ?? '').trim()
const clean = (value: unknown) => String(value ?? '').trim()

export function missingCompanyLegalFields(brand: Partial<Record<CompanyLegalKey, unknown>> | null | undefined): MissingLegalField[] {
  return COMPANY_LEGAL_FIELDS.filter(field => blank(brand?.[field.key])).map(field => ({ ...field, section: 'empresa' as const }))
}

/** ¿La marca tiene RUT registrado? (único dato legal que exigen los flujos de facturación/colaboración). */
export function hasCompanyRut(brand: { rut?: unknown } | null | undefined): boolean {
  return !blank(brand?.rut)
}

export function missingRepresentativeFields(rep: Partial<Record<RepresentativeLegalKey, unknown>> | null | undefined): MissingLegalField[] {
  return REPRESENTATIVE_LEGAL_FIELDS.filter(field => blank(rep?.[field.key])).map(field => ({ ...field, section: 'representante' as const }))
}

export function missingLegalFields(brand: BrandLegalRow | null | undefined, rep: RepresentativeRow | null | undefined): MissingLegalField[] {
  return [...missingCompanyLegalFields(brand), ...missingRepresentativeFields(rep)]
}

export function formatBrandAddress(brand: BrandLegalRow | null | undefined): string {
  return [brand?.address_street, brand?.address_number, brand?.address_city, brand?.address_region, brand?.address_country]
    .map(clean).filter(Boolean).join(', ')
}

export type BrandLegalProfile = {
  company: { name: string; rut: string; address: string }
  representative: { name: string; rut: string; role: string }
  missing: MissingLegalField[]
  complete: boolean
}

export function buildBrandLegalProfile(brand: BrandLegalRow | null | undefined, rep: RepresentativeRow | null | undefined): BrandLegalProfile {
  const missing = missingLegalFields(brand, rep)
  return {
    company: { name: clean(brand?.name), rut: clean(brand?.rut), address: formatBrandAddress(brand) },
    representative: { name: clean(rep?.full_name), rut: clean(rep?.signer_rut), role: clean(rep?.signer_role) },
    missing,
    complete: missing.length === 0,
  }
}

/** Variables de las plantillas de documento (document-templates.ts). */
export function legalDocumentContext(profile: BrandLegalProfile) {
  return {
    brand_name: profile.company.name, brand_rut: profile.company.rut, brand_address: profile.company.address,
    signer_name: profile.representative.name, signer_rut: profile.representative.rut, signer_role: profile.representative.role,
  }
}

/** Copia histórica estructurada que se guarda en brand_documents.metadata al firmar. */
export function signedLegalData(profile: BrandLegalProfile, signerUserId: string) {
  return {
    brand_name: profile.company.name, brand_rut: profile.company.rut, brand_address: profile.company.address,
    signer_name: profile.representative.name, signer_rut: profile.representative.rut, signer_role: profile.representative.role,
    signer_user_id: signerUserId,
  }
}

/** Cuerpo estándar de la respuesta 422 cuando faltan datos: dice exactamente qué falta y adónde ir. */
export function legalIncompleteBody(missing: MissingLegalField[]) {
  return {
    error: `Faltan datos legales para firmar: ${missing.map(field => field.label).join(', ')}. Complétalos en Organización.`,
    code: 'LEGAL_PROFILE_INCOMPLETE' as const,
    missing,
    fix_url: BRAND_LEGAL_FIX_URL,
  }
}
