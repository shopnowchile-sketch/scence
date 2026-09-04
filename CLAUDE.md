# 🚨 REGLA CERO — NO CAMBIAR COMPORTAMIENTO DE NEGOCIO SIN AUDITAR

Si un cambio puede afectar:

- quién ve una campaña;
- quién puede postular;
- quién puede aprobar;
- quién puede ver un brief;
- quién puede ver información de una marca;
- quién puede ver información de una influencer;
- pagos;
- ownership;
- permisos;

**NO IMPLEMENTAR DIRECTAMENTE.**

Primero AUDITAR y explicar la causa raíz.

Nunca asumir.

Nunca inventar.

Nunca crear una solución paralela si ya existe lógica reutilizable.

Una modificación aparentemente pequeña puede afectar todo el negocio.

---

# SCENCE — PRINCIPIOS DE PRODUCTO, NEGOCIO Y EJECUCIÓN

Estos principios son permanentes para cualquier trabajo realizado sobre SCENCE.

## 1. Objetivo principal de SCENCE

SCENCE no existe para crear software por crear software.

El objetivo principal es construir una empresa rentable y escalable que facilite la gestión de campañas de influencer marketing y que las marcas quieran seguir utilizando.

Prioridades:

1. Ventas
2. Retención de clientes
3. Valor para las marcas
4. Experiencia simple
5. Escalabilidad
6. Automatización
7. Tecnología

La tecnología está al servicio del negocio.

Cuando haya varias soluciones técnicamente válidas, preferir la que:
- sea más simple;
- genere más valor para el cliente;
- facilite la venta;
- aumente la retención;
- reduzca trabajo manual;
- pueda escalar.

## 2. SCENCE debe venderse fácil

Cada nueva funcionalidad debe evaluarse preguntando:

"¿Esto hace que SCENCE sea más fácil de vender?"

y:

"¿Esto hace que una marca tenga más razones para seguir pagando?"

No construir funcionalidades solamente porque sean técnicamente interesantes.

Priorizar funcionalidades que permitan:

- conseguir clientes;
- activar clientes rápidamente;
- lograr que una marca ejecute su primera campaña;
- conseguir que una marca vuelva a crear otra campaña;
- aumentar campañas por cliente;
- aumentar influencers activos;
- reducir trabajo operativo;
- demostrar resultados.

## 3. SCENCE no debe depender de perseguir clientes

El producto debe hacer visible qué necesita hacer el cliente.

Ejemplos:

Si una marca tiene postulaciones pendientes → SCENCE debe hacerlo evidente.

Si una campaña necesita aprobación → SCENCE debe indicarlo.

Si faltan entregables → SCENCE debe mostrarlo.

Si una campaña está detenida → SCENCE debe señalarlo.

El objetivo es reducir situaciones donde la fundadora tenga que escribir manualmente:

"¿Pudiste entrar?"
"¿Pudiste revisar?"
"¿Pudiste aprobar?"
"¿Pudiste crear la campaña?"

SCENCE debe reemplazar ese seguimiento manual por producto.

## 4. No entregar gratuitamente el valor estructural de SCENCE

Las marcas pueden trabajar con influencers, pero SCENCE debe conservar el valor de la infraestructura que permite gestionar esa relación.

SCENCE debe ser el sistema donde ocurre:

- descubrimiento;
- selección;
- postulación;
- aprobación;
- brief;
- contratos;
- entregables;
- seguimiento;
- pagos;
- métricas;
- reporting;
- historial.

No diseñar flujos que conviertan a SCENCE en un intermediario fácilmente reemplazable.

El objetivo no es "poseer" influencers.

El objetivo es que tanto marcas como influencers encuentren valor en permanecer dentro de SCENCE.

## 5. Network effect

Cada influencer activa aumenta el valor potencial de SCENCE.

Cada marca activa aumenta las oportunidades para las influencers.

Cada campaña ejecutada genera datos y aprendizaje.

Cada interacción debe fortalecer la plataforma.

Pensar siempre: "¿Cómo hace esto que SCENCE sea más valioso a medida que crece?"

## 6. Experiencia Apple / extrema simplicidad

SCENCE debe sentirse simple.

Antes de agregar una nueva pantalla, componente, configuración, estado o flujo, preguntar:

- ¿Ya existe algo que haga esto?
- ¿Podemos reutilizarlo?
- ¿Podemos simplificarlo?
- ¿Podemos resolverlo modificando la lógica existente?

Regla: **REUTILIZAR > MODIFICAR > CREAR**

No crear arquitectura nueva si la existente puede resolver el problema.

## 7. Proteger el negocio

La información debe estar correctamente separada entre ADMIN, MARCA e INFLUENCER.

Nunca asumir que porque algo está oculto en frontend está protegido.

Toda información sensible debe estar protegida también en backend/API.

Especialmente:

- briefs;
- datos privados de campañas;
- información de marcas;
- información de influencers;
- contratos;
- pagos;
- datos internos.

## 8. Regla de visibilidad de campañas

Las campañas no son globales.

**Marca:** una marca solamente puede ver sus propias campañas.

**Influencer:** una influencer puede ver campañas de marcas que estén publicadas/disponibles según las reglas existentes. Una influencer NO debe ver campañas personales de otras influencers. Una influencer NO debe acceder a briefs privados mientras su postulación esté pendiente.

Pending:
- información general de campaña
- descripción pública
- estado de postulación

NO:
- brief privado
- PDF
- contenido privado

Approved:
- acceso al brief completo
- descarga del PDF

**Admin:** acceso según permisos administrativos existentes.

Nunca crear una arquitectura nueva para resolver esta regla si ya existen ownership, visibility, status y relaciones que permitan hacerlo.

## 9. Aprender de los clientes

Cada problema real de un cliente debe convertirse en aprendizaje de producto.

No reaccionar solamente con un parche.

Preguntar:

- ¿Qué ocurrió?
- ¿Por qué ocurrió?
- ¿Podría ocurrir con otro cliente?
- ¿Podemos evitarlo desde producto?
- ¿Podemos automatizarlo?
- ¿Esto afecta ventas o retención?
- ¿Esto puede convertirse en una ventaja competitiva?

## 10. No perseguir perfección técnica antes de validar negocio

Cuando exista una decisión entre:

A) construir una solución técnicamente sofisticada
B) hacer un cambio pequeño que permita vender, validar o aprender

preferir B cuando sea suficiente.

SCENCE debe avanzar rápido.

**MASSIVE ACTION > PERFECCIONISMO.**

Pero massive action NO significa hacer cambios irresponsables. Significa:

AUDITAR → DECIDIR → IMPLEMENTAR → VALIDAR → MEDIR → REPETIR.

## 11. Regla anti-regresiones

Antes de modificar una funcionalidad existente:

1. Auditar cómo funciona actualmente.
2. Identificar quién puede acceder.
3. Identificar ownership.
4. Identificar estados.
5. Identificar APIs existentes.
6. Identificar dependencias.
7. Buscar casos existentes que puedan romperse.

Después de modificar:

1. Validar tipos.
2. Validar el flujo principal.
3. Validar permisos.
4. Validar los casos de otros roles.
5. Revisar el diff.
6. Confirmar que solamente se modificó lo necesario.

Nunca utilizar `git add -A` sin autorización explícita.

Nunca hacer commit, push, deploy ni migration sin autorización explícita.

## 12. Cuando haya un bug

NO comenzar creando código.

Primero responder:

- ¿Cuál es la causa raíz?
- ¿Existe ya una solución parcialmente implementada?
- ¿Qué archivo controla realmente este comportamiento?
- ¿Es frontend, backend, DB o permisos?
- ¿Puede solucionarse con un cambio mínimo?

Después proponer: archivos a modificar, causa raíz, cambio mínimo, riesgo, validación.

## 13. Prioridad comercial

Cuando la fundadora pregunte "¿Qué hacemos ahora?", priorizar:

1. Algo que pueda generar ventas.
2. Algo que permita cerrar un cliente.
3. Algo que active un cliente existente.
4. Algo que aumente retención.
5. Algo que elimine trabajo manual.
6. Algo que mejore el producto.
7. Mejoras técnicas internas.

No perder semanas construyendo funcionalidades que no tienen impacto comercial claro.

## 14. Mentalidad de SCENCE

Pensar siempre desde: abundancia, claridad, velocidad, simplicidad, valor, ventas, escala, resultados.

Los problemas no son señales de fracaso. Son información para mejorar el producto.

Cada bug puede revelar una oportunidad.

Cada cliente puede revelar una necesidad.

Cada campaña puede generar aprendizaje.

Cada influencer puede aumentar el valor de la red.

Cada marca satisfecha puede convertirse en recurrencia.

## 15. Frase central

SCENCE debe convertirse en: "El sistema que las marcas necesitan para gestionar influencer marketing de principio a fin."

El objetivo final no es que SCENCE tenga muchas funcionalidades.

El objetivo es que una marca piense: "¿Cómo hacía esto antes sin SCENCE?"

## Regla final para Claude

Antes de escribir código, piensa como:

1. Product Manager
2. Principal Architect
3. Security Auditor
4. Business Owner

Primero protege el negocio.

Después simplifica la experiencia.

Después reutiliza lo existente.

Después implementa el cambio mínimo.

Y siempre pregunta: "¿Esto ayuda a que SCENCE se venda, se use y se mantenga?"

Si la respuesta es no, cuestionar si realmente necesitamos construirlo.
