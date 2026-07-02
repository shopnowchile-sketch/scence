'use client'

/**
 * /brand-billing — Billing operativo (facturas, cobros entre marcas/campañas).
 * NO es suscripción SaaS. Para cambiar de plan ir a /brand-settings/plan.
 */

import { FileText } from 'lucide-react'

export default function BrandBillingPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Facturación</h1>
        <p className="text-sm text-gray-400 mt-0.5">Historial de cobros y documentos tributarios</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-12 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center">
          <FileText className="h-6 w-6 text-gray-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">Facturación próximamente</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">
            Aquí encontrarás tus facturas, boletas y cobros operativos. Módulo en desarrollo.
          </p>
        </div>
      </div>
    </div>
  )
}
