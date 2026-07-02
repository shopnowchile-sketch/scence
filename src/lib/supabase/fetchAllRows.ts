// Supabase/PostgREST tiene un límite máximo de filas por request a nivel de
// proyecto (Settings → API → Max Rows, por defecto 1000). Un `.limit(5000)` en
// el cliente NO lo evita: el servidor igual recorta la respuesta a 1000 filas.
// Esto causó que Ranking y Dashboard mostraran "1000" en vez del total real
// (ej. 1452 influencers) aun después de subir el `.limit()` del lado cliente.
//
// Esta función pagina con `.range()` hasta traer todas las filas (con un tope
// de seguridad `maxRows`), para queries que necesitan el dataset completo
// (ranking, exports). NO usar para listas paginadas normales de UI — esas ya
// usan `.range()` con paginación real página a página.
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<{ data: T[]; error: unknown }> {
  const pageSize = opts.pageSize ?? 1000
  const maxRows = opts.maxRows ?? 10000
  const all: T[] = []
  let from = 0

  while (all.length < maxRows) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) return { data: all, error }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break // última página
    from += pageSize
  }

  return { data: all, error: null }
}
