/* Invariantes del SQL del módulo estadístico.
 *
 * Estas migraciones NO se ejecutan desde aquí: el proyecto no tiene una base de
 * pruebas y las corre a mano quien administra Supabase. Lo que sí se puede
 * verificar sin base —y es donde han estado los errores caros de este módulo—
 * es que el SQL escrito siga diciendo lo que debe decir: que las canceladas
 * queden fuera de TODAS las métricas, que el tránsito se atribuya una sola vez,
 * que la clasificación no adivine, y que nada de esto se escriba con valores
 * interpolados en SQL dinámico.
 *
 * Cuando una de estas pruebas falle, lo correcto casi nunca es relajarla: es
 * revisar si el cambio en el SQL rompió una de las reglas del módulo.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');
// Se normaliza el fin de línea al leer: git puede convertir estos archivos a
// CRLF al pasarlos por el índice, y una prueba estructural no debería
// depender de eso. Ya rompió una vez por un ciclo de stash/pop.
const leer = (archivo) => fs.readFileSync(path.join(dir, archivo), 'utf8').replace(/\r\n/g, '\n');

const reglas = leer('036_estadistica_clasificacion_reglas.sql');
const carga = leer('037_estadistica_carga_transito.sql');
const motorV1 = leer('038_estadistica_motor.sql');
const semilla = leer('039_estadistica_reglas_semilla.sql');
// El motor VIGENTE es la 040: reescribe la 038 contra el esquema real de
// maestra_operaciones. Las invariantes se comprueban sobre él.
// El motor v2 va REPARTIDO EN SEIS ARCHIVOS porque el editor SQL de Supabase
// corta la petición HTTP si una sola tarda demasiado, y al ir dentro de una
// transacción se deshace entera. Para las invariantes de CONTENIDO da igual en
// cuál de los cinco primeros esté cada cosa, así que se concatenan; el orden
// de la concatenación es el orden de ejecución, que es lo que importa para las
// pruebas de orden de borrado.
const prep      = leer('040_estadistica_v2_preparacion.sql');
const reglasV2  = leer('041_estadistica_v2_reglas.sql');
const vista     = leer('042_estadistica_v2_vista.sql');
const agregado  = leer('043_estadistica_v2_agregado.sql');
const funciones = leer('044_estadistica_v2_funciones.sql');
const poblar    = leer('045_estadistica_v2_poblar.sql');
const partesV2  = [prep, reglasV2, vista, agregado, funciones];
const motor     = partesV2.join('\n');
const todas     = [reglas, carga, motorV1, semilla].concat(partesV2, [poblar]);

// Varias de estas comprobaciones miran la ESTRUCTURA del SQL, y los archivos de
// este proyecto llevan más comentario que código. Sin quitarlos, un regex
// encuentra "CREATE MATERIALIZED VIEW" dentro del instructivo de uso y la
// prueba mide cualquier cosa menos lo que quería medir.
const sinComentarios = (sql) => sql
  .split(/\r?\n/)
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n');

// El SQL se lee con los saltos ya normalizados a \n (ver `leer`).
const nlSQL = '\n';

const motorSC = sinComentarios(motor);
const motorV1SC = sinComentarios(motorV1);
const cargaSC = sinComentarios(carga);
const reglasSC = sinComentarios(reglas);
const semillaSC = sinComentarios(semilla);
const poblarSC = sinComentarios(poblar);

// Recorta el cuerpo de una función desde su CREATE hasta el $$; que la cierra.
function cuerpoFuncion(sql, nombre) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}`);
  if (inicio === -1) throw new Error(`No se encontró la función ${nombre}`);
  const fin = sql.indexOf('$$;', inicio);
  return sql.slice(inicio, fin === -1 ? undefined : fin + 3);
}

describe('Numeración y forma de las migraciones', () => {
  test('siguen la secuencia real del repositorio sin pisar ninguna existente', () => {
    const archivos = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f));
    const nuevos = ['036_estadistica_clasificacion_reglas.sql', '037_estadistica_carga_transito.sql',
      '038_estadistica_motor.sql', '039_estadistica_reglas_semilla.sql',
      '040_estadistica_v2_preparacion.sql', '041_estadistica_v2_reglas.sql',
      '042_estadistica_v2_vista.sql', '043_estadistica_v2_agregado.sql',
      '044_estadistica_v2_funciones.sql', '045_estadistica_v2_poblar.sql'];
    nuevos.forEach((f) => expect(archivos).toContain(f));
    // 035 era la última antes de esta entrega; no existe ninguna 036-039 previa
    // con otro nombre que estas cuatro estarían duplicando.
    ['036', '037', '038', '039', '040', '041', '042', '043', '044', '045'].forEach((n) => {
      expect(archivos.filter((f) => f.startsWith(`${n}_`))).toHaveLength(1);
    });
  });

  test('las que escriben terminan en ROLLBACK, para poder revisarlas antes de aplicarlas', () => {
    [reglas, carga, semilla, motorV1].concat(partesV2).forEach((sql) => {
      expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
      expect(sql).toMatch(/BEGIN;/);
    });
  });

  test('ninguna parte del motor v2 concentra demasiado trabajo en una petición', () => {
    // Dos corridas terminaron en "Failed to fetch": el editor de Supabase corta
    // la petición HTTP y, al ir el trabajo en una transacción, se deshace todo.
    // La defensa es que cada archivo haga UNA cosa y ninguno se acerque al
    // tamaño del monolito anterior (más de 1,500 líneas).
    partesV2.forEach((sql) => {
      expect(sql.split(/\r?\n/).length).toBeLessThan(700);
    });
  });

  test('cada parte del motor v2 pone un freno de espera por bloqueos', () => {
    // Sin lock_timeout, un DROP que choca con el refresco de pg_cron espera
    // indefinidamente y el navegador se rinde con un error que no dice nada.
    partesV2.forEach((sql) => {
      expect(sinComentarios(sql)).toMatch(/SET LOCAL lock_timeout/);
      expect(sinComentarios(sql)).not.toMatch(/statement_timeout\s*=\s*0/);
    });
  });

  test('el contrato de columnas se resuelve en UNA consulta, no una por columna', () => {
    const contrato = sinComentarios(prep).slice(
      sinComentarios(prep).indexOf('DO $contrato$'),
      sinComentarios(prep).indexOf('$contrato$;'));
    // 84 consultas separadas contra information_schema.columns eran una parte
    // considerable de por qué la migración no llegaba a terminar.
    expect(contrato).not.toMatch(/FOREACH/);
    expect(contrato).not.toMatch(/information_schema/);
    expect(contrato).toMatch(/FROM pg_attribute a/);
    // Y sigue exigiendo las columnas que de verdad usa el motor.
    ['cancelado', 'rotacion_key', 'movimiento_relacionado_id', 'capacidad_max_pax',
      'slot_asignado', 'slot_coordinado', 'hora_operacion', 'ocupacion']
      .forEach((col) => expect(contrato).toContain(`'${col}'`));
  });

  test('el refresco automático se pausa antes de reconstruir y se reanuda al final', () => {
    // El job de pg_cron de la 038 refresca la vista cada 15 minutos. Si arranca
    // en medio de la reconstrucción se queda con el bloqueo y la migración no
    // puede seguir.
    expect(sinComentarios(prep)).toMatch(/cron\.unschedule\('refrescar_estadistica'\)/);
    expect(sinComentarios(prep)).not.toMatch(/cron\.schedule\(/);
    expect(poblarSC).toMatch(/cron\.schedule\(/);
  });

  test('la pausa del refresco va FUERA de la transacción, o el ROLLBACK la deshace', () => {
    // Éste fue el error real: con la pausa dentro del BEGIN...ROLLBACK, la
    // primera pasada de revisión la deshacía y el job seguía despertando cada
    // 15 minutos justo encima de la migración. Suelta, confirma en el acto.
    const sc = sinComentarios(prep);
    expect(sc.indexOf("cron.unschedule('refrescar_estadistica')"))
      .toBeLessThan(sc.indexOf('BEGIN;'));
  });

  test('en la 040, lo suelto queda confirmado antes del BEGIN aunque se corra completo', () => {
    // Un BEGIN en medio de un mensaje con varias sentencias absorbe
    // retroactivamente las anteriores en su transacción: el ROLLBACK final
    // desharía la pausa del cron. El COMMIT previo cierra ese bloque implícito.
    const sc = sinComentarios(prep);
    expect(sc.slice(0, sc.indexOf('BEGIN;'))).toMatch(/COMMIT;\s*$/);
  });

  test('la pausa del cron se puede confirmar a la vista, no sólo con un NOTICE', () => {
    // El editor de Supabase no muestra los RAISE NOTICE.
    expect(sinComentarios(prep)).toMatch(/FROM cron\.job\s+WHERE jobname = 'refrescar_estadistica'/);
  });

  test('el llenado tiene un plan B por pg_cron, comentado por omisión', () => {
    expect(poblar).toMatch(/poblar_estadistica_una_vez/);
    expect(poblarSC).not.toMatch(/poblar_estadistica_una_vez/);
  });

  test('la preparación empieza diagnosticando quién tiene el candado', () => {
    // Antes de intentar demoler hay que SABER qué bloquea, no suponerlo: es lo
    // que faltó en los dos intentos que terminaron en "Failed to fetch".
    const sc = sinComentarios(prep);
    expect(sc).toMatch(/FROM pg_stat_activity a/);
    expect(sc).toMatch(/FROM pg_locks l/);
    // Y el diagnóstico va primero, antes de tocar nada.
    expect(sc.indexOf('pg_stat_activity')).toBeLessThan(sc.indexOf('BEGIN;'));
  });

  test('terminar sesiones ajenas queda comentado: no se hace a ciegas', () => {
    // pg_terminate_backend corta trabajo en curso. Puede hacer falta, pero es
    // decisión de quien aplica la migración, no del archivo.
    expect(prep).toMatch(/pg_terminate_backend/);
    expect(sinComentarios(prep)).not.toMatch(/pg_terminate_backend/);
    expect(sinComentarios(prep)).not.toMatch(/pg_cancel_backend/);
  });

  test('el llenado (045) va SIN transacción, para que cada sentencia confirme sola', () => {
    // Si el REFRESH fuera dentro de una transacción y el editor SQL cortara
    // la petición HTTP —que es lo que pasó: "Failed to fetch"— se desharía
    // todo el trabajo. Suelto, el servidor termina aunque el navegador se
    // rinda.
    expect(poblarSC).not.toMatch(/\bBEGIN;/);
    // Sin ROLLBACK: aquí no hay nada que revisar antes de confirmar.
    expect(poblarSC).not.toMatch(/\bROLLBACK;/);
    // Y con COMMIT justo después del REFRESH. El editor de Supabase manda lo
    // que se ejecuta junto en UN mensaje, y Postgres corre un mensaje con
    // varias sentencias como una sola transacción implícita: sin este COMMIT,
    // correr el archivo completo haría que un fallo en las verificaciones de
    // abajo deshiciera el llenado.
    expect(poblarSC).toMatch(/REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;\s*COMMIT;/);
    expect(poblarSC).toMatch(/REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;/);
  });

  test('no hay DROP destructivo sobre nada que ya existiera', () => {
    todas.forEach((sql) => {
      // Se permite DROP de lo que la propia migración crea (políticas, triggers
      // e índices propios) y de su vista materializada al recrearla.
      const drops = sql.match(/DROP\s+(TABLE|VIEW|COLUMN|SCHEMA|DATABASE|FUNCTION)[^;]*/gi) || [];
      drops.forEach((d) => {
        expect(d).not.toMatch(/maestra_operaciones|Conciliación Manifiestos|itinerario_vuelos_editable/i);
      });
      expect(sql).not.toMatch(/TRUNCATE|DELETE\s+FROM\s+public\.(maestra_operaciones|"Conciliación)/i);
    });
  });

  test('los catálogos y las tablas auditadas sólo se LEEN', () => {
    const escrituras = todas.join('\n').match(
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+(public\.)?"?[A-Za-zÀ-ÿ_][\w À-ÿ]*"?/gi) || [];
    const prohibidas = /(airlines|catalogo_demoras|catalogo_aeropuertos|matriculas_manifiestos|flight_service_type|conciliacion_catalogo_aerolineas|Conciliación|itinerario_vuelos_editable|manifiestos_carga|manifiestos_pasajeros)/i;
    escrituras.forEach((e) => expect(e).not.toMatch(prohibidas));
  });

  test('la única tabla existente que se altera es maestra_operaciones, y sólo para agregar columnas', () => {
    const alters = cargaSC.match(/ALTER TABLE public\.maestra_operaciones[\s\S]*?;/g) || [];
    expect(alters.length).toBeGreaterThan(0);
    alters.forEach((a) => {
      expect(a).toMatch(/ADD COLUMN IF NOT EXISTS|ADD CONSTRAINT|DROP CONSTRAINT IF EXISTS/);
      expect(a).not.toMatch(/DROP COLUMN|ALTER COLUMN .* TYPE|SET NOT NULL/);
    });
  });
});

describe('Fuente de datos', () => {
  test('el motor lee vw_maestra_operaciones como fuente principal', () => {
    expect(motor).toMatch(/FROM public\.vw_maestra_operaciones v/);
    expect(motor).toMatch(/JOIN public\.maestra_operaciones mo ON mo\.id = v\.id/);
  });

  test('comprueba el contrato de columnas antes de crear nada, y falla nombrando lo que falta', () => {
    const contrato = motorSC.slice(motorSC.indexOf('DO $contrato$'), motorSC.indexOf('$contrato$;') + 11);
    expect(contrato).toMatch(/FROM pg_attribute a/);
    expect(contrato).toMatch(/RAISE EXCEPTION/);
    expect(contrato).toMatch(/array_to_string\(v_faltan/);
    // El contrato aparece ANTES de la primera creación de objetos.
    expect(motorSC.indexOf('DO $contrato$')).toBeLessThan(motorSC.indexOf('CREATE MATERIALIZED VIEW public.'));
  });

  test('no se inventa otra tabla maestra', () => {
    todas.forEach((sql) => {
      expect(sql).not.toMatch(/CREATE\s+TABLE\s+(IF NOT EXISTS\s+)?public\.\w*maestra\w*/i);
    });
  });
});

describe('Cancelaciones', () => {
  test('el criterio es el que YA usa la aplicación, no uno nuevo', () => {
    // js/parte-ops-flights.js: /cancel|not.?oper|no.?opera|cnx|nop\b/i
    // En Postgres el límite de palabra se escribe \y en vez de \b.
    const jsSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'js', 'parte-ops-flights.js'), 'utf8');
    const enJs = jsSource.match(/_EXCLUDED_STATUS_RE\s*=\s*\/([^/]+)\//);
    expect(enJs).not.toBeNull();
    const patronJs = enJs[1];                       // cancel|not.?oper|no.?opera|cnx|nop\b
    const patronSql = patronJs.replace(/\\b/g, '\\y');
    expect(motor).toContain(patronSql);
    // Y la segunda señal: la columna "PUNTUALIDAD / CANCELACIÓN" del manifiesto.
    expect(motor).toMatch(/estado_puntualidad\) IN \('CANCELADO', 'CANCELADA'\)/);
  });

  test('ninguna métrica operacional incluye canceladas', () => {
    const cuerpo = motor.slice(motor.indexOf('v_sql := format('), motor.indexOf('RETURN QUERY EXECUTE v_sql'));
    // Todas las líneas con un agregado deben llevar su filtro, salvo la que
    // cuenta precisamente las canceladas.
    const agregados = cuerpo.split('\n')
      .filter((l) => /^\s+(count|sum|min|max|round)\(/.test(l))
      .filter((l) => !/operaciones_canceladas|es_cancelada\)::bigint/.test(l));
    expect(agregados.length).toBeGreaterThan(15);
    agregados.forEach((linea) => {
      expect(linea).toMatch(/NOT m\.es_cancelada/);
    });
    // Y existe exactamente una métrica que sí las cuenta, aparte.
    expect(cuerpo).toMatch(/count\(\*\) FILTER \(WHERE m\.es_cancelada\)::bigint/);
  });

  test('las canceladas tampoco donan carga en tránsito', () => {
    expect(motor).toMatch(/PARTITION BY c\.rotacion_clave[\s\S]*?c\.es_cancelada ASC/);
  });
});

describe('Clasificación', () => {
  test('las dos dimensiones son independientes y MIXTA es un valor propio', () => {
    expect(reglas).toMatch(/'segmento_aviacion',\s*'COMERCIAL'/);
    expect(reglas).toMatch(/'segmento_aviacion',\s*'GENERAL'/);
    ['PASAJEROS', 'CARGA', 'MIXTA', 'OTRA'].forEach((v) => {
      expect(reglas).toMatch(new RegExp(`'naturaleza_operacion',\\s*'${v}'`));
    });
    // Segmento y naturaleza son columnas distintas, no un solo campo compuesto.
    expect(reglas).toMatch(/segmento_aviacion\s+text NOT NULL/);
    expect(reglas).toMatch(/naturaleza_operacion\s+text NOT NULL/);
  });

  test('sin regla que la cubra, la operación queda SIN CLASIFICAR: no se adivina', () => {
    // El resolvedor es un LEFT JOIN LATERAL: si no hay regla, devuelve NULL.
    expect(motor).toMatch(/LEFT JOIN LATERAL public\.estadistica_resolver_clasificacion/);
    expect(motor).toMatch(/\(c\.segmento_aviacion IS NOT NULL AND c\.naturaleza_operacion IS NOT NULL\) AS clasificada/);
    // Y no hay ningún COALESCE que rellene la clasificación con un valor por
    // omisión en la vista materializada.
    const seleccion = motor.slice(motor.indexOf('    c.segmento_aviacion,'), motor.indexOf('AS clasificada'));
    expect(seleccion).not.toMatch(/coalesce\(c\.segmento_aviacion/i);
    expect(seleccion).not.toMatch(/coalesce\(c\.naturaleza_operacion/i);
  });

  test('gana la de menor prioridad y, a igualdad, la más específica', () => {
    const fn = cuerpoFuncion(reglasSC, 'estadistica_resolver_clasificacion');
    const orden = fn.slice(fn.indexOf('ORDER BY'), fn.indexOf('LIMIT 1'));
    expect(orden).toMatch(/r\.prioridad ASC/);
    // Especificidad = número de criterios no nulos, en DESC.
    expect(orden).toMatch(/\(r\.aerolinea_id IS NOT NULL\)::int/);
    expect(orden).toMatch(/tipo_aeronave[\s\S]*IS NOT NULL\)::int/);
    expect(orden).toMatch(/tipo_servicio[\s\S]*IS NOT NULL\)::int/);
    expect(orden).toMatch(/\) DESC/);
    expect(orden).toMatch(/r\.id DESC/);
    expect(fn).toMatch(/LIMIT 1/);
  });

  test('la vigencia se compara contra la FECHA DE OPERACIÓN, no contra hoy', () => {
    const fn = cuerpoFuncion(reglasSC, 'estadistica_resolver_clasificacion');
    expect(fn).toMatch(/p_fecha >= r\.vigente_desde/);
    expect(fn).toMatch(/p_fecha <= r\.vigente_hasta/);
    expect(fn).not.toMatch(/current_date|now\(\)/);
    // Y la fecha que se le pasa desde la materialización es la de la operación.
    expect(motor).toMatch(/estadistica_resolver_clasificacion\(\s*\n\s*u\.fecha_operacion,/);
  });

  test('una regla sin criterios no puede clasificar el aeropuerto entero por descuido', () => {
    expect(reglas).toMatch(/CONSTRAINT estadistica_reglas_criterio_ck/);
    expect(reglas).toMatch(/OR prioridad >= 9000/);
  });

  test('lleva auditoría básica y vigencia coherente', () => {
    ['activo', 'prioridad', 'vigente_desde', 'vigente_hasta', 'observaciones',
      'creado_por', 'created_at', 'updated_at'].forEach((col) => {
      expect(reglas).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    });
    expect(reglas).toMatch(/CONSTRAINT estadistica_reglas_vigencia_ck[\s\S]*vigente_hasta >= vigente_desde/);
  });

  test('reutiliza los catálogos que ya existen en vez de duplicarlos', () => {
    expect(reglas).toMatch(/REFERENCES public\.conciliacion_catalogo_aerolineas\(id\)/);
    expect(reglas).toMatch(/REFERENCES public\.flight_service_type\(codigo\)/);
  });

  test('la semilla sale de catálogos reales y es reconocible para poder revertirla', () => {
    expect(semilla).toMatch(/FROM public\.flight_service_type/);
    expect(semilla).toMatch(/conciliacion_catalogo_aerolineas/);
    expect(semilla).toMatch(/\[semilla-039\]/);
    // El tipo de servicio (300) gana sobre la aerolínea (500).
    expect(semilla).toMatch(/\n    300,/);
    expect(semilla).toMatch(/\n    500,/);
  });
});

describe('Semilla de reglas sobre el motor v2', () => {
  test('la verificación usa el resolvedor de SEIS argumentos y no lee la vista vacía', () => {
    const v = sinComentarios(semilla.slice(semilla.lastIndexOf('-- VERIFICACIÓN')));
    // Antes de la 045 la vista está vacía: consultarla aborta con 55000.
    expect(v).not.toMatch(/FROM public\.mv_estadistica_operaciones/);
    expect(v).toMatch(/estadistica_resolver_clasificacion\(\s*m\.fecha_operacion, m\.aerolinea_conciliacion_id, m\.aerolinea_id,/);
  });

  test('una regla con código de aerolínea no se confunde con una de tipo de servicio', () => {
    // Sin esto, la semilla podría saltarse una regla creada a mano que sólo
    // tuviera aerolinea_codigo, o duplicar la suya al lado.
    expect(sinComentarios(semilla).match(/r\.aerolinea_codigo IS NULL/g) || []).toHaveLength(2);
  });
});

describe('Carga y tránsito', () => {
  test('las tres columnas nuevas son nullable: NULL es "no capturado", no cero', () => {
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_descargada_kg numeric,/);
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_embarcada_kg\s+numeric,/);
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_transito_kg\s+numeric;/);
    expect(carga).not.toMatch(/carga_(descargada|embarcada|transito)_kg\s+numeric\s+NOT NULL/);
    expect(carga).not.toMatch(/carga_(descargada|embarcada|transito)_kg\s+numeric\s+DEFAULT\s+0/);
  });

  test('la rotación usa los vínculos que ya existen, no matrícula + hora', () => {
    // Tres niveles, en orden de confianza: la clave explícita, el vuelo
    // relacionado por FK y, como último recurso, la fila del AODB.
    expect(motor).toMatch(/b\.rotacion_key,/);
    expect(motor).toMatch(/b\.movimiento_relacionado_id IS NOT NULL/);
    expect(motor).toMatch(/'aodb:' \|\| b\.aodb_legacy_id::text/);
    expect(motor).toMatch(/PARTITION BY c\.rotacion_clave/);
    // El par se ordena {menor, mayor} para que los dos lados caigan en la
    // misma partición apunte quien apunte a quién.
    expect(motor).toMatch(/least\(b\.id, b\.movimiento_relacionado_id\)/);
    expect(motor).toMatch(/greatest\(b\.id, b\.movimiento_relacionado_id\)/);
    // No se empareja por matrícula ni por cercanía de horas.
    expect(motor).not.toMatch(/PARTITION BY[^)]*matricula/i);
  });

  test('el tránsito se atribuye UNA sola vez por rotación', () => {
    const bloque = motor.slice(motor.indexOf('WHEN c.carga_transito_kg IS NULL THEN NULL'),
      motor.indexOf('AS transito_contable_kg'));
    // Sin rotación conocida se cuenta tal cual (es una sola fila).
    expect(bloque).toMatch(/WHEN c\.rotacion_clave IS NULL THEN c\.carga_transito_kg/);
    // Con rotación, sólo la fila ganadora aporta; el otro lado va en 0.
    expect(bloque).toMatch(/row_number\(\) OVER \(/);
    expect(bloque).toMatch(/\) = 1 THEN c\.carga_transito_kg/);
    expect(bloque).toMatch(/ELSE 0/);
    // La llegada gana el desempate: es donde la carga llega a bordo.
    expect(bloque).toMatch(/\(c\.direccion = 'A'\) DESC/);
    // El agregado suma la columna atribuida, NO la capturada en bruto.
    expect(motor).toMatch(/sum\(m\.transito_contable_kg\)\s+FILTER \(WHERE NOT m\.es_cancelada\)/);
    expect(motor).not.toMatch(/sum\(m\.carga_transito_kg\)/);
  });

  test('nacional/internacional y tránsito son dimensiones distintas, no excluyentes', () => {
    // El tránsito vive en su propia columna, nunca como un valor más de la
    // clasificación territorial.
    const bloque = motor.slice(motor.indexOf('coalesce(' + nlSQL + '            CASE public._estadistica_norm(u.tipo_operacion)'),
      motor.indexOf(') AS nacional_internacional'));
    expect(bloque.length).toBeGreaterThan(0);
    expect(bloque).not.toMatch(/transito/i);
    expect(bloque).toMatch(/'Nacional'/);
    expect(bloque).toMatch(/'Internacional'/);
  });

  test('lo DECLARADO en tipo_operacion manda sobre la derivación por catálogo', () => {
    // La fuente llena tipo_operacion con NACIONAL / INTERNACIONAL: es la
    // declaración oficial. El catálogo de aeropuertos queda de respaldo, y se
    // publica de cuál de los dos salió cada fila.
    const bloque = motor.slice(motor.indexOf('CASE public._estadistica_norm(u.tipo_operacion)'),
      motor.indexOf('AS nacint_origen'));
    expect(bloque.indexOf("WHEN 'NACIONAL' THEN 'Nacional'"))
      .toBeLessThan(bloque.indexOf('left(u.endpoint_codigo, 2)'));
    expect(motor).toMatch(/AS nacint_origen/);
  });

  test('el nombre original del origen/destino no se pierde ni se reemplaza por el IATA', () => {
    expect(motor).toMatch(/AS endpoint_nombre/);
    // Y la etiqueta cae al nombre original cuando no hubo IATA que resolver.
    expect(motor).toMatch(/coalesce\(c\.endpoint_ciudad, c\.endpoint_codigo,[\s\S]*?AS endpoint_ciudad/);
  });

  test('la identidad contable transportada = descargada/embarcada + tránsito queda protegida', () => {
    expect(carga).toMatch(/CONSTRAINT maestra_operaciones_carga_desglose_ck/);
    expect(carga).toMatch(/carga_descargada_kg \+ carga_transito_kg/);
    expect(carga).toMatch(/carga_embarcada_kg \+ carga_transito_kg/);
    // NOT VALID: rige de aquí en adelante sin arriesgar la migración con filas
    // históricas inconsistentes.
    expect(carga).toMatch(/carga_desglose_ck[\s\S]*?NOT VALID/);
  });
});

describe('Factor de ocupación y valores nulos', () => {
  test('es SUM(pax)/SUM(capacidad), sobre el mismo conjunto de filas', () => {
    const cuerpo = motor.slice(motor.indexOf('v_sql := format('), motor.indexOf('RETURN QUERY EXECUTE v_sql'));
    expect(cuerpo).toMatch(/100\.0 \* \(sum\(m\.pax\)[\s\S]*?\/ \(sum\(m\.capacidad_pasajeros\)/);
    expect(cuerpo).not.toMatch(/avg\(\s*m\.pax\s*\/\s*m\.capacidad/);
    // El mismo FILTER en numerador y denominador.
    const filtros = cuerpo.match(/FILTER \(WHERE NOT m\.es_cancelada AND m\.ocupacion_evaluable\)/g) || [];
    expect(filtros.length).toBeGreaterThanOrEqual(4);
  });

  test('capacidad NULL o <= 0 se trata como desconocida, no como cero', () => {
    // La capacidad del vuelo manda; la de la matrícula es el respaldo.
    expect(motor).toMatch(/mo\.capacidad_max_pax IS NOT NULL AND mo\.capacidad_max_pax > 0/);
    expect(motor).toMatch(/CASE WHEN mm\.pasajeros IS NOT NULL AND mm\.pasajeros > 0 THEN mm\.pasajeros END AS capacidad_matricula/);
    expect(motor).toMatch(/coalesce\(c\.capacidad_operacion, c\.capacidad_matricula\) AS capacidad_pasajeros/);
    expect(motor).toMatch(/AS ocupacion_evaluable/);
    // Y se publica de cuál de las dos salió, para poder auditarlo.
    expect(motor).toMatch(/AS capacidad_origen/);
  });

  test('la ocupación ya capturada NO se usa para calcular el factor', () => {
    // Promediar el porcentaje por fila da otro número que
    // SUM(pax)/SUM(capacidad). Se publica sólo para poder contrastarla.
    expect(motor).toMatch(/mo\.ocupacion\s+AS ocupacion_reportada/);
    const cuerpo = motorSC.slice(motorSC.indexOf('v_sql := format('), motorSC.indexOf('RETURN QUERY EXECUTE v_sql'));
    expect(cuerpo).not.toMatch(/ocupacion_reportada/);
  });

  test('nunca se divide entre cero', () => {
    expect(motor).toMatch(/WHEN coalesce\(sum\(m\.capacidad_pasajeros\)[\s\S]*?, 0\) > 0/);
  });

  test('los pasajeros no se convierten artificialmente a cero', () => {
    expect(motor).toMatch(/coalesce\(mo\.pax_total, mo\.pax_abordados\)\s+AS pax/);
    // No hay un coalesce(..., 0) sobre pax en la materialización.
    expect(motor).not.toMatch(/coalesce\(mo\.pax_total, 0\)/);
  });

  test('la capacidad viene del modelo maestro, no de una tabla propia del módulo', () => {
    expect(motor).toMatch(/LEFT JOIN public\.matriculas_manifiestos mm ON mm\.id = u\.matricula_id/);
    todas.forEach((sql) => {
      expect(sql).not.toMatch(/CREATE TABLE[^;]*capacidad/i);
    });
  });
});

describe('Esquema real de maestra_operaciones', () => {
  test('la cancelación usa la bandera de la tabla, con el texto como respaldo', () => {
    // cancelado es LA columna. Los dos criterios de texto se conservan
    // porque la bandera nace en false y el histórico puede no traerla.
    expect(motor).toMatch(/coalesce\(mo\.cancelado, false\)/);
    expect(motor).toMatch(/AS cancelado_origen/);
    const jsSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'js', 'parte-ops-flights.js'), 'utf8');
    const enJs = jsSource.match(/_EXCLUDED_STATUS_RE\s*=\s*\/([^/]+)\//);
    expect(motor).toContain(enJs[1].replace(/\\b/g, '\\y'));
  });

  test('el turnaround se atribuye a la salida: nunca se cuenta dos veces', () => {
    expect(motor).toMatch(/AS turnaround_min/);
    const bloque = motor.slice(motor.indexOf('WHEN c.direccion = \'D\' AND c.rot_llegada'),
      motor.indexOf('AS turnaround_min'));
    expect(bloque).toMatch(/c\.direccion = 'D'/);
    // Y la rotación se cuenta una sola vez, en su primer movimiento.
    expect(motor).toMatch(/AS es_cabeza_rotacion/);
    expect(motor).toMatch(/count\(\*\) FILTER \(WHERE NOT m\.es_cancelada AND m\.es_cabeza_rotacion\)/);
  });

  test('las columnas nuevas del esquema sí se usan', () => {
    ['capacidad_max_pax', 'pax_programados', 'pax_no_abordados', 'pax_inadmitidos',
      'pax_repatriados', 'carga_importacion_kg', 'carga_exportacion_kg',
      'hora_inicio_pernocta', 'hora_termino_pernocta', 'motivo_operativo',
      'codigo_afac_aifa', 'posicion', 'puertas', 'bandas_equipaje',
      'estatus_matricula', 'conciliado', 'validado', 'aerolinea_id', 'escala_iata']
      .forEach((col) => expect(motor).toMatch(new RegExp(`mo\\.${col}\\b`)));
  });

  test('el diagnóstico existe para poder explicar una pantalla vacía', () => {
    expect(motor).toMatch(/CREATE OR REPLACE FUNCTION public\.estadistica_diagnostico\(\)/);
    expect(motor).toMatch(/primera_fecha\s+date/);
    expect(motor).toMatch(/refrescado_at\s+timestamptz/);
  });
});

describe('El DDL y el llenado van separados', () => {
  test('la 042 crea la vista materializada VACÍA', () => {
    // Poblarla dentro del DDL obliga a resolver la clasificación por cada
    // fila de la maestra en la misma petición HTTP, y el editor la corta.
    expect(motorSC).toMatch(/CREATE MATERIALIZED VIEW public\.mv_estadistica_operaciones AS/);
    expect(motorSC).toMatch(/WITH NO DATA;/);
    // Y no se refresca desde el DDL.
    expect(motorSC).not.toMatch(/REFRESH MATERIALIZED VIEW/);
  });

  test('la verificación de la 042 no consulta la vista: todavía no es consultable', () => {
    const marca = vista.lastIndexOf('-- VERIFICACIÓN');
    expect(marca).toBeGreaterThan(-1);
    const verificacion = sinComentarios(vista.slice(marca));
    // Una materializada WITH NO DATA es "unscannable": consultarla aquí
    // abortaría con 55000.
    expect(verificacion).not.toMatch(/FROM public\.mv_estadistica_operaciones/);
    // Lo que sí hace es comprobar el catálogo.
    expect(verificacion).toMatch(/relispopulated/);
    expect(verificacion).toMatch(/pg_indexes/);
  });

  test('la 045 llena, deja constancia de la hora y verifica los datos', () => {
    expect(poblarSC).toMatch(/REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;/);
    expect(poblarSC).toMatch(/UPDATE public\.estadistica_refresco SET refrescado_at = now\(\)/);
    expect(poblarSC).toMatch(/FROM public\.mv_estadistica_operaciones/);
    // El primer REFRESH va sin CONCURRENTLY: la vista está vacía y
    // CONCURRENTLY exige que ya tenga datos. (El que SÍ lo lleva es el comando
    // que se reprograma en pg_cron, que corre después, con la vista ya poblada.)
    expect(poblarSC).toMatch(/^REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;/m);
    const antesDelCron = poblarSC.slice(0, poblarSC.indexOf('cron.schedule('));
    expect(antesDelCron).not.toMatch(/REFRESH MATERIALIZED VIEW CONCURRENTLY/);
  });

  test('la 045 comprueba el tamaño ANTES de lanzar el trabajo caro', () => {
    expect(poblarSC.indexOf('FROM public.maestra_operaciones'))
      .toBeLessThan(poblarSC.indexOf('REFRESH MATERIALIZED VIEW'));
  });
});

describe('Orden de borrado', () => {
  // Postgres se niega a borrar una función de la que cuelga una vista
  // materializada, y a borrar una materializada de cuyo TIPO cuelga una
  // función (error 2BP01). El orden correcto va de arriba hacia abajo, y no
  // es algo que el parser de SQL pueda detectar: sólo aparece al ejecutar.
  const pos = (frag) => {
    const i = motorSC.indexOf(frag);
    expect(i).toBeGreaterThan(-1);
    return i;
  };

  test('las funciones que usan el TIPO de la materializada se borran antes que ella', () => {
    // estadistica_detalle devuelve SETOF mv_estadistica_operaciones.
    expect(pos('DROP FUNCTION IF EXISTS public.estadistica_detalle('))
      .toBeLessThan(pos('DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones'));
  });

  test('la vista pública se borra antes que la materializada de la que cuelga', () => {
    expect(pos('DROP VIEW IF EXISTS public.v_estadistica_operaciones'))
      .toBeLessThan(pos('DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones'));
  });

  test('el resolvedor se borra DESPUÉS de la materializada que lo usa', () => {
    // Éste fue el error real: borrarlo primero aborta con 2BP01.
    expect(pos('DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones'))
      .toBeLessThan(pos('DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text);'));
  });

  test('se borran las DOS firmas del resolvedor, para que re-correr el archivo funcione', () => {
    expect(motorSC).toContain('DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text);');
    expect(motorSC).toContain('DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text);');
  });

  test('cada objeto se borra antes de volver a crearse', () => {
    [
      ['DROP MATERIALIZED VIEW IF EXISTS public.mv_estadistica_operaciones',
       'CREATE MATERIALIZED VIEW public.mv_estadistica_operaciones'],
      ['DROP FUNCTION IF EXISTS public.estadistica_resolver_clasificacion(date, bigint, text, text, text, text);',
       'CREATE OR REPLACE FUNCTION public.estadistica_resolver_clasificacion('],
      ['DROP FUNCTION IF EXISTS public.estadistica_agregado(',
       'CREATE OR REPLACE FUNCTION public.estadistica_agregado('],
      ['DROP FUNCTION IF EXISTS public.estadistica_detalle(',
       'CREATE OR REPLACE FUNCTION public.estadistica_detalle('],
      ['DROP FUNCTION IF EXISTS public.estadistica_sin_clasificar(',
       'CREATE OR REPLACE FUNCTION public.estadistica_sin_clasificar('],
      ['DROP FUNCTION IF EXISTS public.estadistica_opciones_filtro(',
       'CREATE OR REPLACE FUNCTION public.estadistica_opciones_filtro(']
    ].forEach(([drop, create]) => {
      expect(pos(drop)).toBeLessThan(pos(create));
    });
  });

  test('no se usa CASCADE sobre la materializada: un dependiente desconocido debe fallar en voz alta', () => {
    // CASCADE se llevaría por delante cualquier objeto que alguien más haya
    // construido encima, y sin decir cuál. Es preferible que la migración
    // aborte nombrándolo.
    expect(motorSC).not.toMatch(/DROP MATERIALIZED VIEW[^;]*CASCADE/);
  });
});

describe('Puntualidad contra el slot', () => {
  test('el slot vigente es el coordinado y, si no hay, el asignado', () => {
    expect(motor).toMatch(/coalesce\(mo\.slot_coordinado, mo\.slot_asignado\)\s+AS slot_vigente/);
    expect(motor).toMatch(/AS slot_origen/);
  });

  test('la desviación se mide hora_operacion − slot_vigente, NO contra la hora programada', () => {
    const bloque = motor.slice(motor.indexOf('CASE' + nlSQL + '            WHEN u.slot_vigente IS NOT NULL'),
      motor.indexOf('END AS minutos_vs_slot'));
    expect(bloque).toMatch(/u\.hora_operacion - u\.slot_vigente/);
    expect(bloque).not.toMatch(/hora_programada/);
  });

  test('los cinco tramos oficiales están completos y con los cortes correctos', () => {
    const bloque = motor.slice(motor.indexOf('WHEN c.minutos_vs_slot IS NULL THEN NULL'),
      motor.indexOf('AS clasificacion_slot'));
    expect(bloque).toMatch(/c\.minutos_vs_slot < -15 THEN 'ANTICIPADO'/);
    expect(bloque).toMatch(/c\.minutos_vs_slot <= -1 THEN 'ANTES'/);
    expect(bloque).toMatch(/c\.minutos_vs_slot = 0\s+THEN 'EN TIEMPO'/);
    expect(bloque).toMatch(/c\.minutos_vs_slot <= 15 THEN 'DESPUÉS'/);
    expect(bloque).toMatch(/ELSE 'DEMORA'/);
  });

  test('cumplir la ventana es ANTES + EN TIEMPO + DESPUÉS: ANTICIPADO queda fuera', () => {
    const cuerpo = motorSC.slice(motorSC.indexOf('v_sql := format('), motorSC.indexOf('RETURN QUERY EXECUTE v_sql'));
    expect(cuerpo).toMatch(/m\.clasificacion_slot IN \('ANTES', 'EN TIEMPO', 'DESPUÉS'\)/);
    // Y los cinco tramos se reportan por separado, para poder auditarlo.
    ['ANTICIPADO', 'ANTES', 'EN TIEMPO', 'DESPUÉS', 'DEMORA'].forEach((t) => {
      expect(cuerpo).toContain(`m.clasificacion_slot = '${t}'`);
    });
  });

  test('la demora operacional sigue siendo una métrica aparte', () => {
    // minutos_demora mide el retraso del vuelo; minutos_vs_slot mide el
    // cumplimiento del permiso. Confundirlas sería el error de fondo.
    expect(motor).toMatch(/AS minutos_demora_calc/);
    expect(motor).toMatch(/c\.minutos_demora_calc AS minutos_demora/);
    const cuerpo = motorSC.slice(motorSC.indexOf('v_sql := format('), motorSC.indexOf('RETURN QUERY EXECUTE v_sql'));
    expect(cuerpo).toMatch(/avg\(m\.minutos_demora\)/);
    expect(cuerpo).toMatch(/avg\(m\.minutos_vs_slot\)/);
  });
});

describe('Rendimiento y seguridad', () => {
  test('los cálculos pesados quedan en PostgreSQL, en una vista materializada indexada', () => {
    expect(motor).toMatch(/CREATE MATERIALIZED VIEW public\.mv_estadistica_operaciones/);
    const indices = motor.match(/CREATE (UNIQUE )?INDEX idx_mv_estadistica_\w+/g) || [];
    expect(indices.length).toBeGreaterThanOrEqual(6);
    // El UNIQUE es obligatorio para poder refrescar sin bloquear la lectura.
    expect(motor).toMatch(/CREATE UNIQUE INDEX idx_mv_estadistica_id/);
    // refrescar_estadistica se define en la 038 y la 040 no lo toca: la
    // vista cambia de forma, no de mecanismo de refresco.
    expect(motorV1).toMatch(/REFRESH MATERIALIZED VIEW CONCURRENTLY/);
  });

  test('los índices propuestos no repiten los que ya existían', () => {
    const previos = ['idx_maestra_operaciones_informe_capturado', 'idx_maestra_operaciones_informe_itinerario',
      'idx_maestra_operaciones_cliente_uuid', 'idx_maestra_operaciones_fuente',
      'idx_maestra_operaciones_origenes_gin'];
    const nuevos = (carga.match(/CREATE INDEX IF NOT EXISTS (\w+)/g) || [])
      .map((m) => m.replace('CREATE INDEX IF NOT EXISTS ', ''));
    nuevos.forEach((n) => expect(previos).not.toContain(n));
    expect(nuevos).toContain('idx_maestra_operaciones_carga');
    expect(nuevos).toContain('idx_maestra_operaciones_rotacion');
  });

  test('el SQL dinámico sólo interpola dimensiones de lista blanca, nunca valores', () => {
    const fn = motorSC.slice(motorSC.indexOf('CREATE OR REPLACE FUNCTION public.estadistica_agregado'),
      motorSC.indexOf('REVOKE ALL ON FUNCTION public.estadistica_agregado'));
    // Se rechaza cualquier dimensión que no esté en el mapa.
    expect(fn).toMatch(/IF NOT \(v_mapa \? v_dim\) THEN[\s\S]*?RAISE EXCEPTION/);
    // Los valores viajan como parámetros ($1..$4), no dentro del format().
    expect(fn).toMatch(/USING p_desde, p_hasta, coalesce\(p_filtros/);
    expect(fn).toMatch(/format\(\$q\$[\s\S]*?\$q\$, v_select, v_group\)/);
    // Dentro de la plantilla que se interpola no aparece ningún parámetro del
    // usuario: los filtros entran por $3, ya como jsonb.
    const plantilla = fn.slice(fn.indexOf('format($q$'), fn.indexOf('$q$, v_select, v_group)'));
    expect(plantilla).not.toMatch(/p_filtros|p_desde|p_hasta|p_limite/);
    expect(plantilla).toMatch(/\$3 -> 'aerolinea'/);
  });

  test('el cast nunca se escribe ANTES del FILTER de un agregado', () => {
    // sum(x)::numeric FILTER (WHERE ...) es error de sintaxis: FILTER sólo
    // puede seguir a la llamada del agregado, no a una expresión ya casteada.
    // La forma correcta es (sum(x) FILTER (WHERE ...))::numeric.
    //
    // Esto se escapó una vez y sólo apareció al correr la migración, porque el
    // trozo afectado vivía dentro de format($q$...$q$): Postgres no revisa esa
    // cadena al crear la función, sólo al ejecutarla.
    [reglasSC, cargaSC, motorSC, motorV1SC, semillaSC].forEach((sql) => {
      const malos = sql.match(/\w+\s*\([^()]*\)\s*::\s*\w+\s+FILTER\s*\(/gi) || [];
      expect(malos).toEqual([]);
    });
  });

  test('la consulta dinámica declara tantas columnas como RETURNS TABLE', () => {
    const fn = motorSC.slice(motorSC.indexOf('CREATE OR REPLACE FUNCTION public.estadistica_agregado'),
      motorSC.indexOf('REVOKE ALL ON FUNCTION public.estadistica_agregado'));

    // Columnas declaradas en RETURNS TABLE (...)
    const declarado = fn.slice(fn.indexOf('RETURNS TABLE ('), fn.indexOf('LANGUAGE plpgsql'));
    const columnas = declarado
      .replace(/^[\s\S]*?RETURNS TABLE \(/, '')
      .replace(/\)\s*$/, '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    // d1..d4 vienen en una sola línea separados por comas, así que el conteo
    // por comas es exacto para esta declaración.
    // No se fija un número a mano: crecer el motor es normal, lo que no puede
    // pasar es que la declaración y el SELECT dejen de coincidir.
    expect(columnas.length).toBeGreaterThanOrEqual(39);

    // Expresiones del SELECT de la plantilla: el %s de las dimensiones aporta
    // 4 (d1..d4) y el resto son los agregados, uno por línea.
    const plantilla = fn.slice(fn.indexOf('format($q$'), fn.indexOf('$q$, v_select, v_group)'));
    const seleccion = plantilla.slice(plantilla.indexOf('SELECT %s,'), plantilla.indexOf('FROM public.mv_estadistica_operaciones'));
    const lineas = seleccion.split(/\r?\n/)
      .filter((l) => /^\s+\(?(count|sum|min|max|round|avg|CASE|END)/.test(l))
      .filter((l) => !/^\s+(WHEN|THEN|100\.0|\/ )/.test(l));
    // El factor de ocupación ocupa dos líneas (CASE … END) pero es UNA columna.
    const paresCaseEnd = lineas.filter((l) => /^\s+CASE\s*$/.test(l)).length;
    const columnasAgregadas = lineas.length - paresCaseEnd;
    // d1..d4 más una expresión por métrica tienen que dar exactamente lo que
    // declara RETURNS TABLE, o PL/pgSQL falla en tiempo de ejecución.
    expect(columnasAgregadas + 4).toBe(columnas.length);
  });

  test('las funciones de consulta son SECURITY INVOKER y comprueban el permiso', () => {
    ['estadistica_agregado', 'estadistica_sin_clasificar', 'estadistica_detalle', 'estadistica_opciones_filtro']
      .forEach((nombre) => {
        const cuerpo = cuerpoFuncion(motorSC, nombre);
        expect(cuerpo).toMatch(/SECURITY INVOKER/);
        expect(cuerpo).toMatch(/estadistica_access_level\(auth\.uid\(\)\) = 'none'[\s\S]*?RAISE EXCEPTION/);
      });
  });

  test('la administración de reglas está cerrada del lado de los DATOS, no sólo de la pantalla', () => {
    expect(reglas).toMatch(/ALTER TABLE public\.estadistica_reglas_clasificacion ENABLE ROW LEVEL SECURITY/);
    const politica = reglas.slice(reglas.indexOf('CREATE POLICY estadistica_reglas_write'));
    expect(politica).toMatch(/USING \(public\.estadistica_access_level\(auth\.uid\(\)\) = 'admin'\)/);
    expect(politica).toMatch(/WITH CHECK \(public\.estadistica_access_level\(auth\.uid\(\)\) = 'admin'\)/);
    // La lectura es más amplia que la escritura: consultar no es administrar.
    expect(reglas).toMatch(/CREATE POLICY estadistica_reglas_select[\s\S]*?<> 'none'/);
  });

  test('el permiso se apoya en el sistema existente y el override sólo puede recortar', () => {
    expect(reglas).toMatch(/public\.conciliacion_manifiestos_access_level\(p_user_id\)/);
    expect(reglas).toMatch(/least\(v_rank, v_rank_ovr\)/);
    expect(reglas).toMatch(/section_levels' ->> 'estadistica'/);
  });

  test('no se expone service_role, ni claves, ni se desactiva RLS', () => {
    todas.forEach((sql) => {
      expect(sql).not.toMatch(/service_role/i);
      expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/GRANT .* TO PUBLIC/i);
      expect(sql).not.toMatch(/eyJhbGciOi/); // ninguna JWT pegada
    });
  });

  test('los bloques de VERIFICACIÓN no llaman a los RPC con guardia de permiso', () => {
    // En el editor SQL de Supabase auth.uid() es NULL, así que
    // estadistica_access_level devuelve 'none' y cualquiera de esos RPC
    // abortaría la migración entera con un 42501 desconcertante. La
    // verificación consulta la vista materializada directamente.
    // El rótulo "VERIFICACIÓN" vive en un comentario, así que se localiza sobre
    // el SQL original y sólo después se quitan los comentarios del recorte.
    [vista, funciones, semilla, poblar].forEach((sql) => {
      const marca = sql.lastIndexOf('-- VERIFICACIÓN');
      expect(marca).toBeGreaterThan(-1);
      const verificacion = sinComentarios(sql.slice(marca));
      ['public.estadistica_agregado(', 'public.estadistica_sin_clasificar(',
        'public.estadistica_detalle(', 'public.estadistica_opciones_filtro(',
        'public.refrescar_estadistica('].forEach((fn) => {
        expect(verificacion).not.toContain(fn);
      });
    });
  });

  test('refrescar la materialización exige nivel de escritura', () => {
    // Sigue viviendo en la 038: la 040 no la redefine.
    const fn = cuerpoFuncion(motorV1SC, 'refrescar_estadistica');
    expect(fn).toMatch(/estadistica_access_level\(auth\.uid\(\)\) NOT IN \('admin', 'edit'\)/);
    expect(fn).toMatch(/pg_try_advisory_xact_lock/);
  });
});

describe('Convivencia con el Informe Estadístico existente', () => {
  test('no se toca ningún objeto de las migraciones 027 y 028', () => {
    const objetos027y028 = [
      'v_informe_manifiestos_normalizado', 'v_informe_estadistico_resumen',
      'v_informe_estadistico_aerolinea', 'mv_informe_estadistico_base',
      'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea',
      'informe_estadistico_aprobaciones', 'refrescar_informe_estadistico'
    ];
    [reglasSC, cargaSC, motorSC, motorV1SC, semillaSC].forEach((sql) => {
      objetos027y028.forEach((obj) => {
        expect(sql).not.toMatch(new RegExp(`(CREATE|DROP|ALTER)[^;]*${obj}`, 'i'));
      });
    });
  });

  test('la función de refresco del módulo nuevo no comparte nombre con la del informe', () => {
    expect(motorV1).toMatch(/FUNCTION public\.refrescar_estadistica\(/);
    [motorV1, motor].forEach((sql) => {
      expect(sql).not.toMatch(/FUNCTION public\.refrescar_informe_estadistico\(/);
    });
  });
});
