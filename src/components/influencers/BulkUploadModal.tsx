'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X, CheckCircle, AlertCircle, FileText, Download } from 'lucide-react'
import { toast } from 'sonner'
import type { BulkRow } from '@/app/api/influencers/bulk/route'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

interface UploadResult {
  created: number
  imported?: number
  skipped: number
  skippedByEmail?: number
  skippedByInstagramUrl?: number
  skippedNoInstagram?: number
  skippedEmpty?: number
  errors: Array<{ row: number; error: string }>
  total: number
}

// Columnas reconocidas por el backend
const KNOWN_COLUMNS = [
  'display_name', 'email', 'phone', 'city', 'country', 'bio', 'categories',
  'instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin',
  'instagram_url', 'tiktok_url',
]

// ── CSV parser (no deps) ──────────────────────────────────────────────────────
function parseCSV(text: string): { rows: BulkRow[]; headers: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], headers: [] }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))

  const rows = lines.slice(1).map(line => {
    // Handle quoted fields
    const values: string[] = []
    let cur = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    values.push(cur.trim())

    const row: BulkRow = {}
    headers.forEach((h, i) => { if (values[i] !== undefined) row[h] = values[i] })
    return row
  }).filter(r => Object.values(r).some(v => v))

  return { rows, headers }
}

// ── Template CSV ──────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = 'display_name,email,phone,city,country,bio,categories,instagram,tiktok,youtube,twitter,facebook,linkedin,instagram_url,tiktok_url'
const TEMPLATE_EXAMPLE = 'María García,maria@gmail.com,+56912345678,Santiago,CL,"Lifestyle & fashion creator","fashion,beauty",125000,89000,,12000,,,https://www.instagram.com/mariagarcia,https://www.tiktok.com/@mariagarcia'

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS}\n${TEMPLATE_EXAMPLE}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'influencers_template.csv'
  a.click()
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function BulkUploadModal({ onClose, onSuccess }: Props) {
  const [rows,    setRows]    = useState<BulkRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [requireInstagram, setRequireInstagram] = useState(true)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<UploadResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback((file: File) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed.rows)
      setHeaders(parsed.headers)
      setResult(null)
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  // Diagnóstico de columnas
  const missingRequired = !headers.includes('display_name') && !headers.includes('email')
  const hasInstagramCol = headers.includes('instagram_url')
  const unmappedHeaders = headers.filter(h => !KNOWN_COLUMNS.includes(h))

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  async function upload() {
    if (!rows.length) return
    setLoading(true)
    try {
      const res = await fetch('/api/influencers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, requireInstagram }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error en bulk upload')
      setResult(data)
      if (data.created > 0) {
        toast.success(`${data.created} importados · ${data.skipped} omitidos`)
        onSuccess()
      } else {
        toast.info(`0 importados · ${data.skipped} omitidos (duplicados)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Importar influencers</h2>
            <p className="text-sm text-gray-400 mt-0.5">CSV con deduplicación por email e instagram_url</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Template download */}
          <button onClick={downloadTemplate}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-violet-300 bg-violet-50 hover:bg-violet-100 transition-colors text-sm text-violet-700">
            <Download className="h-4 w-4 flex-shrink-0" />
            <span>Descargar plantilla CSV</span>
          </button>

          {/* Drop zone */}
          {!result && (
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={`w-full p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center ${
                dragOver ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300 hover:bg-gray-50'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f) }}
              />
              {fileName ? (
                <div className="flex items-center justify-center gap-3 text-sm text-gray-700">
                  <FileText className="h-5 w-5 text-violet-600" />
                  <span className="font-medium">{fileName}</span>
                  <span className="text-gray-400">— {rows.length} filas</span>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-600">Arrastra tu CSV aquí</p>
                  <p className="text-xs text-gray-400 mt-1">o click para seleccionar</p>
                </div>
              )}
            </div>
          )}

          {/* Mapeo de columnas detectadas */}
          {headers.length > 0 && !result && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Columnas detectadas ({headers.length})
              </div>
              <div className="p-4 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {headers.map(h => (
                    <span key={h} className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      KNOWN_COLUMNS.includes(h) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {h}{!KNOWN_COLUMNS.includes(h) && ' (ignorada)'}
                    </span>
                  ))}
                </div>
                {missingRequired && (
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    Falta columna obligatoria: <strong>display_name</strong> o <strong>email</strong>
                  </div>
                )}
                {!hasInstagramCol && (
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    No se detectó <strong>instagram_url</strong> (identificador principal recomendado)
                  </div>
                )}
                {unmappedHeaders.length > 0 && (
                  <p className="text-[11px] text-gray-400">
                    {unmappedHeaders.length} columna(s) no reconocida(s) serán ignoradas.
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-gray-600 pt-1 cursor-pointer">
                  <input type="checkbox" checked={requireInstagram}
                    onChange={e => setRequireInstagram(e.target.checked)}
                    className="rounded border-gray-300 text-violet-600" />
                  Omitir filas sin instagram_url
                </label>
              </div>
            </div>
          )}

          {/* Data preview table */}
          {rows.length > 0 && !result && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Vista previa — {rows.length} fila{rows.length !== 1 ? 's' : ''} detectadas
                </span>
                <span className="text-[11px] text-gray-400">Primeras 10 mostradas</span>
              </div>
              <div className="overflow-x-auto max-h-52">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      {headers.filter(h => KNOWN_COLUMNS.includes(h)).map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap border-b border-gray-100">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        {headers.filter(h => KNOWN_COLUMNS.includes(h)).map(h => (
                          <td key={h} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[160px] truncate">
                            {r[h] ? String(r[h]) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 && (
                <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 bg-gray-50">
                  +{rows.length - 10} filas más no mostradas
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Resultado
              </div>
              <div className="p-4 grid grid-cols-3 gap-3">
                {[
                  { label: 'Importados',  value: result.created, color: 'text-emerald-600' },
                  { label: 'Omitidos',    value: result.skipped, color: 'text-gray-400' },
                  { label: 'Total filas', value: result.total,   color: 'text-gray-700' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-gray-400">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Desglose de omitidos */}
              <div className="border-t border-gray-100 p-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">Email duplicado</span><span className="font-semibold text-gray-700">{result.skippedByEmail ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Instagram duplicado</span><span className="font-semibold text-gray-700">{result.skippedByInstagramUrl ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Sin Instagram</span><span className="font-semibold text-gray-700">{result.skippedNoInstagram ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Filas vacías</span><span className="font-semibold text-gray-700">{result.skippedEmpty ?? 0}</span></div>
              </div>
              {result.errors.length > 0 && (
                <div className="border-t border-gray-100 p-4 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map(e => (
                    <div key={e.row} className="flex items-center gap-2 text-xs text-red-500">
                      <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      Fila {e.row}: {e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between gap-3 p-6 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              onClick={upload}
              disabled={loading || rows.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              {loading ? 'Importando…' : `✓ Aprobar e importar ${rows.length} influencers`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
