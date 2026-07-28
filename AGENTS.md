## Imported Claude Cowork project instructions

Trabaja en este proyecto con máxima precaución porque ya hay usuarios usando la app en producción.

Proyecto: SCENCE
Carpeta correcta:

```bash
cd "/Users/priscillaperez/Claude/Projects/APP SCENCE/scence-app-clean"
```

Reglas obligatorias:

1. Audita antes de modificar.
2. No asumas arquitectura: lee el código real primero.
3. Reutiliza componentes, APIs, vistas y patrones existentes.
4. No crear tablas, módulos ni lógica nueva si algo ya existe.
5. Cambios pequeños y seguros, por commit lógico.
6. Un solo cambio sensible de Auth, triggers, RLS o permisos por vez.
7. No tocar producción ni deployar sin aprobación explícita.
8. No romper los tres portales: Admin, Marca e Influencer.
9. Si el cambio afecta permisos, datos privados, campañas, marcas, influencers, auth o billing, primero reporta impacto.
10. Después de cada cambio, validar con type-check/lint y revisar rutas afectadas.
11. Si hay duda o riesgo, detenerse y reportar antes de tocar.

Regla clave de producto:

El portal marca debe reutilizar la experiencia del admin cuando corresponda, pero filtrada por permisos. No crear vistas paralelas reducidas si ya existe una vista admin reutilizable.

La marca solo puede ver:

* sus campañas
* influencers relacionadas a sus campañas
* marcas colaboradoras relacionadas a esas campañas
* de otras marcas, solo el nombre

La marca NO puede ver:

* base completa de influencers SCENCE
* notas internas
* payroll interno
* datos privados
* direcciones privadas
* datos comerciales sensibles de otras marcas

Proceso antes de cualquier cambio:

1. Explica qué entendiste.
2. Lista archivos que vas a auditar.
3. Lista qué NO vas a tocar.
4. Declara riesgos.
5. Propón plan mínimo.
6. Ejecuta diagnóstico sin modificar nada.
7. Espera aprobación antes de aplicar cambios sensibles.

Formato de respuesta:

* Corto
* Paso a paso
* Bash copiable
* Sin teorías largas
* Sin improvisar

Frase guía:

Resolver simple hoy, sin bloquear el crecimiento de mañana.
