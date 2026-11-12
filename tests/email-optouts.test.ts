import { crmCatalogEmail } from '../src/lib/crm-email-html.ts'
// Pruebas del bloqueo comercial. Sin dependencias nuevas: `node --test` de
// Node 22 ejecuta TypeScript directamente.
//
//   npm run test:optouts
//
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.env.INTERNAL_JOB_SECRET = process.env.INTERNAL_JOB_SECRET || 'test-secret-para-firmar-tokens'

import {
  buildUnsubscribeUrl,
  classifyResendEvent,
  commercialEmailHeaders,
  getBlockedEmails,
  isOptedOut,
  normalizeEmail,
  OptOutLookupError,
  recordOptOut,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../src/lib/email-optouts.ts'
import { applyCrmPresentationVariables, CRM_PRESENTATION_KEY, CRM_EMAIL_CATALOG, getEmailTemplate, applyEmailVariables } from '../src/lib/email-catalog.ts'

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')

/** Doble de la tabla `email_optouts` con las mismas formas de llamada. */
function fakeAdmin(seed: string[] = [], opts: { failLookup?: boolean; throwLookup?: boolean } = {}) {
  const rows = new Set(seed.map(e => e.toLowerCase()))
  const admin = {
    rows,
    from() {
      return {
        select: () => ({
          in: async (_col: string, values: string[]) => {
            if (opts.throwLookup) throw new Error('ECONNREFUSED contra Supabase')
            if (opts.failLookup) return { data: null, error: { message: 'connection terminated unexpectedly' } }
            return {
              data: values.filter(v => rows.has(v)).map(email => ({ email })),
              error: null,
            }
          },
        }),
        upsert: (payload: { email: string }) => ({
          select: async () => {
            if (rows.has(payload.email)) return { data: [], error: null }
            rows.add(payload.email)
            return { data: [{ email: payload.email }], error: null }
          },
        }),
      }
    },
  }
  return admin as unknown as Parameters<typeof getBlockedEmails>[0] & { rows: Set<string> }
}

const LEAD = '26350a00-acd0-48c5-8149-aafb75ffad58'

describe('1 · Baja voluntaria', () => {
  test('una baja bloquea a esa dirección para el CRM', async () => {
    const admin = fakeAdmin()
    assert.equal(await isOptedOut(admin, 'marca@ejemplo.cl'), false)

    const res = await recordOptOut(admin, { email: 'marca@ejemplo.cl', reason: 'unsubscribe', source: 'link', leadId: LEAD })
    assert.equal(res.ok, true)
    assert.equal(res.inserted, true)

    assert.equal(await isOptedOut(admin, 'marca@ejemplo.cl'), true)
  })

  test('el bloqueo no depende de mayúsculas ni espacios', async () => {
    const admin = fakeAdmin(['marca@ejemplo.cl'])
    assert.equal(await isOptedOut(admin, '  MARCA@Ejemplo.CL '), true)
    assert.equal(normalizeEmail('  MARCA@Ejemplo.CL '), 'marca@ejemplo.cl')
  })
})

describe('2 · Idempotencia', () => {
  test('repetir la baja no duplica ni falla, y la segunda no es inserción', async () => {
    const admin = fakeAdmin()
    const primera = await recordOptOut(admin, { email: 'repetida@ejemplo.cl', reason: 'unsubscribe' })
    const segunda = await recordOptOut(admin, { email: 'repetida@ejemplo.cl', reason: 'unsubscribe' })

    assert.equal(primera.inserted, true)
    assert.equal(segunda.ok, true)
    assert.equal(segunda.inserted, false, 'la segunda baja no debe insertar otra fila')
    assert.equal(admin.rows.size, 1)
  })
})

describe('3-5 · Clasificación de eventos de Resend', () => {
  test('queja de spam bloquea', () => {
    const d = classifyResendEvent('email.complained', null)
    assert.equal(d.block, true)
    assert.equal(d.reason, 'complaint')
  })

  test('rebote PERMANENTE bloquea', () => {
    const d = classifyResendEvent('email.bounced', { bounce: { type: 'Permanent', subType: 'General' } })
    assert.equal(d.block, true)
    assert.equal(d.reason, 'bounce')
  })

  test('rebote TRANSIENT (buzón lleno) NO bloquea', () => {
    const d = classifyResendEvent('email.bounced', { bounce: { type: 'Transient', subType: 'MailboxFull' } })
    assert.equal(d.block, false)
    assert.equal(d.reason, null)
  })

  test('rebote transitorio general tampoco bloquea', () => {
    assert.equal(classifyResendEvent('email.bounced', { bounce: { type: 'Transient', subType: 'General' } }).block, false)
  })

  test('rebote sin tipo informado no bloquea (ante la duda, no se pierde el lead)', () => {
    assert.equal(classifyResendEvent('email.bounced', null).block, false)
    assert.equal(classifyResendEvent('email.bounced', { bounce: { type: 'Undetermined' } }).block, false)
  })

  test('supresión de Resend bloquea', () => {
    assert.equal(classifyResendEvent('email.suppressed', null).block, true)
  })

  test('eventos normales no bloquean nada', () => {
    for (const e of ['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.delivery_delayed', 'email.failed']) {
      assert.equal(classifyResendEvent(e, null).block, false, `${e} no debe bloquear`)
    }
  })
})

describe('6 · El bulk salta al bloqueado y sigue con el resto', () => {
  test('getBlockedEmails devuelve solo los bloqueados del lote', async () => {
    const admin = fakeAdmin(['baja@ejemplo.cl', 'rebote@ejemplo.cl'])
    const lote = ['ok1@ejemplo.cl', 'BAJA@ejemplo.cl', 'ok2@ejemplo.cl', null, 'rebote@ejemplo.cl', undefined]
    const blocked = await getBlockedEmails(admin, lote)

    assert.deepEqual(Array.from(blocked).sort(), ['baja@ejemplo.cl', 'rebote@ejemplo.cl'])
    const enviables = lote.filter(e => e && !blocked.has(normalizeEmail(e)))
    assert.deepEqual(enviables, ['ok1@ejemplo.cl', 'ok2@ejemplo.cl'], 'los demás leads deben seguir siendo enviables')
  })

  test('sendLeadBatch salta con `continue` — no corta el job', () => {
    // La lógica del loop vive en processLeadBatch (crm-send-guard.ts); crm-bulk-send.ts
    // solo le entrega el conjunto de bloqueados.
    assert.ok(src('lib/crm-bulk-send.ts').includes('blocked.has(normalizeEmail(email))'), 'sendLeadBatch debe pasar el conjunto de bloqueados')
    const code = src('lib/crm-send-guard.ts')
    const inicio = code.indexOf('if (deps.isBlocked(')
    assert.ok(inicio > -1, 'debe existir la guarda de bloqueo en el loop')
    const hastaContinue = code.slice(inicio, code.indexOf('continue', inicio))
    assert.ok(hastaContinue.includes('skipped++'), 'el bloqueado debe contarse como skipped')
    assert.ok(hastaContinue.includes('crm_lead_activities'), 'el skip debe quedar trazado en el timeline')
    assert.ok(!hastaContinue.includes('return') && !hastaContinue.includes('throw'), 'el skip no debe cortar el job')
  })
})

describe('7 · Envío individual bloqueado no manda', () => {
  test('la guarda de opt-out va ANTES de emails.send y responde 409', () => {
    const code = src('app/api/crm-leads/[id]/send-intro/route.ts')
    const guarda = code.indexOf('isOptedOut(admin, lead.email)')
    const envio = code.indexOf('emails.send(')
    assert.ok(guarda > -1, 'send-intro debe consultar el opt-out')
    assert.ok(envio > -1)
    assert.ok(guarda < envio, 'la verificación debe ocurrir antes del envío')
    assert.ok(code.slice(guarda, envio).includes('status: 409'), 'debe cortar con 409 sin enviar')
  })
})

describe('8 · Headers de baja', () => {
  const url = 'https://scence-app.vercel.app/api/unsubscribe?l=abc&t=xyz'
  const headers = commercialEmailHeaders(url)

  test('List-Unsubscribe incluye la URL entre <> y un mailto', () => {
    assert.ok(headers['List-Unsubscribe'].includes(`<${url}>`))
    assert.ok(headers['List-Unsubscribe'].includes('mailto:'))
  })

  test('List-Unsubscribe-Post habilita el botón de un clic (RFC 8058)', () => {
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  })

  test('los dos caminos comerciales los adjuntan', () => {
    for (const f of ['lib/crm-bulk-send.ts', 'app/api/crm-leads/[id]/send-intro/route.ts']) {
      assert.ok(src(f).includes('headers: commercialEmailHeaders(unsubscribeUrl)'), `${f} debe mandar los headers`)
    }
  })

  test('el pie de baja solo existe en el layout comercial', () => {
    const layout = src('lib/crm-email-html.ts')
    assert.equal(layout.split('date de baja aquí').length - 1, 1)
    assert.ok(layout.slice(layout.indexOf('export function crmCatalogEmail')).includes('date de baja aquí'))
    assert.ok(!src('lib/resend.ts').includes('date de baja aquí'))
  })
})

describe('9 · Token y ruta de baja', () => {
  test('el token válido verifica', () => {
    const t = signUnsubscribeToken(LEAD)
    assert.ok(t && t.length > 20)
    assert.equal(verifyUnsubscribeToken(LEAD, t), true)
  })

  test('token alterado, de otro lead, vacío o nulo → inválido', () => {
    const t = signUnsubscribeToken(LEAD)!
    assert.equal(verifyUnsubscribeToken(LEAD, t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a')), false)
    assert.equal(verifyUnsubscribeToken('00000000-0000-0000-0000-000000000000', t), false)
    assert.equal(verifyUnsubscribeToken(LEAD, ''), false)
    assert.equal(verifyUnsubscribeToken(LEAD, null), false)
  })

  test('la URL no lleva el email (nada de PII en la query string)', () => {
    const url = buildUnsubscribeUrl(LEAD)!
    assert.ok(url.includes(`l=${LEAD}`) && url.includes('&t='))
    assert.ok(!url.includes('@'), 'la URL no debe contener una dirección de correo')
  })

  test('sin secreto configurado no hay URL — y entonces no se envía', () => {
    const real = process.env.INTERNAL_JOB_SECRET
    const realUnsub = process.env.UNSUBSCRIBE_SECRET
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.UNSUBSCRIBE_SECRET
    try {
      assert.equal(buildUnsubscribeUrl(LEAD), null)
      assert.equal(signUnsubscribeToken(LEAD), null)
    } finally {
      process.env.INTERNAL_JOB_SECRET = real
      if (realUnsub) process.env.UNSUBSCRIBE_SECRET = realUnsub
    }

    for (const f of ['lib/crm-bulk-send.ts', 'app/api/crm-leads/[id]/send-intro/route.ts']) {
      assert.ok(src(f).includes('if (!unsubscribeUrl)'), `${f} debe negarse a enviar sin link de baja`)
    }
  })

  test('la ruta es pública, no cacheable y responde GET y POST', () => {
    const route = src('app/api/unsubscribe/route.ts')
    assert.ok(route.includes('export async function GET'))
    assert.ok(route.includes('export async function POST'), 'POST es obligatorio para el botón de un clic')
    assert.ok(route.includes('verifyUnsubscribeToken'), 'debe validar el token')
    assert.ok(route.includes('no-store'))
    assert.ok(route.includes('noindex'))
    assert.ok(!route.includes('auth.getUser'), 'la baja no debe requerir sesión')
  })
})

describe('10 · Los emails transaccionales no se ven afectados', () => {
  const PERMITIDOS = [
    'src/lib/crm-bulk-send.ts',
    'src/app/api/crm-leads/[id]/send-intro/route.ts',
    'src/app/api/webhooks/resend/route.ts',
    'src/app/api/unsubscribe/route.ts',
    'src/app/api/crm-leads/route.ts', // solo lectura: filtro de suscripción del CRM
  ]

  test('solo los 2 caminos comerciales, el webhook y la ruta de baja conocen el opt-out', () => {
    const raiz = fileURLToPath(new URL('../src/', import.meta.url))
    const importadores: string[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}${entry.name}`
        if (entry.isDirectory()) walk(`${full}/`)
        else if (/\.tsx?$/.test(entry.name)) {
          const code = readFileSync(full, 'utf8')
          if (code.includes("from '@/lib/email-optouts'") || code.includes('email_optouts')) {
            importadores.push('src/' + full.slice(raiz.length))
          }
        }
      }
    }
    walk(raiz)

    const inesperados = importadores.filter(f => !PERMITIDOS.includes(f) && f !== 'src/lib/email-optouts.ts')
    assert.deepEqual(inesperados, [], `estos archivos no deberían consultar el opt-out: ${inesperados.join(', ')}`)
  })

  test('ningún flujo transaccional filtra por opt-out antes de enviar', () => {
    const transaccionales = [
      'app/api/auth/forgot-password/route.ts',
      'app/api/brands/[id]/invite/route.ts',
      'app/api/invoices/[id]/route.ts',
      'app/api/campaigns/[id]/report/email/route.ts',
      'lib/campaign-notifications.ts',
      'lib/support-notifications.ts',
    ]
    for (const f of transaccionales) {
      const code = src(f)
      assert.ok(!code.includes('isOptedOut'), `${f} no debe consultar el opt-out`)
      assert.ok(!code.includes('getBlockedEmails'), `${f} no debe consultar el opt-out`)
      assert.ok(code.includes('emails.send') || code.includes('batch.send'), `${f} debe seguir enviando`)
    }
  })
})

describe('Presentación comercial CRM', () => {
  const template = getEmailTemplate(CRM_PRESENTATION_KEY)!

  test('aparece en el catálogo con asunto, nombre y contexto CRM', () => {
    assert.ok(CRM_EMAIL_CATALOG.includes(template))
    assert.equal(template.name, 'Presentación SCENCE — Marcas y negocios')
    assert.equal(template.category, 'crm')
    assert.equal(template.defaultSubject, 'Me encantaría que conozcas SCENCE 💙')
  })

  test('personaliza con los campos del CRM y usa alternativas independientes', () => {
    const message = template.defaultMessage!
    assert.match(applyCrmPresentationVariables(message, { contact_name: ' Camila ' }), /^Hola Camila, ¿cómo estás\?/)
    assert.match(applyCrmPresentationVariables(message, { contact_name: 'Camila' }), /campaña para tu negocio\./)
    const withoutName = applyCrmPresentationVariables(message, { contact_name: '  ', company_name: ' Café Volcán ' })
    assert.match(withoutName, /^Hola, ¿cómo estás\?/)
    assert.ok(withoutName.includes('campaña para **Café Volcán**.'))
    const withoutData = applyCrmPresentationVariables(message + ' {{variable_desconocida}}', { contact_name: null })
    assert.match(withoutData, /^Hola, ¿cómo estás\?/)
    assert.ok(withoutData.includes('campaña para tu negocio.'))
    assert.doesNotMatch(withoutData, /{{|undefined|null/)
  })

  test('el HTML del correo incluye los enlaces y escapa los datos del contacto', () => {
    const message = applyCrmPresentationVariables(template.defaultMessage!, { contact_name: '<b>Camila</b>' })
    const html = crmCatalogEmail({ message, presentation: true, unsubscribeUrl: 'https://example.com/baja' })
    for (const href of ['https://www.scence.cl', 'https://www.instagram.com/influencers.snc/', 'https://wa.me/56975265196']) {
      assert.ok(html.includes(`href="${href}"`))
    }
    assert.ok(html.includes('Hola &lt;b&gt;Camila&lt;/b&gt;,'))
    assert.ok(html.includes('<strong>Pri</strong>'))
    assert.ok(html.includes('href="https://example.com/baja"'))
    assert.doesNotMatch(html, /linear-gradient|<img|Registrar mi marca/)
  })

  test('las plantillas anteriores conservan formato y botones', () => {
    const html = crmCatalogEmail({
      message: '**Texto** y www.scence.cl',
      registerLinks: { brandUrl: 'https://example.com/marca', creatorUrl: 'https://example.com/creadora' },
    })
    assert.ok(html.includes('**Texto** y www.scence.cl'))
    assert.ok(html.includes('linear-gradient'))
    assert.ok(html.includes('Registrar mi marca'))
  })
})

describe('11 · Templates del CRM sin regresión', () => {
  test('plantillas anteriores y presentación comercial, con el copy aprobado', () => {
    assert.equal(CRM_EMAIL_CATALOG.length, 8)
    const intro = getEmailTemplate('crm_intro')!
    const render = applyEmailVariables(intro.defaultMessage!, { contact_name: 'Camila', company_name: 'Café Volcán' })
    assert.ok(render.includes('Soy Priscilla de SCENCE. Trabajamos con una comunidad de creadoras de contenido'))
    assert.ok(render.startsWith('Hola Camila!'))
    assert.ok(!render.includes('{{'))
    const inf = getEmailTemplate('crm_influencer_invite')!
    const brand = getEmailTemplate('crm_brand_invite')!
    assert.ok(inf.registrationSection && brand.registrationSection)
    assert.ok(brand.defaultMessage!.includes('registra tu marca'))
    assert.ok(inf.defaultMessage!.includes('Únete a nuestra plataforma como influencer'))
  })

  test('no reaparece copy legado', () => {
    for (const t of CRM_EMAIL_CATALOG) {
      const legacyCopy = ['primera campaña gratis', 'primera campaña gratuita']
      if (t.key !== CRM_PRESENTATION_KEY) legacyCopy.push('Soy Pri, fundadora')
      for (const legado of legacyCopy) {
        assert.ok(!(t.defaultMessage ?? '').includes(legado), `${t.key} trae copy legado`)
      }
    }
  })
})

describe('12 · El webhook existente sigue intacto', () => {
  const code = src('app/api/webhooks/resend/route.ts')

  test('conserva firma svix, dedupe, log de eventos y timeline', () => {
    assert.ok(code.includes('new Webhook(secret)'), 'debe seguir verificando la firma')
    assert.ok(code.includes('RESEND_WEBHOOK_SECRET'))
    assert.ok(code.includes('duplicate: true'), 'debe conservar el dedupe de reintentos de Svix')
    assert.ok(code.includes("from('crm_email_events')"), 'debe seguir registrando el evento')
    assert.ok(code.includes("from('crm_lead_activities')"), 'debe seguir escribiendo el timeline')
    assert.ok(code.includes('received: true'))
  })

  test('el bloqueo se registra DESPUÉS de registrar el evento', () => {
    // La clasificación se hace temprano (para saltar eventos no-CRM, fix
    // 2026-09-28), pero el opt-out se escribe recién después de insertar el
    // evento: el evento queda registrado aunque el bloqueo falle.
    const insertEvent = code.indexOf("from('crm_email_events').insert(")
    const recordBlock = code.indexOf('recordOptOut(admin')
    assert.ok(insertEvent > -1 && recordBlock > -1)
    assert.ok(insertEvent < recordBlock, 'el evento debe quedar registrado aunque el bloqueo falle')
  })

  test('los eventos de bloqueo nunca se saltan por no ser CRM', () => {
    assert.match(code, /if \(audienceTag\(data\.tags\) !== 'crm' && !decision\.block\) \{/,
      'rebotes/quejas/supresiones deben procesarse siempre')
  })
})

describe('13 · FAIL CLOSED — si no se puede comprobar la lista, no se envía', () => {
  test('getBlockedEmails lanza OptOutLookupError cuando la consulta devuelve error', async () => {
    const admin = fakeAdmin([], { failLookup: true })
    await assert.rejects(
      () => getBlockedEmails(admin, ['a@ejemplo.cl', 'b@ejemplo.cl']),
      (err: unknown) => err instanceof OptOutLookupError,
    )
  })

  test('getBlockedEmails lanza también si la consulta revienta', async () => {
    const admin = fakeAdmin([], { throwLookup: true })
    await assert.rejects(() => getBlockedEmails(admin, ['a@ejemplo.cl']), (err: unknown) => err instanceof OptOutLookupError)
  })

  test('isOptedOut propaga el error — el envío individual no puede continuar', async () => {
    const admin = fakeAdmin([], { failLookup: true })
    await assert.rejects(() => isOptedOut(admin, 'a@ejemplo.cl'), (err: unknown) => err instanceof OptOutLookupError)
  })

  test('Supabase caído → 0 emails comerciales enviados en el bulk', () => {
    const code = src('lib/crm-bulk-send.ts')
    const lookup = code.indexOf('await getBlockedEmails(')
    const send = code.indexOf('emails.send(')
    assert.ok(lookup > -1 && send > -1)
    assert.ok(lookup < send, 'la lista de bajas se consulta ANTES de cualquier envío')

    // La consulta no está envuelta en un try/catch que la deje pasar.
    const previo = code.slice(0, lookup)
    assert.ok(!previo.includes('try {'), 'sendLeadBatch no debe tragarse el error de la consulta')
  })

  test('el job aborta la tanda y conserva el cursor para reintentar', () => {
    const code = src('app/api/crm-leads/bulk-send/process/route.ts')
    const catchStart = code.indexOf('} catch (error) {')
    assert.ok(catchStart > -1, 'la llamada a sendLeadBatch debe estar protegida')
    const bloque = code.slice(catchStart, code.indexOf('const missingLeads = '))
    // failJobBatch (crm-send-guard.ts) marca el job como fallido y NO toca el cursor.
    assert.ok(bloque.includes('failJobBatch('), 'el job debe quedar marcado como fallido')
    const guard = src('lib/crm-send-guard.ts')
    const fail = guard.slice(guard.indexOf('export async function failJobBatch'))
    assert.ok(fail.slice(0, fail.indexOf('\n}')).includes("status: 'failed'"), 'failJobBatch debe fijar status failed')
    assert.ok(!fail.slice(0, fail.indexOf('\n}')).includes('cursor'), 'failJobBatch no debe mover el cursor')
    assert.ok(!bloque.includes('cursor:'), 'el cursor NO debe avanzar cuando la tanda aborta')
    assert.ok(bloque.includes('503'))
  })

  test('el envío individual responde 503 sin llamar a Resend', () => {
    const code = src('app/api/crm-leads/[id]/send-intro/route.ts')
    const catchStart = code.indexOf('if (!(error instanceof OptOutLookupError)) throw error')
    const send = code.indexOf('emails.send(')
    assert.ok(catchStart > -1 && catchStart < send, 'la guarda fail-closed va antes del envío')
    assert.ok(code.slice(catchStart, send).includes('status: 503'))
  })
})

describe('14 · La baja no se dispara sola (escáneres de links)', () => {
  const route = src('app/api/unsubscribe/route.ts')
  const getBlock = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  const postBlock = route.slice(route.indexOf('export async function POST'))

  test('GET válido NO crea el opt-out: solo muestra la confirmación', () => {
    assert.ok(!getBlock.includes('recordOptOut'), 'el GET no debe escribir en email_optouts')
    assert.ok(!getBlock.includes('crm_lead_activities'), 'el GET no debe escribir en el timeline')
    assert.ok(getBlock.includes('¿Quieres dejar de recibir comunicaciones comerciales de SCENCE?'))
    assert.ok(getBlock.includes('<form method="post"'), 'debe ofrecer un botón que hace POST')
    assert.ok(getBlock.includes('Darme de baja'))
  })

  test('POST válido SÍ crea el opt-out', () => {
    assert.ok(postBlock.includes('recordOptOut'))
    assert.ok(postBlock.includes("reason: 'unsubscribe'"))
    assert.ok(postBlock.includes('Listo, te diste de baja'))
  })

  test('el POST de un clic de Gmail funciona sin interacción extra', () => {
    // RFC 8058: Gmail hace POST directo a la URL del header. No debe exigir
    // ningún campo del formulario ni referer.
    assert.ok(!postBlock.includes('formData()'), 'el POST no debe exigir campos del formulario')
    assert.ok(!postBlock.includes('referer') && !postBlock.includes('Referer'))
  })

  test('POST repetido es idempotente', async () => {
    const admin = fakeAdmin()
    const a = await recordOptOut(admin, { email: 'doble@ejemplo.cl', reason: 'unsubscribe', source: 'link' })
    const b = await recordOptOut(admin, { email: 'doble@ejemplo.cl', reason: 'unsubscribe', source: 'link' })
    assert.equal(a.inserted, true)
    assert.equal(b.ok, true)
    assert.equal(b.inserted, false)
    assert.equal(admin.rows.size, 1)
    // Y el timeline solo se escribe cuando `inserted` es true.
    assert.ok(postBlock.includes('if (inserted) {'))
  })

  test('token inválido no revela nada', () => {
    assert.ok(route.includes('function invalidLinkPage'), 'una sola respuesta para todos los casos inválidos')
    const invalid = route.slice(route.indexOf('function invalidLinkPage'), route.indexOf('function readParams'))
    assert.ok(!invalid.includes('lead.email') && !invalid.includes('${email'), 'nunca muestra la dirección')
    assert.ok(invalid.includes('El enlace no es válido o ya expiró'))
    // El mismo mensaje cubre token malo, lead inexistente y lead sin email.
    assert.equal(route.split('return invalidLinkPage()').length - 1, 3)
  })

  test('la URL de baja sigue sin exponer el email', () => {
    assert.ok(!buildUnsubscribeUrl(LEAD)!.includes('@'))
  })
})

describe('12 · Invitaciones CRM: sección de registro y RUT enlazado', () => {
  test('el correo trae «Si eres marca…» y «Si eres creador de contenido…» con sus enlaces', () => {
    const resend = src('lib/crm-email-html.ts')
    assert.ok(resend.includes('Si eres marca</strong>, regístrate para crear una campaña'))
    assert.ok(resend.includes('Si eres creador de contenido</strong>, regístrate para crear contenido para marcas'))
    assert.match(resend, /\$\{registerSection\}/)
    assert.ok(resend.includes('https://www.instagram.com/scence.cl/') && resend.includes('https://www.instagram.com/influencers.snc/'), 'Instagram de SCENCE e Influencers.snc en el pie')
    const catalog = readFileSync(new URL('../src/lib/email-catalog.ts', import.meta.url), 'utf8')
    assert.ok(catalog.includes('/register/brand') && catalog.includes('/register`'))
    for (const f of ['src/lib/crm-bulk-send.ts', 'src/app/api/crm-leads/[id]/send-intro/route.ts']) {
      assert.match(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /registerLinks: template\??\.registrationSection/)
    }
  })

  test('RUT: la ficha guarda el de la persona y el registro lo copia al perfil sin pisar', () => {
    const link = readFileSync(new URL('../src/lib/crm-lead-link.ts', import.meta.url), 'utf8')
    assert.match(link, /contact_rut/)
    assert.match(link, /influencer_private_data/)
    assert.match(link, /signer_rut/)
    assert.doesNotMatch(link, /company_rut/)
  })
})
