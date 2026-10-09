'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowUpRight, Building2, Calendar, Info, Loader2, Mail, MoreHorizontal, Phone, Plus, Search, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SortableTH } from '@/components/ui/SortableTH'
import {
  COLLAB_STATUSES,
  COLLAB_STATUS_LABEL,
  COLLAB_TYPES,
  COLLAB_TYPE_LABEL,
  type CollabStatus,
  type CampaignPlan,
  type CollaborationRow,
} from '@/lib/campaign-collaborations-shared'
import {
  useAddCollaboration,
  useCampaignCollaborations,
  useCampaignContracts,
  useContractContent,
  type ContractSummary,
  useCollaborationCandidates,
  useCollaborationHistory,
  useRemoveCollaboration,
  usePlanActions,
  useUpdateCollaboration,
  type CollaborationOwner,
} from '@/hooks/useCampaignCollaborations'

const STATUS_STYLE: Record<CollabStatus, { badge: string; dot: string }> = {
  to_contact: { badge: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
  contacted: { badge: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  negotiating: { badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  confirmed: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  declined: { badge: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
}

// Etiquetas de los contadores (plural, como en el diseño); los badges usan COLLAB_STATUS_LABEL.
const COUNTER_LABEL: Record<CollabStatus, string> = {
  to_contact: 'Por contactar',
  contacted: 'Contactadas',
  negotiating: 'En negociación',
  confirmed: 'Confirmadas',
  declined: 'No participa',
}

const PLAN_STYLE: Record<string, string> = {
  bronze: 'bg-orange-50 text-orange-800 ring-orange-200',
  gold: 'bg-yellow-50 text-yellow-800 ring-yellow-300',
  naming: 'bg-violet-50 text-violet-700 ring-violet-200',
}

const money = (value: number | null) => value == null ? '' : `$${Math.round(value).toLocaleString('es-CL')}`

function PlanBadge({ name }: { name: string | null }) {
  if (!name) return null
  const style = PLAN_STYLE[name.trim().toLowerCase()] ?? 'bg-gray-100 text-gray-700 ring-gray-200'
  return <span className={cn('inline-flex max-w-[110px] items-center truncate rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1', style)}>{name}</span>
}

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40'

/** Las fechas `date` llegan como YYYY-MM-DD: se arman en local para no correr el día por zona horaria. */
function formatDate(value: string | null) {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return '—'
  return new Date(y, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Todo lo que el usuario ve (y un poco más) en una fila: la búsqueda encuentra cualquier dato. */
function searchText(row: CollaborationRow) {
  const [y, m, d] = (row.follow_up_date ?? '').split('-').map(Number)
  return normalize([
    row.name, row.contact_name, row.contact_position, row.contact_email, row.contact_phone, row.instagram, row.industry,
    COLLAB_STATUS_LABEL[row.status], row.collaboration_type ? COLLAB_TYPE_LABEL[row.collaboration_type] : '',
    row.plan_name, row.plan_amount != null ? String(Math.round(row.plan_amount)) : '',
    row.contribution_detail, row.quantity != null ? String(row.quantity) : '', row.next_step,
    row.follow_up_date, y ? `${d} ${MONTHS_ES[m - 1]} ${y}` : '', row.owner_name,
  ].filter(Boolean).join(' '))
}

type SortCol = 'name' | 'contact' | 'status' | 'plan' | 'type' | 'detail' | 'next' | 'date' | 'owner'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
}

function StatusBadge({ status }: { status: CollabStatus }) {
  return <span className={cn('badge', STATUS_STYLE[status].badge)}>{COLLAB_STATUS_LABEL[status]}</span>
}

function BrandAvatar({ row, size = 'sm' }: { row: Pick<CollaborationRow, 'name' | 'logo_url'>; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-14 w-14 text-base' : 'h-8 w-8 text-[11px]'
  // eslint-disable-next-line @next/next/no-img-element
  if (row.logo_url) return <img src={row.logo_url} alt="" className={cn(dims, 'rounded-full border border-gray-200 object-cover')} />
  return <span aria-hidden className={cn(dims, 'flex flex-shrink-0 items-center justify-center rounded-full bg-violet-50 font-semibold text-violet-700')}>{initials(row.name)}</span>
}

function profileHref(row: CollaborationRow) {
  if (row.lead_id) return `/admin-crm/${row.lead_id}`
  if (row.brand_id) return `/admin-brands/${row.brand_id}`
  return null
}

export function CollaboratingBrandsTab({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { data, isPending: isLoading, isError, error, refetch } = useCampaignCollaborations(campaignId)
  const rows = useMemo(() => data?.data ?? [], [data])
  const owners = useMemo(() => data?.owners ?? [], [data])
  const plans = useMemo(() => data?.plans ?? [], [data])
  const [plansOpen, setPlansOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortCol | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const remove = useRemoveCollaboration(campaignId)

  // Un solo filtro: la barra de búsqueda (todas las palabras deben aparecer en algún dato de la fila).
  // Los contadores reflejan los resultados de la búsqueda.
  const searched = useMemo(() => {
    const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter(row => { const text = searchText(row); return terms.every(t => text.includes(t)) })
  }, [rows, query])

  const counts = useMemo(() => {
    const result = Object.fromEntries(COLLAB_STATUSES.map(s => [s, 0])) as Record<CollabStatus, number>
    searched.forEach(row => { result[row.status] += 1 })
    return result
  }, [searched])

  const visible = useMemo(() => {
    if (!sortBy) return searched
    const planOrder = new Map(plans.map((p, i) => [p.id, i]))
    const text = (v: string | null | undefined) => (v ?? '').trim()
    const key = (row: CollaborationRow): string | number | null => {
      switch (sortBy) {
        case 'name': return text(row.name)
        case 'contact': return text(row.contact_name) || null
        case 'status': return COLLAB_STATUSES.indexOf(row.status)
        case 'plan': return row.plan_id ? planOrder.get(row.plan_id) ?? 999 : null
        case 'type': return row.collaboration_type ? COLLAB_TYPE_LABEL[row.collaboration_type] : null
        case 'detail': return text(row.contribution_detail) || null
        case 'next': return text(row.next_step) || null
        case 'date': return row.follow_up_date
        case 'owner': return text(row.owner_name) || null
      }
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...searched].sort((a, b) => {
      const ka = key(a), kb = key(b)
      if (ka === null && kb === null) return 0
      if (ka === null) return 1          // los vacíos siempre al final
      if (kb === null) return -1
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'es', { sensitivity: 'base', numeric: true })
      return cmp * dir
    })
  }, [searched, sortBy, sortDir, plans])

  function toggleSort(col: SortCol) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const selected = rows.find(row => row.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !rows.some(row => row.id === selectedId)) setSelectedId(null)
  }, [rows, selectedId])

  useEffect(() => {
    if (!selected) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  async function removeRow(row: CollaborationRow) {
    setMenuId(null)
    if (!window.confirm(`¿Quitar a ${row.name} de esta campaña? La marca, su ficha y sus notas no se borran.`)) return
    try {
      await remove.mutateAsync(row.id)
      if (selectedId === row.id) setSelectedId(null)
      toast.success('Marca quitada de la campaña')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo quitar la marca')
    }
  }


  return (
    <div className={cn('gap-5', selected ? 'md:grid md:grid-cols-[minmax(0,1fr)_360px] md:items-start' : '')}>
      <section className="min-w-0 space-y-5" aria-labelledby="collab-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="collab-title" className="text-xl font-semibold text-gray-900">Marcas colaboradoras</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">Gestiona las marcas confirmadas y en proceso para {campaignName}. <Info className="h-3.5 w-3.5 text-gray-400" aria-hidden /></p>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:pb-0" role="group" aria-label="Resumen por estado">
          {COLLAB_STATUSES.map(status => (
            <div key={status} className="card min-w-[128px] flex-1 p-3 sm:min-w-0 sm:p-5">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600 sm:gap-2 sm:text-sm">
                <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', STATUS_STYLE[status].dot)} aria-hidden />
                <span className="truncate">{COUNTER_LABEL[status]}</span>
              </span>
              <span className="mt-1 block text-2xl font-semibold text-gray-900 sm:mt-2 sm:text-3xl">{isLoading ? '–' : counts[status]}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por marca, contacto, estado, plan, fecha, responsable…"
              aria-label="Buscar en todos los datos" className="input-base pl-9" />
          </div>
          <span className="text-sm text-gray-500" aria-live="polite">{visible.length} {visible.length === 1 ? 'marca' : 'marcas'}</span>
          <button type="button" onClick={() => setPlansOpen(true)}
            className={cn('inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50', FOCUS)}>
            Planes
          </button>
          <button type="button" onClick={() => setAddOpen(true)}
            className={cn('inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800', FOCUS)}>
            <Plus className="h-4 w-4" aria-hidden /> Agregar marca
          </button>
        </div>

        {isLoading ? (
          <div className="card flex items-center justify-center gap-2 p-12 text-sm text-gray-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando marcas colaboradoras…
          </div>
        ) : isError ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center" role="alert">
            <AlertCircle className="h-6 w-6 text-red-500" aria-hidden />
            <p className="text-sm text-gray-700">{error instanceof Error ? error.message : 'No se pudieron cargar las marcas.'}</p>
            <button type="button" onClick={() => refetch()} className={cn('rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50', FOCUS)}>Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-12 text-center">
            <Building2 className="h-8 w-8 text-gray-300" aria-hidden />
            <p className="text-sm font-semibold text-gray-800">Aún no hay marcas en esta campaña</p>
            <p className="max-w-sm text-sm text-gray-500">Agrega la primera marca para seguir su estado, aporte y próximos pasos.</p>
            <button type="button" onClick={() => setAddOpen(true)} className={cn('inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800', FOCUS)}>
              <Plus className="h-4 w-4" aria-hidden /> Agregar la primera marca
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-500">
            Ninguna marca coincide con la búsqueda.
            <button type="button" onClick={() => setQuery('')} className={cn('ml-2 font-semibold text-violet-700 hover:underline', FOCUS)}>Limpiar búsqueda</button>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {([['name', 'Marca'], ['contact', 'Contacto'], ['status', 'Estado'], ['plan', 'Plan'], ['type', 'Tipo de colaboración'], ['detail', 'Detalle / aporte'], ['next', 'Próximo paso'], ['date', 'Fecha'], ['owner', 'Responsable']] as const).map(([col, label]) => (
                    <SortableTH key={col} col={col} sortBy={sortBy ?? undefined} sortDir={sortDir} onSort={toggleSort} className="px-2.5 !text-[11px]">{label}</SortableTH>
                  ))}
                  <th scope="col" className="bg-gray-50 px-2 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr key={row.id} tabIndex={0} aria-selected={row.id === selectedId}
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedId(row.id) } }}
                    className={cn('cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/70', FOCUS, 'focus-visible:bg-violet-50/50', row.id === selectedId && 'bg-violet-50/40')}>
                    <td className="px-2.5 py-2.5">
                      <span className="flex items-center gap-2.5"><BrandAvatar row={row} /><span className="max-w-[110px] truncate font-semibold text-gray-900" title={row.name}>{row.name}</span></span>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <span className="block text-gray-800">{row.contact_name ?? '—'}</span>
                      {row.contact_email && <span className="block max-w-[110px] truncate text-xs text-gray-500">{row.contact_email}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5"><StatusBadge status={row.status} /></td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">{row.plan_name ? <PlanBadge name={row.plan_name} /> : <span className="text-gray-400">—</span>}</td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-gray-700">{row.collaboration_type ? COLLAB_TYPE_LABEL[row.collaboration_type] : '—'}</td>
                    <td className="max-w-[100px] px-2.5 py-2.5 text-gray-700">
                      <span className="block truncate" title={row.contribution_detail ?? undefined}>{row.contribution_detail || (row.quantity != null ? `${row.quantity} un.` : 'Por definir')}</span>
                    </td>
                    <td className="max-w-[100px] px-2.5 py-2.5 text-gray-700"><span className="block truncate" title={row.next_step ?? undefined}>{row.next_step || 'Por definir'}</span></td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-gray-600">{formatDate(row.follow_up_date)}</td>
                    <td className="px-2.5 py-2.5">
                      {row.owner_name
                        ? <span title={row.owner_name} className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">{initials(row.owner_name)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="relative px-2 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                      <button type="button" aria-label={`Acciones de ${row.name}`} aria-haspopup="menu" aria-expanded={menuId === row.id}
                        onClick={() => setMenuId(current => current === row.id ? null : row.id)}
                        className={cn('rounded p-1 text-gray-500 hover:bg-gray-100', FOCUS)}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                      {menuId === row.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} aria-hidden />
                          <div role="menu" className="absolute right-3 top-9 z-20 w-52 rounded-lg border border-gray-200 bg-white p-1 text-left shadow-lg">
                            <button role="menuitem" type="button" onClick={() => { setSelectedId(row.id); setMenuId(null) }} className={cn('block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-gray-50', FOCUS)}>Abrir ficha lateral</button>
                            {profileHref(row) && <Link role="menuitem" href={profileHref(row)!} className={cn('block rounded px-3 py-1.5 text-sm hover:bg-gray-50', FOCUS)}>Ver ficha completa</Link>}
                            <button role="menuitem" type="button" onClick={() => removeRow(row)} className={cn('flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50', FOCUS)}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Quitar de la campaña
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <CollaborationPanel key={selected.id} campaignId={campaignId} row={selected} owners={owners} plans={plans} onClose={() => setSelectedId(null)} />
      )}
      {plansOpen && <PlansModal campaignId={campaignId} plans={plans} onClose={() => setPlansOpen(false)} />}
      {addOpen && <AddBrandModal campaignId={campaignId} plans={plans} onOpenPlans={() => { setAddOpen(false); setPlansOpen(true) }} onClose={() => setAddOpen(false)} onAdded={id => { setAddOpen(false); setSelectedId(id) }} />}
    </div>
  )
}

// ── Panel lateral ─────────────────────────────────────────────────────────────
function CollaborationPanel({ campaignId, row, owners, plans, onClose }: {
  campaignId: string; row: CollaborationRow; owners: CollaborationOwner[]; plans: CampaignPlan[]; onClose: () => void
}) {
  const [tab, setTab] = useState<'summary' | 'contract' | 'notes' | 'history'>('summary')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const href = profileHref(row)

  return (
    <aside aria-label={`Ficha de ${row.name}`}
      className="fixed inset-0 z-40 overflow-y-auto bg-white md:sticky md:top-4 md:z-auto md:max-h-[calc(100vh-2rem)] md:rounded-xl md:border md:border-gray-200 md:shadow-sm">
      <div className="flex items-start gap-3 p-5">
        <BrandAvatar row={row} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-lg font-semibold text-gray-900">{row.name}</h3><StatusBadge status={row.status} /><PlanBadge name={row.plan_name} /></div>
          {row.industry && <p className="mt-0.5 truncate text-sm text-gray-500">{row.industry}</p>}
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar ficha" className={cn('rounded p-1 text-gray-500 hover:bg-gray-100', FOCUS)}><X className="h-5 w-5" aria-hidden /></button>
      </div>
      {href && (
        <div className="px-5 pb-3">
          <Link href={href} className={cn('flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-100', FOCUS)}>
            Ver ficha completa de la marca <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}
      <div role="tablist" aria-label="Secciones de la ficha" className="flex gap-5 border-b border-gray-200 px-5">
        {([['summary', 'Resumen'], ['contract', 'Contrato'], ['notes', 'Notas'], ['history', 'Historial']] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('-mb-px border-b-2 py-2.5 text-sm font-medium', FOCUS, tab === id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>{label}</button>
        ))}
      </div>
      <div className="space-y-4 p-5" role="tabpanel">
        {tab === 'summary' && <SummaryTab campaignId={campaignId} row={row} owners={owners} plans={plans} onSeeNotes={() => setTab('notes')} />}
        {tab === 'contract' && <ContractTab campaignId={campaignId} row={row} />}
        {tab === 'notes' && <NotesTab campaignId={campaignId} row={row} />}
        {tab === 'history' && <HistoryTab campaignId={campaignId} row={row} />}
      </div>
    </aside>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2">
      <label htmlFor={htmlFor} className="text-xs text-gray-600">{label}</label>
      {children}
    </div>
  )
}

function SummaryTab({ campaignId, row, owners, plans, onSeeNotes }: { campaignId: string; row: CollaborationRow; owners: CollaborationOwner[]; plans: CampaignPlan[]; onSeeNotes: () => void }) {
  const update = useUpdateCollaboration(campaignId)
  const history = useCollaborationHistory(campaignId, row.lead_id ? row.id : null)
  const recentNotes = (history.data?.data ?? []).filter(a => a.action_type === 'note').slice(0, 2)
  const [form, setForm] = useState({
    status: row.status,
    plan_id: row.plan_id ?? '',
    collaboration_type: row.collaboration_type ?? '',
    contribution_detail: row.contribution_detail ?? '',
    quantity: row.quantity != null ? String(row.quantity) : '',
    next_step: row.next_step ?? '',
    follow_up_date: row.follow_up_date ?? '',
    owner_id: row.owner_id ?? '',
  })
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setSaved(false); setForm(f => ({ ...f, [key]: value })) }

  const dirty =
    form.status !== row.status ||
    form.plan_id !== (row.plan_id ?? '') ||
    form.collaboration_type !== (row.collaboration_type ?? '') ||
    form.contribution_detail !== (row.contribution_detail ?? '') ||
    form.quantity !== (row.quantity != null ? String(row.quantity) : '') ||
    form.next_step !== (row.next_step ?? '') ||
    form.follow_up_date !== (row.follow_up_date ?? '') ||
    form.owner_id !== (row.owner_id ?? '')

  async function save(event: React.FormEvent) {
    event.preventDefault()
    try {
      await update.mutateAsync({
        id: row.id,
        status: form.status,
        plan_id: form.plan_id || null,
        collaboration_type: form.collaboration_type || null,
        contribution_detail: form.contribution_detail || null,
        quantity: form.quantity === '' ? null : Number(form.quantity),
        next_step: form.next_step || null,
        follow_up_date: form.follow_up_date || null,
        owner_id: form.owner_id || null,
      })
      setSaved(true)
      toast.success('Colaboración guardada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  return (
    <>
      <form onSubmit={save} className="space-y-3 rounded-xl border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-900">Colaboración en esta campaña</h4>
        <Field label="Estado" htmlFor="c-status">
          <select id="c-status" value={form.status} onChange={e => set('status', e.target.value as CollabStatus)} className="input-base">
            {COLLAB_STATUSES.map(s => <option key={s} value={s}>{COLLAB_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Plan" htmlFor="c-plan">
          <select id="c-plan" value={form.plan_id} onChange={e => set('plan_id', e.target.value)} className="input-base">
            <option value="">{plans.length ? 'Sin plan' : 'Sin planes definidos'}</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.amount != null ? ` · ${money(p.amount)}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Tipo de colaboración" htmlFor="c-type">
          <select id="c-type" value={form.collaboration_type} onChange={e => set('collaboration_type', e.target.value)} className="input-base">
            <option value="">Sin definir</option>
            {COLLAB_TYPES.map(t => <option key={t} value={t}>{COLLAB_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Detalle del aporte" htmlFor="c-detail">
          <input id="c-detail" maxLength={500} value={form.contribution_detail} onChange={e => set('contribution_detail', e.target.value)} placeholder="Ej: 50 productos de belleza" className="input-base" />
        </Field>
        <Field label="Cantidad" htmlFor="c-qty">
          <input id="c-qty" type="number" min={0} step={1} value={form.quantity} onChange={e => set('quantity', e.target.value)} className="input-base" />
        </Field>
        <Field label="Próximo paso" htmlFor="c-next">
          <input id="c-next" maxLength={300} value={form.next_step} onChange={e => set('next_step', e.target.value)} placeholder="Ej: Coordinar entrega" className="input-base" />
        </Field>
        <Field label="Fecha de seguimiento" htmlFor="c-date">
          <div className="relative"><Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input id="c-date" type="date" value={form.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} className="input-base" /></div>
        </Field>
        <Field label="Responsable" htmlFor="c-owner">
          <select id="c-owner" value={form.owner_id} onChange={e => set('owner_id', e.target.value)} className="input-base">
            <option value="">Sin responsable</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <div className="flex items-center justify-end gap-3 pt-1">
          <span className="text-xs text-gray-500" aria-live="polite">{update.isPending ? 'Guardando…' : saved && !dirty ? 'Guardado' : dirty ? 'Cambios sin guardar' : ''}</span>
          <button type="submit" disabled={!dirty || update.isPending}
            className={cn('inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50', FOCUS)}>
            {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
          </button>
        </div>
        {update.isError && <p role="alert" className="text-xs text-red-600">{update.error instanceof Error ? update.error.message : 'No se pudo guardar'}</p>}
      </form>

      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">Información de contacto</h4>
          {profileHref(row) && <Link href={profileHref(row)!} className={cn('text-xs font-semibold text-violet-700 hover:underline', FOCUS)}>Ver en ficha</Link>}
        </div>
        {row.contact_name || row.contact_email || row.contact_phone || row.instagram ? (
          <div className="mt-3 space-y-3 text-sm">
            {row.contact_name && (
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500"><User className="h-4 w-4" aria-hidden /></span>
                <span><span className="block font-medium text-gray-900">{row.contact_name}</span>{row.contact_position && <span className="block text-xs text-gray-500">{row.contact_position}</span>}</span>
              </div>
            )}
            {row.contact_email && <a href={`mailto:${row.contact_email}`} className="flex items-center gap-3 text-gray-700 hover:underline"><Mail className="h-4 w-4 text-gray-400" aria-hidden />{row.contact_email}</a>}
            {row.contact_phone && <p className="flex items-center gap-3 text-gray-700"><Phone className="h-4 w-4 text-gray-400" aria-hidden />{row.contact_phone}</p>}
            {row.instagram && <p className="pl-7 text-gray-700">{row.instagram}</p>}
          </div>
        ) : <p className="mt-2 text-sm text-gray-500">Sin datos de contacto en la ficha.</p>}
      </div>

      {row.lead_id && (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">Notas recientes</h4>
            <button type="button" onClick={onSeeNotes} className={cn('text-xs font-semibold text-violet-700 hover:underline', FOCUS)}>Ver todas</button>
          </div>
          {history.isPending ? <p className="mt-2 text-sm text-gray-500" role="status">Cargando…</p>
            : recentNotes.length === 0 ? <p className="mt-2 text-sm text-gray-500">Aún no hay notas.</p>
            : (
              <ul className="mt-3 space-y-3">
                {recentNotes.map(n => (
                  <li key={n.id} className="flex gap-3">
                    <span aria-hidden className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-50 text-[11px] font-semibold text-violet-700">{initials(n.created_by_name ?? '?')}</span>
                    <span className="min-w-0 text-sm"><span className="line-clamp-3 text-gray-800">{n.description}</span>
                      <span className="mt-0.5 block text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span></span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </>
  )
}

function NotesTab({ campaignId, row }: { campaignId: string; row: CollaborationRow }) {
  const { data, isLoading, isError } = useCollaborationHistory(campaignId, row.id)
  const update = useUpdateCollaboration(campaignId)
  const [note, setNote] = useState('')
  const notes = (data?.data ?? []).filter(a => a.action_type === 'note')

  async function addNote(event: React.FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    try {
      await update.mutateAsync({ id: row.id, note })
      setNote('')
      toast.success('Nota guardada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar la nota')
    }
  }

  if (!row.lead_id) return <p className="text-sm text-gray-500">Esta marca no tiene ficha en el CRM, por lo que no hay notas que mostrar. Agrégala desde el CRM para llevar su historial.</p>

  return (
    <>
      <form onSubmit={addNote} className="space-y-2">
        <label htmlFor="c-note" className="sr-only">Nueva nota</label>
        <textarea id="c-note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Agregar una nota sobre esta marca en la campaña…" className="input-base" />
        <div className="flex justify-end">
          <button type="submit" disabled={!note.trim() || update.isPending} className={cn('inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50', FOCUS)}>
            {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar nota
          </button>
        </div>
      </form>
      {isLoading ? <p className="text-sm text-gray-500" role="status">Cargando notas…</p>
        : isError ? <p role="alert" className="text-sm text-red-600">No se pudieron cargar las notas.</p>
        : notes.length === 0 ? <p className="text-sm text-gray-500">Aún no hay notas.</p>
        : (
          <ul className="space-y-3">
            {notes.map(n => (
              <li key={n.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <p className="whitespace-pre-wrap text-gray-800">{n.description}</p>
                <p className="mt-1.5 text-xs text-gray-400">
                  {n.created_by_name ? `${n.created_by_name} · ` : ''}{new Date(n.created_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {n.campaign_id === campaignId && <span className="ml-2 badge bg-violet-50 text-violet-700">Esta campaña</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
    </>
  )
}

function HistoryTab({ campaignId, row }: { campaignId: string; row: CollaborationRow }) {
  const { data, isLoading, isError } = useCollaborationHistory(campaignId, row.id)
  if (!row.lead_id) return <p className="text-sm text-gray-500">Esta marca no tiene ficha en el CRM, por lo que no hay historial.</p>
  if (isLoading) return <p className="text-sm text-gray-500" role="status">Cargando historial…</p>
  if (isError) return <p role="alert" className="text-sm text-red-600">No se pudo cargar el historial.</p>
  const items = data?.data ?? []
  if (!items.length) return <p className="text-sm text-gray-500">Sin actividad registrada.</p>
  return (
    <ol className="space-y-3">
      {items.map(a => (
        <li key={a.id} className="border-l-2 border-gray-200 pl-3 text-sm">
          <p className="font-medium text-gray-800">{a.action_type === 'note' ? 'Nota' : a.action_type.replace(/_/g, ' ')}</p>
          {a.description && <p className="text-gray-600">{a.description}</p>}
          <p className="text-xs text-gray-400">
            {new Date(a.created_at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {a.created_by_name ? ` · ${a.created_by_name}` : ''}
            {a.campaign_id === campaignId && <span className="ml-2 badge bg-violet-50 text-violet-700">Esta campaña</span>}
          </p>
        </li>
      ))}
    </ol>
  )
}

// ── Contrato de la marca (datos del sistema de contratos existente) ───────────
const CONTRACT_STATUS: Record<string, string> = { draft: 'Borrador', pending_signature: 'Pendiente de firma', sent: 'Enviado', signed: 'Firmado', completed: 'Firmado', voided: 'Anulado', expired: 'Vencido' }
const PAYMENT_CONDITION: Record<string, string> = { before_event: 'antes del evento', after_event: 'después del evento', on_signing: 'al firmar', before_date: 'antes de una fecha acordada' }

function ContractCard({ contract }: { contract: ContractSummary }) {
  const [open, setOpen] = useState(false)
  const content = useContractContent(open ? contract.id : null)
  const pkg = contract.metadata?.package
  const pay = contract.metadata?.payment_terms
  const ev = contract.metadata?.event
  const total = contract.total_value != null ? Number(contract.total_value) : pkg?.amount ?? null
  const list = (items?: string[]) => items && items.length > 0 ? (
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">{items.map((i, n) => <li key={n}>{i}</li>)}</ul>
  ) : <p className="mt-1 text-sm text-gray-400">No especificado</p>
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{contract.title}</h4>
        <span className="badge bg-gray-100 text-gray-700">{CONTRACT_STATUS[contract.status] ?? contract.status}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-gray-500">Plan</dt><dd className="font-medium text-gray-900">{pkg?.name ?? '—'}</dd></div>
        <div><dt className="text-xs text-gray-500">Monto</dt><dd className="font-medium text-gray-900">{total != null ? money(total) : '—'} {contract.currency ?? ''}</dd></div>
        {ev?.date && <div><dt className="text-xs text-gray-500">Evento</dt><dd className="text-gray-800">{ev.name ?? ''} {ev.date}{ev.start_time ? ` · ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ''}` : ''}</dd></div>}
        {ev?.location && <div><dt className="text-xs text-gray-500">Lugar</dt><dd className="text-gray-800">{ev.location}</dd></div>}
      </dl>
      <div><h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Qué entrega SCENCE (incluye el plan)</h5>{list(pkg?.inclusions)}</div>
      <div><h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Qué aporta la marca</h5>{list(pkg?.requirements)}</div>
      {(pkg?.deliverables?.length ?? 0) > 0 && <div><h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Entregables</h5>{list(pkg?.deliverables)}</div>}
      {pay && (pay.first_percentage || pay.second_percentage) && (
        <div><h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pago</h5>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {pay.first_percentage ? <li>{pay.first_percentage}%{pay.first_amount ? ` (${money(pay.first_amount)})` : ''} {PAYMENT_CONDITION[pay.first_condition ?? ''] ?? pay.first_condition ?? ''}</li> : null}
            {pay.second_percentage ? <li>{pay.second_percentage}%{pay.second_amount ? ` (${money(pay.second_amount)})` : ''} {PAYMENT_CONDITION[pay.second_condition ?? ''] ?? pay.second_condition ?? ''}</li> : null}
          </ul>
        </div>
      )}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={cn('text-sm font-semibold text-violet-700 hover:underline', FOCUS)}>
        {open ? 'Ocultar contrato completo' : 'Ver contrato completo (responsabilidades de cada parte)'}
      </button>
      {open && (content.isPending ? <p className="text-sm text-gray-500" role="status">Cargando contrato…</p>
        : content.isError ? <p role="alert" className="text-sm text-red-600">No se pudo cargar el contrato.</p>
        : <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-xs leading-relaxed text-gray-800">{content.data?.data.content ?? 'Sin contenido'}</pre>)}
    </div>
  )
}

function ContractTab({ campaignId, row }: { campaignId: string; row: CollaborationRow }) {
  const { data, isPending, isError } = useCampaignContracts(campaignId, !!row.brand_id)
  const contractsHref = `/admin-campaigns/${campaignId}?tab=contracts`
  if (!row.brand_id) {
    return <p className="text-sm text-gray-500">Esta marca todavía es un lead del CRM. Conviértela en marca desde su ficha para poder generar su contrato.</p>
  }
  if (isPending) return <p className="text-sm text-gray-500" role="status">Cargando contratos…</p>
  if (isError) return <p role="alert" className="text-sm text-red-600">No se pudieron cargar los contratos.</p>
  const contracts = (data?.data ?? []).filter(c => c.brand_id === row.brand_id)
  if (contracts.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-gray-200 p-5 text-center">
        <p className="text-sm text-gray-600">Aún no hay contrato para esta marca en la campaña.</p>
        <Link href={contractsHref} className={cn('inline-flex rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700', FOCUS)}>Generar contrato</Link>
        {row.plan_name && <p className="text-xs text-gray-400">Plan elegido: {row.plan_name}{row.plan_amount != null ? ` · ${money(row.plan_amount)}` : ''}</p>}
      </div>
    )
  }
  return (
    <>
      {contracts.map(c => <ContractCard key={c.id} contract={c} />)}
      <Link href={contractsHref} className={cn('block text-center text-sm font-semibold text-violet-700 hover:underline', FOCUS)}>Gestionar contratos de la campaña</Link>
    </>
  )
}

// ── Agregar marca ─────────────────────────────────────────────────────────────
function AddBrandModal({ campaignId, plans, onOpenPlans, onClose, onAdded }: { campaignId: string; plans: CampaignPlan[]; onOpenPlans: () => void; onClose: () => void; onAdded: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [creating, setCreating] = useState(false)
  const [lead, setLead] = useState({ company_name: '', contact_name: '', email: '', instagram: '' })
  const [creatingBusy, setCreatingBusy] = useState(false)
  // Si el lead se creó pero la asociación falló, el reintento reutiliza ese lead
  // en vez de crear otro registro en el CRM.
  const [planId, setPlanId] = useState<string>('')
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null)
  const add = useAddCollaboration(campaignId)
  const candidates = useCollaborationCandidates(campaignId, debounced)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function pick(target: { lead_id?: string; brand_id?: string }) {
    try {
      const res = await add.mutateAsync({ ...target, plan_id: planId || null })
      toast.success('Marca agregada a la campaña')
      onAdded(res.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo agregar la marca')
    }
  }

  // Reutiliza el alta de leads del CRM (POST /api/crm-leads) y luego asocia.
  async function createLead(event: React.FormEvent) {
    event.preventDefault()
    setCreatingBusy(true)
    try {
      let leadId = createdLeadId
      if (!leadId) {
        const res = await fetch('/api/crm-leads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...lead, source: 'campaign_collaborator' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(res.status === 403 ? 'No tienes permisos para crear registros en el CRM' : json.error ?? 'No se pudo crear el registro')
        leadId = json.data.id as string
        setCreatedLeadId(leadId)
      }
      await pick({ lead_id: leadId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el registro')
    } finally {
      setCreatingBusy(false)
    }
  }

  const leads = candidates.data?.leads ?? []
  const brands = candidates.data?.brands ?? []
  const busy = add.isPending || creatingBusy

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-brand-title" onClick={e => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 id="add-brand-title" className="text-base font-semibold text-gray-900">{creating ? 'Nuevo registro comercial' : 'Agregar marca'}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={cn('rounded p-1 text-gray-500 hover:bg-gray-100', FOCUS)}><X className="h-5 w-5" aria-hidden /></button>
        </div>

        {creating ? (
          <form onSubmit={createLead} className="space-y-3 overflow-y-auto p-5">
            <p className="text-sm text-gray-500">Se crea en el CRM de SCENCE y se asocia a esta campaña{planId ? ` con plan ${plans.find(p => p.id === planId)?.name ?? ''}` : ''}.</p>
            {([['company_name', 'Marca / empresa'], ['contact_name', 'Contacto'], ['email', 'Email'], ['instagram', 'Instagram']] as const).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`n-${key}`} className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
                <input id={`n-${key}`} type={key === 'email' ? 'email' : 'text'} value={lead[key]} onChange={e => setLead(l => ({ ...l, [key]: e.target.value }))} className="input-base" />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCreating(false)} className={cn('rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50', FOCUS)}>Volver</button>
              <button type="submit" disabled={busy || !(lead.company_name.trim() || lead.email.trim() || lead.instagram.trim())}
                className={cn('inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50', FOCUS)}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Crear y agregar
              </button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-col p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar marca o lead" placeholder="Buscar por marca, contacto, email o Instagram…" className="input-base pl-9" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="add-plan" className="text-xs font-medium text-gray-600">Plan</label>
              <select id="add-plan" value={planId} onChange={e => setPlanId(e.target.value)} className="input-base w-auto py-1.5">
                <option value="">Sin plan</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.amount != null ? ` · ${money(p.amount)}` : ''}</option>)}
              </select>
              {plans.length === 0 && <button type="button" onClick={onOpenPlans} className={cn('text-xs font-semibold text-violet-700 hover:underline', FOCUS)}>Definir planes</button>}
            </div>
            <div className="mt-3 min-h-[120px] overflow-y-auto" aria-live="polite">
              {debounced.trim().length < 2 ? <p className="py-6 text-center text-sm text-gray-400">Escribe al menos 2 letras para buscar.</p>
                : candidates.isFetching ? <p className="py-6 text-center text-sm text-gray-500" role="status">Buscando…</p>
                : candidates.isError ? <p role="alert" className="py-6 text-center text-sm text-red-600">No se pudo buscar. Intenta de nuevo.</p>
                : leads.length + brands.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">No encontramos resultados disponibles.</p>
                : (
                  <ul className="divide-y divide-gray-100">
                    {brands.map(b => (
                      <li key={`b-${b.id}`}><button type="button" disabled={busy} onClick={() => pick({ brand_id: b.id })} className={cn('flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left hover:bg-gray-50 disabled:opacity-50', FOCUS)}>
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{b.name}</span><span className="block truncate text-xs text-gray-500">{[b.contact_name, b.contact_email].filter(Boolean).join(' · ') || 'Marca en SCENCE'}</span></span>
                        <span className="badge bg-emerald-50 text-emerald-700">Marca</span></button></li>
                    ))}
                    {leads.map(l => (
                      <li key={`l-${l.id}`}><button type="button" disabled={busy} onClick={() => pick({ lead_id: l.id })} className={cn('flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left hover:bg-gray-50 disabled:opacity-50', FOCUS)}>
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{l.company_name || l.contact_name || l.email || l.instagram}</span><span className="block truncate text-xs text-gray-500">{[l.contact_name, l.email].filter(Boolean).join(' · ') || 'Lead del CRM'}</span></span>
                        <span className="badge bg-gray-100 text-gray-600">Lead CRM</span></button></li>
                    ))}
                  </ul>
                )}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
              <button type="button" onClick={() => setCreating(true)} className={cn('text-sm font-semibold text-violet-700 hover:underline', FOCUS)}>¿No existe? Crear registro</button>
              <button type="button" onClick={onClose} className={cn('rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50', FOCUS)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Planes de la campaña ──────────────────────────────────────────────────────
function PlanRow({ plan, onSave, onDelete, busy }: {
  plan: CampaignPlan; busy: boolean
  onSave: (patch: { name: string; amount: number | null; description: string | null }) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(plan.name)
  const [amount, setAmount] = useState(plan.amount != null ? String(plan.amount) : '')
  const [description, setDescription] = useState(plan.description ?? '')
  const dirty = name !== plan.name || amount !== (plan.amount != null ? String(plan.amount) : '') || description !== (plan.description ?? '')
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 rounded-lg border border-gray-100 p-3 sm:grid-cols-[130px_120px_minmax(0,1fr)_auto]">
      <input aria-label="Nombre del plan" value={name} maxLength={40} onChange={e => setName(e.target.value)} className="input-base" />
      <input aria-label="Monto" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Monto" className="input-base" />
      <input aria-label="Qué incluye" value={description} maxLength={300} onChange={e => setDescription(e.target.value)} placeholder="Qué incluye (opcional)" className="input-base col-span-2 sm:col-span-1" />
      <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
        <button type="button" disabled={!dirty || busy || !name.trim()} onClick={() => onSave({ name, amount: amount === '' ? null : Number(amount), description: description || null })}
          className={cn('rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40', FOCUS)}>Guardar</button>
        <button type="button" aria-label={`Eliminar plan ${plan.name}`} disabled={busy} onClick={onDelete} className={cn('rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600', FOCUS)}><Trash2 className="h-4 w-4" aria-hidden /></button>
      </div>
    </li>
  )
}

function PlansModal({ campaignId, plans, onClose }: { campaignId: string; plans: CampaignPlan[]; onClose: () => void }) {
  const actions = usePlanActions(campaignId)
  const busy = actions.loadStandard.isPending || actions.create.isPending || actions.update.isPending || actions.remove.isPending
  const [draft, setDraft] = useState({ name: '', amount: '', description: '' })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run<T>(action: Promise<T>, ok: string) {
    try { await action; toast.success(ok); return true } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo completar'); return false }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="plans-title" onClick={e => e.stopPropagation()} className="flex max-h-[84vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 id="plans-title" className="text-base font-semibold text-gray-900">Planes de esta campaña</h3>
            <p className="text-xs text-gray-500">Cada campaña define sus propios planes. Las marcas eligen uno de esta lista.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={cn('rounded p-1 text-gray-500 hover:bg-gray-100', FOCUS)}><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-5">
          {plans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
              <p className="text-sm text-gray-600">Esta campaña aún no tiene planes.</p>
              <button type="button" disabled={busy} onClick={() => run(actions.loadStandard.mutateAsync(), 'Plan estándar cargado')}
                className={cn('mt-3 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50', FOCUS)}>
                {actions.loadStandard.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Usar estándar: Bronze, Gold, Naming
              </button>
              <p className="mt-2 text-xs text-gray-400">Luego puedes editar nombres y montos, o agregar otros.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {plans.map(plan => (
                <PlanRow key={plan.id + plan.name + plan.amount + plan.description} plan={plan} busy={busy}
                  onSave={patch => { void run(actions.update.mutateAsync({ id: plan.id, ...patch }), 'Plan guardado') }}
                  onDelete={() => { if (window.confirm(`¿Eliminar el plan ${plan.name}? Las marcas con este plan quedarán sin plan.`)) void run(actions.remove.mutateAsync(plan.id), 'Plan eliminado') }} />
              ))}
            </ul>
          )}
          <form className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-[130px_120px_minmax(0,1fr)_auto]"
            onSubmit={async e => { e.preventDefault(); if (await run(actions.create.mutateAsync({ name: draft.name, amount: draft.amount === '' ? null : Number(draft.amount), description: draft.description || null }), 'Plan creado')) setDraft({ name: '', amount: '', description: '' }) }}>
            <input aria-label="Nuevo plan: nombre" value={draft.name} maxLength={40} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Nuevo plan" className="input-base" />
            <input aria-label="Nuevo plan: monto" type="number" min={0} value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} placeholder="Monto" className="input-base" />
            <input aria-label="Nuevo plan: qué incluye" value={draft.description} maxLength={300} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Qué incluye (opcional)" className="input-base col-span-2 sm:col-span-1" />
            <button type="submit" disabled={busy || !draft.name.trim()} className={cn('col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40 sm:col-span-1', FOCUS)}><Plus className="h-4 w-4" aria-hidden />Agregar</button>
          </form>
        </div>
      </div>
    </div>
  )
}
