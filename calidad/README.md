# SIGEC — Sistema Integral de Gestión y Evaluación de la Calidad (AIFA)

Plataforma de calidad del Edificio Terminal: incidencias de equipaje, encuestas a pasajeros y aerolíneas, documentación controlada y directorio.

## Cómo está integrado en AIFA Operaciones

- **Menú:** Edificio Terminal (GOET) → **Calidad (SIGEC)** abre `calidad/index.html` en su propia pestaña (`js/calidad-host.js`), con su diseño completo. Si ya estaba abierta, solo se trae al frente.
- **Sesión:** la misma cuenta con la que se entró a AIFA Operaciones en ese navegador: la página usa `../js/supabase-client.js` (misma base) y la sesión que Supabase guarda para el sitio (`js/core/conexion.js`). No pide contraseña; sin sesión manda al inicio de AIFA Operaciones. Al cerrar sesión en el sistema (en cualquier pestaña), Calidad se cierra; «Cerrar sesión» en Calidad cierra la de todo el sistema.
- **Rol:** lo calcula la base con `calidad_mi_rol()`, a partir del nivel del módulo «Calidad (SIGEC)» en Administración de usuarios:

  | Nivel en Administración de usuarios | Rol en Calidad | Qué puede hacer |
  |---|---|---|
  | admin / superadmin | Administrador | Todo, y ve la lista de usuarios |
  | Edición | Supervisor | Cambiar estados, publicar documentos, mantener el directorio |
  | Captura | Capturista | Registrar incidencias y encuestas |
  | Lectura | Consulta | Consultar y exportar |

- **Datos:** `db/calidad_sigec.sql` (en la raíz del repositorio) crea las tablas `calidad_*`, sus reglas (RLS), el folio `INC-AAAA-NNNN` y los buckets privados `calidad-evidencias` y `calidad-documentos`. Se corre una vez en el SQL Editor de Supabase.
- **Publicación:** `.vercelignore` de la raíz publica `calidad/` sin lo que solo sirve para desarrollarlo suelto (`server.js`, `package.json`, `paquete/`, documentación).

## Cómo se cargan los scripts
No se usan módulos ES. Cada archivo es un script clásico envuelto en una IIFE que publica su API con `SIGEC.define('ruta', {...})`
y obtiene sus dependencias con `SIGEC.use('ruta')` (ver `js/sigec.js`).
**El orden de los `<script>` en `index.html` y `login.html` respeta las dependencias**: si agregas un archivo, insértalo después de lo que usa.

## Estructura

```
index.html / login.html     Shell de la app y pantalla de acceso (el login no se usa dentro de AIFA Operaciones)
css/app.css                 Sistema de diseño: tokens (claro/oscuro), layout y componentes
modulo.js                   Cargador para incrustarlo en el sistema (SigecCalidad)
js/config.js                Configuración de la integración (cliente de Supabase del sistema)
js/boot.js                  Tema, modo incrustado y guardia de sesión
js/sigec.js                 Registro de módulos (SIGEC.define / SIGEC.use)
js/app.js                   Arranque: usuario, menú, notificaciones, inactividad
js/core/                    dom, router, session, charts, ui, theme, format
js/data/
  catalogs.js               Catálogos (tipos, aerolíneas, niveles, severidad + SLA, canales)
  fuente.js                 Lecturas y escrituras en Supabase (tablas calidad_*, Storage)
  api.js                    ÚNICA capa de datos que usan las vistas: filtros e indicadores
js/views/                   inicio · reportes · encuestas · documentacion · directorio · configuracion
vendor/                     Bootstrap 5.3.3, Bootstrap Icons 1.11.3, Chart.js 4.4.1, Montserrat (locales)
```

## Seguridad

- **La autorización vive en la base (RLS).** Los roles del módulo solo ocultan botones; aunque alguien cambie su rol en el navegador, la base no le deja leer ni escribir lo que no le toca. El cambio de estado de una incidencia solo pasa por `calidad_actualizar_estado()`, que calcula los tiempos de atención y resolución.
- **CSP estricta** (`script-src 'self'`, sin `unsafe-inline` ni `unsafe-eval`), con todas las librerías servidas localmente y sin CDN.
- **Render seguro**: `html```` escapa toda interpolación. Los estilos dinámicos se aplican por CSSOM.
- Archivos: se valida la firma real (magic bytes), el tamaño y la extensión antes de subir; la base vuelve a limitar tipo y tamaño en cada bucket. Se abren con enlaces firmados que vencen.
- La exportación CSV neutraliza la inyección de fórmulas (`=`, `+`, `-`, `@`).

## Desarrollo suelto

Para probarla, sirve la raíz del repositorio (necesita `../js/supabase-client.js`) e inicia sesión primero en AIFA Operaciones. `calidad/modulo.js` sigue permitiendo incrustarla en un iframe si algún día se prefiere (ver INTEGRACION.md).
