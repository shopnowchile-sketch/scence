# SCENCE App — Setup de Instalación

## 1. Reutilizar el proyecto existente

```bash
cd "/Users/priscillaperez/Claude/Projects/APP SCENCE/scence-app-clean"
node --version # Node 24, igual que CI
npm ci
```

No crear ramas, worktrees, proyectos Supabase ni infraestructura paralela. Antes de instalar, conservar cualquier trabajo local de dependencias.

## 2. Variables de entorno

Reutilizar `.env.local`, sin sobrescribirlo. Comprobar el destino de la URL y de las claves sin imprimir secretos: deben pertenecer a DEV `dexpvoubiklgotuukrml`. Mantener pagos en sandbox y servicios externos sin claves reales. No cargar `.env.local.respaldo-produccion`.

## 3. Base de datos

Usar DEV existente. No ejecutar un schema inicial ni aplicar migraciones automáticamente. El historial versionado está en `supabase/migrations/`; comprobar su aplicación real antes de cada cambio que dependa del esquema.

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

## 5. Pagos (PayPal)
PayPal es la única pasarela de pago (ver `CLAUDE.md` §16.5). Variables: `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_INFLUENCER_WEBHOOK_ID` y los IDs de plan `PAYPAL_BASIC_PLAN_ID`, `PAYPAL_GROWTH_PLAN_ID`, `PAYPAL_PRO_PLAN_ID`, `PAYPAL_INFLUENCER_PRO_PLAN_ID`. Webhook: `/api/paypal/webhook`. En local y Preview usar credenciales de prueba (`PAYPAL_ENV=sandbox`).

## 6. Levantar en desarrollo
```bash
npm run dev
# → http://localhost:3000
```

## 7. Entornos y despliegue
El proceso oficial es **LOCAL → DEV (`staging`) → PROD (`master`)**. Las reglas viven en `CLAUDE.md`, sección 18 («Ruta de despliegue obligatoria»); aquí solo queda el detalle operativo de cada entorno.

| Etapa | Dónde corre | Rama | Base de datos |
|---|---|---|---|
| LOCALHOST | `localhost:3000` (`npm run dev`) | repositorio existente, sin ramas nuevas | Si la prueba escribe datos, no producción: comprobar antes el ref de Supabase de `.env.local`, y de sus claves (DEV confirmado el 2026-10-29) |
| PREVIEW (DEV) | Vercel Preview, dirección fija `dev.scence.cl` | `staging` | Rama de Supabase `campaign-locations-test` (ref `dexpvoubiklgotuukrml`), separada de producción |
| PRODUCCIÓN | Vercel Production | `master` | Producción |

Reglas de variables de entorno en Vercel:
- Preview no comparte con Producción las variables de Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Las variables generales (sin rama) aplican solo a Producción; `staging` define las suyas por rama, con la base DEV. Una rama sin variables propias queda sin base y falla en vez de escribir en producción.
- Las claves de correo, pagos, mensajería y scraping existen en Producción; en Preview van vacías o en modo de prueba.
- Comprobar el destino de una base solo por el ref del proyecto; nunca imprimir ni pegar claves.

> Estado auditado al 2026-10-29 y pendientes de cierre: `CLAUDE.md`, sección 18 («Estado de la configuración»).

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

## Validación y pendientes

```bash
npm test
npx tsc --noEmit
npx next lint
npx next build
```

`npm test` descubre `tests/*.test.ts`: lógica pura, contratos estáticos y rutas con Supabase simulado. No ejecuta integración PostgreSQL ni prueba RLS real. El workflow `.github/workflows/recovery-validation.yml` es manual; `prebuild` ejecuta la suite, pero no rechaza TODO. No interpretar salida cero como ausencia de pendientes.

Integración CRM existente: `bash tests/integration/run-crm-integration.sh`, solo con credenciales DEV verificadas y datos sintéticos. Los scripts `scripts/test-*-local.mjs` requieren `embedded-postgres`/`pg`, ausentes del proyecto; no instalar infraestructura para esta auditoría.

Resultados y pendientes actuales: [resumen ejecutivo](docs/00-MASTER/RESUMEN-EJECUTIVO_v1.0_2026-10-19.md) y [roadmap](docs/IMPLEMENTATION_ROADMAP.md).
