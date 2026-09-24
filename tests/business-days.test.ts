// Días hábiles de Chile (fuente única: src/lib/business-days.ts).
//   node --test tests/business-days.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHILE_HOLIDAYS,
  HolidayCalendarRangeError,
  addBusinessDays,
  addCalendarDays,
  businessDaysDeadline,
  calendarDaysDeadline,
  endOfDaySantiago,
  isBusinessDay,
  toSantiagoDate,
} from '../src/lib/business-days.ts'

describe('calendario de feriados', () => {
  test('cubre 2026 y 2027 con 16 feriados nacionales cada año', () => {
    assert.equal(CHILE_HOLIDAYS[2026].length, 16)
    assert.equal(CHILE_HOLIDAYS[2027].length, 16)
  })
  test('fechas trasladadas por ley en 2027', () => {
    assert.ok(CHILE_HOLIDAYS[2027].includes('2027-06-28')) // San Pedro y San Pablo
    assert.ok(CHILE_HOLIDAYS[2027].includes('2027-10-11')) // Encuentro de Dos Mundos
    assert.ok(!CHILE_HOLIDAYS[2027].includes('2027-10-12'))
  })
  test('no incluye el feriado bancario del 31-dic ni feriados regionales', () => {
    assert.ok(!CHILE_HOLIDAYS[2026].includes('2026-12-31'))
    assert.ok(!CHILE_HOLIDAYS[2026].includes('2026-06-07'))
  })
})

describe('isBusinessDay', () => {
  test('fin de semana y feriados no son hábiles', () => {
    assert.equal(isBusinessDay('2026-10-03'), false) // sábado
    assert.equal(isBusinessDay('2026-10-04'), false) // domingo
    assert.equal(isBusinessDay('2026-10-12'), false) // lunes feriado
    assert.equal(isBusinessDay('2026-09-18'), false)
  })
  test('día laboral normal es hábil', () => {
    assert.equal(isBusinessDay('2026-10-13'), true)
  })
  test('falla cerrado fuera del calendario (incluso en fin de semana)', () => {
    assert.throws(() => isBusinessDay('2028-03-01'), HolidayCalendarRangeError)
    assert.throws(() => isBusinessDay('2028-03-04'), HolidayCalendarRangeError)
    assert.throws(() => addBusinessDays('2027-12-30', 3), HolidayCalendarRangeError)
  })
  test('rechaza fechas inválidas', () => {
    assert.throws(() => isBusinessDay('2026-02-30'))
    assert.throws(() => isBusinessDay('14/11/2026'))
  })
})

describe('addBusinessDays', () => {
  test('el día de partida no cuenta: viernes + 3 = miércoles', () => {
    assert.equal(addBusinessDays('2026-10-02', 3), '2026-10-07')
  })
  test('salta feriado en lunes (12-oct-2026)', () => {
    assert.equal(addBusinessDays('2026-10-09', 1), '2026-10-13')
  })
  test('salta Fiestas Patrias', () => {
    assert.equal(addBusinessDays('2026-09-16', 3), '2026-09-22') // jue 17, lun 21, mar 22
  })
  test('cruza fin de año', () => {
    assert.equal(addBusinessDays('2026-12-30', 3), '2027-01-05') // jue 31, lun 4, mar 5
  })
  test('desde un sábado (fin del evento del golden case)', () => {
    assert.equal(addBusinessDays('2026-11-14', 3), '2026-11-18')
  })
  test('rechaza cantidades no válidas', () => {
    assert.throws(() => addBusinessDays('2026-10-02', 0))
    assert.throws(() => addBusinessDays('2026-10-02', 1.5))
  })
})

describe('días corridos y zona horaria', () => {
  test('addCalendarDays cruza meses', () => {
    assert.equal(addCalendarDays('2026-09-28', 7), '2026-10-05')
  })
  test('endOfDaySantiago en horario de verano (UTC-3)', () => {
    assert.equal(endOfDaySantiago('2026-10-01').toISOString(), '2026-10-02T02:59:59.999Z')
  })
  test('endOfDaySantiago en horario de invierno (UTC-4)', () => {
    assert.equal(endOfDaySantiago('2026-07-01').toISOString(), '2026-07-02T03:59:59.999Z')
  })
  test('toSantiagoDate usa el día local, no el UTC', () => {
    assert.equal(toSantiagoDate('2026-10-02T02:30:00Z'), '2026-10-01')
  })
})

describe('reglas de la propuesta (golden case: emisión lun 28-sep-2026 10:00)', () => {
  const issuedAt = new Date('2026-09-28T13:00:00Z')
  test('vigencia: 7 días corridos → lun 05-oct 23:59:59 Santiago', () => {
    assert.equal(calendarDaysDeadline(issuedAt, 7).toISOString(), '2026-10-06T02:59:59.999Z')
  })
  test('aceptación: 3 días hábiles → jue 01-oct 23:59:59 Santiago', () => {
    assert.equal(businessDaysDeadline(issuedAt, 3).toISOString(), '2026-10-02T02:59:59.999Z')
  })
  test('primer pago: 3 hábiles desde envío del contrato (vie 02-oct) → mié 07-oct', () => {
    assert.equal(toSantiagoDate(businessDaysDeadline(new Date('2026-10-02T15:00:00Z'), 3)), '2026-10-07')
  })
  test('segundo pago: 3 hábiles tras el evento (sáb 14-nov) → mié 18-nov', () => {
    assert.equal(addBusinessDays('2026-11-14', 3), '2026-11-18')
  })
})
