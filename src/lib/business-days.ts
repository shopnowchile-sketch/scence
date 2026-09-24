// ── Días hábiles de Chile — FUENTE ÚNICA ──────────────────────────────────────
// Toda regla comercial expresada en "días hábiles" (aceptación de propuestas,
// vencimientos de pago de contratos de marca) se calcula SOLO con este
// archivo. No duplicar calendarios ni aritmética de fechas en rutas.
//
// Día hábil = lunes a viernes que no es feriado legal NACIONAL de Chile.
// Zona horaria de referencia: America/Santiago.
//
// Falla cerrado: si se pide un año que el calendario no cubre, lanza
// HolidayCalendarRangeError en vez de calcular sin feriados.
//
// Fuente: calendario oficial de feriados nacionales (Ley 19.668 traslados a
// lunes, Ley 20.299 Iglesias Evangélicas, Ley 21.357 Pueblos Indígenas),
// contrastado con cuentadias.cl el 2026-09-24. Se excluyen feriados solo
// regionales y el "feriado bancario" del 31 de diciembre (no es feriado legal
// general). Si se decreta un feriado nuevo (p. ej. elecciones), agregarlo aquí.

export const BUSINESS_TIME_ZONE = 'America/Santiago'

export const CHILE_HOLIDAYS: Readonly<Record<number, readonly string[]>> = {
  2026: [
    '2026-01-01', // Año Nuevo
    '2026-04-03', // Viernes Santo
    '2026-04-04', // Sábado Santo
    '2026-05-01', // Día del Trabajo
    '2026-05-21', // Glorias Navales
    '2026-06-21', // Día Nacional de los Pueblos Indígenas
    '2026-06-29', // San Pedro y San Pablo
    '2026-07-16', // Virgen del Carmen
    '2026-08-15', // Asunción de la Virgen
    '2026-09-18', // Independencia Nacional
    '2026-09-19', // Glorias del Ejército
    '2026-10-12', // Encuentro de Dos Mundos
    '2026-10-31', // Iglesias Evangélicas
    '2026-11-01', // Todos los Santos
    '2026-12-08', // Inmaculada Concepción
    '2026-12-25', // Navidad
  ],
  2027: [
    '2027-01-01', // Año Nuevo
    '2027-03-26', // Viernes Santo
    '2027-03-27', // Sábado Santo
    '2027-05-01', // Día del Trabajo
    '2027-05-21', // Glorias Navales
    '2027-06-21', // Día Nacional de los Pueblos Indígenas
    '2027-06-28', // San Pedro y San Pablo (trasladado)
    '2027-07-16', // Virgen del Carmen
    '2027-08-15', // Asunción de la Virgen
    '2027-09-18', // Independencia Nacional
    '2027-09-19', // Glorias del Ejército
    '2027-10-11', // Encuentro de Dos Mundos (trasladado)
    '2027-10-31', // Iglesias Evangélicas
    '2027-11-01', // Todos los Santos
    '2027-12-08', // Inmaculada Concepción
    '2027-12-25', // Navidad
  ],
}

export class HolidayCalendarRangeError extends Error {
  readonly year: number
  constructor(year: number) {
    super(`El calendario de feriados no cubre el año ${year}. Actualiza CHILE_HOLIDAYS en src/lib/business-days.ts.`)
    this.name = 'HolidayCalendarRangeError'
    this.year = year
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(isoDate: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(isoDate)
  if (!match) throw new Error(`Fecha inválida (se espera YYYY-MM-DD): ${isoDate}`)
  const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3])
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`Fecha inexistente: ${isoDate}`)
  }
  return { y, m, d }
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Suma días corridos a una fecha calendario 'YYYY-MM-DD'. */
export function addCalendarDays(isoDate: string, days: number): string {
  const { y, m, d } = parseIsoDate(isoDate)
  return formatIsoDate(new Date(Date.UTC(y, m - 1, d + days)))
}

export function isChileHoliday(isoDate: string): boolean {
  const { y } = parseIsoDate(isoDate)
  const list = CHILE_HOLIDAYS[y]
  if (!list) throw new HolidayCalendarRangeError(y)
  return list.includes(isoDate)
}

/** Lunes a viernes y no feriado nacional. Lanza si el año no está cubierto. */
export function isBusinessDay(isoDate: string): boolean {
  const { y, m, d } = parseIsoDate(isoDate)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (weekday === 0 || weekday === 6) {
    // Igual se valida el rango: un fin de semana fuera del calendario no
    // debe permitir "saltarse" la verificación de cobertura.
    if (!CHILE_HOLIDAYS[y]) throw new HolidayCalendarRangeError(y)
    return false
  }
  return !isChileHoliday(isoDate)
}

/**
 * N-ésimo día hábil POSTERIOR a `isoDate` (el día de partida no cuenta).
 * addBusinessDays('2026-10-02', 3) === '2026-10-07' (vie → mié).
 */
export function addBusinessDays(isoDate: string, businessDays: number): string {
  if (!Number.isInteger(businessDays) || businessDays < 1) {
    throw new Error('businessDays debe ser un entero ≥ 1')
  }
  let cursor = isoDate
  let counted = 0
  while (counted < businessDays) {
    cursor = addCalendarDays(cursor, 1)
    if (isBusinessDay(cursor)) counted += 1
  }
  return cursor
}

/** Fecha calendario en Santiago ('YYYY-MM-DD') de un instante. */
export function toSantiagoDate(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) throw new Error('Instante inválido')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Offset (ms) de Santiago respecto de UTC en un instante dado. */
function santiagoOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** Instante exacto de las 23:59:59.999 (hora de Santiago) de una fecha calendario. */
export function endOfDaySantiago(isoDate: string): Date {
  const { y, m, d } = parseIsoDate(isoDate)
  const wallClock = Date.UTC(y, m - 1, d, 23, 59, 59, 999)
  let utc = wallClock - santiagoOffsetMs(wallClock)
  // Segunda pasada: corrige si el cambio de horario cae entre ambos instantes.
  utc = wallClock - santiagoOffsetMs(utc)
  return new Date(utc)
}

/** Fin del día del N-ésimo día hábil posterior al día (Santiago) de `from`. */
export function businessDaysDeadline(from: Date | string, businessDays: number): Date {
  return endOfDaySantiago(addBusinessDays(toSantiagoDate(from), businessDays))
}

/** Fin del día del N-ésimo día corrido posterior al día (Santiago) de `from`. */
export function calendarDaysDeadline(from: Date | string, calendarDays: number): Date {
  return endOfDaySantiago(addCalendarDays(toSantiagoDate(from), calendarDays))
}
