# Diagnóstico: qué necesita realmente `influencers.organization_id` (2026-10-22)

Modelo: organización técnica = una marca; SCENCE administra; Scence SpA es una marca de prueba sin privilegios. Estado: **solo diagnóstico y propuesta; nada aplicado** (ni migración ni datos).
Fuentes: esquema de la rama de pruebas `dexpvoubiklgotuukrml` (solo lectura) y código local. **Producción no consultada** (ver `CONSULTA_prod_fichas_sin_organizacion_2026-10-22.sql`).

## 1. Hechos (esquema)
- `influencers.organization_id`: nullable, FK a `organizations`, índice `idx_influencers_org`.
- Tablas con `organization_id` **NOT NULL** ligadas a una influencer (`influencer_id`): `subscriptions` (+ `subscription_payments`), `affiliate_links`, `affiliate_conversions`, `commission_settlements`, `bookings`, `contracts`, `barters`, `brand_influencers`; además `tickets`, `campaigns` (campaña propia), `invoices`, `payments`.
- Rama de pruebas: 152 fichas, 0 sin organización; 150 en «Scence SpA», 1 en «SCENCE (prueba)», 1 en «SCENCE SPA» (tres organizaciones **sin ninguna marca**; dos se llaman igual salvo mayúsculas). Los `super_admin` de esa rama pertenecen a otras dos organizaciones; 151 de 152 fichas están en organizaciones sin `super_admin`. Casi no hay filas comerciales (1 booking, 1 campaña-influencer): **la rama no sirve para inferir producción**.
- Ninguna fila comercial de influencers tiene organización distinta de la de su ficha (0 discrepancias medibles; casi sin datos).

## 2. Hechos (código): quién depende del dato
| Flujo | Uso | Con `NULL` |
|---|---|---|
| Checkout Pro `influencer/paypal/checkout`, `complete`, `paypal/webhook` | `subscriptions.organization_id = influencer.organization_id` | 409 / 403 / se descarta el evento |
| Enlace de afiliado `influencer/affiliate` | `affiliate_links.organization_id` (NOT NULL) | falla |
| Campaña propia `influencer/my-campaigns` | `campaigns.organization_id` | 400 |
| Ticket de soporte `api/support` | `tickets.organization_id` (NOT NULL), usa la de la ficha | falla |
| Ficha en admin `GET influencers/[id]`; documentos y términos (`admin/influencer-documents`, `admin/influencer-terms/.../pdf`) | compara `influencer.organization_id` con la organización del admin | 400 / 404 |
| Listados de admin de afiliados, liquidaciones, eventos, tickets | filtran por la organización **del admin** | solo ve filas cuya organización coincide con la suya |
| Marca ↔ influencer (`brand/influencers`) | `brand_influencers.organization_id = organización de la MARCA`; no depende de la organización de la ficha | sin efecto |

Conclusión: la organización de una influencer es su **inquilino comercial** (a quién pertenecen sus suscripciones, enlaces, tickets, etc.). No es "su marca", y `NULL` rompe seis flujos.

## 3. Por qué NO las alternativas obvias
- **`NULL` definitivo**: rompe Pro, afiliados, tickets, campañas propias y la ficha de admin (tabla anterior).
- **La marca que la registró**: mezcla datos comerciales de la influencer con los de esa marca (tickets, pagos, afiliados, `bookings` filtran por organización: los miembros de la marca los verían); la marca puede borrarse/suspenderse arrastrando a la influencer; y registrar no debe conceder acceso (CLAUDE.md §16.9).
- **Una organización por influencer**: aislamiento perfecto pero crea una organización por cada alta (el patrón que causó ~60 organizaciones huérfanas en B-18) y obliga a reescribir los ~10 puntos que comparan "organización del admin = organización de la ficha".
- **Organización de plataforma independiente / variable `SCENCE_PLATFORM_ORG_ID` / por nombre / por antigüedad**: descartadas por el modelo.

## 4. Propuesta (no aplicada): contenedor comercial designado explícitamente
Archivo: `PROPUESTA_handle_new_user_sin_scence_spa_2026-10-22.sql` (v2).
1. Columna `organizations.influencer_tenant boolean not null default false` + índice único parcial (como máximo **una**). No cambia ninguna fila.
2. Disparador que impide alojar **marcas** en la organización designada: sigue siendo solo un contenedor, no una marca ni un privilegio. Los permisos continúan saliendo de `organization_members`.
3. `handle_new_user`: ficha previa conserva su organización (si era NULL recibe la designada); autorregistro recibe la designada; **si no hay ninguna designada, queda NULL y el registro NO aborta** (falla segura). Sin nombre, sin antigüedad, sin variable de entorno.
4. La designación la hace la fundadora con una sentencia auditada y un `id` elegido (comentada en el archivo). Puede ser cualquier organización sin marcas.
Probado en Postgres local (13 casos): sin designada → NULL sin error aunque existan homónimas; con designada → se asigna esa; ficha previa conserva la suya; dos designadas imposible; la designada no admite marcas; marcas normales siguen; sin organizaciones nuevas.

### Consecuencias
- **Influencers existentes**: sin cambios (ni organización ni datos). Siguen en lo que tengan hoy; si son NULL (producción: por medir) siguen NULL hasta que decidas un relleno **aparte y con lista de ids** (no incluido).
- **Influencers nuevas**: tras designar el contenedor, reciben ese `organization_id`; Pro, afiliados y tickets funcionan como hoy. Antes de designar: quedan NULL y esos flujos devuelven su error actual (409/400), sin pérdida de datos.
- **Admin**: ve filas comerciales solo si su organización coincide con la del contenedor (comportamiento actual). Para desacoplar al admin de la membresía en el contenedor hay que cambiar las ~5 comparaciones por `isPlatformAdmin` (cambio de código pequeño; decidir tras medir `fichas_en_org_con_super_admin`).
- **Largo plazo (alternativa E, no ahora)**: guardar la propiedad en `influencer_id` y permitir `organization_id` NULL en registros propios de influencers; el admin accede por rol de plataforma. Es la solución más limpia pero toca ~10 tablas y los flujos PayPal.

## 5. Decisiones que necesito de ti
1. ¿Apruebas el diseño "contenedor designado" (v2) como solución intermedia? Si no, ¿prefieres la alternativa E?
2. ¿Qué organización designar? Debe tener **0 marcas**. Sugerencia: la que hoy ya aloja casi todas las fichas, elegida por ti con su id (no por nombre).
3. ¿Autorizas ejecutar la consulta de solo lectura en producción (`CONSULTA_prod_fichas_sin_organizacion_2026-10-22.sql`, solo conteos)?
4. ¿Cambiamos las comparaciones admin→organización por `isPlatformAdmin` (tras la medición)?
