/* Invariantes de las migraciones 058-061 (manifiestos_hechos).
 *
 * Igual que estadistica-sql.test.js: el SQL no se ejecuta aquí (no hay base de
 * pruebas), pero sí se comprueba que diga lo que debe decir — que sólo lea de
 * las dos tablas de origen, que el corte por FECHA sea el acordado, que la
 * regla de carga sea la misma que la de script.js, y que el cambio en
 * producción sólo renombre lo viejo a *_old, nunca lo borre.
 */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const dir = path.join(raiz, 'supabase', 'migrations');
const leer = (archivo) => fs.readFileSync(path.join(dir, archivo), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const estructura = leer('058_manifiestos_hechos_estructura.sql');
const llenado = leer('059_manifiestos_hechos_llenado.sql');
const seguimiento = leer('059_manifiestos_hechos_seguimiento.sql');
const cambio = leer('060_reportes_sobre_manifiestos_hechos.sql');
const reversa = leer('060_reversa_reportes_sobre_manifiestos_hechos.sql');
const validacion = leer('061a_validacion_manifiestos_hechos_totales.sql');
const validacionCapas = leer('061b_validacion_reportes_coinciden.sql');
const inicio057c = leer('057c_inicio_manifiestos_por_dia.sql');
const previa062 = leer('062a_validacion_previa.sql');
const frontera062 = leer('062b_frontera_y_fecha.sql');
const reversa062 = leer('062b_reversa_frontera_y_fecha.sql');
const seguimiento062 = leer('062b_seguimiento.sql');
const aviso062 = leer('062c_quitar_aviso_carga.sql');
const ag051 = leer('051_aviacion_general_2025_por_fecha_real.sql');
const agregado043 = leer('043_estadistica_v2_agregado.sql');
const script = fs.readFileSync(path.join(raiz, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

const estructuraSC = sinComentarios(estructura);
const llenadoSC = sinComentarios(llenado);
const cambioSC = sinComentarios(cambio);
const reversaSC = sinComentarios(reversa);
const nuevasSC = [estructuraSC, llenadoSC, cambioSC];

describe('fuentes: sólo maestra_manifiestos y "Conciliación Manifiestos"', () => {
  const prohibidas = [
    /maestra_operaciones/i, /vw_maestra_operaciones/i, /manifiestos_carga\b/i, /manifiestos_pasajeros\b/i,
    /"Base de Datos Manifiestos/i, /"Manifiestos /i, /datos_origen/i, /itinerario_vuelos_editable/i
  ];

  test.each(prohibidas.map((re) => [re]))('ninguna migración nueva lee %s', (re) => {
    nuevasSC.forEach((sql) => expect(sql).not.toMatch(re));
  });

  test('lee las dos tablas de origen y nunca las modifica', () => {
    expect(estructuraSC).toMatch(/FROM public\.maestra_manifiestos m/);
    expect(estructuraSC).toMatch(/FROM public\."Conciliación Manifiestos" c/);
    nuevasSC.concat(reversaSC).forEach((sql) => {
      expect(sql).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE|TRUNCATE)\s+public\.(maestra_manifiestos|"Conciliación Manifiestos")/i);
      expect(sql).not.toMatch(/(CREATE|DROP|ALTER)\s+(TRIGGER|POLICY)[^;]*"Conciliación Manifiestos"/i);
      expect(sql).not.toMatch(/(CREATE|DROP)\s+INDEX[^;]*ON\s+public\.(maestra_manifiestos|"Conciliación Manifiestos")/i);
    });
  });

  test('el corte por FECHA: maestra antes de 2026 y Conciliación desde 2026', () => {
    expect(estructuraSC).toMatch(/f\.fecha_operacion < DATE '2026-01-01'/);
    expect(estructuraSC).toMatch(/f\.fecha_operacion >= DATE '2026-01-01'/);
    expect(estructuraSC).toMatch(/CASE WHEN v_ini < DATE '2026-01-01' THEN 'MAESTRA' ELSE 'CONCILIACION' END/);
  });
});

describe('reglas de negocio en manifiestos_hechos', () => {
  test('fecha_reporte = cierre de Subsecretaría válido o, si no hay, la FECHA', () => {
    const coincidencias = estructuraSC.match(/coalesce\(f\.fecha_cierre, f\.fecha_operacion\)/g) || [];
    expect(coincidencias).toHaveLength(2);
    expect(estructuraSC).toMatch(/'\^\\d\{1,2\}\/\\d\{1,2\}\/\\d\{4\}\$'/);
  });

  test('maestra clasifica por tipo_reporte y Conciliación por la regla única', () => {
    expect(estructuraSC).toMatch(/CASE WHEN p_fuente = 'MAESTRA' THEN upper\(coalesce\(s\.tipo_reporte, ''\)\) = 'CARGA'/);
    expect(estructuraSC).toMatch(/public\.aifa_regla_carga\(\s*a\.types,/);
  });

  test('la regla de carga: catálogo primero y luego el orden de _conciRowIsCargo()', () => {
    const cuerpo = estructuraSC.slice(estructuraSC.indexOf('FUNCTION public.aifa_regla_carga('));
    const orden = ['catalogo_carga', 'catalogo_pasajeros', 'cierre_carga', 'cierre_pasajeros',
      'lista_carga', 'lista_pasajeros', 'servicio_carga', 'omision_pasajeros'].map((m) => cuerpo.indexOf(`'${m}'`));
    orden.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(cuerpo).toMatch(/IN \('F', 'H'\)/);
  });

  test('la lista fija de aerolíneas es la misma que la de script.js', () => {
    const lista = (sql, fn) => {
      const i = sql.indexOf(`FUNCTION public.${fn}()`);
      const bloque = sql.slice(i, sql.indexOf(']) x', i));
      return [...bloque.slice(bloque.indexOf('ARRAY[') + 6).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    const js = (nombre) => JSON.parse(script.match(new RegExp(`let ${nombre} = (\\[[^\\]]*\\]);`))[1]);
    expect(lista(estructura, 'aifa_aerolineas_carga_fijas')).toEqual(js('cargoAirlines'));
    expect(lista(estructura, 'aifa_aerolineas_pasajeros_fijas')).toEqual(js('passengerAirlines'));
  });

  test('operación = fila con AEROLINEA; cancelado = PUNTUALIDAD contiene CANCEL', () => {
    expect(estructuraSC).toMatch(/\(s\.aerolinea_texto IS NOT NULL\)\s+AS es_operacion/);
    expect(estructuraSC).toMatch(/\(upper\(coalesce\(s\.puntualidad, ''\)\) LIKE '%CANCEL%'\) AS cancelado/);
    expect(estructuraSC).toMatch(/count\(\*\) FILTER \(WHERE es_operacion\)/);
  });

  test('tabla tipada sin JSON, con clave (fuente, id_origen) y los índices pedidos', () => {
    const tabla = estructuraSC.slice(estructuraSC.indexOf('CREATE TABLE IF NOT EXISTS public.manifiestos_hechos ('),
      estructuraSC.indexOf('CREATE INDEX IF NOT EXISTS idx_manifiestos_hechos_fecha_reporte'));
    expect(tabla).not.toMatch(/\bjsonb?\b/);
    expect(tabla).toMatch(/UNIQUE \(fuente, id_origen\)/);
    ['(fecha_reporte)', '(aerolinea, fecha_reporte)', '(destino, fecha_reporte)', '(es_carga, fecha_reporte)']
      .forEach((ix) => expect(estructuraSC).toContain(`ON public.manifiestos_hechos ${ix}`));
  });

  test('los cuatro resúmenes existen', () => {
    ['manifiestos_resumen_dia', 'manifiestos_resumen_mes_aerolinea', 'manifiestos_resumen_mes_destino',
      'manifiestos_resumen_mes_aerolinea_destino']
      .forEach((t) => expect(estructuraSC).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`));
  });

  test('refresco con candado: el programado no se encima, el manual espera su turno', () => {
    const refrescar = estructuraSC.slice(estructuraSC.indexOf('FUNCTION public.manifiestos_hechos_refrescar('));
    expect(refrescar).toMatch(/pg_try_advisory_xact_lock\(hashtext\('manifiestos_hechos'\)/);
    const mes = estructuraSC.slice(estructuraSC.indexOf('FUNCTION public.manifiestos_hechos_rehacer_mes('));
    expect(mes).toMatch(/pg_advisory_xact_lock\(hashtext\('manifiestos_hechos'\)/);
    expect(refrescar).toMatch(/greatest\(coalesce\(p_dias, 60\), 1\)/);
  });

  test('el hueco de carga ene–ago 2026 queda como aviso configurable', () => {
    expect(estructura).toMatch(/'carga_2026_ene_ago',\s*'Carga ene–ago 2026 incompleta'/);
    expect(estructura).toMatch(/DATE '2026-01-01', DATE '2026-08-31'/);
  });
});

describe('059: el llenado va en pg_cron, todo o nada, con bitácora', () => {
  test('la tarea se quita sola, corre sin límite de tiempo y termina en FIN: OK', () => {
    expect(llenadoSC).toMatch(/cron\.schedule\(\s*'mig_manifiestos_hechos'/);
    expect(llenadoSC).toMatch(/SELECT cron\.unschedule\('mig_manifiestos_hechos'\);/);
    expect(llenadoSC).toMatch(/SET statement_timeout = 0;/);
    expect(llenadoSC).toMatch(/EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\._mig_paso_log \(paso, inicio, fin, error\)/);
    expect(llenadoSC).toMatch(/VALUES \('FIN', clock_timestamp\(\), clock_timestamp\(\), 'OK'\)/);
  });

  test('el seguimiento es de solo lectura', () => {
    expect(sinComentarios(seguimiento)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
    expect(sinComentarios(validacion)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
    expect(sinComentarios(validacionCapas)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  });
});

describe('060: cambio en producción en una sola transacción', () => {
  test('un BEGIN y un COMMIT, sin ROLLBACK de prueba', () => {
    expect(cambioSC.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(cambioSC.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(cambioSC).not.toMatch(/^ROLLBACK;$/m);
  });

  test('lo viejo se renombra a *_pre060 (los *_old de antes no se tocan) y nunca se borra', () => {
    expect(cambioSC).toMatch(/RENAME TO %I', v_base, v_args, v_base \|\| '_pre060'\)/);
    expect(cambioSC).toMatch(/v_rel1, v_rel1 \|\| '_pre060'\)/);
    expect(cambioSC).not.toMatch(/_old\b/);
    expect(cambioSC).not.toMatch(/DROP\s+MATERIALIZED\s+VIEW/i);
    expect(cambioSC).not.toMatch(/DROP[^;]*_pre060/i);
    // Sólo se quitan vistas simples (las que creó esta misma migración).
    expect(cambioSC).toMatch(/IF v_kind = 'v' THEN\s+EXECUTE format\('DROP VIEW public\.%I', v_rel1\);/);
  });

  test('renombra según el tipo real (pg_class.relkind): tabla, vista o vista materializada', () => {
    expect(cambioSC).toMatch(/SELECT c\.relkind INTO v_kind FROM pg_class c/);
    expect(cambioSC).toMatch(/CASE v_kind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END/);
    expect(cambioSC).toMatch(/IF v_kind NOT IN \('r', 'p', 'v', 'm'\) THEN/);
    expect(cambioSC).not.toMatch(/v_estadistica_calculo/);
  });

  test('conserva los nombres que consume la app', () => {
    ['mv_estadistica_operaciones', 'v_estadistica_operaciones', 'mv_informe_estadistico_base',
      'mv_informe_estadistico_resumen', 'mv_informe_estadistico_aerolinea', 'v_informe_manifiestos_normalizado',
      'v_informe_estadistico_resumen', 'v_informe_estadistico_aerolinea']
      .forEach((v) => expect(cambioSC).toMatch(new RegExp(`_mh_vista_compatible\\(\\s*'${v}'`)));
    ['estadistica_agregado', 'estadistica_detalle', 'estadistica_sin_clasificar', 'estadistica_opciones_filtro',
      'estadistica_diagnostico', 'refrescar_estadistica', 'refrescar_informe_estadistico', 'inicio_manifiestos_por_dia']
      .forEach((f) => expect(cambioSC).toContain(`CREATE OR REPLACE FUNCTION public.${f}(`));
  });

  test('inicio_manifiestos_por_dia mantiene los parámetros y columnas de la 057c', () => {
    expect(cambioSC).toMatch(/inicio_manifiestos_por_dia\(\s*p_desde date DEFAULT NULL,\s*p_hasta date DEFAULT NULL\s*\)\s*RETURNS TABLE \(\s*fecha date,\s*comercial_ops bigint,\s*comercial_pax numeric,\s*carga_ops bigint,\s*carga_kg numeric\s*\)/);
    expect(cambioSC).toContain("'TABLE(fecha date, comercial_ops bigint, comercial_pax numeric, carga_ops bigint, carga_kg numeric)'");
  });

  test('la 057c que corre en producción está en el repo con la misma firma', () => {
    const sc = sinComentarios(inicio057c);
    expect(sc).toMatch(/CREATE OR REPLACE FUNCTION public\.inicio_manifiestos_por_dia\(\s*p_desde date DEFAULT NULL,\s*p_hasta date DEFAULT NULL\s*\)\s*RETURNS TABLE \(\s*fecha date,\s*comercial_ops bigint,\s*comercial_pax numeric,\s*carga_ops bigint,\s*carga_kg numeric\s*\)/);
    const descargas = 'C:/Users/Windows/Downloads/057c_inicio_manifiestos_por_dia.sql';
    if (fs.existsSync(descargas)) {
      expect(inicio057c).toBe(fs.readFileSync(descargas, 'utf8').replace(/\r\n/g, '\n'));
    }
  });

  test('estadistica_agregado devuelve las mismas columnas que la 043', () => {
    const columnas = (sql) => {
      const i = sql.indexOf('FUNCTION public.estadistica_agregado(');
      const bloque = sql.slice(sql.indexOf('RETURNS TABLE (', i), sql.indexOf('LANGUAGE plpgsql', i));
      return [...sinComentarios(bloque).matchAll(/^\s*(\w+)\s+(?:text|bigint|numeric)/gm)].map((m) => m[1]);
    };
    expect(columnas(cambio)).toEqual(columnas(agregado043));
    expect(columnas(cambio).length).toBeGreaterThan(60);
  });

  test('fuente_principal es PASAJEROS / CARGA y fecha_operacion es la fecha de reporte', () => {
    expect(cambioSC).toMatch(/CASE WHEN h\.es_carga THEN 'CARGA' ELSE 'PASAJEROS' END AS fuente_principal/);
    expect(cambioSC).toMatch(/h\.fecha_reporte\s+AS fecha_operacion,/);
    expect(cambioSC).toMatch(/h\.fecha_operacion\s+AS fecha_operacion_manifiesto/);
  });

  test('la columna sin fuente sale NULL con el tipo del objeto viejo', () => {
    expect(cambioSC).toMatch(/format\('NULL::%s AS %I', r\.tipo, r\.attname\)/);
  });

  test('cambia la agenda de pg_cron: fuera lo viejo, refresco cada 10 minutos', () => {
    expect(cambioSC).toMatch(/jobname IN \('refrescar_estadistica', 'refrescar_informe_estadistico'\)/);
    expect(cambioSC).toMatch(/'manifiestos_hechos_refresco',\s*'\*\/10 \* \* \* \*',\s*\$cmd\$SELECT public\.manifiestos_hechos_refrescar\(60\)\$cmd\$/);
  });

  test('si se pierde una columna que hoy consume la app, aborta', () => {
    expect(cambioSC).toMatch(/RAISE EXCEPTION E'El cambio NO se aplicó\. Falta:/);
  });
});

describe('reversa de la 060', () => {
  test('regresa cada *_pre060 a su nombre, según su tipo, sin tocar los *_old', () => {
    expect(reversaSC).toMatch(/RENAME TO %I', v_base \|\| '_pre060', v_args, v_base\)/);
    expect(reversaSC).toMatch(/v_rel1 \|\| '_pre060', v_rel1\)/);
    expect(reversaSC).toMatch(/CASE v_kind WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END/);
    expect(reversaSC).not.toMatch(/_old\b/);
    expect(reversaSC).not.toMatch(/DROP[^;]*_pre060/i);
    expect(reversaSC).not.toMatch(/DROP\s+(TABLE|MATERIALIZED)/i);
  });

  test('deja la agenda como estaba en producción: sólo refrescar_informe_estadistico, cada hora', () => {
    expect(reversaSC).toMatch(/cron\.schedule\('refrescar_informe_estadistico', '0 \* \* \* \*',\s*\$c\$SELECT public\.refrescar_informe_estadistico\(true\)\$c\$\)/);
    expect(reversaSC).not.toMatch(/cron\.schedule\('refrescar_estadistica'/);
    expect(reversaSC).toMatch(/cron\.unschedule\(jobname\) FROM cron\.job WHERE jobname = 'manifiestos_hechos_refresco'/);
  });

  test('trae como respaldo las definiciones actuales de producción de los dos refrescos', () => {
    expect(reversaSC).toMatch(/CREATE OR REPLACE FUNCTION public\.refrescar_informe_estadistico\(p_forzar boolean DEFAULT false\)\s+RETURNS timestamp with time zone[\s\S]*SET search_path TO ''[\s\S]*hashtext\('informe_estadistico_refresco'\)/);
    expect(reversaSC).toMatch(/CREATE OR REPLACE FUNCTION public\.refrescar_estadistica\(p_forzar boolean DEFAULT false\)[\s\S]*SET search_path TO 'public'[\s\S]*INSERT INTO public\.mv_estadistica_operaciones\s+SELECT \* FROM public\.v_estadistica_calculo;/);
  });

  test('rellena la tabla congelada desde v_estadistica_calculo en vez de un REFRESH', () => {
    // El REFRESH sólo queda para el caso en que sí fuera vista materializada.
    expect(reversaSC.match(/REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;/g)).toHaveLength(1);
    expect(reversaSC).toMatch(/IF v_kind = 'm' THEN\s+REFRESH MATERIALIZED VIEW public\.mv_estadistica_operaciones;/);
    expect(reversaSC).toMatch(/ELSIF v_kind IN \('r', 'p'\) THEN/);
    expect(reversaSC).toMatch(/SELECT public\.refrescar_informe_estadistico\(true\);/);
  });
});

describe('061: validación en dos partes', () => {
  const validacionSC = sinComentarios(validacion);
  test('061a trae los cuatro años y compara 2026 contra cifras_oficiales_mensuales hasta el corte', () => {
    expect(validacion).toContain('(2022,  9639,  912415,     8,     41.6)');
    expect(validacion).toContain('(2025, 52597, 7058219, 14830, 434565.8)');
    expect(validacionSC).toMatch(/FROM public\.cifras_oficiales_mensuales o, corte\s+WHERE o\.anio = 2026 AND make_date\(o\.anio, o\.mes, 1\) <= corte\.oficial/);
    expect(validacionSC).toContain('public.fn_fecha_corte_oficial()');
  });

  test('061a: los años van por fecha de reporte y 2026 por FECHA, de las dos fuentes, sin frontera fija', () => {
    expect(validacionSC).toMatch(/FROM public\.manifiestos_resumen_dia\s+GROUP BY anio/);
    expect(validacionSC).toMatch(/extract\(month FROM fecha_operacion\)::int\s+AS mes/);
    expect(validacionSC).toMatch(/FROM public\.manifiestos_hechos\s+WHERE fecha_operacion >= DATE '2026-01-01'/);
    expect(validacionSC).not.toMatch(/fuente = 'CONCILIACION'\s+AND fecha_operacion/);
    expect(validacionSC).not.toMatch(/WHERE anio = 2026/);
  });

  test('061a no lee las vistas de reportes (se corre antes de la 060); 061b sí', () => {
    expect(validacionSC).not.toMatch(/v_informe_|v_estadistica_|inicio_manifiestos_por_dia/);
    ['v_informe_estadistico_resumen', 'v_estadistica_operaciones', 'inicio_manifiestos_por_dia()']
      .forEach((x) => expect(validacionCapas).toContain(x));
  });
});

describe('avisos de periodo (js/manifiestos-avisos.js)', () => {
  const { filtrar } = require('../js/manifiestos-avisos.js');
  const avisos = [
    { clave: 'carga_2026_ene_ago', texto: 'Carga ene–ago 2026 incompleta', desde: '2026-01-01', hasta: '2026-08-31',
      categoria: 'carga', ambitos: ['inicio', 'estadistica'], activo: true },
    { clave: 'apagado', texto: 'x', desde: '2026-01-01', hasta: '2026-12-31', ambitos: ['inicio'], activo: false }
  ];

  test('sólo los activos, del ámbito, que se cruzan con el periodo', () => {
    expect(filtrar(avisos, 'inicio', '2026-08-31', '2026-09-30').map((a) => a.clave)).toEqual(['carga_2026_ene_ago']);
    expect(filtrar(avisos, 'estadistica', '2026-09-01', '2026-09-30')).toEqual([]);
    expect(filtrar(avisos, 'estadistica', '2025-01-01', '2025-12-31')).toEqual([]);
    expect(filtrar(avisos, 'inicio', '2026-03-15')).toHaveLength(1);
    expect(filtrar(avisos, 'otro', '2026-03-15')).toEqual([]);
    expect(filtrar(avisos, 'inicio', '2026-03-15', '2026-03-15', 'comercial')).toEqual([]);
    expect(filtrar(avisos, 'inicio', '')).toEqual([]);
  });
});

describe('el frontend ya no lee las fuentes viejas para el inicio', () => {
  test('el día del inicio sale del detalle de la capa (totales_detalle_por_dia)', () => {
    const cargador = script.slice(script.indexOf('async function ndwLoadCurrentManifestDay('),
      script.indexOf('function renderNavdeckWeeklyBanner('));
    expect(cargador).toContain('window.TotalesService.getDetalleDiario(dateKey, dateKey, { forzar: force })');
    expect(cargador).not.toContain('v_informe_manifiestos_normalizado');
  });

  test('Estadística y el Informe muestran el aviso de periodo, discreto', () => {
    const panel = fs.readFileSync(path.join(raiz, 'js', 'estadistica-panel.js'), 'utf8');
    const informe = fs.readFileSync(path.join(raiz, 'js', 'estadistico-informe.js'), 'utf8');
    expect(panel).toContain("api.para('estadistica', desde(), hasta())");
    expect(panel).toContain("String(a.clave || '').startsWith('periodo_')");
    expect(panel).toMatch(/const periodo = await avisosDePeriodo\(\);/);
    expect(panel).not.toContain('REFRESH MATERIALIZED VIEW public.mv_estadistica_operaciones');
    expect(informe).toContain("api.para('estadistica', `${anio}-01-01`, `${anio}-12-31`)");
    expect(informe).toMatch(/est-aviso est-aviso-info/);
  });

  test('index.html carga la capa de totales y los avisos antes que script.js', () => {
    const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
    expect(html.indexOf('js/manifiestos-avisos.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/manifiestos-avisos.js')).toBeLessThan(html.indexOf('src="script.js'));
    expect(html.indexOf('js/totales-service.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/totales-service.js')).toBeLessThan(html.indexOf('src="script.js'));
  });
});

describe('ya no hay cifras forzadas en JS: todo pasa por js/totales-service.js', () => {
  const leerJs = (archivo) => fs.readFileSync(path.join(raiz, 'js', archivo), 'utf8');

  test('el archivo de cifras forzadas se borró y nadie lo carga', () => {
    expect(fs.existsSync(path.join(raiz, 'js', 'estadistico-informe-overrides.js'))).toBe(false);
    expect(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8')).not.toContain('estadistico-informe-overrides');
    ['estadistico-informe.js', 'estadistica-panel.js', 'estadistica-motor.js'].forEach((archivo) =>
      expect(leerJs(archivo)).not.toContain('OFFICIAL_STATISTICS_OVERRIDES'));
  });

  test('ninguna pantalla de totales lee monthly_operations, annual_operations ni daily_operations para totales', () => {
    const informe = leerJs('estadistico-informe.js');
    expect(informe).not.toContain("'monthly_operations'");
    expect(informe).not.toContain("'annual_operations'");
    ['comparativa-historica.js', 'yoy-cargo.js', 'yoy-general.js'].forEach((archivo) => {
      const js = leerJs(archivo);
      expect(js).toContain('window.TotalesService.filasMensuales()');
      expect(js).not.toMatch(/from\('(monthly|daily)_operations'\)/);
    });
    expect(leerJs('analisis-anual.js')).not.toContain("from('annual_operations')");
    expect(script).toContain('window.TotalesService.filasAnuales(),\n                window.TotalesService.filasMensuales(),');
  });

  test('el Informe y Estadística toman los totales de la capa', () => {
    expect(leerJs('estadistico-informe.js')).toContain('Core.aplicarTotalesUnificados(Core.aggregateResumen(resumenRows), meses)');
    const panel = leerJs('estadistica-panel.js');
    expect(panel).toContain("servicio.getTotales({ desde, hasta, granularidad: esMensual ? 'mes' : 'total' })");
    expect(panel).toContain('servicio.hayFiltros(filtros)');
    expect(panel).toContain('async function totalesAgFbo(rango, anterior)');
    const motorJs = leerJs('estadistica-motor.js');
    expect(motorJs).not.toContain('function oficialOperacion(');
    expect(motorJs).not.toContain('celdasOficialesCapturadas');
  });
});

describe('062a: validación previa, solo lectura', () => {
  const sc = sinComentarios(previa062);
  test('no modifica nada', () => {
    expect(sc).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  });
  test('compara maestra, Conciliación y oficial por mes con el mismo criterio de FECHA que la 062b', () => {
    expect(sc).toContain("'^(\\d{4})-(\\d{1,2})-(\\d{1,2})(\\D|$)'");
    expect(sc).toContain("'^(\\d{1,2})/(\\d{1,2})/(\\d{4})(\\D|$)'");
    expect(sc).toMatch(/y2\.portal\) AS fecha/);
    expect(sc).toContain('public.cifras_oficiales_mensuales');
    expect(sc).toContain("WHERE clave = 'fecha_corte_maestra'");
    ["'VACÍO'", "'MUY POR DEBAJO'", "'REVISAR'"].forEach((x) => expect(sc).toContain(x));
  });
});

describe('062b: frontera por config_fuentes y conteo por FECHA', () => {
  const sc = sinComentarios(frontera062);
  const cargar = sc.slice(sc.indexOf('CREATE OR REPLACE FUNCTION public._mh_cargar('), sc.indexOf('CREATE OR REPLACE FUNCTION public.manifiestos_hechos_refrescar('));

  test('fn_fecha_corte_maestra lee config_fuentes', () => {
    expect(sc).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_fecha_corte_maestra\(\)[\s\S]*FROM public\.config_fuentes cf\s+WHERE cf\.clave = 'fecha_corte_maestra'/);
  });

  test('_mh_cargar usa la frontera excluyente y la FECHA, sin 2026-01-01 fijo ni cierre', () => {
    expect(cargar).toContain('v_corte     date := public.fn_fecha_corte_maestra();');
    expect(cargar).toContain('AND f.fecha_operacion <= v_corte');
    expect(cargar).toContain('AND f.fecha_operacion > v_corte');
    expect(cargar).toContain(`public._aifa_fecha_manifiesto(m."FECHA"::text, NULL::date)`);
    expect(cargar).toContain(`public._aifa_fecha_manifiesto(c."FECHA"::text, c."_portal_flight_date"::date)`);
    expect(cargar).not.toMatch(/2026-01-01/);
    expect(cargar).not.toMatch(/CIERRE SUBSECRETARIA|_aifa_fecha_cierre/);
    // Lo de una fuente que quedó del otro lado de la frontera se borra.
    expect(cargar).toMatch(/p_fuente = 'MAESTRA'\s+AND h\.fecha_operacion >  v_corte/);
    expect(cargar).toMatch(/p_fuente = 'CONCILIACION' AND h\.fecha_operacion <= v_corte/);
  });

  test('el refresco y el rehecho de un mes también siguen la frontera', () => {
    const refrescar = sc.slice(sc.indexOf('CREATE OR REPLACE FUNCTION public.manifiestos_hechos_refrescar('), sc.indexOf('CREATE OR REPLACE FUNCTION public.manifiestos_hechos_rehacer_mes('));
    expect(refrescar).toContain('public.fn_fecha_corte_maestra() + 1');
    expect(refrescar).not.toMatch(/2026-01-01/);
    const rehacer = sc.slice(sc.indexOf('CREATE OR REPLACE FUNCTION public.manifiestos_hechos_rehacer_mes('));
    expect(rehacer).toMatch(/'maestra',\s+public\._mh_cargar\('MAESTRA', v_ini, v_fin, true\)/);
    expect(rehacer).toMatch(/'conciliacion', public\._mh_cargar\('CONCILIACION', v_ini, v_fin, true\)/);
  });

  test('la FECHA: con año → _portal_flight_date → ilegible (y se reporta)', () => {
    expect(sc).toMatch(/SELECT coalesce\(public\._aifa_fecha_con_anio\(p_fecha\), p_portal\)/);
    expect(sc).toContain('CREATE OR REPLACE VIEW public.v_manifiestos_fecha_ilegible AS');
    expect(sc).toMatch(/SELECT count\(\*\) INTO _n FROM public\.v_manifiestos_fecha_ilegible;/);
  });

  test('totales_detalle_por_dia: AG con la misma regla de fecha que aviacion_general_resumen (051)', () => {
    const rpc = sc.slice(sc.indexOf('CREATE OR REPLACE FUNCTION public.totales_detalle_por_dia('));
    expect(rpc).toContain("WHEN o.tipo_operacion = 'LLEGADA' THEN o.fecha_operacion");
    expect(rpc).toContain('extract(year FROM o.fecha_operacion)::int IN (2024, 2025)');
    expect(rpc).toContain("WHERE o.estatus_registro = 'ACTIVO'");
    expect(ag051).toContain("WHEN ba.tipo_operacion = 'LLEGADA'                THEN ba.fecha_operacion");
    expect(ag051).toContain('WHEN extract(year FROM ba.fecha_operacion)::int IN (2024, 2025)');
    expect(rpc).toMatch(/GRANT EXECUTE ON FUNCTION public\.totales_detalle_por_dia\(date, date\) TO authenticated/);
  });

  test('va en pg_cron, todo o nada, rehace 2026 mes por mes y verifica antes de terminar', () => {
    expect(sc).toMatch(/cron\.schedule\(\s*'mig_062b_frontera'/);
    expect(sc).toMatch(/SELECT cron\.unschedule\('mig_062b_frontera'\);/);
    expect(sc).toMatch(/EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\._mig_paso_log \(paso, inicio, fin, error\)/);
    expect(sc).toMatch(/VALUES \('FIN', clock_timestamp\(\), clock_timestamp\(\), 'OK'\)/);
    expect(sc).toMatch(/WHILE _mes <= _hasta LOOP[\s\S]*public\.manifiestos_hechos_rehacer_mes/);
    [/filas de Conciliación con FECHA <= corte maestra/, /filas de maestra con FECHA > corte maestra/,
      /aparecen en las dos fuentes/, /fecha_reporte distinta de la FECHA/, /no suman lo mismo que los hechos/,
      /sin tipo_reporte PASAJEROS\/CARGA/, /Meses con cifra oficial pero sin manifiestos en la maestra/]
      .forEach((re) => expect(sc).toMatch(re));
  });

  test('no toca las tablas de origen ni las vistas de la 060', () => {
    expect(sc).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE|TRUNCATE)\s+public\.(maestra_manifiestos|"Conciliación Manifiestos")/i);
    expect(sc).not.toMatch(/(CREATE|DROP|ALTER)\s+(TRIGGER|POLICY)/i);
    expect(sc).not.toMatch(/mv_estadistica_operaciones\b(?!_pre060)/);
  });

  test('la reversa restaura EXACTAMENTE las funciones de la 058', () => {
    const fn = (sql, nombre) => {
      const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
      return sql.slice(i, sql.indexOf('\n$$;\n', i));
    };
    ['_mh_cargar', 'manifiestos_hechos_refrescar', 'manifiestos_hechos_rehacer_mes'].forEach((nombre) =>
      expect(fn(reversa062, nombre)).toBe(fn(estructura, nombre)));
    expect(sinComentarios(reversa062)).toMatch(/DELETE FROM public\.manifiestos_hechos WHERE fuente = 'MAESTRA' AND fecha_operacion >= DATE '2026-01-01';/);
    expect(sinComentarios(reversa062)).toContain('restaura el respaldo antes de revertir');
  });

  test('el seguimiento es de solo lectura y 062c sólo apaga el aviso', () => {
    expect(sinComentarios(seguimiento062)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
    const c = sinComentarios(aviso062);
    expect(c).toMatch(/UPDATE public\.manifiestos_avisos_periodo\s+SET activo = false,[\s\S]*WHERE clave = 'carga_2026_ene_ago';/);
    expect(c).not.toMatch(/\b(DELETE|DROP|TRUNCATE|INSERT)\b/i);
  });
});
