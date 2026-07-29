# OpenSpec - Shell del modulo Miscelanea

## 1. Identificacion

- Nombre: Miscelanea.
- Slug y `data-section`: `miscelanea`.
- DOM host: `#miscelanea-section.content-section`.
- Fecha: 2026-07-28.
- Estado: En desarrollo.
- Riesgo: Alto por integrar la matriz administrativa de permisos; la fase funcional es UI estatica.

## 2. Objetivo y alcance

Agregar un acceso administrable llamado **Miscelanea** al menu de usuario, entre
**Historia** y **Gestion de Datos**. Al activarlo debe abrir un modal pequeno que
funcione como lanzador de herramientas.

Esta primera fase incluye solamente:

- el contrato formal de modulo;
- el acceso condicionado por `allowed_sections`;
- el modal responsive;
- los accesos **Directorio** y **Marca de agua** preparados para integraciones futuras.

Quedan fuera de alcance la consulta del directorio, el tratamiento de documentos,
la generacion de marcas de agua, la carga de archivos y cualquier persistencia.

## 3. Contrato del modulo

- Seccion: `miscelanea`.
- DOM host: `#miscelanea-section`.
- Menu: `.menu-item[data-section="miscelanea"]`.
- Archivo frontend: `js/miscelanea.js`.
- Inicializador: `window.miscelaneaModule.init()`; debe ser idempotente.
- Funciones globales: `window.miscelaneaOpen()` y `window.miscelaneaModule`.
- Tablas Supabase: ninguna en esta fase.
- RPCs: ninguna en esta fase.
- Storage buckets: ninguno en esta fase.
- Realtime: no aplica.
- Permiso: `permissions.allowed_sections` incluye `miscelanea`; una lista vacia
  conserva la semantica existente de acceso total. `admin` y `superadmin` siempre
  tienen acceso.
- Nivel: `section_levels.miscelanea` puede administrarse con el patron existente,
  aunque esta fase solo muestra un lanzador sin operaciones de escritura.

## 4. Flujo y UI

1. Un administrador activa **Miscelanea** en las vistas del usuario.
2. El usuario abre su tarjeta de sesion.
3. El acceso aparece entre **Historia** y **Gestion de Datos**.
4. Al seleccionarlo se cierra el menu de usuario y se abre el modal.
5. El modal muestra **Directorio** y **Marca de agua**.
6. Mientras sus submodulos no esten implementados, cada acceso informa que sera
   incorporado en el siguiente paso y emite el evento extensible
   `miscelanea:tool-selected`.

Estados aplicables:

- sin permiso: el acceso permanece oculto y la apertura programatica falla cerrada;
- disponible: el modal abre sin cambiar la seccion activa ni el hash;
- herramienta pendiente: se muestra retroalimentacion dentro del modal;
- sesion expirada: el acceso se oculta al recibir el cambio de autenticacion.

El host formal existe para cumplir el contrato DOM/navegacion, pero el acceso del
menu de usuario abre el modal y no reemplaza la vista activa.

## 5. Matriz de permisos

| Accion | Viewer | Capturista | Editor | Admin | Superadmin | Especializado |
|---|---:|---:|---:|---:|---:|---:|
| Ver lanzador con `allowed_sections` | Si | Si | Si | Si | Si | Si |
| Ver lanzador sin permiso explicito | No | No | No | Si | Si | No |
| Ejecutar Directorio | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance |
| Ejecutar Marca de agua | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance | Fuera de alcance |
| Administrar la vista | No | No | No | Si | Si | No |

Una cuenta no administrativa con `allowed_sections: []` mantiene la convencion
actual de acceso total. `allowed_sections: ["__none__"]` deniega Miscelanea.
No se agregan RLS ni RPC porque no hay datos en esta fase.

## 6. Seguridad y privacidad

- No se debe inferir ni abrir contenido de `pdfs/directorio/` en esta fase.
- Directorio puede contener datos personales; su clasificacion y backend se
  revisaran antes de implementar ese submodulo.
- Marca de agua no debe aceptar archivos hasta definir validacion, limites,
  tratamiento local/remoto y permisos.
- El control frontend evita navegacion accidental, pero no se presenta como
  seguridad de datos; cada submodulo futuro debera definir RLS/RPC/Storage.

## 7. Pruebas y smoke

Pruebas automatizadas:

- el acceso existe una sola vez y esta ordenado entre Historia y Gestion de Datos;
- cada `data-section="miscelanea"` tiene `#miscelanea-section`;
- Miscelanea aparece en la matriz de vistas administrativas;
- usuario permitido ve y abre el modal;
- usuario restringido no ve ni puede abrir el modal;
- admin y superadmin tienen acceso total;
- el inicializador no duplica listeners;
- el modal contiene Directorio y Marca de agua.

Smoke manual:

1. Abrir como admin y confirmar posicion, modal, cierre y reapertura.
2. Abrir el panel **Vistas** de un usuario y confirmar la opcion Miscelanea.
3. Validar un usuario con `miscelanea` y otro sin ella.
4. Revisar desktop, movil, modo oscuro y consola.

## 8. Rollback

- Retirar el enlace, host y modal de `index.html`.
- Retirar `js/miscelanea.js` y sus estilos acotados.
- Retirar `miscelanea` de `AU_SECTIONS` y del grupo administrable.
- Retirar las pruebas y esta especificacion si se abandona la funcionalidad.
- No hay rollback Supabase ni de datos porque no se crean tablas, RPCs, buckets o migraciones.

## 9. Criterios de aceptacion

- [ ] El acceso esta entre Historia y Gestion de Datos.
- [ ] Su visibilidad responde a `allowed_sections`.
- [ ] Puede activarse desde Vistas de Administracion.
- [ ] El modal pequeno contiene Directorio y Marca de agua.
- [ ] La apertura no cambia la seccion activa ni el hash.
- [ ] La UI es usable en desktop y movil.
- [ ] No hay errores bloqueantes en consola.
- [ ] Pruebas automatizadas y smoke documentado completados.

