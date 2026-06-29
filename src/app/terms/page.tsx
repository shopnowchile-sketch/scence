import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Términos de servicio' }

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/login" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors">
            ← Volver
          </Link>
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white font-extrabold text-sm">S</div>
            <span className="text-lg font-bold text-gray-900">Scence</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Términos de servicio</h1>
          <p className="text-sm text-gray-400">Última actualización: mayo 2026</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-8 space-y-6 text-sm text-gray-600 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">1. Aceptación de términos</h2>
            <p>Al acceder y usar Scence, aceptas estar sujeto a estos Términos de Servicio. Si no estás de acuerdo con alguna parte, no podrás acceder al servicio.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">2. Descripción del servicio</h2>
            <p>Scence es una plataforma SaaS de gestión de campañas de marketing de influencers que permite a marcas y agencias administrar influencers, campañas, bookings, deliverables, facturación y pagos.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">3. Cuentas de usuario</h2>
            <p>Eres responsable de mantener la confidencialidad de tu cuenta y contraseña. Notifica inmediatamente cualquier uso no autorizado de tu cuenta.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">4. Datos y privacidad</h2>
            <p>El tratamiento de tus datos personales se rige por nuestra <Link href="/privacy" className="text-violet-600 hover:underline">Política de Privacidad</Link>. Al usar Scence, consientes dicho tratamiento.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">5. Propiedad intelectual</h2>
            <p>El contenido, diseño y código de Scence son propiedad de sus creadores. No puedes reproducir, distribuir ni crear obras derivadas sin autorización expresa.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">6. Limitación de responsabilidad</h2>
            <p>Scence se proporciona &quot;tal cual&quot;. No garantizamos disponibilidad ininterrumpida y no seremos responsables por daños indirectos o pérdida de datos.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">7. Cambios a los términos</h2>
            <p>Nos reservamos el derecho de modificar estos términos en cualquier momento. Te notificaremos por email ante cambios materiales.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">8. Contacto</h2>
            <p>Para preguntas sobre estos términos: <a href="mailto:hola@scence.app" className="text-violet-600 hover:underline">hola@scence.app</a></p>
          </section>
        </div>
      </div>
    </div>
  )
}
