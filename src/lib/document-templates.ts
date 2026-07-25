export const NDA_TEMPLATE_ES = `ACUERDO DE CONFIDENCIALIDAD Y USO RESTRINGIDO DE INFORMACIÓN

Entre SCENCE SpA, en adelante “SCENCE”, y {{brand_name}}, RUT {{brand_rut}}, con domicilio en {{brand_address}}, representada para estos efectos por {{signer_name}}, RUT {{signer_rut}}, en adelante la “Marca”, se acuerda lo siguiente:

1. Información confidencial
Se considera Información Confidencial toda información no pública a la que la Marca acceda mediante SCENCE, incluyendo, sin limitación, bases de datos, perfiles, datos de contacto, métricas, audiencias, tarifas, propuestas, campañas, reportes, procesos, material comercial y cualquier información relativa a creadoras e influencers.

2. Uso permitido
La Marca solo podrá utilizar la Información Confidencial para evaluar, planificar y ejecutar campañas gestionadas dentro de la plataforma SCENCE. No podrá usarla para fines ajenos a esa relación comercial.

3. Prohibición de extracción y contacto externo
La Marca no podrá copiar, descargar, compartir, vender, ceder, publicar, almacenar fuera de SCENCE ni utilizar para campañas externas las bases de datos o información de influencers. Tampoco podrá contactar directamente a creadoras obtenidas desde SCENCE para eludir la plataforma, salvo que exista autorización previa y escrita de SCENCE.

4. Deber de resguardo
La Marca deberá mantener medidas razonables de seguridad y limitar el acceso a esta información únicamente a sus usuarios autorizados que la necesiten para el propósito permitido.

5. Vigencia
Estas obligaciones rigen desde la aceptación de este acuerdo y se mantendrán vigentes durante la relación comercial y por cinco años después de su término. Las obligaciones relativas a datos personales y secretos comerciales subsistirán mientras la información conserve dicho carácter.

6. Incumplimiento
El incumplimiento faculta a SCENCE para suspender el acceso de la Marca a la plataforma, exigir el cese inmediato del uso indebido y ejercer las acciones que correspondan.

7. Aceptación electrónica
La persona que firma declara contar con facultades suficientes para representar a la Marca y acepta este acuerdo mediante firma electrónica simple dentro de la plataforma SCENCE.

Firmado electrónicamente por {{signer_name}}, {{signer_role}}, en representación de {{brand_name}}.`

export function templateVariables(content: string) {
  return Array.from(new Set(content.match(/\{\{[a-z_]+\}\}/g) ?? []))
}

export function renderDocument(content: string, values: Record<string, string | null | undefined>) {
  return content.replace(/\{\{[a-z_]+\}\}/g, variable => values[variable.slice(2, -2)]?.trim() || '________________')
}
