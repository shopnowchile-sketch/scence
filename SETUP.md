# SCENCE App — Setup de Instalación

## 1. Instalar dependencias
```bash
cd scence-app
npm install
```

## 2. Configurar variables de entorno
```bash
cp .env.local.example .env.local
# Edita .env.local con tus credenciales reales
```

## 3. Crear proyecto en Supabase
1. Ve a https://supabase.com → Nuevo proyecto
2. En SQL Editor, pega el contenido de `../schema.sql` y ejecuta
3. Copia `Project URL` y `anon key` al `.env.local`

## 4. Configurar Google Cloud
1. Ir a https://console.cloud.google.com
2. Crear proyecto → Habilitar APIs:
   - **Google Calendar API**
   - **Maps JavaScript API**
   - **Places API**
3. Crear **Service Account**:
   - IAM → Service Accounts → Crear
   - Descargar JSON de credenciales
   - Copiar `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - Copiar `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
4. Crear **API Key** para Maps (restringir a tu dominio)
   - Copiar a `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
5. Crear calendario en Google Calendar llamado "SCENCE Bookings"
   - Compartir con el email del Service Account (permiso: hacer cambios)
   - Copiar Calendar ID → `GOOGLE_CALENDAR_ID`

## 5. Configurar Stripe (billing SaaS)
1. https://dashboard.stripe.com → Obtener claves API
2. Crear webhook: `https://tudominio.com/api/webhooks/stripe`
3. Eventos: `invoice.paid`, `customer.subscription.*`

## 6. Levantar en desarrollo
```bash
npm run dev
# → http://localhost:3000
```

## 7. Entornos y despliegue
El proceso oficial es **LOCALHOST → PREVIEW → PRODUCCIÓN**. Las reglas viven en `CLAUDE.md`, sección 18 («Ruta de despliegue obligatoria»); aquí solo queda el detalle operativo de cada entorno.

| Etapa | Dónde corre | Rama | Base de datos |
|---|---|---|---|
| LOCALHOST | `localhost:3000` (`npm run dev`) | rama o worktree de trabajo | Si la prueba escribe datos, no producción: comprobar antes el ref de Supabase de `.env.local`, que en el proyecto principal apunta a producción |
| PREVIEW (DEV) | Vercel Preview, dirección fija `dev.scence.cl` | `staging` | Rama de Supabase `campaign-locations-test` (ref `dexpvoubiklgotuukrml`), separada de producción |
| PRODUCCIÓN | Vercel Production | `master` | Producción |

Reglas de variables de entorno en Vercel:
- Preview no comparte con Producción las variables de Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Las variables generales (sin rama) aplican solo a Producción; `staging` define las suyas por rama, con la base DEV. Una rama sin variables propias queda sin base y falla en vez de escribir en producción.
- Las claves de correo, pagos, mensajería y scraping existen en Producción; en Preview van vacías o en modo de prueba.
- Comprobar el destino de una base solo por el ref del proyecto; nunca imprimir ni pegar claves.

> Estado verificado al 2026-10-21 y pendientes de cierre: `CLAUDE.md`, sección 18 («Estado de la configuración»).

Migraciones: el mismo archivo de `supabase/migrations/` se aplica primero en la base DEV y, con autorización, en producción. Supabase las registra con la fecha de aplicación, así que la versión del historial puede diferir del prefijo del archivo; se identifican por nombre.

## Estructura de archivos clave

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx          ← Shell con sidebar (auth guard)
│   │   ├── influencers/
│   │   │   ├── page.tsx        ← Server component
│   │   │   └── InfluencersClient.tsx ← Client: grid/list + filtros
│   │   └── bookings/
│   │       ├── page.tsx
│   │       └── BookingsClient.tsx  ← Calendar + Google Cal
│   └── api/
│       └── bookings/route.ts   ← CRUD + Google Calendar sync
├── components/
│   ├── influencers/
│   │   ├── InfluencerCard.tsx  ← Vista grid
│   │   ├── InfluencerTable.tsx ← Vista lista con sort
│   │   └── InfluencerFilters.tsx ← Filtros completos
│   └── maps/
│       └── GoogleMap.tsx       ← Mapa + AddressWithMap
├── hooks/
│   └── useInfluencers.ts       ← Fetch + filtrado + sort client-side
├── lib/
│   ├── google-calendar.ts      ← Service Account Calendar API
│   ├── supabase/client.ts
│   └── supabase/server.ts
└── types/index.ts              ← Todos los tipos TypeScript
```

## Próximos módulos a implementar
- [ ] Dashboard con KPIs reales (query Supabase)
- [ ] Campaigns CRUD completo
- [ ] Billing + generación de PDF de invoices
- [ ] Payroll runs con aprobación
- [ ] Contratos con DocuSign
- [ ] Analytics con Recharts
- [ ] Perfil de influencer `/influencers/[id]` con mapa de dirección
