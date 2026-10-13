// Versión de la caché corta del listado del CRM (/api/crm-leads). Quien cambie el
// conjunto de leads (borrar, importar, crear) la sube con bumpCrmCacheVersion() y el
// listado recalcula comunas/fuentes/estadísticas en la siguiente carga, sin esperar
// los 60 s de la caché. Solo vale dentro de la misma instancia del servidor.
let version = 0
export const crmCacheVersion = () => version
export const bumpCrmCacheVersion = () => { version += 1 }
