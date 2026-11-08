/**
 * Ruta interna segura para redirecciones posteriores a login o confirmación.
 *
 * Solo acepta rutas de este mismo sitio ("/inf-profile?tab=plan"). Rechaza URLs
 * absolutas, "//host", barras invertidas y caracteres de control, que permitirían
 * mandar a la persona a otro dominio (open redirect). Si el valor no es seguro
 * devuelve `fallback`.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 2048) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback
  return value
}
