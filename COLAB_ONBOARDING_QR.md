# Onboarding por QR para nuevos colaboradores

## Archivos

- [colaborador-registro.html](colaborador-registro.html) — portal público que abre el colaborador.
- [db/create_colab_onboarding_portal.sql](db/create_colab_onboarding_portal.sql) — tabla de tokens y los tres RPC.
- [index.html](index.html) — panel "QR de onboarding" dentro del modal de alta de colaborador.
- [__tests__/colaboradores-onboarding-qr.test.js](__tests__/colaboradores-onboarding-qr.test.js) — regresiones del backend y de los campos bloqueados.
- [__tests__/colaboradores-onboarding-faltantes.test.js](__tests__/colaboradores-onboarding-faltantes.test.js) — el modal que pide lo que falta antes de generar el QR.

## Qué hace

1. El área de personal da de alta al colaborador y genera su QR desde el propio modal.
2. El colaborador escanea el QR y abre una vista pública identificada por token.
3. Llena sus datos y sube CV, INE frente, INE reverso y TIA.
4. Guarda avance parcial o final.
5. Si le falta algo, regresa con el mismo QR y continúa donde se quedó.
6. Todo se guarda en `agenda_2026` mediante funciones seguras por token.

## Campos bloqueados

**Hay nueve datos que no se pueden modificar desde el QR**, porque los asigna el
área de personal. En el portal salen con la marca 🔒 **Fijo** y en solo lectura:

| Campo | De dónde sale |
|---|---|
| No. Empleado | del token del QR |
| Nombre completo | del expediente, o del alta que generó el QR |
| Puesto | ídem |
| Nivel | ídem |
| Plaza | ídem |
| Dirección | ídem |
| Subdirección | ídem |
| Gerencia | ídem |
| Coordinación | ídem |

El candado no es sólo visual, porque un `readonly` se quita editando el DOM o
llamando al RPC a mano:

- El **número de empleado** sale siempre de `colab_onboarding_links.num_empleado`,
  es decir del token.
- **Los otros ocho** los resuelve el servidor: primero el valor del expediente en
  `agenda_2026` y, si el registro todavía no existe, el que capturó el área al
  generar el QR (la `metadata` del link). Lo que mande el portal para esas claves
  se ignora, venga del formulario o de una llamada directa al RPC.

Si al enlace le falta alguno, el portal deja guardar avances pero no finalizar:
devuelve `locked_missing` y pide que el área regenere el QR.

> La lista vive en tres sitios que se mueven juntos: `locked_keys` en
> `save_colab_onboarding`, `LOCKED_SPECS` en el portal y
> `COLAB_ONBOARDING_FIJOS` en el alta de `index.html`. Las pruebas los comparan
> entre sí; si agregas un campo bloqueado, van los tres.

## Paso 1: ejecutar el SQL en Supabase

Ejecuta completo [db/create_colab_onboarding_portal.sql](db/create_colab_onboarding_portal.sql).

Es idempotente (`IF NOT EXISTS` / `CREATE OR REPLACE`), así que se puede volver a
correr sobre una base donde ya se intentó antes.

> Si el portal venía respondiendo `function get_colab_onboarding does not exist`
> o `No se detecto columna de numero de empleado en agenda_2026`, es que la
> versión anterior del script nunca terminó de instalarse. Vuelve a ejecutarlo.

## Paso 2: generar el QR desde la aplicación

En **Colaboradores → Nuevo Colaborador**, captura los datos que el colaborador ya
no puede llenar y pulsa **Generar QR onboarding**. El panel muestra el QR, el
enlace y su fecha de expiración (30 días).

Son obligatorios para generar el QR, y en el formulario de alta llevan un icono
de código QR junto a su etiqueta:

- **Generales**: No. Empleado, Nombre completo, Puesto
- **Clasificación**: Nivel, Plaza
- **Organización**: Dirección, Subdirección, Gerencia, Coordinación

Si falta alguno, el botón no genera nada: abre un modal con los que faltan,
agrupados por la pestaña de la que salen, para capturarlos ahí de una vez en vez
de ir a buscarlos por todo el alta. Al confirmar se copian a su campo original
—así "Registrar Colaborador" también los guarda— y el QR se genera enseguida.

El resto de campos del alta siguen siendo opcionales, porque el colaborador sí
los captura desde el portal.

La primera vez hay que capturar la **URL pública del portal** en ese mismo panel
(por ejemplo `https://tu-dominio-aifa/colaborador-registro.html`) y guardarla: si
el sistema se abre en `localhost` o en una IP de red interna, el QR generado no
abriría en el celular del colaborador. Queda guardada en el navegador.

También se puede crear un token a mano desde el SQL Editor, autenticado como
admin/editor:

```sql
select public.create_colab_onboarding_link('1299-2', 30, jsonb_build_object(
  'nombre',       'Nombre Apellido',
  'puesto',       'Analista de Operaciones',
  'nivel',        '11',
  'plaza',        'Base',
  'direccion',    'Dirección de Operación',
  'subdireccion', 'Subdirección de Operaciones',
  'gerencia',     'Gerencia de Plataforma',
  'coordinacion', 'Coordinación de Rampa'
));
```

La salida trae `token`, `url_suffix` y `expires_at`. Manda la metadata completa:
es lo que verá bloqueado el colaborador mientras su registro no exista todavía en
`agenda_2026`.

## Paso 3: reingreso para completar lo que falte

El colaborador vuelve a abrir la misma URL del QR. El portal carga lo ya guardado
y permite subir lo faltante hasta que expire el token.

## Qué campos actualiza

Las funciones no asumen los nombres de columna de `agenda_2026` —son los del
Excel original, con puntos, espacios y acentos— sino que los detectan por
patrones, igual que hace el directorio en `index.html`.

Se actualiza lo que el colaborador captura: profesión, grado académico, matrícula,
cédula, turno, militar/civil, comisionado, CURP, RFC, NSS, domicilio, estado
civil, dependientes, tipo de sangre, alergias, celular, extensión, correos,
fecha de ingreso, fecha de nacimiento, licencias y vigencias, contactos de
emergencia, CV, INE frente, INE reverso y TIA, más
`onboarding_actualizado_en` y `onboarding_estado`.

Los nueve campos bloqueados también se escriben en cada guardado, pero con el
valor que resolvió el servidor, no con el que mandó el portal.

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
