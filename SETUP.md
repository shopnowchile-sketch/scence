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
