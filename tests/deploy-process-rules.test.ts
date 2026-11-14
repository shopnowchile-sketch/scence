// El proceso LOCAL → DEV (staging) → PROD (master) y la lógica única de asistencia deben seguir documentados.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const claude = readFileSync(fileURLToPath(new URL('../CLAUDE.md', import.meta.url)), 'utf8')

test('CLAUDE.md fija la ruta LOCAL → DEV (staging) → PROD (master) y prohíbe ramas nuevas', () => {
  assert.match(claude, /LOCAL → DEV \(`staging`\) → PROD \(`master`\)/)
  assert.match(claude, /Solo existen las ramas `staging` \(DEV\) y `master` \(PROD\)/)
  assert.match(claude, /Nunca crear ramas, worktrees ni infraestructura paralela/)
  assert.match(claude, /por merge revisado `staging` → `master`; sin commits directos ni ramas de trabajo/)
  assert.match(claude, /No se salta ninguna etapa/)
})

test('CLAUDE.md documenta la fuente única de asistencia y el Plan Pro pendiente', () => {
  assert.match(claude, /### 6\.8 Entregables y asistencia/)
  assert.match(claude, /La confirmación de la influencer no requiere aprobación/)
  assert.match(claude, /selecciona `attendance_response`/)
  assert.match(claude, /influencer-pro-commitment\.ts/)
})

test('el trigger de progress también reacciona a attendance_response (asistencia confirmada => 100)', () => {
  const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261029140000_progress_trigger_on_attendance_response.sql', import.meta.url)), 'utf8')
  assert.match(sql, /update of status, progress, attendance_response/)
})
