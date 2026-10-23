/**
 * Quién registró a una influencer, para rotular el listado de Admin (SOLO presentación).
 *
 * Se determina con relaciones reales del esquema (organización → marcas), nunca por la antigüedad ni por
 * el nombre de una organización (2026-10-22; antes: «la organización más antigua es SCENCE»):
 *  - sin organización → la plataforma;
 *  - su organización pertenece a UNA marca → esa marca;
 *  - su organización no pertenece a ninguna marca → la plataforma (alta hecha por SCENCE o autorregistro);
 *  - su organización es compartida por varias marcas (legado) → la marca más antigua de `brand_influencers`
 *    para esa influencer, o «Marca» si no hay vínculo (no se adivina).
 */
export type OrgBrand = { name: string }

export const PLATFORM_LABEL = 'SCENCE'

export function resolveRegisteredBy(input: {
  organizationId: string | null
  /** Marcas cuyo `organization_id` es la organización de la influencer. */
  brandsInOrg: OrgBrand[]
  /** Marcas ligadas por `brand_influencers`, de la más antigua a la más reciente. */
  associatedBrands: OrgBrand[]
}): string {
  if (!input.organizationId) return PLATFORM_LABEL
  if (input.brandsInOrg.length === 0) return PLATFORM_LABEL
  if (input.brandsInOrg.length === 1) return input.brandsInOrg[0].name
  return input.associatedBrands[0]?.name ?? 'Marca'
}
