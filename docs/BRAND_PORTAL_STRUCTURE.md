# SCENCE — Estructura del Portal Marca

> Documento de referencia permanente. Actualizar si cambia arquitectura. No tocar sin auditoría previa.

---

## Rutas oficiales — Settings de marca

| Tab | Ruta | Componente | Contenido |
|-----|------|------------|-----------|
| Mi perfil | `/brand-settings/profile` | re-export de `admin-settings/profile` | Perfil personal / auth del usuario |
| Organización | `/brand-settings/organization` | `BrandOrgForm` | Empresa, RUT, industria, web, contacto |
| Lugares | `/brand-settings/locations` | `BrandAddressForm` | Dirección principal y secundaria |
| Usuarios | `/brand-settings/users` | `BrandMembersSection` | Equipo con acceso al portal |
| Plan | `/brand-settings/plan` | `BrandPlanSettings` | Suscripción SaaS a SCENCE |

Layout compartido: `src/app/(brand)/brand-settings/layout.tsx`

---

## Sidebar de marca

**Regla:** El link "Mi perfil" en `AppSidebar.tsx` (`portal === 'brand'`) **siempre apunta a `/brand-settings/profile`**.

```tsx
// src/components/layout/AppSidebar.tsx
{portal === 'brand' && (
  <Link href="/brand-settings/profile"
    className={cn('nav-link', pathname.startsWith('/brand-settings') && 'active')}>
    <Settings className="h-4 w-4" /> Mi perfil
  </Link>
)}
```

`/brand-profile` existe como fallback all-in-one pero **no se usa como entrada principal**. No eliminarlo todavía.

---

## Separación de módulos — NO mezclar

| Módulo | Qué es | Dónde vive |
|--------|--------|------------|
| **Plan / Suscripción** | Marca paga a SCENCE por SaaS | `/brand-settings/plan` |
| **Billing operativo** | Facturas / cobros entre marcas y campañas | `/brand-billing` (módulo separado, en desarrollo) |
| **Payroll** | Pagos y canjes a influencers | Módulo separado, no implementado aún |

**Plan ≠ Billing. Billing ≠ Payroll.**

---

## Flujo de influencers — Portal Marca

- La marca **no crea influencers globales**. Eso es exclusivo de admin.
- La marca **invita influencers existentes a sus campañas** desde `/brand-campaigns/[id]/invite`.
- El roster en `/brand-influencers` muestra influencers que ya participan en campañas de la marca.
- CTA en `/brand-influencers` cuando roster vacío: "Ir a mis campañas".
- Búsqueda en catálogo global **pendiente de decisión de privacidad**.

---

## Plan limits (gating interno)

Sin Stripe ni Transbank aún. Límites gateados por plan efectivo (`resolveBrandPlan`):

| Plan | Campañas activas | Influencers en roster | Campañas abiertas |
|------|------------------|-----------------------|-------------------|
| Basic | 1 | 3 | ❌ |
| Growth | 5 | 25 | ❌ |
| Pro | ilimitadas | ilimitados | ✅ |

Fuente de verdad: `src/lib/plan-limits.ts` → `resolveBrandPlan()` → `organizations.subscription_plan` (fallback) o `subscriptions` table (activa/trialing).

---

## Checklist antes de modificar settings de marca

```
[ ] Auditar rutas en brand-settings/layout.tsx — confirmar que cada tab tiene su componente correcto
[ ] Confirmar AppSidebar apunta a /brand-settings/profile (no a /brand-profile)
[ ] Confirmar que cada tab renderiza SOLO su sección
[ ] "Usuarios con acceso" solo en BrandMembersSection / brand-settings/users
[ ] Plan solo en BrandPlanSettings / brand-settings/plan
[ ] No mezclar Billing operativo con suscripción SaaS
[ ] No tocar DB sin migración revisada
[ ] No tocar trigger / backfill / orgs / auth
[ ] No tocar Stripe / Transbank hasta fase habilitada
[ ] Typecheck (tsc --noEmit)
[ ] Mostrar diff antes de commit
```

---

## Verificación rápida en terminal

```bash
cd "/Users/priscillaperez/Claude/Projects/APP SCENCE/scence-app-clean"

# Sidebar apunta a settings, no a /brand-profile
grep -n "brand-profile\|brand-settings/profile" src/components/layout/AppSidebar.tsx

# Tabs correctos
grep -n "href" 'src/app/(brand)/brand-settings/layout.tsx'

# Usuarios con acceso solo donde corresponde
grep -Rn "Usuarios con acceso" 'src/app/(brand)' src/components/brand
```

**Resultado esperado:**
- `brand-profile` NO aparece en AppSidebar
- `brand-settings/profile` SÍ aparece en AppSidebar con `startsWith('/brand-settings')`
- "Usuarios con acceso" solo en `BrandMembersSection` y `brand-settings/users`

---

*Última actualización: 2026-07-02*
