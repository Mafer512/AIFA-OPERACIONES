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
const leer = (archivo) => fs.readFileSync(path.join(dir, archivo), 'utf8');

const reglas = leer('036_estadistica_clasificacion_reglas.sql');
const carga = leer('037_estadistica_carga_transito.sql');
const motor = leer('038_estadistica_motor.sql');
const semilla = leer('039_estadistica_reglas_semilla.sql');
const todas = [reglas, carga, motor, semilla];

// Varias de estas comprobaciones miran la ESTRUCTURA del SQL, y los archivos de
// este proyecto llevan más comentario que código. Sin quitarlos, un regex
// encuentra "CREATE MATERIALIZED VIEW" dentro del instructivo de uso y la
// prueba mide cualquier cosa menos lo que quería medir.
const sinComentarios = (sql) => sql
  .split(/\r?\n/)
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n');

const motorSC = sinComentarios(motor);
const cargaSC = sinComentarios(carga);
const reglasSC = sinComentarios(reglas);
const semillaSC = sinComentarios(semilla);

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
      '038_estadistica_motor.sql', '039_estadistica_reglas_semilla.sql'];
    nuevos.forEach((f) => expect(archivos).toContain(f));
    // 035 era la última antes de esta entrega; no existe ninguna 036-039 previa
    // con otro nombre que estas cuatro estarían duplicando.
    ['036', '037', '038', '039'].forEach((n) => {
      expect(archivos.filter((f) => f.startsWith(`${n}_`))).toHaveLength(1);
    });
  });

  test('las tres que escriben terminan en ROLLBACK, para poder revisarlas antes de aplicarlas', () => {
    [reglas, carga, semilla, motor].forEach((sql) => {
      expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
      expect(sql).toMatch(/BEGIN;/);
    });
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
    expect(contrato).toMatch(/information_schema\.columns/);
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
    expect(motor).toMatch(/PARTITION BY c\.aodb_legacy_id[\s\S]*?c\.es_cancelada ASC/);
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

describe('Carga y tránsito', () => {
  test('las tres columnas nuevas son nullable: NULL es "no capturado", no cero', () => {
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_descargada_kg numeric,/);
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_embarcada_kg\s+numeric,/);
    expect(carga).toMatch(/ADD COLUMN IF NOT EXISTS carga_transito_kg\s+numeric;/);
    expect(carga).not.toMatch(/carga_(descargada|embarcada|transito)_kg\s+numeric\s+NOT NULL/);
    expect(carga).not.toMatch(/carga_(descargada|embarcada|transito)_kg\s+numeric\s+DEFAULT\s+0/);
  });

  test('la rotación usa el vínculo que ya existe (aodb_legacy_id), no matrícula + hora', () => {
    expect(motor).toMatch(/c\.aodb_legacy_id AS rotacion_id/);
    expect(motor).toMatch(/PARTITION BY c\.aodb_legacy_id/);
    // No se empareja por matrícula ni por cercanía de horas.
    const bloque = motor.slice(motor.indexOf('AS rotacion_id') - 2500, motor.indexOf('AS transito_contable_kg'));
    expect(bloque).not.toMatch(/PARTITION BY[^)]*matricula/i);
  });

  test('el tránsito se atribuye UNA sola vez por rotación', () => {
    const bloque = motor.slice(motor.indexOf('CASE\n        WHEN c.carga_transito_kg IS NULL THEN NULL'),
      motor.indexOf('AS transito_contable_kg'));
    // Sin rotación conocida se cuenta tal cual (es una sola fila).
    expect(bloque).toMatch(/WHEN c\.aodb_legacy_id IS NULL THEN c\.carga_transito_kg/);
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
    expect(motor).toMatch(/nacional_internacional/);
    const nacInt = motor.match(/END AS nacional_internacional/);
    expect(nacInt).not.toBeNull();
    const bloque = motor.slice(motor.indexOf('WHEN u.endpoint_codigo IS NULL THEN NULL'),
      motor.indexOf('END AS nacional_internacional'));
    expect(bloque).not.toMatch(/transito/i);
    expect(bloque).toMatch(/'Nacional'/);
    expect(bloque).toMatch(/'Internacional'/);
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
    expect(motor).toMatch(/CASE WHEN mm\.pasajeros IS NOT NULL AND mm\.pasajeros > 0 THEN mm\.pasajeros END AS capacidad_pasajeros/);
    expect(motor).toMatch(/\(c\.pax IS NOT NULL AND c\.capacidad_pasajeros IS NOT NULL\) AS ocupacion_evaluable/);
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

describe('Rendimiento y seguridad', () => {
  test('los cálculos pesados quedan en PostgreSQL, en una vista materializada indexada', () => {
    expect(motor).toMatch(/CREATE MATERIALIZED VIEW public\.mv_estadistica_operaciones/);
    const indices = motor.match(/CREATE (UNIQUE )?INDEX idx_mv_estadistica_\w+/g) || [];
    expect(indices.length).toBeGreaterThanOrEqual(6);
    // El UNIQUE es obligatorio para poder refrescar sin bloquear la lectura.
    expect(motor).toMatch(/CREATE UNIQUE INDEX idx_mv_estadistica_id/);
    expect(motor).toMatch(/REFRESH MATERIALIZED VIEW CONCURRENTLY/);
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
    [reglasSC, cargaSC, motorSC, semillaSC].forEach((sql) => {
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
    expect(columnas.length).toBe(39);

    // Expresiones del SELECT de la plantilla: el %s de las dimensiones aporta
    // 4 (d1..d4) y el resto son los agregados, uno por línea.
    const plantilla = fn.slice(fn.indexOf('format($q$'), fn.indexOf('$q$, v_select, v_group)'));
    const seleccion = plantilla.slice(plantilla.indexOf('SELECT %s,'), plantilla.indexOf('FROM public.mv_estadistica_operaciones'));
    const lineas = seleccion.split(/\r?\n/)
      .filter((l) => /^\s+(count|sum|min|max|round|CASE|END)/.test(l))
      .filter((l) => !/^\s+(WHEN|THEN|100\.0|\/ )/.test(l));
    // El factor de ocupación ocupa dos líneas (CASE … END) pero es UNA columna.
    const paresCaseEnd = lineas.filter((l) => /^\s+CASE\s*$/.test(l)).length;
    const columnasAgregadas = lineas.length - paresCaseEnd;
    expect(columnasAgregadas).toBe(35);        // 35 métricas
    expect(columnasAgregadas + 4).toBe(columnas.length); // + d1..d4 = 39
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
    [motor, semilla].forEach((sql) => {
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
    const fn = cuerpoFuncion(motorSC, 'refrescar_estadistica');
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
    [reglasSC, cargaSC, motorSC, semillaSC].forEach((sql) => {
      objetos027y028.forEach((obj) => {
        expect(sql).not.toMatch(new RegExp(`(CREATE|DROP|ALTER)[^;]*${obj}`, 'i'));
      });
    });
  });

  test('la función de refresco del módulo nuevo no comparte nombre con la del informe', () => {
    expect(motor).toMatch(/FUNCTION public\.refrescar_estadistica\(/);
    expect(motor).not.toMatch(/FUNCTION public\.refrescar_informe_estadistico\(/);
  });
});
