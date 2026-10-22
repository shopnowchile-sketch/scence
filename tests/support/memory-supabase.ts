// Base de datos EN MEMORIA con la parte del cliente de Supabase que usan las pruebas del CRM.
// Cada consulta se ejecuta de forma SÍNCRONA al esperarla (como una sentencia atómica de Postgres con
// lock de fila), por lo que Promise.all sobre varias llamadas ejercita de verdad la exclusión mutua.
// NO es Supabase: no valida tipos ni restricciones. Sin red, sin credenciales.

export type Row = Record<string, any>
export type Db = Record<string, Row[]>

export function getPath(row: Row, col: string): unknown {
  const [base, key] = col.split('->>')
  return key ? row[base]?.[key] : row[base]
}

export type MemoryOptions = {
  /** Las inserciones en esta tabla fallan. */
  failInsertOn?: string
  /** Las lecturas (select) de esta tabla fallan. */
  failSelectOn?: string
  /** Las actualizaciones de esta tabla fallan. */
  failUpdateOn?: string
  /** Los borrados (delete) en esta tabla fallan. */
  failDeleteOn?: string
  /** Asigna `id` incremental ('mem-1', 'mem-2'…) a las filas insertadas sin `id`. Opt-in: por defecto no se agrega nada. */
  autoId?: boolean
}

export function makeAdmin(db: Db, opts: MemoryOptions = {}) {
  let idSeq = 0
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let onConflict: string[] = []
    let payload: any
    let wantRows = false
    let head = false
    let count = false
    const builder: any = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) { wantRows = true; head = Boolean(o?.head); count = Boolean(o?.count); return builder },
      insert(p: any) { op = 'insert'; payload = p; return builder },
      update(p: any) { op = 'update'; payload = p; return builder },
      upsert(p: any, o?: { onConflict?: string }) { op = 'upsert'; payload = p; onConflict = (o?.onConflict ?? 'id').split(','); return builder },
      delete() { op = 'delete'; return builder },
      eq(c: string, v: unknown) { filters.push(r => getPath(r, c) === v); return builder },
      is(c: string, v: unknown) { filters.push(r => (getPath(r, c) ?? null) === v); return builder },
      not(c: string, kind: string, v: unknown) {
        if (kind === 'is') filters.push(r => (getPath(r, c) ?? null) !== v)
        return builder
      },
      in(c: string, arr: unknown[]) { filters.push(r => arr.includes(getPath(r, c))); return builder },
      gte(c: string, v: string) { filters.push(r => getPath(r, c) != null && String(getPath(r, c)) >= v); return builder },
      lt(c: string, v: string) { filters.push(r => getPath(r, c) != null && String(getPath(r, c)) < v); return builder },
      lte(c: string, v: string) { filters.push(r => getPath(r, c) != null && String(getPath(r, c)) <= v); return builder },
      neq(c: string, v: unknown) { filters.push(r => getPath(r, c) != null && getPath(r, c) !== v); return builder },
      ilike(c: string, pattern: string) {
        const needle = pattern.replace(/%/g, '').toLowerCase()
        filters.push(r => String(getPath(r, c) ?? '').toLowerCase().includes(needle)); return builder
      },
      range() { return builder },
      filter(c: string, _op: string, v: unknown) { filters.push(r => getPath(r, c) === v); return builder },
      limit() { return builder },
      order() { return builder },
      or(expr: string) {
        const conds = expr.split(',').map(part => {
          const [col, kind, ...rest] = part.split('.')
          const val = rest.join('.')
          return (r: Row) => kind === 'is' ? (r[col] ?? null) === null : r[col] != null && String(r[col]) < val
        })
        filters.push(r => conds.some(c => c(r)))
        return builder
      },
      then(resolve: (v: unknown) => void) { resolve(exec()) },
      maybeSingle() { const r: any = exec(); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }) },
      single() { const r: any = exec(); const first = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve(first ? { ...r, data: first } : { data: null, error: { message: 'no rows' } }) },
    }
    // Todo el cuerpo es síncrono: equivale a una sentencia atómica.
    function exec(): { data: unknown; error: { message: string } | null; count?: number } {
      const rows = db[table] ?? (db[table] = [])
      if (op === 'insert') {
        if (opts.failInsertOn === table) return { data: null, error: { message: `insert fallido en ${table}` } }
        const inserted = ([] as Row[]).concat(payload).map((p: Row) => ({ ...p }))
        if (opts.autoId) inserted.forEach(r => { if (r.id === undefined) r.id = `mem-${++idSeq}` })
        rows.push(...inserted)
        // Con `.select()` encadenado (insert(...).select().single()) devuelve las filas, como PostgREST.
        return { data: wantRows ? inserted.map(r => ({ ...r })) : null, error: null }
      }
      if (op === 'upsert') {
        if (opts.failInsertOn === table) return { data: null, error: { message: `upsert fallido en ${table}` } }
        const out: Row[] = []
        for (const p of ([] as Row[]).concat(payload)) {
          const existing = rows.find(r => onConflict.every(c => r[c] === p[c]))
          if (existing) { Object.assign(existing, p); out.push({ ...existing }) }
          else { const row = { ...p }; if (opts.autoId && row.id === undefined) row.id = `mem-${++idSeq}`; rows.push(row); out.push({ ...row }) }
        }
        return { data: wantRows ? out : null, error: null }
      }
      if (op === 'delete') {
        if (opts.failDeleteOn === table) return { data: null, error: { message: `delete fallido en ${table}` } }
        const removed = rows.filter(r => filters.every(f => f(r)))
        const keep = rows.filter(r => !filters.every(f => f(r)))
        rows.splice(0, rows.length, ...keep)
        // Con `.select()` encadenado devuelve las filas borradas, como PostgREST.
        return { data: wantRows ? removed.map(r => ({ ...r })) : null, error: null }
      }
      if (op === 'update') {
        if (opts.failUpdateOn === table) return { data: null, error: { message: `update fallido en ${table}` } }
        const matched = rows.filter(r => filters.every(f => f(r)))
        matched.forEach(r => Object.assign(r, payload))
        return { data: wantRows ? matched.map(r => ({ ...r })) : null, error: null }
      }
      if (opts.failSelectOn === table) return { data: null, error: { message: `select fallido en ${table}` } }
      const matched = rows.filter(r => filters.every(f => f(r)))
      if (head) return { data: null, error: null, count: matched.length }
      return { data: matched.map(r => ({ ...r })), error: null, ...(count ? { count: matched.length } : {}) }
    }
    return builder
  }
  return { from } as any
}
