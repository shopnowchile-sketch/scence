// Contenido por revisar: la tarjeta del dashboard lleva a una lista con aprobar/rechazar en la fila.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('la tarjeta del dashboard lleva a /admin-review y el middleware la trata como ruta de admin', () => {
  assert.match(read('src/app/(dashboard)/DashboardClient.tsx'), /title="Contenido por revisar"[^>]*href="\/admin-review"/)
  assert.match(read('src/middleware.ts'), /'\/admin-review'/)
})
test('la API usa el mismo criterio que el KPI (in_review, sin asistencia) y es solo Admin de plataforma', () => {
  const api = read('src/app/api/content-review/route.ts')
  assert.match(api, /eq\('status', 'in_review'\)/)
  assert.match(api, /neq\('type', 'event_attendance'\)/)
  assert.match(api, /isPlatformAdmin/)
  const dash = read('src/app/api/dashboard/route.ts')
  assert.match(dash, /in\('status', \['in_review'\]\)[\s\S]{0,80}neq\('type', 'event_attendance'\)/)
})
test('la página aprueba y rechaza con el PATCH existente (sin lógica paralela) y el rechazo lleva nota', () => {
  const page = read('src/app/(dashboard)/admin-review/page.tsx')
  assert.match(page, /\/api\/campaigns\/\$\{item\.campaign_id\}\/deliverables/)
  assert.match(page, /action: 'approve' \| 'reject'/)
  assert.match(page, /disabled=\{working \|\| !note\.trim\(\)\}/)
})
