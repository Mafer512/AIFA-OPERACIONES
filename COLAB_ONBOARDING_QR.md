# Onboarding por QR para nuevos colaboradores

## Archivos

- [colaborador-registro.html](colaborador-registro.html) — portal público que abre el colaborador.
- [db/create_colab_onboarding_portal.sql](db/create_colab_onboarding_portal.sql) — tabla de tokens y los tres RPC.
- [index.html](index.html) — panel "QR de onboarding" dentro del modal de alta de colaborador.
- [__tests__/colaboradores-onboarding-qr.test.js](__tests__/colaboradores-onboarding-qr.test.js) — regresiones del módulo.

## Qué hace

1. El área de personal da de alta al colaborador y genera su QR desde el propio modal.
2. El colaborador escanea el QR y abre una vista pública identificada por token.
3. Llena sus datos y sube CV, INE frente, INE reverso y TIA.
4. Guarda avance parcial o final.
5. Si le falta algo, regresa con el mismo QR y continúa donde se quedó.
6. Todo se guarda en `agenda_2026` mediante funciones seguras por token.

## Campos bloqueados

**El número de empleado y el nombre no se pueden modificar desde el QR.** Los
asigna el área de personal y en el portal aparecen como solo lectura.

El candado no es sólo visual, porque un `readonly` se quita editando el DOM o
llamando al RPC a mano:

- El **número de empleado** sale siempre de `colab_onboarding_links.num_empleado`,
  es decir del token. `save_colab_onboarding` nunca lo lee del payload.
- El **nombre** lo resuelve el servidor: primero el del expediente en
  `agenda_2026` y, si el registro todavía no existe, el que capturó el área al
  generar el QR (`metadata.nombre` del link). Lo que mande el portal se ignora.

Si el enlace se generó sin nombre, el portal deja guardar avances pero no
finalizar, y pide que el área regenere el QR.

## Paso 1: ejecutar el SQL en Supabase

Ejecuta completo [db/create_colab_onboarding_portal.sql](db/create_colab_onboarding_portal.sql).

Es idempotente (`IF NOT EXISTS` / `CREATE OR REPLACE`), así que se puede volver a
correr sobre una base donde ya se intentó antes.

> Si el portal venía respondiendo `function get_colab_onboarding does not exist`
> o `No se detecto columna de numero de empleado en agenda_2026`, es que la
> versión anterior del script nunca terminó de instalarse. Vuelve a ejecutarlo.

## Paso 2: generar el QR desde la aplicación

En **Colaboradores → Nuevo Colaborador**, captura al menos No. Empleado y Nombre
y pulsa **Generar QR onboarding**. El panel muestra el QR, el enlace y su fecha
de expiración (30 días).

La primera vez hay que capturar la **URL pública del portal** en ese mismo panel
(por ejemplo `https://tu-dominio-aifa/colaborador-registro.html`) y guardarla: si
el sistema se abre en `localhost` o en una IP de red interna, el QR generado no
abriría en el celular del colaborador. Queda guardada en el navegador.

También se puede crear un token a mano desde el SQL Editor, autenticado como
admin/editor:

```sql
select public.create_colab_onboarding_link('1299-2', 30, '{"nombre":"Nombre Apellido"}'::jsonb);
```

La salida trae `token`, `url_suffix` y `expires_at`. Manda siempre `nombre` en la
metadata: es lo que verá bloqueado el colaborador si aún no existe su registro.

## Paso 3: reingreso para completar lo que falte

El colaborador vuelve a abrir la misma URL del QR. El portal carga lo ya guardado
y permite subir lo faltante hasta que expire el token.

## Qué campos actualiza

Las funciones no asumen los nombres de columna de `agenda_2026` —son los del
Excel original, con puntos, espacios y acentos— sino que los detectan por
patrones, igual que hace el directorio en `index.html`.

Se actualiza lo que el colaborador captura: puesto, profesión, grado académico,
matrícula, cédula, nivel, plaza, adscripción, CURP, RFC, NSS, domicilio, estado
civil, dependientes, tipo de sangre, alergias, celular, extensión, correos,
fecha de ingreso, fecha de nacimiento, licencias y vigencias, contactos de
emergencia, CV, INE frente, INE reverso y TIA, más
`onboarding_actualizado_en` y `onboarding_estado`.

Los campos cuya columna no existe en la tabla (hoy `turno`, `ryr` y `grado`) se
omiten sin romper el guardado, y tampoco se exigen para finalizar.

## Estado de completitud

- `onboarding_estado = 'completo'` cuando ya están CV, INE frente, INE reverso,
  TIA, grado académico y tipo de sangre.
- Si falta alguno queda `pendiente`.

## Notas técnicas

- Qué campos son obligatorios para finalizar lo decide el backend, que devuelve
  `missing_fields`; el portal sólo traduce esas claves a etiquetas. Antes la
  lista estaba duplicada en los dos lados y se habían separado.
- El portal guarda las fotos como Data URL en las columnas de onboarding, para
  evitar bloqueos por políticas de Storage en acceso anónimo.
- El acceso está controlado por token y fecha de expiración; los RPC de lectura y
  guardado están otorgados a `anon`, y sólo el de creación de links exige rol
  admin/editor.
- Los patrones de detección de columnas se escriben con **una** barra invertida.
  En SQL, con `standard_conforming_strings` en `on`, dos barras dejan de ser un
  escape y pasan a exigir un backslash literal en el nombre de la columna.
