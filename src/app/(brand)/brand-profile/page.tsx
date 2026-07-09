import { redirect } from 'next/navigation'

// Duplicado real de /brand-settings/organization (BrandOrgForm) — esta
// implementación completa vivía acá, sin link en sidebar/footer ni en
// ningún otro lugar de la UI. El gate de Instagram obligatorio en
// (brand)/layout.tsx apuntaba acá en una versión anterior (comentario
// desactualizado todavía en api/brand/me/route.ts); hoy apunta a
// /brand-settings/organization?complete=1, que es la vista vigente.
export default function LegacyBrandProfilePage() {
  redirect('/brand-settings/organization')
}
