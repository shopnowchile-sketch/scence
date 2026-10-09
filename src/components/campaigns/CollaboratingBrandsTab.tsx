'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowUpRight, Building2, Calendar, Info, Loader2, Mail, MoreHorizontal, Phone, Plus, Search, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  COLLAB_STATUSES,
  COLLAB_STATUS_LABEL,
  COLLAB_TYPES,
  COLLAB_TYPE_LABEL,
  type CollabStatus,
  type CollabType,
  type CollaborationRow,
} from '@/lib/campaign-collaborations-shared'
import {
  useAddCollaboration,
  useCampaignCollaborations,
  useCollaborationCandidates,
  useCollaborationHistory,
  useRemoveCollaboration,
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

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | CollabStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | CollabType>('all')
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'none' | string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const remove = useRemoveCollaboration(campaignId)

  // Búsqueda + filtros que no son de estado: los contadores los respetan,
  // así la tarjeta de cada estado muestra cuántas habría al elegirla.
  const baseFiltered = useMemo(() => {
    const term = normalize(query.trim())
    return rows.filter(row => {
      if (term && !normalize([row.name, row.contact_name, row.contact_email, row.instagram].filter(Boolean).join(' ')).includes(term)) return false
      if (typeFilter !== 'all' && row.collaboration_type !== typeFilter) return false
      if (ownerFilter === 'none' && row.owner_id) return false
      if (ownerFilter !== 'all' && ownerFilter !== 'none' && row.owner_id !== ownerFilter) return false
      return true
    })
  }, [rows, query, typeFilter, ownerFilter])

  const counts = useMemo(() => {
    const result = Object.fromEntries(COLLAB_STATUSES.map(s => [s, 0])) as Record<CollabStatus, number>
    baseFiltered.forEach(row => { result[row.status] += 1 })
    return result
  }, [baseFiltered])

  const visible = useMemo(
    () => statusFilter === 'all' ? baseFiltered : baseFiltered.filter(row => row.status === statusFilter),
    [baseFiltered, statusFilter],
  )
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

  const hasFilters = !!query.trim() || statusFilter !== 'all' || typeFilter !== 'all' || ownerFilter !== 'all'

  return (
    <div className={cn('gap-5', selected ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start' : '')}>
      <section className="min-w-0 space-y-5" aria-labelledby="collab-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="collab-title" className="text-xl font-semibold text-gray-900">Marcas colaboradoras</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">Gestiona las marcas confirmadas y en proceso para {campaignName}. <Info className="h-3.5 w-3.5 text-gray-400" aria-hidden /></p>
          </div>
          <button type="button" onClick={() => setAddOpen(true)}
            className={cn('inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800', FOCUS)}>
            <Plus className="h-4 w-4" aria-hidden /> Agregar marca
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Filtrar por estado">
          {COLLAB_STATUSES.map(status => (
            <button key={status} type="button" aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(current => current === status ? 'all' : status)}
              className={cn('card p-5 text-left transition-colors hover:border-gray-300', FOCUS,
                statusFilter === status && 'border-violet-500 ring-1 ring-violet-500/30')}>
              <span className="flex items-center gap-2 text-sm text-gray-600">
                <span className={cn('h-2 w-2 rounded-full', STATUS_STYLE[status].dot)} aria-hidden />
                {COUNTER_LABEL[status]}
              </span>
              <span className="mt-2 block text-3xl font-semibold text-gray-900">{isLoading ? '–' : counts[status]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar marca o contacto…"
              aria-label="Buscar marca o contacto" className="input-base pl-9" />
          </div>
          <select aria-label="Filtrar por estado" value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | CollabStatus)} className="input-base w-auto">
            <option value="all">Estado</option>
            {COLLAB_STATUSES.map(s => <option key={s} value={s}>{COLLAB_STATUS_LABEL[s]}</option>)}
          </select>
          <select aria-label="Filtrar por tipo de colaboración" value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'all' | CollabType)} className="input-base w-auto">
            <option value="all">Tipo de colaboración</option>
            {COLLAB_TYPES.map(t => <option key={t} value={t}>{COLLAB_TYPE_LABEL[t]}</option>)}
          </select>
          <select aria-label="Filtrar por responsable" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className="input-base w-auto">
            <option value="all">Responsable</option>
            <option value="none">Sin responsable</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="ml-auto text-sm text-gray-500" aria-live="polite">{visible.length} {visible.length === 1 ? 'marca' : 'marcas'}</span>
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
            Ninguna marca coincide con los filtros.
            {hasFilters && (
              <button type="button" onClick={() => { setQuery(''); setStatusFilter('all'); setTypeFilter('all'); setOwnerFilter('all') }}
                className={cn('ml-2 font-semibold text-violet-700 hover:underline', FOCUS)}>Limpiar filtros</button>
            )}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {['Marca', 'Contacto', 'Estado', 'Tipo de colaboración', 'Detalle / aporte', 'Próximo paso', 'Fecha', 'Responsable'].map(h => <th key={h} scope="col" className="px-2.5 py-3">{h}</th>)}
                  <th scope="col" className="px-2 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr key={row.id} tabIndex={0} aria-selected={row.id === selectedId}
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedId(row.id) } }}
                    className={cn('cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/70', FOCUS, 'focus-visible:bg-violet-50/50', row.id === selectedId && 'bg-violet-50/40')}>
                    <td className="px-2.5 py-2.5">
                      <span className="flex items-center gap-2.5"><BrandAvatar row={row} /><span className="max-w-[95px] truncate font-semibold text-gray-900" title={row.name}>{row.name}</span></span>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <span className="block text-gray-800">{row.contact_name ?? '—'}</span>
                      {row.contact_email && <span className="block max-w-[110px] truncate text-xs text-gray-500">{row.contact_email}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5"><StatusBadge status={row.status} /></td>
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
        <CollaborationPanel key={selected.id} campaignId={campaignId} row={selected} owners={owners} onClose={() => setSelectedId(null)} />
      )}
      {addOpen && <AddBrandModal campaignId={campaignId} onClose={() => setAddOpen(false)} onAdded={id => { setAddOpen(false); setSelectedId(id) }} />}
    </div>
  )
}

// ── Panel lateral ─────────────────────────────────────────────────────────────
function CollaborationPanel({ campaignId, row, owners, onClose }: {
  campaignId: string; row: CollaborationRow; owners: CollaborationOwner[]; onClose: () => void
}) {
  const [tab, setTab] = useState<'summary' | 'notes' | 'history'>('summary')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const href = profileHref(row)

  return (
    <aside aria-label={`Ficha de ${row.name}`}
      className="fixed inset-0 z-40 overflow-y-auto bg-white lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-xl lg:border lg:border-gray-200 lg:shadow-sm">
      <div className="flex items-start gap-3 p-5">
        <BrandAvatar row={row} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-lg font-semibold text-gray-900">{row.name}</h3><StatusBadge status={row.status} /></div>
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
        {([['summary', 'Resumen'], ['notes', 'Notas'], ['history', 'Historial']] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('-mb-px border-b-2 py-2.5 text-sm font-medium', FOCUS, tab === id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>{label}</button>
        ))}
      </div>
      <div className="space-y-4 p-5" role="tabpanel">
        {tab === 'summary' && <SummaryTab campaignId={campaignId} row={row} owners={owners} onSeeNotes={() => setTab('notes')} />}
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

function SummaryTab({ campaignId, row, owners, onSeeNotes }: { campaignId: string; row: CollaborationRow; owners: CollaborationOwner[]; onSeeNotes: () => void }) {
  const update = useUpdateCollaboration(campaignId)
  const history = useCollaborationHistory(campaignId, row.lead_id ? row.id : null)
  const recentNotes = (history.data?.data ?? []).filter(a => a.action_type === 'note').slice(0, 2)
  const [form, setForm] = useState({
    status: row.status,
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

// ── Agregar marca ─────────────────────────────────────────────────────────────
function AddBrandModal({ campaignId, onClose, onAdded }: { campaignId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [creating, setCreating] = useState(false)
  const [lead, setLead] = useState({ company_name: '', contact_name: '', email: '', instagram: '' })
  const [creatingBusy, setCreatingBusy] = useState(false)
  // Si el lead se creó pero la asociación falló, el reintento reutiliza ese lead
  // en vez de crear otro registro en el CRM.
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
      const res = await add.mutateAsync(target)
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
            <p className="text-sm text-gray-500">Se crea en el CRM de SCENCE y se asocia a esta campaña.</p>
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
