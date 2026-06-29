import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// ── Invoices ──────────────────────────────────────────────────────────────────
interface InvoiceParams {
  status?: string
  search?: string
  date_from?: string
  date_to?: string
  page?: number
  limit?: number
}

async function fetchInvoices(params: InvoiceParams) {
  const sp = new URLSearchParams()
  if (params.status)    sp.set('status', params.status)
  if (params.search)    sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))

  const res = await fetch(`/api/invoices?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar facturas')
  return res.json()
}

export function useInvoices(params: InvoiceParams = {}) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn:  () => fetchInvoices(params),
  })
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear factura')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      toast.success('Factura creada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function usePatchInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar factura')
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Payroll ───────────────────────────────────────────────────────────────────
interface PayrollParams {
  status?: string
  page?: number
  limit?: number
}

async function fetchPayroll(params: PayrollParams) {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.page)   sp.set('page', String(params.page))
  if (params.limit)  sp.set('limit', String(params.limit))

  const res = await fetch(`/api/payroll?${sp.toString()}`)
  if (!res.ok) throw new Error('Error al cargar payroll')
  return res.json()
}

export function usePayroll(params: PayrollParams = {}) {
  return useQuery({
    queryKey: ['payroll', params],
    queryFn:  () => fetchPayroll(params),
  })
}

export function useCreatePayroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear payroll')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll'] })
      toast.success('Payroll creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function usePatchPayroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ run_id, action }: { run_id: string; action: string }) => {
      const res = await fetch('/api/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id, action }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al procesar payroll')
      }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
    onError: (err: Error) => toast.error(err.message),
  })
}
