# Integrar el módulo SIGEC · Calidad

Ya está integrado en AIFA Operaciones (ver [README.md](README.md)). Esta guía queda para entender las piezas o repetir la integración en otro sistema.

## 1. La carpeta

```
tu-repositorio/
├── index.html
├── …
└── calidad/          ← esta carpeta, completa
```

## 2. Dentro de una pantalla del sistema

```html
<div id="vista-calidad" class="vista-calidad"></div>
<script src="calidad/modulo.js"></script>
```

```js
// Cuando el usuario ya inició sesión en el sistema:
SigecCalidad.iniciarSesion({ username, name, role, area });

// Al abrir la sección. alSalir se llama si el módulo se queda sin sesión.
const calidad = SigecCalidad.montar('#vista-calidad', { ruta: 'inicio', alSalir: () => { /* volver a entregar la sesión o cerrar */ } });

calidad.ir('reportes');          // cambiar de pantalla
SigecCalidad.renovarSesion();    // mientras la sesión del sistema siga abierta
calidad.desmontar();             // al salir
SigecCalidad.cerrarSesion();     // al cerrar sesión en el sistema
```

En AIFA Operaciones todo esto lo hace `js/calidad-host.js`.

El contenedor necesita una altura definida, por ejemplo `.vista-calidad { height: calc(100vh - 190px); }`. También se puede pasar `alto: '800px'` a `montar`.

El módulo se muestra en un `<iframe>` del mismo sitio. En este modo se ocultan su encabezado y su menú lateral, y la navegación queda en una barra superior.

- Pantallas: `inicio`, `reportes`, `encuestas`, `documentacion`, `directorio`, `configuracion`.
- Roles: `admin`, `supervisor`, `capturista`, `consulta`. Un rol desconocido se trata como `consulta`.

## 3. `js/config.js`

| Opción | Para qué sirve |
|---|---|
| `modoDemo` | `true` acepta cualquier contraseña en `login.html`. Debe quedar en `false`. |
| `supabase` | Función que devuelve el cliente de Supabase con la sesión iniciada. Por defecto, el del sistema anfitrión (`window.parent.supabaseClient`). |
| `soloIncrustado` | `true`: abierta suelta, la página se va a `portalUrl`. |
| `loginUrl` | Página a la que se envía a quien no tiene sesión. |
| `portalUrl`, `portalNombre` | Enlace "Volver a …" del menú lateral. |
| `minutosInactividad` | Minutos antes de cerrar la sesión (el anfitrión la renueva). |
| `autenticar` | Inicio de sesión propio, solo si se usa `login.html`. |

## 4. Base de datos

`db/calidad_sigec.sql` crea tablas, reglas (RLS), funciones y buckets. Las pantallas solo usan `js/data/api.js`; las consultas a Supabase están en `js/data/fuente.js`.

## 5. Publicar

El `.vercelignore` de AIFA Operaciones solo publica carpetas autorizadas; ya incluye `!/calidad/` y `!/calidad/**`, y excluye lo que solo sirve para desarrollo.

La cabecera `X-Frame-Options: SAMEORIGIN` es compatible con el iframe. Si el sitio tuviera una CSP global, debe permitir `script-src 'self'`, `style-src 'self'` y `frame-src 'self'`.

## Convivencia con el sistema

- En la página del sistema, el módulo solo agrega el global `SigecCalidad`.
- En el almacenamiento del navegador solo usa claves que empiezan con `sigec.`.
- No registra service workers ni usa rutas del servidor.
