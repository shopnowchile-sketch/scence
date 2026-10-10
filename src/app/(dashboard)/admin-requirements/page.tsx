'use client'

import { useMemo, useState } from 'react'
import { Search, ChevronRight, CircleCheck, CircleDashed, CircleHelp, Clock3, FileCode2, ListChecks, Layers3, Workflow, ShieldCheck } from 'lucide-react'

type Status = 'Implementado' | 'Parcial' | 'Pendiente' | 'Por verificar'
type Requirement = {
  id: string
  title: string
  summary: string
  status: Status
  flow: string[]
  acceptance: string[]
  tests: string[]
  files: string[]
}
type Module = { name: string; description: string; requirements: Requirement[] }

const modules: Module[] = [
  { name: 'Campañas', description: 'Creación, configuración, postulación y seguimiento de campañas.', requirements: [
    { id:'CAM-001', title:'Crear y editar campañas', summary:'Configurar una campaña con sus datos comerciales, fechas, entregables, visibilidad y marcas asociadas.', status:'Parcial', flow:['Abrir Campañas y crear una campaña.','Completar datos, fechas y entregables disponibles.','Guardar y revisar la ficha resultante.'], acceptance:['La campaña se guarda con los campos válidos.','La edición conserva los datos no modificados.','Los campos opcionales no bloquean el guardado.'], tests:['Revisar pruebas existentes del flujo de campañas antes de certificar el resultado.'], files:['src/app/(dashboard)/admin-campaigns/','src/app/(dashboard)/admin-campaigns/new/'] },
    { id:'CAM-002', title:'Asignar múltiples Locations a una campaña', summary:'Permitir configurar más de una ubicación física para una campaña, reutilizando el catálogo canónico public.locations.', status:'Parcial', flow:['Crear o editar campaña.','Buscar y seleccionar una o más Locations.','Guardar la campaña y sus asociaciones.','Reabrir la ficha y validar que las ubicaciones persistan.'], acceptance:['Una campaña puede tener varias ubicaciones.','Las ubicaciones seleccionadas se recuperan al editar.','Las relaciones usan el catálogo canónico y no texto libre duplicado.'], tests:['Pendiente de verificación end-to-end en la UI local.','Revisar la migración/implementación campaign_locations antes de confirmar cobertura completa.'], files:['src/app/(dashboard)/admin-campaigns/','src/app/(dashboard)/admin-settings/locations/','public.locations','PR #89 (abierto en el momento de elaborar el catálogo)'] },
    { id:'CAM-003', title:'Modos de acceso de campaña', summary:'Distinguir campañas públicas, privadas y por invitación.', status:'Parcial', flow:['Elegir el modo de acceso al crear la campaña.','Guardar y revisar qué opciones de participación ve la persona creadora.'], acceptance:['El modo seleccionado persiste.','La UI aplica las reglas de acceso correspondientes.'], tests:['Confirmar en producción y pruebas automatizadas antes de cambiar el estado a Implementado.'], files:['src/app/(dashboard)/admin-campaigns/'] },
    { id:'CAM-004', title:'Postulación y selección de influencers', summary:'Gestionar postulaciones y la selección de perfiles para una campaña.', status:'Por verificar', flow:['Abrir una campaña.','Revisar postulaciones.','Aceptar o rechazar según permisos.'], acceptance:['Los cambios de estado se persisten y quedan reflejados en el detalle.'], tests:['Auditoría funcional pendiente.'], files:['src/app/(dashboard)/admin-campaigns/','src/app/(dashboard)/admin-influencers/'] },
  ]},
  { name: 'Locations', description: 'Catálogo canónico de ubicaciones físicas y jerarquía geográfica.', requirements: [
    { id:'LOC-001', title:'Administrar catálogo de Locations', summary:'Consultar y mantener ubicaciones organizadas por nivel geográfico y tipo.', status:'Parcial', flow:['Entrar a Configuración → Locations.','Buscar y explorar ubicaciones.','Crear, editar o desactivar según el nivel y permisos.'], acceptance:['Se mantiene una fuente canónica en public.locations.','La UI identifica país, región, comuna y lugar mediante la jerarquía disponible.','No se duplican catálogos innecesarios.'], tests:['Probar búsqueda, creación, edición y navegación jerárquica.','Verificar RLS y permisos con distintos roles.'], files:['src/app/(dashboard)/admin-settings/locations/page.tsx','src/lib/locations','public.locations','PR #85 (abierto)'] },
    { id:'LOC-002', title:'Resolver ubicaciones en flujos físicos', summary:'Usar Location IDs consistentes en los flujos que requieren una ubicación real.', status:'Por verificar', flow:['Elegir o resolver la Location en el formulario correspondiente.','Guardar referencia a la Location.','Reabrir el registro y comprobar que la referencia se conserva.'], acceptance:['Los flujos usan IDs canónicos cuando corresponda.','La información heredada se resuelve o se señala para revisión, no se inventa.'], tests:['Verificar bookings, events y campañas; comprobar nulos y casos heredados.'], files:['src/lib/locations/','src/app/(dashboard)/admin-settings/locations/','public.bookings','public.events','public.locations'] },
  ]},
  { name: 'Influencers', description: 'Perfiles, datos sociales, documentos y calidad de datos.', requirements: [
    { id:'INF-001', title:'Administrar perfiles de influencers', summary:'Consultar y mantener perfiles, datos de contacto y redes sociales.', status:'Por verificar', flow:['Abrir Influencers.','Buscar un perfil.','Revisar y editar información permitida.'], acceptance:['La búsqueda permite encontrar perfiles existentes.','Los cambios se guardan con permisos adecuados.'], tests:['Revisar paginación, perfiles incompletos y controles de autorización.'], files:['src/app/(dashboard)/admin-influencers/','public.influencers','public.influencer_social_profiles'] },
    { id:'INF-002', title:'Calidad y completitud de perfiles', summary:'Detectar perfiles con datos requeridos faltantes o ubicaciones incompletas.', status:'Parcial', flow:['Abrir calidad de datos.','Explorar el resumen y el detalle geográfico.','Identificar perfiles que necesitan corrección.'], acceptance:['Los conteos corresponden a los datos consultados.','El detalle permite localizar registros que requieren acción.'], tests:['Comparar métricas de UI con consultas de lectura a la base de datos.'], files:['src/app/(dashboard)/admin-influencers/data-quality/','public.influencers','public.locations'] },
  ]},
  { name: 'Bookings', description: 'Reservas y coordinación de acciones.', requirements: [
    { id:'BKG-001', title:'Gestionar bookings', summary:'Consultar reservas asociadas a campañas y perfiles.', status:'Por verificar', flow:['Abrir Bookings.','Buscar una reserva.','Revisar estados y datos asociados.'], acceptance:['La lista y el detalle reflejan los datos guardados.','Los cambios respetan los permisos.'], tests:['Validar estados, relaciones con campañas y Location.'], files:['src/app/(dashboard)/admin-bookings/','public.bookings'] },
  ]},
  { name: 'Marcas', description: 'Cuentas de marca, usuarios y relaciones entre marcas.', requirements: [
    { id:'BRD-001', title:'Administrar marcas y usuarios', summary:'Consultar fichas de marca y gestionar los usuarios asociados.', status:'Por verificar', flow:['Abrir Marcas.','Seleccionar una ficha.','Revisar datos, usuarios y campañas asociadas.'], acceptance:['Las relaciones mostradas corresponden a datos persistidos.','El acceso está limitado por rol.'], tests:['Probar permisos de administración y aislamiento por organización.'], files:['src/app/(dashboard)/admin-brands/','public.brands','public.brand_members'] },
  ]},
  { name: 'CRM', description: 'Leads comerciales, actividades y correo individual o por lotes controlados.', requirements: [
    { id:'CRM-001', title:'Gestionar leads comerciales', summary:'Buscar leads y actualizar su estado comercial con historial.', status:'Parcial', flow:['Abrir CRM.','Filtrar y abrir un lead.','Actualizar estado o registrar una actividad.'], acceptance:['Los cambios quedan persistidos y consultables.','Los filtros no eliminan registros del origen.'], tests:['Revisar filtros, selección, historial de actividad y estados.'], files:['src/app/(dashboard)/admin-crm/','public.crm_leads','public.crm_lead_activities'] },
    { id:'CRM-002', title:'Enviar correos con protección contra duplicados', summary:'Gestionar envíos con guardas, trazabilidad y reanudación segura.', status:'Parcial', flow:['Seleccionar el envío permitido.','Procesar y registrar eventos.','Ante resultado incierto, evitar el reenvío automático no seguro.'], acceptance:['El sistema registra resultados y eventos.','Los casos de aceptación incierta no provocan duplicados silenciosos.','Los opt-outs se respetan.'], tests:['Consultar tests/crm-bulk-send-guard.test.ts y validar el entorno antes de certificar.'], files:['src/lib/crm-send-guard.ts','src/lib/crm-bulk-send.ts','src/app/(dashboard)/admin-crm/envios/','public.crm_bulk_send_jobs','public.crm_email_events','public.email_optouts'] },
  ]},
  { name: 'Billing', description: 'Facturación de campañas, documentos y líneas de factura.', requirements: [
    { id:'BIL-001', title:'Gestionar facturas', summary:'Consultar facturas y sus líneas asociadas.', status:'Por verificar', flow:['Abrir Billing.','Seleccionar una factura.','Revisar importe, líneas y estado.'], acceptance:['Los importes y las líneas son consistentes con la base de datos.'], tests:['Validar totales y transiciones según el flujo actual.'], files:['src/app/(dashboard)/admin-billing/','public.invoices','public.invoice_line_items'] },
  ]},
  { name: 'Payroll', description: 'Liquidaciones y pagos a influencers.', requirements: [
    { id:'PAY-001', title:'Preparar nóminas de pago', summary:'Gestionar lotes y partidas de payroll.', status:'Por verificar', flow:['Abrir Payroll.','Consultar una corrida y sus partidas.','Verificar estados.'], acceptance:['Las partidas están vinculadas a los registros esperados.'], tests:['Revisar casos sin partidas y permisos financieros.'], files:['src/app/(dashboard)/admin-payroll/','public.payroll_runs','public.payroll_items'] },
  ]},
  { name: 'Contratos', description: 'Plantillas contractuales y contratos por campaña.', requirements: [
    { id:'CON-001', title:'Generar y consultar contratos', summary:'Consultar contratos y plantillas y revisar sus relaciones.', status:'Parcial', flow:['Abrir Contratos o una ficha relacionada.','Elegir o revisar plantilla.','Consultar el contrato generado.'], acceptance:['Contrato y plantilla quedan asociados correctamente.','La UI comunica estados reales de firma.'], tests:['Validar generación, descarga y firma según disponibilidad actual.'], files:['src/app/(dashboard)/admin-contracts/','public.contracts','public.contract_templates','public.contract_signatures'] },
  ]},
  { name: 'Eventos', description: 'Eventos presenciales, ubicaciones y entradas.', requirements: [
    { id:'EVT-001', title:'Administrar eventos', summary:'Consultar eventos y los datos asociados de ubicación y entradas.', status:'Por verificar', flow:['Abrir Eventos.','Crear o editar un evento.','Verificar ubicación y configuración de entradas.'], acceptance:['La Location se conserva cuando está configurada.','La vista no presenta datos no persistidos como guardados.'], tests:['Probar creación/edición y referencia a locations.'], files:['src/app/(dashboard)/admin-events/','public.events','public.locations'] },
  ]},
  { name: 'Afiliados', description: 'Enlaces, conversiones y liquidaciones de comisión.', requirements: [
    { id:'AFF-001', title:'Gestionar afiliados y conversiones', summary:'Consultar enlaces y sus conversiones relacionadas.', status:'Por verificar', flow:['Abrir Afiliados.','Seleccionar un enlace.','Revisar conversiones y liquidaciones disponibles.'], acceptance:['Las conversiones se vinculan al enlace correcto.'], tests:['Validar estados vacíos y datos existentes.'], files:['src/app/(dashboard)/admin-affiliates/','public.affiliate_links','public.affiliate_conversions','public.commission_settlements'] },
  ]},
  { name: 'Soporte', description: 'Tickets de soporte y respuestas.', requirements: [
    { id:'SUP-001', title:'Gestionar tickets', summary:'Consultar tickets y su historial de conversación.', status:'Por verificar', flow:['Abrir Soporte.','Seleccionar un ticket.','Consultar respuestas y estado.'], acceptance:['Las respuestas pertenecen al ticket correcto.','El acceso respeta los permisos.'], tests:['Validar estados, respuestas y aislamiento por organización.'], files:['src/app/(dashboard)/admin-support/','public.tickets','public.ticket_replies'] },
  ]},
  { name: 'Analytics', description: 'Métricas e informes de negocio.', requirements: [
    { id:'ANA-001', title:'Consultar métricas del negocio', summary:'Visualizar indicadores basados en los datos disponibles.', status:'Por verificar', flow:['Abrir Analytics.','Elegir el informe disponible.','Contrastar los valores con sus fuentes.'], acceptance:['Cada indicador tiene una fuente verificable.','Los estados vacíos y errores son claros.'], tests:['Contrastar métricas con consultas y validar rangos de fechas.'], files:['src/app/(dashboard)/admin-analytics/'] },
  ]},
  { name: 'Dashboard', description: 'Resumen operativo y accesos rápidos.', requirements: [
    { id:'DSH-001', title:'Mostrar resumen operativo', summary:'Consultar indicadores y pendientes relevantes para administración.', status:'Por verificar', flow:['Abrir Dashboard.','Revisar tarjetas y contadores.','Abrir el módulo correspondiente desde un acceso.'], acceptance:['Los indicadores coinciden con su fuente y los permisos del usuario.'], tests:['Validar valores vacíos, errores de carga y navegación.'], files:['src/app/(dashboard)/admin-dash/','src/app/api/navigation/summary/'] },
  ]},
  { name: 'Suscripciones y planes', description: 'Planes y pagos recurrentes de influencers y marcas.', requirements: [
    { id:'SUB-001', title:'Consultar suscripciones y pagos', summary:'Identificar el estado de suscripción y el historial de cobros.', status:'Por verificar', flow:['Abrir la ficha o módulo que presenta suscripciones.','Consultar estado y pagos asociados.'], acceptance:['El estado se deriva del registro autoritativo y no de una etiqueta aislada.'], tests:['Verificar estados active/trialing y eventos webhook.'], files:['public.subscriptions','public.subscription_payments','src/lib/'] },
  ]},
]

const statuses: Status[] = ['Implementado', 'Parcial', 'Pendiente', 'Por verificar']
const statusStyle: Record<Status, string> = {
  Implementado: 'bg-emerald-50 text-emerald-700',
  Parcial: 'bg-amber-50 text-amber-700',
  Pendiente: 'bg-rose-50 text-rose-700',
  'Por verificar': 'bg-slate-100 text-slate-600',
}
const StatusIcon = ({ status }: { status: Status }) => status === 'Implementado' ? <CircleCheck className="w-4 h-4" /> : status === 'Parcial' ? <Clock3 className="w-4 h-4" /> : status === 'Pendiente' ? <CircleDashed className="w-4 h-4" /> : <CircleHelp className="w-4 h-4" />

export default function AdminRequirementsPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Status | 'Todos'>('Todos')
  const [moduleFilter, setModuleFilter] = useState('Todos')
  const [selectedId, setSelectedId] = useState('CAM-001')

  const allRequirements = useMemo(() => modules.flatMap(module => module.requirements.map(requirement => ({ ...requirement, module: module.name }))), [])
  const filtered = allRequirements.filter(req => {
    const content = [req.id, req.title, req.summary, req.module, ...req.files].join(' ').toLowerCase()
    return (filter === 'Todos' || req.status === filter) && (moduleFilter === 'Todos' || req.module === moduleFilter) && content.includes(query.toLowerCase())
  })
  const selected = allRequirements.find(req => req.id === selectedId) ?? filtered[0] ?? allRequirements[0]
  const counts = statuses.reduce((acc, status) => ({ ...acc, [status]: allRequirements.filter(req => req.status === status).length }), {} as Record<Status, number>)

  return <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">SCENCE · Product & Engineering</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Requerimientos</h1>
        <p className="mt-1 text-sm text-gray-500">Catálogo funcional por módulo → funcionalidad → requerimiento</p>
      </div>
      <div className="text-sm text-gray-500">{modules.length} módulos · {allRequirements.length} requerimientos iniciales</div>
    </header>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {statuses.map(status => <button key={status} onClick={() => setFilter(filter === status ? 'Todos' : status)} className={'rounded-xl border bg-white p-4 text-left transition hover:shadow-sm ' + (filter === status ? 'border-violet-300 ring-2 ring-violet-100' : 'border-gray-200')}>
        <div className="flex items-center justify-between text-xs text-gray-500"><span>{status}</span><StatusIcon status={status}/></div>
        <div className="mt-2 text-2xl font-bold text-gray-900">{counts[status]}</div>
      </button>)}
    </section>

    <section className="flex flex-col gap-3 md:flex-row">
      <label className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar requerimiento, archivo o módulo…" className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"/>
      </label>
      <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
        <option>Todos</option>{modules.map(m => <option key={m.name}>{m.name}</option>)}
      </select>
      <select value={filter} onChange={e => setFilter(e.target.value as Status | 'Todos')} className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
        <option>Todos los estados</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.6fr)]">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700"><Layers3 className="w-4 h-4"/>Módulos y requerimientos</div>
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
          {filtered.map(req => <button key={req.id} onClick={() => setSelectedId(req.id)} className={'w-full p-4 text-left transition hover:bg-gray-50 ' + (selected?.id === req.id ? 'bg-violet-50/60 border-l-2 border-l-violet-500' : '')}>
            <div className="flex items-start gap-2"><span className="mt-0.5 text-[10px] font-semibold text-gray-400">{req.id}</span><span className="flex-1 text-sm font-semibold text-gray-900">{req.title}</span><ChevronRight className="w-4 h-4 text-gray-300"/></div>
            <p className="mt-1 pl-0 text-xs text-gray-500">{req.module} · {req.summary}</p>
            <span className={'mt-3 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ' + statusStyle[req.status]}>{req.status}</span>
          </button>)}
          {filtered.length === 0 && <p className="p-6 text-sm text-gray-500">No hay requerimientos que coincidan con la búsqueda.</p>}
        </div>
      </div>

      <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 md:p-7">
        {selected ? <>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-violet-600">{selected.id}</span><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' + statusStyle[selected.status]}>{selected.status}</span></div>
          <h2 className="mt-3 text-2xl font-bold text-gray-950">{selected.title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{selected.summary}</p>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div><h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Workflow className="w-4 h-4 text-violet-600"/>Flujo funcional</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-5 text-gray-600">{selected.flow.map(s => <li key={s}>{s}</li>)}</ol></div>
            <div><h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><ShieldCheck className="w-4 h-4 text-violet-600"/>Criterios de aceptación</h3><ul className="mt-3 space-y-2 text-sm text-gray-600">{selected.acceptance.map(s => <li key={s} className="flex gap-2"><span className="text-violet-500">•</span><span>{s}</span></li>)}</ul></div>
            <div><h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><ListChecks className="w-4 h-4 text-violet-600"/>Pruebas y verificación</h3><ul className="mt-3 space-y-2 text-sm text-gray-600">{selected.tests.map(s => <li key={s}>• {s}</li>)}</ul></div>
            <div><h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><FileCode2 className="w-4 h-4 text-violet-600"/>Archivos y fuentes relacionados</h3><ul className="mt-3 space-y-2 text-xs text-gray-500">{selected.files.map(s => <li key={s} className="break-all rounded-lg bg-gray-50 px-3 py-2">{s}</li>)}</ul></div>
          </div>
        </> : <p className="text-sm text-gray-500">Selecciona un requerimiento para ver el detalle.</p>}
      </div>
    </section>
    <p className="text-xs text-gray-400">Los estados son una clasificación inicial de trabajo, no una certificación automática. Los requerimientos marcados «Por verificar» requieren comprobación funcional antes de considerarse implementados.</p>
  </div>
}
