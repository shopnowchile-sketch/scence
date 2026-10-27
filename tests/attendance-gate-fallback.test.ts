// El brief y los datos operativos exigen confirmar asistencia solo cuando la campaña tiene entregable de asistencia.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('las tres rutas conservan el acceso por aceptación cuando no hay entregable de asistencia', () => {
  assert.match(src('src/app/api/influencer/campaigns/[id]/route.ts'), /attendanceConfirmed = !attendance \|\| attendance\.attendance_response === 'confirmed'/)
  assert.match(src('src/lib/campaign-asset-access.ts'), /attendanceConfirmed = !attendance \|\| attendance\.attendance_response === 'confirmed'/)
  assert.match(src('src/app/api/influencer/my-campaigns/route.ts'), /attendanceItems\.length === 0 \|\| attendanceItems\.some/)
})

test('con asistencia pendiente la aceptación sola no abre el brief', () => {
  for (const p of ['src/app/api/influencer/campaigns/[id]/route.ts', 'src/lib/campaign-asset-access.ts']) {
    assert.match(src(p), /application_status === 'accepted'|isAccepted/)
  }
  assert.match(src('src/app/api/influencer/campaigns/[id]/route.ts'), /operationalAccess = isAccepted && attendanceConfirmed/)
})
