import type { SupabaseClient } from '@supabase/supabase-js'

export const BRAND_NDA_REQUIRED = 'BRAND_NDA_REQUIRED'
export const BRAND_NDA_MESSAGE = 'El representante legal debe firmar el NDA en Documentos para continuar.'

export async function brandHasSignedNda(admin: SupabaseClient, brandId: string): Promise<boolean> {
  const { data, error } = await admin.from('brand_documents')
    .select('id')
    .eq('brand_id', brandId)
    .eq('document_type', 'nda')
    .eq('status', 'signed')
    .limit(1)
    .maybeSingle()
  if (error) return false
  return Boolean(data)
}
