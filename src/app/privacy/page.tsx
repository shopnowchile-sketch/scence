import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Política de Privacidad' }

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidad</h1>
          <p className="text-sm text-gray-400">Última actualización: mayo 2026</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-8 space-y-6 text-sm text-gray-600 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">1. Información que recopilamos</h2>
            <p>Recopilamos información que nos proporcionas al crear una cuenta (nombre, email, nombre de empresa), datos de uso de la plataforma, y datos de influencers y campañas que ingresas como parte del servicio.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">2. Cómo usamos tu información</h2>
            <p>Usamos tus datos para proveer y mejorar el servicio, enviar comunicaciones transaccionales (confirmaciones, notificaciones de campaña), procesar pagos vía Stripe, y cumplir obligaciones legales.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">3. Compartir información</h2>
            <p>No vendemos tus datos personales. Compartimos información únicamente con proveedores de servicios necesarios para operar Scence (Supabase para base de datos, Stripe para pagos, Resend para emails) bajo acuerdos de confidencialidad.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">4. Seguridad</h2>
            <p>Implementamos medidas de seguridad estándar de la industria incluyendo encriptación en tránsito (HTTPS/TLS), Row Level Security en base de datos, y autenticación segura via Supabase Auth.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">5. Tus derechos</h2>
            <p>Tienes derecho a acceder, corregir o eliminar tus datos personales. Para ejercer estos derechos contáctanos en <a href="mailto:privacy@scence.app" className="text-violet-600 hover:underline">privacy@scence.app</a>.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">6. Cookies</h2>
            <p>Usamos cookies de sesión necesarias para autenticación. No usamos cookies de seguimiento de terceros ni publicidad.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">7. Retención de datos</h2>
            <p>Conservamos tus datos mientras tu cuenta esté activa. Al cancelar tu cuenta, eliminamos tus datos personales en un plazo de 30 días salvo obligación legal de conservarlos.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">8. Contacto</h2>
            <p>Para consultas de privacidad: <a href="mailto:privacy@scence.app" className="text-violet-600 hover:underline">privacy@scence.app</a></p>
          </section>
        </div>
      </div>
    </div>
  )
}
