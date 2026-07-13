// Lista oficial de las 346 comunas de Chile (nombre con tildes correctas),
// fuente: Biblioteca del Congreso Nacional de Chile (bcn.cl/siit), cruzada
// contra el conteo oficial de 346 comunas. Se usa para:
//   1) Normalizar/agrupar los valores libres ya guardados en
//      influencers.commune (mayúsculas, tildes, espacios distintos para la
//      misma comuna real) sin tener que crear una tabla nueva.
//   2) Poblar el selector con buscador de "Comuna" en los formularios de
//      creación/edición de influencer.
//
// NOTA: esto es una constante de datos (no una tabla en la base) — pedido
// explícito de Pri 2026-07-13: "no crear tablas nuevas sin antes revisar
// estructura actual". `influencers.commune` sigue siendo texto libre; esta
// lista solo sirve para normalizar/validar en el código.
export const COMUNAS_CHILE: string[] = [
  // XV Arica y Parinacota
  'Arica', 'Camarones', 'Putre', 'General Lagos',
  // I Tarapacá
  'Alto Hospicio', 'Iquique', 'Huara', 'Camiña', 'Colchane', 'Pica', 'Pozo Almonte',
  // II Antofagasta
  'Tocopilla', 'María Elena', 'Calama', 'Ollagüe', 'San Pedro de Atacama',
  'Antofagasta', 'Mejillones', 'Sierra Gorda', 'Taltal',
  // III Atacama
  'Chañaral', 'Diego de Almagro', 'Copiapó', 'Caldera', 'Tierra Amarilla',
  'Vallenar', 'Freirina', 'Huasco', 'Alto del Carmen',
  // IV Coquimbo
  'La Serena', 'La Higuera', 'Coquimbo', 'Andacollo', 'Vicuña', 'Paihuano',
  'Ovalle', 'Río Hurtado', 'Monte Patria', 'Combarbalá', 'Punitaqui',
  'Illapel', 'Salamanca', 'Los Vilos', 'Canela',
  // V Valparaíso
  'La Ligua', 'Petorca', 'Cabildo', 'Zapallar', 'Papudo',
  'Los Andes', 'San Esteban', 'Calle Larga', 'Rinconada',
  'San Felipe', 'Putaendo', 'Santa María', 'Panquehue', 'Llay-Llay', 'Catemu',
  'Quillota', 'La Cruz', 'La Calera', 'Nogales', 'Hijuelas', 'Limache', 'Olmué',
  'Valparaíso', 'Viña del Mar', 'Quintero', 'Puchuncaví', 'Quilpué',
  'Villa Alemana', 'Casablanca', 'Concón', 'Juan Fernández',
  'San Antonio', 'Cartagena', 'El Tabo', 'El Quisco', 'Algarrobo', 'Santo Domingo',
  'Isla de Pascua',
  // VI O'Higgins
  'Rancagua', 'Graneros', 'Mostazal', 'Codegua', 'Machalí', 'Olivar', 'Requínoa',
  'Rengo', 'Malloa', 'Quinta de Tilcoco', 'San Vicente de Tagua Tagua', 'Pichidegua',
  'Peumo', 'Coltauco', 'Coinco', 'Doñihue', 'Las Cabras',
  'San Fernando', 'Chimbarongo', 'Placilla', 'Nancagua', 'Chépica', 'Santa Cruz',
  'Lolol', 'Pumanque', 'Palmilla', 'Peralillo',
  'Pichilemu', 'Navidad', 'Litueche', 'La Estrella', 'Marchihue', 'Paredones',
  // VII Maule
  'Curicó', 'Teno', 'Romeral', 'Molina', 'Sagrada Familia', 'Hualañé', 'Licantén',
  'Vichuquén', 'Rauco',
  'Talca', 'Pelarco', 'Río Claro', 'San Clemente', 'Maule', 'San Rafael',
  'Empedrado', 'Pencahue', 'Constitución', 'Curepto',
  'Linares', 'Yerbas Buenas', 'Colbún', 'Longaví', 'Parral', 'Retiro',
  'Villa Alegre', 'San Javier',
  'Cauquenes', 'Pelluhue', 'Chanco',
  // XVI Ñuble
  'Chillán', 'San Carlos', 'Ñiquén', 'San Fabián', 'Coihueco', 'Pinto',
  'San Ignacio', 'El Carmen', 'Yungay', 'Pemuco', 'Bulnes', 'Quillón',
  'Ránquil', 'Portezuelo', 'Coelemu', 'Trehuaco', 'Cobquecura', 'Quirihue',
  'Ninhue', 'San Nicolás', 'Chillán Viejo',
  // VIII Biobío
  'Los Ángeles', 'Cabrero', 'Tucapel', 'Antuco', 'Quilleco', 'Santa Bárbara',
  'Quilaco', 'Mulchén', 'Negrete', 'Nacimiento', 'Laja', 'San Rosendo',
  'Yumbel', 'Alto Biobío',
  'Concepción', 'Talcahuano', 'Penco', 'Tomé', 'Florida', 'Hualpén', 'Hualqui',
  'Santa Juana', 'Lota', 'Coronel', 'San Pedro de la Paz', 'Chiguayante',
  'Lebu', 'Arauco', 'Curanilahue', 'Los Álamos', 'Cañete', 'Contulmo', 'Tirúa',
  // IX Araucanía
  'Angol', 'Renaico', 'Collipulli', 'Lonquimay', 'Curacautín', 'Ercilla',
  'Victoria', 'Traiguén', 'Lumaco', 'Purén', 'Los Sauces',
  'Temuco', 'Lautaro', 'Perquenco', 'Vilcún', 'Cholchol', 'Cunco', 'Melipeuco',
  'Curarrehue', 'Pucón', 'Villarrica', 'Freire', 'Pitrufquén', 'Gorbea',
  'Loncoche', 'Toltén', 'Teodoro Schmidt', 'Saavedra', 'Carahue',
  'Nueva Imperial', 'Galvarino', 'Padre Las Casas',
  // XIV Los Ríos
  'Valdivia', 'Mariquina', 'Lanco', 'Máfil', 'Corral', 'Los Lagos', 'Panguipulli',
  'Paillaco', 'La Unión', 'Futrono', 'Río Bueno', 'Lago Ranco',
  // X Los Lagos
  'Osorno', 'San Pablo', 'Puyehue', 'Puerto Octay', 'Purranque', 'Río Negro',
  'San Juan de la Costa',
  'Puerto Montt', 'Puerto Varas', 'Cochamó', 'Calbuco', 'Maullín', 'Los Muermos',
  'Fresia', 'Llanquihue', 'Frutillar',
  'Castro', 'Ancud', 'Quemchi', 'Dalcahue', 'Curaco de Vélez', 'Quinchao',
  'Puqueldón', 'Chonchi', 'Queilén', 'Quellón',
  'Chaitén', 'Hualaihué', 'Futaleufú', 'Palena',
  // XI Aysén
  'Coyhaique', 'Lago Verde', 'Aysén', 'Cisnes', 'Guaitecas',
  'Chile Chico', 'Río Ibáñez', 'Cochrane', "O'Higgins", 'Tortel',
  // XII Magallanes
  'Natales', 'Torres del Paine', 'Punta Arenas', 'Río Verde', 'Laguna Blanca',
  'San Gregorio', 'Porvenir', 'Primavera', 'Timaukel', 'Cabo de Hornos', 'Antártica',
  // Metropolitana de Santiago
  'Santiago', 'Independencia', 'Conchalí', 'Huechuraba', 'Recoleta', 'Providencia',
  'Vitacura', 'Lo Barnechea', 'Las Condes', 'Ñuñoa', 'La Reina', 'Macul',
  'Peñalolén', 'La Florida', 'San Joaquín', 'La Granja', 'La Pintana', 'San Ramón',
  'San Miguel', 'La Cisterna', 'El Bosque', 'Pedro Aguirre Cerda', 'Lo Espejo',
  'Estación Central', 'Cerrillos', 'Maipú', 'Quinta Normal', 'Lo Prado',
  'Pudahuel', 'Cerro Navia', 'Renca', 'Quilicura',
  'Colina', 'Lampa', 'Tiltil',
  'Puente Alto', 'San José de Maipo', 'Pirque',
  'San Bernardo', 'Buin', 'Paine', 'Calera de Tango',
  'Melipilla', 'María Pinto', 'Curacaví', 'Alhué', 'San Pedro',
  'Talagante', 'Peñaflor', 'Isla de Maipo', 'El Monte', 'Padre Hurtado',
]

// ── Normalización ─────────────────────────────────────────────────────────────

// Clave de comparación: sin espacios extra, sin mayúsculas, sin tildes/diéresis.
// No usamos la extensión `unaccent` de Postgres (no está instalada en el
// proyecto) — toda la normalización se hace en código, en JS.
export function communeKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes/diéresis
    .toLowerCase()
}

const OFFICIAL_BY_KEY = new Map<string, string>(
  COMUNAS_CHILE.map(name => [communeKey(name), name])
)

// Si `raw` matchea (ignorando mayúsculas/tildes/espacios) una comuna oficial,
// devuelve el nombre oficial con formato correcto. Si no matchea nada
// (ej. es una región, una ciudad de otro país, o tiene un typo real), devuelve
// null — no se inventa ni se fuerza un valor.
export function matchOfficialCommune(raw: string | null | undefined): string | null {
  const key = communeKey(raw)
  if (!key) return null
  return OFFICIAL_BY_KEY.get(key) ?? null
}

export type CommuneGroup = { label: string; variants: string[] }

// Puntaje simple de "se ve bien escrito" para elegir una etiqueta cuando el
// valor no matchea la lista oficial (ej. regiones, ciudades de otro país que
// hoy están guardadas en el mismo campo) — no inventa una comuna, solo elige
// la variante más prolija entre las que ya existen en la base.
function titleCaseScore(s: string): number {
  const trimmed = s.trim()
  if (!trimmed) return -1
  let score = trimmed === s ? 1 : 0
  for (const w of trimmed.split(/\s+/)) {
    if (!w) continue
    if (w === w.toUpperCase() && w.length > 1) { score -= 2; continue }
    if (w[0] === w[0].toUpperCase()) score += 1
    if (w.slice(1) === w.slice(1).toLowerCase()) score += 1
  }
  return score
}

// Agrupa una lista de valores crudos (como están hoy en influencers.commune)
// por comuna real, sin tocar la base. Para cada grupo: si alguna variante
// matchea la lista oficial, usa ese nombre oficial como label; si no,
// usa la variante mejor escrita del propio grupo (no inventa nada nuevo).
export function groupCommunes(raw: string[]): CommuneGroup[] {
  const groups = new Map<string, string[]>()
  for (const value of raw) {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) continue
    const key = communeKey(trimmed)
    if (!key) continue
    const arr = groups.get(key)
    if (arr) arr.push(trimmed)
    else groups.set(key, [trimmed])
  }

  const result: CommuneGroup[] = []
  Array.from(groups.entries()).forEach(([key, variants]) => {
    const official = OFFICIAL_BY_KEY.get(key)
    const label = official ?? variants.slice().sort((a: string, b: string) => titleCaseScore(b) - titleCaseScore(a))[0]
    result.push({ label, variants: Array.from(new Set(variants)) })
  })

  return result.sort((a, b) => a.label.localeCompare(b.label, 'es'))
}
