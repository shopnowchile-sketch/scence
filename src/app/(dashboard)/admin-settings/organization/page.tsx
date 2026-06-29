'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, Save, Building2, UserPlus, X, Copy, Check } from 'lucide-react'

const schema = z.object({
  name:          z.string().min(2, 'Mínimo 2 caracteres'),
  website:       z.string().url('URL inválida').optional().or(z.literal('')),
  industry:      z.string().optional(),
  country:       z.string().optional(),
  billing_email: z.string().email('Email inválido').optional().or(z.literal('')),
  currency:      z.enum(['USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP']),
  tax_id:        z.string().optional(),
})
type FormValues = z.infer<typeof schema>

const INDUSTRIES = [
  'Moda y Belleza', 'Tecnología', 'Alimentos y Bebidas', 'Deportes',
  'Entretenimiento', 'Salud y Bienestar', 'Viajes y Turismo', 'Educación',
  'Finanzas', 'Automotriz', 'Hogar y Decoración', 'Retail', 'Otro',
]

const CURRENCIES = [
  { value: 'USD', label: 'USD — Dólar americano' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'CLP', label: 'CLP — Peso chileno' },
  { value: 'COP', label: 'COP — Peso colombiano' },
  { value: 'ARS', label: 'ARS — Peso argentino' },
  { value: 'BRL', label: 'BRL — Real brasileño' },
  { value: 'GBP', label: 'GBP — Libra esterlina' },
]

function OrgSettingsForm() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [orgId, setOrgId]     = useState('')

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'CLP' },
  })

  useEffect(() => {
    fetch('/api/settings/organization')
      .then(r => r.json())
      .then(({ data }) => {
        if (data) {
          setOrgId(data.id)
          reset({
            name:          data.name          ?? '',
            website:       data.website        ?? '',
            industry:      data.industry       ?? '',
            country:       data.country        ?? '',
            billing_email: data.billing_email  ?? '',
            currency:      data.currency       ?? 'CLP',
            tax_id:        data.tax_id         ?? '',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [reset])

  async function onSubmit(data: FormValues) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Organización actualizada')
      reset(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-violet-500" /> Datos de la organización
        </h2>

        {orgId && (
          <div className="mb-4 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-400 font-mono">
            ID: {orgId}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre de la organización <span className="text-red-500">*</span>
            </label>
            <input {...register('name')} className="input-base w-full" placeholder="Nombre de tu empresa o agencia" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Sitio web</label>
            <input {...register('website')} className="input-base w-full" placeholder="https://tuempresa.com" type="url" />
            {errors.website && <p className="text-xs text-red-500 mt-1">{errors.website.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Industria</label>
            <select {...register('industry')} className="input-base w-full">
              <option value="">Selecciona industria</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">País</label>
            <input {...register('country')} className="input-base w-full" placeholder="MX, CL, CO, AR…" maxLength={2} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Moneda principal</label>
            <select {...register('currency')} className="input-base w-full">
              {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email de facturación</label>
            <input {...register('billing_email')} className="input-base w-full" placeholder="facturacion@empresa.com" type="email" />
            {errors.billing_email && <p className="text-xs text-red-500 mt-1">{errors.billing_email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">RFC / Tax ID</label>
            <input {...register('tax_id')} className="input-base w-full" placeholder="RFC o número de identificación fiscal" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || !isDirty}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}


// ── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail]           = useState('')
  const [name, setName]             = useState('')
  const [role, setRole]             = useState('agency_manager')
  const [sending, setSending]       = useState(false)
  const [actionLink, setActionLink] = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)

  const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super Admin', agency_manager: 'Agency Manager',
    brand_manager: 'Brand Manager', finance: 'Finanzas', influencer: 'Influencer',
  }

  async function send() {
    if (!email) { toast.error('Ingresa un email'); return }
    setSending(true)
    try {
      const res = await fetch('/api/settings/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, display_name: name.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(json.message)
      if (json.action_link) setActionLink(json.action_link)
      onSuccess()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSending(false)
  }

  async function copyLink() {
    if (!actionLink) return
    await navigator.clipboard.writeText(actionLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-violet-500" /> Invitar miembro
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        {actionLink ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-green-700 font-medium">✓ Invitación creada</p>
            <p className="text-xs text-gray-500">Si el email falló, comparte este link directamente:</p>
            <div className="flex gap-2">
              <input readOnly value={actionLink} className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 font-mono truncate" />
              <button onClick={copyLink} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-gray-400" />}
              </button>
            </div>
            <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700">
              Cerrar
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email <span className="text-red-500">*</span></label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="miembro@empresa.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Nombre del miembro"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rol <span className="text-red-500">*</span></label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 bg-white">
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={onClose}
                className="flex-1 py-2.5 border border-gray-200 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={send} disabled={sending || !email}
                className="flex-1 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {sending ? 'Enviando…' : 'Invitar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Team Members ──────────────────────────────────────────────────────────────
function TeamMembers() {
  const [members, setMembers] = useState<Array<{
    id: string; user_id: string; role: string; is_owner: boolean;
    profile: { display_name: string | null; email: string | null } | null
  }>>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  function loadMembers() {
    fetch('/api/settings/team')
      .then(r => r.json())
      .then(j => setMembers(j.data ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadMembers() }, [])

  async function updateRole(memberId: string, role: string) {
    setSaving(memberId)
    try {
      await fetch('/api/settings/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, role }),
      })
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m))
      toast.success('Rol actualizado')
    } catch {
      toast.error('Error al actualizar rol')
    } finally {
      setSaving(null)
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    super_admin:     'Super Admin',
    agency_manager:  'Agency Manager',
    brand_manager:   'Brand Manager',
    finance:         'Finanzas',
    influencer:      'Influencer',
  }

  if (loading) return <div className="card p-6 animate-pulse h-32" />

  return (
    <>
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onSuccess={() => { setShowInvite(false); loadMembers() }}
        />
      )}
    <div className="card overflow-x-auto">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Miembros del equipo</h3>
          <p className="text-xs text-gray-400 mt-0.5">Gestiona los roles y permisos de acceso</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors"
        >
          <UserPlus className="h-3.5 w-3.5" /> Invitar
        </button>
      </div>
      {members.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">No hay miembros registrados aún.</div>
      ) : (
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Miembro', 'Email', 'Rol', ''].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {members.map(m => (
              <tr key={m.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">
                    {m.profile?.display_name ?? 'Sin nombre'}
                    {m.is_owner && <span className="ml-2 badge badge-violet text-[10px]">Owner</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{m.profile?.email ?? '—'}</td>
                <td className="px-4 py-3">
                  {m.is_owner ? (
                    <span className="text-sm text-gray-500 font-medium">Owner</span>
                  ) : (
                    <select
                      value={m.role}
                      disabled={saving === m.id}
                      onChange={e => updateRole(m.id, e.target.value)}
                      className="input-base text-sm py-1 pr-8 min-w-[150px]"
                    >
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {saving === m.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  )
}

export default function OrganizationSettingsPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <OrgSettingsForm />
      <TeamMembers />
    </div>
  )
}
