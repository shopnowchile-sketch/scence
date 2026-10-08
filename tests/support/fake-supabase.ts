// Cliente Supabase en memoria SOLO para tests: soporta el subconjunto de
// PostgREST que usan hardDelete / influencer-pro (select, in, eq, neq, is,
// maybeSingle, update, delete) y registra cada escritura.
type Row = Record<string, unknown>

function read(row: Row, column: string): unknown {
  const json = column.match(/^(\w+)->>(\w+)$/)
  if (json) {
    const value = (row[json[1]] as Record<string, unknown> | null | undefined)?.[json[2]]
    return value === undefined || value === null ? null : String(value)
  }
  return row[column] ?? null
}

export function createFakeSupabase(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: 'update' | 'delete' | 'insert'; ids: unknown[]; values?: Row }> = []
  function from(table: string) {
    const rows = () => (tables[table] ??= [])
    const filters: Array<(row: Row) => boolean> = []
    let op: 'select' | 'update' | 'delete' = 'select'
    let values: Row | undefined
    const builder = {
      select() { return builder },
      in(column: string, list: unknown[]) { filters.push(row => list.map(String).includes(String(read(row, column)))); return builder },
      eq(column: string, value: unknown) { filters.push(row => String(read(row, column)) === String(value)); return builder },
      neq(column: string, value: unknown) { filters.push(row => String(read(row, column)) !== String(value)); return builder },
      is(column: string, value: null) { filters.push(row => read(row, column) === value); return builder },
      order() { return builder },
      limit() { return builder },
      update(next: Row) { op = 'update'; values = next; return builder },
      delete() { op = 'delete'; return builder },
      run() {
        const matched = rows().filter(row => filters.every(filter => filter(row)))
        if (op === 'update') {
          matched.forEach(row => Object.assign(row, values))
          writes.push({ table, op, ids: matched.map(row => row.id), values })
        }
        if (op === 'delete') {
          tables[table] = rows().filter(row => !matched.includes(row))
          writes.push({ table, op, ids: matched.map(row => row.id ?? row.influencer_id) })
        }
        return { data: matched.map(row => ({ ...row })), error: null }
      },
      maybeSingle() { const result = builder.run(); return Promise.resolve({ data: result.data[0] ?? null, error: null }) },
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        try { return Promise.resolve(builder.run()).then(resolve, reject) } catch (error) { return Promise.reject(error).then(resolve, reject) }
      },
    }
    return builder
  }
  return { client: { from } as never, tables, writes }
}
