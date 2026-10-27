import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickAdminInfluencerColumns,
  pickInfluencerMetaPatch,
  sanitizeRateCards,
} from '../src/lib/influencers/writable-fields.ts'

test('la lista blanca excluye user_id, organization_id y metadata', () => {
  const result = pickAdminInfluencerColumns({
    display_name: 'Creadora',
    user_id: 'otro-usuario',
    organization_id: 'otra-org',
    metadata: { manual_pro: true },
    is_active: true,
  })

  assert.deepEqual(result, {
    display_name: 'Creadora',
    is_active: true,
  })
})

test('manual_pro no se puede modificar mediante el parche de metadata', () => {
  const result = pickInfluencerMetaPatch({
    first_name: 'Ana',
    manual_pro: true,
  })

  assert.deepEqual(result, {
    ok: true,
    patch: { first_name: 'Ana' },
  })
})

test('rechaza estados de influencer no permitidos', () => {
  const result = pickInfluencerMetaPatch({ status: 'super_admin' })

  assert.equal(result.ok, false)
})

test('rechaza tarifas con importes negativos o tipos vacíos', () => {
  assert.equal(
    sanitizeRateCards([{ service_type: 'Reel', base_rate: -1 }]).ok,
    false,
  )
  assert.equal(
    sanitizeRateCards([{ service_type: '  ', base_rate: 100 }]).ok,
    false,
  )
})

test('normaliza el formato de tarifas sin aceptar columnas adicionales', () => {
  const result = sanitizeRateCards([
    {
      service_type: ' Reel ',
      base_rate: 100000,
      currency: 'CLP',
      notes: 'Campaña',
      influencer_id: 'otro-id',
    },
  ])

  assert.deepEqual(result, {
    ok: true,
    rows: [{
      deliverable_type: 'Reel',
      base_rate: 100000,
      currency: 'CLP',
      notes: 'Campaña',
    }],
  })
})

test('rechaza notas excesivamente largas', () => {
  const result = sanitizeRateCards([{
    service_type: 'Reel',
    base_rate: 100,
    notes: 'x'.repeat(501),
  }])

  assert.equal(result.ok, false)
})
