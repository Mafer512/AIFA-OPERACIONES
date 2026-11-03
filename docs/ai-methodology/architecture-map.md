# Mapa Tecnico AIFA Operaciones

Fecha de levantamiento: 2026-07-22

## Resumen ejecutivo

AIFA Operaciones funciona como una SPA estatica de gran tamano, servida desde `index.html` y coordinada principalmente por `script.js`, con modulos de dominio bajo `js/`. La persistencia, autenticacion, permisos, archivos, realtime y automatizaciones viven mayormente en Supabase.

El sistema ya esta modularizado parcialmente por archivos JavaScript, pero conserva un acoplamiento fuerte por variables globales `window.*`, IDs de DOM, orden de carga de scripts y convenciones de navegacion basadas en `data-section`.

## Arquitectura actual

### Frontend

- `index.html`: shell principal, login, sidebar/nav deck, secciones `.content-section`, modales y markup de negocio.
- `script.js`: orquestador historico. Contiene autenticacion, navegacion, permisos, dashboards y multiples utilidades globales.
- `style.css`, `visual-cards.css`, `admin.css`: estilos globales.
- `js/*.js`: modulos por dominio que agregan funciones globales o inicializadores para pantallas especificas.
- `sw.js` y `manifest.webmanifest`: PWA, instalacion y notificaciones push.

### Servidor local

- `server.js`: Express liviano para servir archivos estaticos y evitar problemas `file://`.
- Expone endpoints auxiliares de version y `parte-operaciones/custom`.
- Verifica JWT contra Supabase con `auth.getUser()`.

### Supabase

- Auth: login y sesion.
- PostgREST: lectura/escritura directa desde cliente con `.from(...)`.
- RPC: administracion de usuarios, roles, permisos, contrasenas y generadores de datos.
- Storage: manifiestos PDF, fotos, logos, boletas y evidencias.
- Realtime: `js/realtime.js` abre un canal solo mientras se está dentro del módulo, y únicamente para `Conciliación Manifiestos`, `daily_operations` e `informe_estadistico_refresco`.
- Edge Functions: alertas, recordatorios, feedback, cumpleanos y agenda.

## Modulos principales

- Operacion aerea: itinerario diario, parte de operaciones, operaciones totales, analisis mensual/anual, YoY general y carga.
- Manifiestos: pasajeros, carga, OCR, PDF, resguardo, portal y conciliacion.
- Administracion: usuarios, roles, permisos por vista, aplicaciones y areas.
- Agenda: comites, reuniones, acuerdos, calendarios, WhatsApp y push.
- Seguridad y servicios: fauna, SSEI derrames, SSEI emergencias, servicio medico, valoraciones, abordadores, mecanicos.
- Infraestructura: hidraulicas, HVAC, energia, transportes, ingenieria civil.
- Operacion terminal: BHS, FIDS, frecuencias, capacidad de carga, aerolineas, vehiculos.
- PWA y notificaciones: instalacion, service worker, push subscriptions.

## Dependencias

### Node/local

- `@supabase/supabase-js`
- `express`
- `cors`
- `dotenv`
- `jsonwebtoken`
- `bcryptjs`
- `mongoose`
- `jest`
- `jest-environment-jsdom`
- `web-push`
- `xlsx`

### Frontend CDN

- Bootstrap
- Font Awesome
- Supabase UMD
- PDF.js
- Signature Pad
- html2pdf
- jsPDF
- html2canvas
- QRCode
- ExcelJS
- FileSaver
- Chart.js y plugins
- jQuery
- DataTables

## Navegacion

El patron central es:

- Menu: `.menu-item[data-section="clave"]`
- Seccion: `#clave-section.content-section`
- Activacion: `showSection(sectionKey, linkEl)`

`js/navigation.js` agrega comportamiento visual del nav deck y acordeones, pero la navegacion efectiva sigue concentrada en `script.js`.

Riesgo: cualquier cambio de nombre en `data-section`, ID de seccion o funcion inicializadora puede romper navegacion, permisos o lazy loading.

## Modelo de permisos

Conviven tres capas:

1. Supabase Auth: identidad y sesion.
2. `user_roles`: rol global y objeto `permissions`.
3. `usuarios_aplicaciones`: compuerta por aplicacion, especialmente `OPERACIONES`.

Campos relevantes en `permissions`:

- `allowed_sections`: visibilidad de secciones.
- `section_levels`: nivel por modulo (`read`, `capture`, `edit`, `admin`).
- `area`: area asignada.
- `must_change_password`: cambio forzado de contrasena.

La UI oculta o muestra secciones, pero la seguridad real debe estar en RLS y RPC.

## Supabase y datos

Entidades frecuentes detectadas:

- `user_roles`
- `usuarios_aplicaciones`
- `aplicaciones`
- `profiles`
- `flights`
- `parte_operations`
- `daily_operations`
- `monthly_operations`
- `annual_operations`
- `vuelos_parte_operaciones`
- `vuelos_parte_operaciones_csv`
- `custom_parte_operaciones`
- `change_history`
- `Conciliacion Manifiestos`
- `manifiestos_pasajeros`
- `manifiestos_pdfs`
- `agenda_comites`
- `agenda_reuniones`
- `agenda_acuerdos`
- `agenda_temas`
- `agenda_2026`
- `whatsapp_alertas`
- `push_subscriptions`
- `catalogo_vehiculos`
- `airlines`
- `areas`
- `bhs_baggage_statistics`
- `atencion_derrames`
- `emergencias_pista`
- `personal_capacitado`
- `valoraciones_medicas`

RLS esta distribuido en `db/`, `migrations/`, `supabase/migrations/`, `sql_fresh/` y archivos SQL raiz. Hace falta definir una fuente canonica del esquema vigente.

## Pruebas existentes

Pruebas Jest detectadas:

- `__tests__/operaciones-access.test.js`: reglas basicas de acceso a la aplicacion OPERACIONES.
- `__tests__/initFlightServiceType.test.js`: catalogo de tipos de servicio para manifiestos.

Cobertura actual: baja frente al tamano del sistema. Las pruebas existentes son utiles como semillas, pero no protegen navegacion, RLS, storage, flujos de login ni modulos criticos.

## Riesgos tecnicos

- `script.js` e `index.html` concentran demasiada responsabilidad.
- Dependencia alta en globales `window.*`.
- Orden de carga de scripts critico.
- Permisos duplicados o superpuestos entre frontend y SQL.
- RLS heterogeneo: algunas politicas historicas son amplias para `authenticated`.
- Muchas migraciones sueltas sin fuente unica de verdad.
- Escritura directa desde cliente a multiples tablas.
- Realtime sobre `public.*` puede provocar recargas innecesarias.
- Dependencias CDN externas sin pinning local completo.
- Falta de lint, tipos y pruebas de smoke de navegacion.
- Riesgo de regresion por cambios pequenos en IDs, clases, `data-section` o nombres de tabla.

## Recomendaciones prioritarias

1. Crear inventario canonico de modulos: seccion, archivo JS, tablas, RPC, storage, permisos y pruebas.
2. Consolidar reglas de permisos en una matriz versionada.
3. Definir RLS canonico por tabla y retirar SQL obsoleto o marcarlo como historico.
4. Extraer nuevos cambios en modulos pequenos sin expandir `script.js` salvo que sea indispensable.
5. Agregar pruebas por cada cambio: al menos una prueba unitaria o smoke documentado.
6. Crear checklist obligatorio para cambios asistidos por IA.
7. Mantener un log de decisiones tecnicas para evitar refactors contradictorios.

