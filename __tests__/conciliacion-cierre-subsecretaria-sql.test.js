/* Invariantes estáticas de Cierre de Subsecretaría (Conciliación > Manifiestos).
 *
 * No hay Supabase local en este entorno, así que estas pruebas NO ejecutan el
 * SQL contra una base real: verifican que el TEXTO de la migración y de la
 * integración JS sigan diciendo lo que deben decir. Son guardas de
 * ARQUITECTURA, y están escritas para fallar exactamente en los puntos donde
 * la implementación se torció antes:
 *
 *   · el corte volviendo a elegir su lote por la FECHA de operación;
 *   · el corte sin escribir "CIERRE SUBSECRETARIA";
 *   · "CIERRE SUBSECRETARIA" volviendo a ser un campo corregible;
 *   · la vista histórica sirviendo la tabla viva para una fila cerrada;
 *   · ajustes que no llegan a la fuente reportable;
 *   · una corrección numérica inventando una operación;
 *   · una reclasificación que no mueve la operación de bucket;
 *   · corrección y cierre sin el mismo lock;
 *   · un helper SECURITY DEFINER con EXECUTE para PUBLIC;
 *   · CHECK que aceptan estados parciales;
 *   · una vista sin security_invoker expuesta a authenticated;
 *   · informes oficiales que ignoran los eventos aplicados.
 *
 * Cuando una de estas pruebas falle, lo correcto casi nunca es relajarla: es
 * revisar si el cambio rompió una de las reglas del módulo.
 *
 * El comportamiento aritmético (que +30 llegue al informe, que una
 * reclasificación mueva la operación) se prueba con datos simulados en
 * __tests__/conciliacion-cierre-subsecretaria-reportes.test.js.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const sql = leer('supabase/migrations/053_conciliacion_cierre_subsecretaria.sql');
const js = leer('js/conci-cierre-subsecretaria.js');
const indexHtml = leer('index.html');
const scriptJs = leer('script.js');
const pasajeros = leer('js/conci-reportes-pasajeros.js');
const carga = leer('js/conci-reportes-carga.js');

const sinComentariosSQL = (texto) => texto
  .split('\n')
  .map((linea) => linea.replace(/--.*$/, ''))
  .join('\n');

const sqlSC = sinComentariosSQL(sql);

/** Cuerpo completo de una función de la migración, comentarios incluidos. */
const fn = (nombre) => {
  const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}[\\s\\S]*?^\\$\\$;`, 'm'));
  if (!m) throw new Error(`No se encontró la función ${nombre} en la migración 053`);
  return m[0];
};
/** Igual, pero sin comentarios: para comprobar lo que el SQL HACE, no lo que dice. */
const fnSC = (nombre) => sinComentariosSQL(fn(nombre));

const RPC_SENSIBLES = [
  'conciliacion_cerrar_subsecretaria',
  'conciliacion_solicitar_correccion',
  'conciliacion_resolver_solicitud_correccion',
];

describe('053 — estructura y método de despliegue', () => {
  test('un solo BEGIN/COMMIT: el archivo entero es una transacción', () => {
    expect((sql.match(/^BEGIN;/gm) || []).length).toBe(1);
    expect((sql.match(/^COMMIT;/gm) || []).length).toBe(1);
  });

  test('NO usa CREATE INDEX CONCURRENTLY (la integración GitHub de Supabase corre cada migración en una transacción y ahí fallaría)', () => {
    expect(sqlSC).not.toMatch(/CREATE INDEX CONCURRENTLY/);
    // Y el archivo explica por qué, para que nadie lo "arregle" de vuelta.
    expect(sql).toMatch(/MÉTODO DE DESPLIEGUE/);
    expect(sql).toMatch(/integración GitHub\/Branching de\n-- Supabase ejecuta cada migración dentro de una transacción/);
  });

  test('exige PostgreSQL 15+ y ABORTA si no se cumple (no degrada la seguridad en silencio)', () => {
    expect(sqlSC).toMatch(/server_version_num'\)::int < 150000/);
    const guarda = sql.match(/server_version_num'\)::int < 150000[\s\S]{0,400}/)[0];
    expect(guarda).toMatch(/RAISE EXCEPTION/);
    // La guarda va ANTES de crear la vista.
    expect(sql.indexOf("server_version_num')::int < 150000"))
      .toBeLessThan(sql.indexOf('CREATE VIEW public.v_conciliacion_manifiestos_reportable'));
  });

  test('los $$ de las funciones están balanceados', () => {
    const n = (sql.match(/\$\$/g) || []).length;
    expect(n % 2).toBe(0);
    expect(n).toBeGreaterThan(0);
  });
});

describe('REGLA DE NEGOCIO: el lote NO se elige por la fecha de operación', () => {
  test('el criterio del lote es cierre_id IS NULL + cierre_capturado_en dentro de la frontera', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).toMatch(
      /FROM public\."Conciliación Manifiestos"\s+WHERE cierre_id IS NULL\s+AND cierre_capturado_en IS NOT NULL\s+AND cierre_capturado_en >= v_baseline\s+AND cierre_capturado_en <= v_instante/
    );
  });

  test('el cierre NO menciona "FECHA" ni _aifa_parse_manifest_date en ninguna parte', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).not.toMatch(/_aifa_parse_manifest_date/);
    expect(cerrar).not.toMatch(/"FECHA"/);
  });

  test('NINGUNA función de la migración selecciona filas por la fecha de operación', () => {
    // Un manifiesto atrasado (vuelo del 21 capturado el 22) tiene que poder
    // entrar al corte del 22. Filtrar por FECHA lo dejaría huérfano para
    // siempre: es el error que esta prueba existe para impedir.
    expect(sqlSC).not.toMatch(/_aifa_parse_manifest_date\("FECHA"\)\s*=/);
  });

  test('el resumen del lote abierto usa el mismo criterio que el corte (no una fecha)', () => {
    const resumen = fnSC('conciliacion_resumen_lote_abierto');
    expect(resumen).toMatch(/WHERE cierre_id IS NULL\s+AND cierre_capturado_en IS NOT NULL\s+AND cierre_capturado_en >= v_baseline/);
    expect(resumen).not.toMatch(/"FECHA"/);
    // Y no recibe fecha: el lote no es un día.
    expect(sql).toMatch(/FUNCTION public\.conciliacion_resumen_lote_abierto\(\)/);
  });

  test('el orden cronológico ya NO decide qué manifiestos entran, sólo qué fecha puede llevar el oficio', () => {
    // La función que elegía el "siguiente informe" a partir de las FECHAS de
    // operación abiertas desapareció: era la que dejaba huérfano un manifiesto
    // atrasado.
    expect(sql).not.toMatch(/_conci_siguiente_informe_fecha\(\)\s*RETURNS/);
    // Y el bloque que sí valida el orden cronológico está en la elección de
    // FECHA DEL CORTE, no en la selección del lote.
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    const idxOrden = cerrar.indexOf('v_ultima_fecha');
    const idxLote = cerrar.indexOf('FROM public."Conciliación Manifiestos"');
    expect(idxOrden).toBeGreaterThan(-1);
    expect(idxOrden).toBeLessThan(idxLote);
  });

  test('el RPC de cierre NO acepta fecha: no hay nada que un cliente pueda enviar', () => {
    // Un usuario con privilegio de cierre no debe poder fechar un corte en el
    // pasado desde DevTools. La defensa no es validar el parámetro: es que no
    // exista.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.conciliacion_cerrar_subsecretaria\(\)/);
    expect(sql).not.toMatch(/FUNCTION public\.conciliacion_cerrar_subsecretaria\(p_fecha/);
    // Y la firma antigua se elimina para que no quede expuesta en PostgREST.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.conciliacion_cerrar_subsecretaria\(date\);/);
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).not.toMatch(/p_fecha/);
    expect(cerrar).toMatch(/v_fecha_corte := v_hoy;/);
    expect(cerrar).toMatch(/v_hoy := \(v_instante AT TIME ZONE 'America\/Mexico_City'\)::date;/);
  });

  test('el cliente llama al RPC sin argumentos y no lee el filtro de fecha', () => {
    expect(js).toMatch(/rpc\('conciliacion_cerrar_subsecretaria'\)/);
    expect(js).not.toMatch(/p_fecha/);
    expect(js).not.toMatch(/function fechaSeleccionadaIso/);
  });
});

describe('Un solo Cierre de Subsecretaría por fecha', () => {
  const cerrar = () => fnSC('conciliacion_cerrar_subsecretaria');

  test('se lee el último corte y se rechaza cualquier fecha <= a la suya', () => {
    expect(cerrar()).toMatch(/SELECT max\(c\.fecha_corte\) INTO v_ultima_fecha/);
    expect(cerrar()).toMatch(/IF v_ultima_fecha IS NOT NULL AND v_fecha_corte <= v_ultima_fecha THEN/);
  });

  test('repetir la fecha del último corte se rechaza con 23505 y dice a qué corte irá lo pendiente', () => {
    const bloque = cerrar().match(/IF v_fecha_corte = v_ultima_fecha THEN[\s\S]*?END IF;/)[0];
    expect(bloque).toMatch(/RAISE EXCEPTION/);
    expect(bloque).toMatch(/ERRCODE = '23505'/);
    expect(bloque).toMatch(/v_ultima_fecha \+ 1/);
  });

  test('una fecha anterior al último corte se rechaza por orden cronológico', () => {
    expect(cerrar()).toMatch(/orden cronológico[\s\S]*?ERRCODE = '22023'/);
  });

  test('el rechazo ocurre ANTES de cualquier escritura y CON el lock ya tomado', () => {
    const cuerpo = cerrar();
    const idxLock = cuerpo.indexOf('_conci_lock_contabilidad()');
    const idxChequeo = cuerpo.indexOf('IF v_ultima_fecha IS NOT NULL AND v_fecha_corte <= v_ultima_fecha THEN');
    expect(idxLock).toBeLessThan(idxChequeo);
    [
      'INSERT INTO public.conciliacion_cierres_subsecretaria',
      'INSERT INTO public.conciliacion_cierres_snapshot',
      'UPDATE public."Conciliación Manifiestos"',
      'UPDATE public.conciliacion_ajustes',
    ].forEach((escritura) => {
      expect(cuerpo.indexOf(escritura)).toBeGreaterThan(idxChequeo);
    });
  });

  test('ya no hace falta validar fechas futuras ni pasadas: la fecha no es un dato de entrada', () => {
    // La fecha del corte se deriva del instante lógico, así que no existe
    // ninguna rama que "acepte" una fecha; sólo la comparación con el último
    // corte, que protege el orden cronológico.
    expect(cerrar()).not.toMatch(/coalesce\(p_fecha/);
    expect(cerrar()).toMatch(/v_fecha_corte := v_hoy;/);
  });

  test('el resumen expone en qué fecha podrá emitirse el siguiente corte, con la MISMA regla', () => {
    const resumen = fnSC('conciliacion_resumen_lote_abierto');
    expect(resumen).toMatch(/v_siguiente_fecha := greatest\(v_hoy, coalesce\(v_ultima_fecha \+ 1, v_hoy\)\);/);
    expect(resumen).toMatch(/'cierre_de_hoy_realizado', \(v_ultima_fecha IS NOT NULL AND v_ultima_fecha >= v_hoy\)/);
    expect(resumen).toMatch(/'siguiente_fecha_corte', v_siguiente_fecha/);
  });

  test('la regla no toca el criterio del lote: lo capturado después sigue esperando, no se pierde', () => {
    // El lote se sigue eligiendo por "lo que falta por cerrar". Lo único que
    // cambia con la unicidad es CUÁNDO puede emitirse el siguiente oficio.
    const cuerpo = cerrar();
    expect(cuerpo).toMatch(/AND cierre_capturado_en <= v_instante/);
    expect(cuerpo).not.toMatch(/cierre_capturado_en >= v_ultima_fecha/);
    expect(cuerpo).not.toMatch(/"FECHA"/);
  });

  test('la interfaz avisa antes de pedir la contraseña, y no se apoya en eso para la seguridad', () => {
    expect(js).toMatch(/cierre_de_hoy_realizado === true/);
    expect(js).toMatch(/id="conci-cierre-ya-cerrado"/);
    expect(js).toMatch(/siguiente_fecha_corte/);
    // El servidor sigue siendo quien rechaza: el cliente no decide nada.
    expect(js).toMatch(/rpc\('conciliacion_cerrar_subsecretaria'\)/);
  });
});

describe('"CIERRE SUBSECRETARIA": la escribe el sistema y no se corrige a mano', () => {
  test('el cierre ESCRIBE la fecha del corte en "CIERRE SUBSECRETARIA"', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).toMatch(
      /UPDATE public\."Conciliación Manifiestos"\s+SET cierre_id = v_cierre_id,\s+"CIERRE SUBSECRETARIA" = to_char\(v_fecha_corte, 'DD\/MM\/YYYY'\)/
    );
  });

  test('NO está en la whitelist de corrección ordinaria (ni en el SQL ni en el JS)', () => {
    expect(fn('_conci_campos_editables_cierre')).not.toContain("'CIERRE SUBSECRETARIA'");
    const lista = js.match(/const CAMPOS_EDITABLES = \[([\s\S]*?)\]/)[1];
    expect(lista).not.toContain("'CIERRE SUBSECRETARIA'");
  });

  test('nace VACÍA en cada captura: una fila abierta no puede aparecer en el oficio de una fecha tecleada', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/NEW\."CIERRE SUBSECRETARIA" := NULL;/);
  });

  test('en una fila ABIERTA del nuevo mecanismo se conserva la del sistema; en una LEGACY sigue siendo captura libre', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/IF OLD\.cierre_capturado_en IS NOT NULL THEN\s+NEW\."CIERRE SUBSECRETARIA" := OLD\."CIERRE SUBSECRETARIA";\s+END IF;/);
  });

  test('la interfaz tampoco la ofrece como celda capturable', () => {
    const proteccion = scriptJs.match(/function _conciIsProtectedEditColumn\(column\) \{[\s\S]*?\n\}/)[0];
    expect(proteccion).toMatch(/=== 'cierre subsecretaria'/);
    expect(proteccion).not.toMatch(/return false;/);
  });

  test('el candado sigue siendo una columna aparte: no se reutiliza el nombre', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cierre_id bigint/);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*"CIERRE SUBSECRETARIA"/);
  });

  test('la migración valida al instalar que la columna sea de texto (el corte le escribe dd/mm/aaaa)', () => {
    expect(sqlSC).toMatch(/column_name = 'CIERRE SUBSECRETARIA'/);
    expect(sqlSC).toMatch(/v_tipo NOT IN \('text', 'character varying', 'character'\)/);
  });

  test('los informes siguen agrupando por "CIERRE SUBSECRETARIA" (no se finge que FECHA sea la fecha de corte)', () => {
    [pasajeros, carga].forEach((src) => {
      expect(src).toMatch(/cierre: buscar\(\/\^CIERRE\\s\+SUBSECRETARIA\/\)/);
    });
  });
});

describe('Frontera legacy / nuevo mecanismo', () => {
  test('existe cierre_capturado_en y la sella el trigger en cada INSERT', () => {
    expect(sqlSC).toMatch(/ADD COLUMN IF NOT EXISTS cierre_capturado_en timestamptz/);
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/NEW\.cierre_capturado_en := clock_timestamp\(\);/);
  });

  test('un cliente no puede antedatar ni mover cierre_capturado_en', () => {
    const trg = fnSC('_conci_proteger_cierre');
    // En UPDATE ordinario siempre se restaura el valor anterior.
    expect((trg.match(/NEW\.cierre_capturado_en := OLD\.cierre_capturado_en;/g) || []).length).toBeGreaterThanOrEqual(1);
    // Y en INSERT se sella con el reloj del servidor, no con lo que llegue.
    expect(trg).not.toMatch(/NEW\.cierre_capturado_en := coalesce\(NEW\./);
  });

  test('las filas legacy NO se rellenan retroactivamente: no hay UPDATE de backfill', () => {
    expect(sqlSC).not.toMatch(/SET cierre_capturado_en\s*=/);
    expect(sqlSC).not.toMatch(/UPDATE public\."Conciliación Manifiestos"[\s\S]{0,200}cierre_capturado_en/);
  });

  test('existe el baseline de activación en una tabla de una sola fila, sembrado y no pisable', () => {
    expect(sqlSC).toMatch(/CREATE TABLE IF NOT EXISTS public\.conciliacion_cierre_config \(\s*id\s+boolean PRIMARY KEY DEFAULT true CHECK \(id\)/);
    expect(sqlSC).toMatch(/baseline_en\s+timestamptz NOT NULL/);
    expect(sql).toMatch(/INSERT INTO public\.conciliacion_cierre_config[\s\S]*?ON CONFLICT \(id\) DO NOTHING/);
  });

  test('el baseline se siembra SIN ventana de activación: después del ALTER y del trigger', () => {
    // Entre el baseline y la creación del trigger nadie sostiene el lock de la
    // tabla de captura. Una fila insertada en ese hueco quedaría con
    // cierre_capturado_en NULL (no hay trigger) pero con hora posterior al
    // baseline: sería legacy por accidente. El ALTER TABLE toma ACCESS
    // EXCLUSIVE y lo retiene hasta el COMMIT, así que sembrar DESPUÉS del
    // trigger cierra el hueco.
    const idxAlter = sqlSC.indexOf('ADD COLUMN IF NOT EXISTS cierre_capturado_en');
    const idxTrigger = sqlSC.indexOf('CREATE TRIGGER trg_conciliacion_manifiestos_proteger_cierre');
    const idxSeed = sqlSC.indexOf('INSERT INTO public.conciliacion_cierre_config');
    [idxAlter, idxTrigger, idxSeed].forEach((i) => expect(i).toBeGreaterThan(-1));
    expect(idxSeed).toBeGreaterThan(idxAlter);
    expect(idxSeed).toBeGreaterThan(idxTrigger);
    // Y se siembra UNA sola vez en todo el archivo.
    expect((sqlSC.match(/INSERT INTO public\.conciliacion_cierre_config/g) || []).length).toBe(1);
  });

  test('una reinstalación conserva el baseline original (o filas ya administradas volverían a ser legacy)', () => {
    const seed = sql.match(/INSERT INTO public\.conciliacion_cierre_config[\s\S]*?;/)[0];
    expect(seed).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(seed).not.toMatch(/DO UPDATE/);
  });

  test('el primer corte no puede arrastrar años de historia: legacy tiene cierre_capturado_en NULL y queda excluido', () => {
    expect(fnSC('conciliacion_cerrar_subsecretaria')).toMatch(/AND cierre_capturado_en IS NOT NULL/);
  });
});

describe('Candado real en BD y bypass explícito (no implícito por ser owner)', () => {
  test('existe el trigger BEFORE INSERT/UPDATE/DELETE sobre "Conciliación Manifiestos"', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_conciliacion_manifiestos_proteger_cierre[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\."Conciliación Manifiestos"/);
  });

  test('el trigger YA NO se abre por "current_user no es authenticated/anon"', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).not.toMatch(/current_user/);
  });

  test('el bypass exige marca de transacción propia Y el lock exclusivo de contabilidad', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/current_setting\('aifa_conci\.escritura_cerrada', true\)/);
    expect(trg).toMatch(/txid_current\(\)::text/);
    expect(trg).toMatch(/pg_catalog\.pg_locks/);
    expect(trg).toMatch(/l\.mode = 'ExclusiveLock'/);
  });

  test('la función que concede el bypass no es ejecutable por ningún cliente', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._conci_permitir_escritura_cerrada\(\) FROM PUBLIC;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\._conci_permitir_escritura_cerrada[^;]*TO/);
    // Y ella misma vuelve a exigir el lock antes de conceder nada.
    expect(fnSC('_conci_permitir_escritura_cerrada')).toMatch(/IF NOT public\._conci_tiene_lock_contabilidad\(\) THEN[\s\S]*?RAISE EXCEPTION/);
  });

  test('no existe bandera alguna que el cliente pueda fijar (ni parámetro de bypass en los RPC)', () => {
    expect(sql).not.toMatch(/p_(bypass|forzar|omitir|skip)/i);
    // set_config sólo se usa con is_local = true y desde las dos funciones internas.
    const usos = sql.match(/set_config\('aifa_conci\.escritura_cerrada'[^;]*;/g) || [];
    expect(usos.length).toBe(2);
    usos.forEach((u) => expect(u).toMatch(/, true\)/));
  });

  test('el trigger rechaza UPDATE y DELETE de un manifiesto cerrado', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/IF OLD\.cierre_id IS NOT NULL THEN[\s\S]*?RAISE EXCEPTION/);
    expect((trg.match(/RAISE EXCEPTION/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('la única excepción son metadatos de revisión del portal, enumerados uno a uno', () => {
    const trg = fnSC('_conci_proteger_cierre');
    expect(trg).toMatch(/_portal_aprob_aifa/);
    expect(trg).toMatch(/_portal_aprob_afac/);
    // Ningún campo reportable puede colarse en esa lista.
    ['TOTAL PAX', 'AEROLINEA', 'TIPO DE OPERACIÓN', 'CIERRE SUBSECRETARIA', 'FECHA',
      'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL'].forEach((campo) => {
      expect(trg).not.toContain(`'${campo}'`);
    });
  });

  test('la función del trigger NO es SECURITY DEFINER (no necesita privilegios propios)', () => {
    expect(fn('_conci_proteger_cierre')).not.toMatch(/SECURITY DEFINER/);
  });
});

describe('Un solo advisory lock para toda la contabilidad oficial', () => {
  test('existe _conci_lock_contabilidad() con una clave fija y única', () => {
    expect(fnSC('_conci_lock_contabilidad')).toMatch(/pg_catalog\.pg_advisory_xact_lock\(531953, 1\)/);
  });

  test('los TRES RPC sensibles toman EXACTAMENTE el mismo lock', () => {
    RPC_SENSIBLES.forEach((nombre) => {
      expect(fnSC(nombre)).toMatch(/PERFORM public\._conci_lock_contabilidad\(\);/);
    });
    // Y ninguno inventa su propia clave.
    RPC_SENSIBLES.forEach((nombre) => {
      expect(fnSC(nombre)).not.toMatch(/pg_advisory_xact_lock\(/);
    });
  });

  test('la captura ordinaria toma el MISMO candado en modo compartido', () => {
    expect(fnSC('_conci_proteger_cierre')).toMatch(/pg_catalog\.pg_advisory_xact_lock_shared\(531953, 1\)/);
  });

  test('el orden es validar → lock → instante lógico → escribir (nunca el instante antes del lock)', () => {
    RPC_SENSIBLES.forEach((nombre) => {
      const cuerpo = fnSC(nombre);
      const idxLock = cuerpo.indexOf('_conci_lock_contabilidad()');
      const idxInstante = cuerpo.indexOf('clock_timestamp()');
      const idxReauth = cuerpo.indexOf('_conci_reautenticacion_reciente');
      expect(idxLock).toBeGreaterThan(-1);
      expect(idxInstante).toBeGreaterThan(idxLock);
      expect(idxReauth).toBeGreaterThan(-1);
      expect(idxReauth).toBeLessThan(idxLock);
    });
  });

  test('el instante lógico se toma UNA sola vez por RPC y se reutiliza', () => {
    RPC_SENSIBLES.forEach((nombre) => {
      const cuerpo = fnSC(nombre);
      expect((cuerpo.match(/clock_timestamp\(\)/g) || []).length).toBe(1);
      expect(cuerpo).toMatch(/v_instante := clock_timestamp\(\);/);
    });
  });

  test('aprobado_en y cerrado_en nunca vienen de un DEFAULT now() (inicio de transacción)', () => {
    expect(sqlSC).toMatch(/aprobado_en\s+timestamptz NOT NULL,/);
    expect(sqlSC).not.toMatch(/aprobado_en\s+timestamptz NOT NULL DEFAULT/);
    expect(sqlSC).toMatch(/cerrado_en\s+timestamptz NOT NULL,/);
    expect(sqlSC).not.toMatch(/cerrado_en\s+timestamptz NOT NULL DEFAULT/);
  });

  test('una captura no puede escaparse del corte: el sellado ocurre después de obtener el lock compartido', () => {
    const trg = fnSC('_conci_proteger_cierre');
    const idxLock = trg.indexOf('pg_advisory_xact_lock_shared');
    const idxSello = trg.indexOf('NEW.cierre_capturado_en := clock_timestamp()');
    expect(idxLock).toBeGreaterThan(-1);
    expect(idxSello).toBeGreaterThan(idxLock);
  });
});

describe('Ledger before/after: toda corrección autorizada genera evento', () => {
  test('la tabla guarda la fila completa antes y después, no sólo una diferencia', () => {
    expect(sqlSC).toMatch(/CREATE TABLE IF NOT EXISTS public\.conciliacion_ajustes \(/);
    expect(sqlSC).toMatch(/datos_antes\s+jsonb NOT NULL/);
    expect(sqlSC).toMatch(/datos_despues\s+jsonb NOT NULL/);
    expect(sqlSC).toMatch(/delta_numerico\s+jsonb NOT NULL/);
    // La tabla "campo → diferencia" del diseño anterior ya no existe.
    expect(sqlSC).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.conciliacion_ajustes_pendientes/);
    expect(sqlSC).not.toMatch(/valor_anterior\s+numeric NOT NULL/);
  });

  test('las DOS vías de corrección insertan un evento SIEMPRE, sin condicionarlo a que el campo sea numérico', () => {
    ['conciliacion_solicitar_correccion', 'conciliacion_resolver_solicitud_correccion'].forEach((nombre) => {
      const cuerpo = fnSC(nombre);
      expect(cuerpo).toMatch(/INSERT INTO public\.conciliacion_ajustes \(/);
      expect(cuerpo).toMatch(/datos_antes, datos_despues, delta_numerico, aprobado_en/);
      // Ninguna de las dos decide "si es numérico" para crear el evento.
      expect(cuerpo).not.toMatch(/v_es_numerico/);
      expect(cuerpo).not.toMatch(/IF .*_campos_numericos_cierre\(\)\) THEN[\s\S]{0,400}INSERT INTO public\.conciliacion_ajustes/);
    });
  });

  test('datos_despues se lee DESPUÉS de aplicar el cambio, y datos_antes ANTES', () => {
    ['conciliacion_solicitar_correccion', 'conciliacion_resolver_solicitud_correccion'].forEach((nombre) => {
      const cuerpo = fnSC(nombre);
      const idxAntes = cuerpo.indexOf('v_datos_antes := to_jsonb(');
      const idxUpdate = cuerpo.indexOf("EXECUTE format('UPDATE public.%I");
      const idxDespues = cuerpo.indexOf('SELECT to_jsonb(mm) INTO v_datos_despues');
      expect(idxAntes).toBeGreaterThan(-1);
      expect(idxAntes).toBeLessThan(idxUpdate);
      expect(idxUpdate).toBeLessThan(idxDespues);
    });
  });

  test('el delta numérico se DERIVA de antes/después — la misma aritmética que la vista', () => {
    const delta = fnSC('_conci_delta_numerico');
    expect(delta).toMatch(/p_despues ->> t\.campo\), 0\)\s*\n?\s*- coalesce\(public\._aifa_safe_numeric\(p_antes/);
    ['conciliacion_solicitar_correccion', 'conciliacion_resolver_solicitud_correccion'].forEach((nombre) => {
      expect(fnSC(nombre)).toMatch(/v_delta := public\._conci_delta_numerico\(v_datos_antes, v_datos_despues\);/);
    });
  });

  test('append-only: ningún UPDATE toca los valores ni el instante de un evento ya escrito', () => {
    const escrituras = sql.match(/UPDATE public\.conciliacion_ajustes\b[\s\S]*?WHERE [^;]+;/g) || [];
    expect(escrituras.length).toBeGreaterThan(0);
    escrituras.forEach((stmt) => {
      expect(stmt).not.toMatch(/SET[\s\S]*?datos_antes\s*=/);
      expect(stmt).not.toMatch(/SET[\s\S]*?datos_despues\s*=/);
      expect(stmt).not.toMatch(/SET[\s\S]*?delta_numerico\s*=/);
      expect(stmt).not.toMatch(/SET[\s\S]*?aprobado_en\s*=/);
    });
  });

  test('un evento se consume UNA sola vez', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).toMatch(/WHERE estado = 'pendiente'\s+AND cierre_aplicacion_id IS NULL\s+AND aprobado_en <= v_instante\s+ORDER BY id\s+FOR UPDATE/);
    expect(cerrar).toMatch(/SET estado = 'aplicado',\s+cierre_aplicacion_id = v_cierre_id,\s+aplicado_en = v_instante/);
  });

  test('NO hay índice único que impida dos eventos pendientes del mismo manifiesto+campo', () => {
    const unicos = sql.match(/CREATE UNIQUE INDEX[^;]*ON public\.conciliacion_ajustes\b[^;]*;/g) || [];
    expect(unicos.length).toBe(0);
  });
});

describe('CHECK explícitos: sin equivalencias booleanas ni estados parciales', () => {
  test('ajuste: cada estado enumera TODAS sus columnas de consumo', () => {
    expect(sqlSC).toMatch(
      /CONSTRAINT ck_conciliacion_ajustes_estado CHECK \(\s*\n\s*\(estado = 'pendiente' AND cierre_aplicacion_id IS NULL\s+AND aplicado_en IS NULL\)\s*\n\s*OR\s*\n\s*\(estado = 'aplicado'\s+AND cierre_aplicacion_id IS NOT NULL AND aplicado_en IS NOT NULL\)\s*\n\s*\)/
    );
    // La equivalencia ambigua anterior ya no existe.
    expect(sqlSC).not.toMatch(/CHECK \(\(estado = 'aplicado'\) = \(/);
  });

  test('corrección: pendiente / aplicada / rechazada, cada una con sus invariantes completas', () => {
    const check = sqlSC.match(/CONSTRAINT ck_conciliacion_correcciones_estado CHECK \([\s\S]*?\n    \),/)[0];
    expect(check).toMatch(/\(estado = 'pendiente'[\s\S]*?usuario_autoriza IS NULL[\s\S]*?resuelto_en IS NULL[\s\S]*?ajuste_id IS NULL[\s\S]*?comentario_resolucion IS NULL\)/);
    expect(check).toMatch(/\(estado = 'aplicada'[\s\S]*?usuario_autoriza IS NOT NULL[\s\S]*?resuelto_en IS NOT NULL[\s\S]*?ajuste_id IS NOT NULL\)/);
    expect(check).toMatch(/\(estado = 'rechazada'[\s\S]*?usuario_autoriza IS NOT NULL[\s\S]*?resuelto_en IS NOT NULL[\s\S]*?ajuste_id IS NULL[\s\S]*?diferencia IS NULL\)/);
    expect(sqlSC).not.toMatch(/CHECK \(\(estado = 'pendiente'\) = \(/);
  });

  test('un evento no puede aplicarse antes de aprobarse, ni una corrección resolverse antes de crearse', () => {
    expect(sqlSC).toMatch(/ck_conciliacion_ajustes_orden_temporal\s*\n?\s*CHECK \(aplicado_en IS NULL OR aplicado_en >= aprobado_en\)/);
    expect(sqlSC).toMatch(/ck_conciliacion_correcciones_orden_temporal\s*\n?\s*CHECK \(resuelto_en IS NULL OR resuelto_en >= creado_en\)/);
  });

  test('UN SOLO corte por fecha: el constraint UNIQUE existe y no se puede quitar sin que esto falle', () => {
    expect(sqlSC).toMatch(/CONSTRAINT ux_conciliacion_cierres_fecha UNIQUE \(fecha_corte\)/);
    // Y se añade también si la tabla ya existía de una ejecución anterior.
    expect(sqlSC).toMatch(/conname = 'ux_conciliacion_cierres_fecha'[\s\S]*?ADD CONSTRAINT ux_conciliacion_cierres_fecha UNIQUE \(fecha_corte\)/);
  });

  test('un corte vacío del todo es imposible, pero uno de sólo ajustes es legítimo', () => {
    expect(sqlSC).toMatch(/CHECK \(total_manifiestos >= 0 AND total_ajustes >= 0\s*\n?\s*AND \(total_manifiestos > 0 OR total_ajustes > 0\)\)/);
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).toMatch(/IF v_total_manifiestos = 0 AND v_total_ajustes = 0 THEN[\s\S]*?RAISE EXCEPTION/);
    const idxRechazo = cerrar.indexOf('IF v_total_manifiestos = 0 AND v_total_ajustes = 0 THEN');
    const idxInsert = cerrar.indexOf('INSERT INTO public.conciliacion_cierres_subsecretaria');
    expect(idxRechazo).toBeLessThan(idxInsert);
  });
});

describe('Histórico inmutable: cerrado ⇒ snapshot, SIEMPRE', () => {
  test('el snapshot se toma DESPUÉS de escribir cierre_id y la fecha del corte', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    const idxUpdate = cerrar.indexOf('UPDATE public."Conciliación Manifiestos"');
    const idxSnapshot = cerrar.indexOf('INSERT INTO public.conciliacion_cierres_snapshot');
    expect(idxUpdate).toBeGreaterThan(-1);
    expect(idxUpdate).toBeLessThan(idxSnapshot);
  });

  test('la vista sirve TODA fila cerrada desde el snapshot, sin condicionarlo a que tenga correcciones', () => {
    const vista = sql.match(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable[\s\S]*?WHERE a\.estado = 'aplicado';/)[0];
    // Ya NO se decide por si hay correcciones aplicadas.
    expect(vista).not.toMatch(/estado = 'aplicada'/);
    expect(vista).not.toMatch(/conciliacion_correcciones/);
    // Ni hay un coalesce que devuelva la fila viva de un cerrado.
    expect(vista).not.toMatch(/coalesce\(s\.datos_snapshot/);
  });

  test('la rama de cerrados PARTE del snapshot y no depende de la fila viva', () => {
    // Si mantenimiento administrativo borrara un manifiesto ya cerrado, con un
    // JOIN a la tabla viva el oficio de ese día cambiaría al regenerarlo.
    const vista = sql.match(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable[\s\S]*?WHERE a\.estado = 'aplicado';/)[0];
    expect(vista).toMatch(/FROM public\.conciliacion_cierres_snapshot s\s+CROSS JOIN LATERAL jsonb_populate_record\(\s*NULL::public\."Conciliación Manifiestos", s\.datos_snapshot\s*\) AS r/);
    // El _uid de esa rama sale del snapshot, no de la fila viva.
    expect(vista).toMatch(/'M' \|\| lpad\(s\.manifiesto_id::text, 18, '0'\)/);
    // Y esa rama ya no menciona la tabla de captura.
    const ramaCerrados = vista.slice(vista.indexOf('B) cerrados'), vista.indexOf('D-)'));
    expect(ramaCerrados).not.toMatch(/FROM public\."Conciliación Manifiestos" m/);
    expect(ramaCerrados).not.toMatch(/m\.cierre_id IS NOT NULL/);
  });

  test('sin duplicados: la rama viva sólo sirve cierre_id NULL, y con snapshot nunca es NULL', () => {
    const vista = sql.match(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable[\s\S]*?WHERE a\.estado = 'aplicado';/)[0];
    expect(vista).toMatch(/FROM public\."Conciliación Manifiestos" m\s+WHERE m\.cierre_id IS NULL/);
    // El invariante está escrito en el archivo, para que nadie lo rompa sin verlo.
    expect(sql).toMatch(/Sin duplicados frente al bloque A/);
  });

  test('la fila VIVA sólo se sirve cuando cierre_id IS NULL', () => {
    const vista = sql.match(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable[\s\S]*?WHERE a\.estado = 'aplicado';/)[0];
    expect(vista).toMatch(/SELECT m\.\*,[\s\S]*?FROM public\."Conciliación Manifiestos" m\s+WHERE m\.cierre_id IS NULL/);
  });

  test('la vista vieja (histórico) ya no existe en ningún sitio', () => {
    expect(sql).toMatch(/DROP VIEW IF EXISTS public\.v_conciliacion_manifiestos_historico;/);
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?VIEW public\.v_conciliacion_manifiestos_historico/);
    [pasajeros, carga, scriptJs, js].forEach((src) => {
      expect(src).not.toMatch(/v_conciliacion_manifiestos_historico/);
    });
  });
});

describe('Los ajustes SÍ llegan a la fuente reportable', () => {
  const vista = () => sql.match(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable[\s\S]*?WHERE a\.estado = 'aplicado';/)[0];

  test('cada evento aplicado produce DOS contribuciones, −1 con el antes y +1 con el después', () => {
    const v = vista();
    expect(v).toMatch(/a\.datos_antes \|\| jsonb_build_object\(/);
    expect(v).toMatch(/a\.datos_despues \|\| jsonb_build_object\(/);
    expect(v).toMatch(/\(-1\)::smallint/);
    expect((v.match(/WHERE a\.estado = 'aplicado'/g) || []).length).toBe(2);
  });

  test('ambas contribuciones se fechan con el corte que las APLICÓ, no con el original', () => {
    const v = vista();
    expect((v.match(/'CIERRE SUBSECRETARIA', to_char\(c\.fecha_corte, 'DD\/MM\/YYYY'\)/g) || []).length).toBe(2);
    expect((v.match(/JOIN public\.conciliacion_cierres_subsecretaria c\s+ON c\.id = a\.cierre_aplicacion_id/g) || []).length).toBe(2);
  });

  test('la FECHA de operación NO se toca en las contribuciones (los reportes por FECHA siguen siendo correctos)', () => {
    const v = vista();
    expect(v).not.toMatch(/'FECHA',\s*to_char/);
  });

  test('la vista expone los metadatos que el cliente necesita para no contar de más', () => {
    const v = vista();
    ['_es_ajuste', '_signo', '_ajuste_id', '_cierre_aplicacion_id', '_uid'].forEach((col) => {
      expect(v).toContain(col);
    });
  });

  test('los informes oficiales leen la vista reportable, no la tabla viva', () => {
    expect(pasajeros).toMatch(/const TABLA = 'v_conciliacion_manifiestos_reportable';/);
    expect(carga).toMatch(/const TABLA = 'v_conciliacion_manifiestos_reportable';/);
    expect(pasajeros).not.toMatch(/const TABLA = 'Conciliación Manifiestos';/);
    expect(carga).not.toMatch(/const TABLA = 'Conciliación Manifiestos';/);
  });

  test('y siguen siendo de solo lectura', () => {
    [pasajeros, carga].forEach((src) => {
      expect(src).not.toMatch(/from\(TABLA\)\s*\.\s*(insert|update|upsert|delete)/);
    });
  });
});

describe('No inventar operaciones: los agregadores respetan el signo', () => {
  test('pasajeros: lee _signo y lo aplica a pasajeros Y al conteo de operaciones', () => {
    expect(pasajeros).toMatch(/signo: claves\.find\(c => c === '_signo'\) \|\| null/);
    expect(pasajeros).toMatch(/const signo = columnas\.signo \? \(Number\(fila\[columnas\.signo\]\) \|\| 1\) : 1;/);
    expect(pasajeros).toMatch(/const pax = signo \* \(Number\(/);
    // Ya no queda ningún incremento "ciego" de operaciones.
    expect(pasajeros).not.toMatch(/\bc\.ops\+\+/);
    expect(pasajeros).not.toMatch(/anioPlantillas\.ops\+\+/);
    expect(pasajeros).not.toMatch(/acc\.ops\+\+/);
    expect(pasajeros).not.toMatch(/casilla\.ops\[carril\]\+\+/);
    expect(pasajeros).toMatch(/c\.ops \+= opDelta;/);
  });

  test('carga: lee _signo y lo aplica a kilos Y al conteo de operaciones', () => {
    expect(carga).toMatch(/signo: claves\.find\(c => c === '_signo'\) \|\| null/);
    expect(carga).toMatch(/const signo = columnas\.signo \? \(Number\(fila\[columnas\.signo\]\) \|\| 1\) : 1;/);
    expect(carga).toMatch(/const opDelta = cuentaSiHay\(bruto\) \? signo : 0;/);
    expect(carga).toMatch(/nacKg \*= signo;/);
    expect(carga).toMatch(/intKg \*= signo;/);
    expect(carga).not.toMatch(/\.ops\+\+/);
    expect(carga).not.toMatch(/opsIntLlegada\+\+/);
    expect(carga).not.toMatch(/opsIntSalida\+\+/);
  });

  test('la reclasificación mueve la operación de bucket: el signo se decide por fila, no por reporte', () => {
    // En carga, el lado (NACIONAL/INTERNACIONAL) sale de TIPO DE OPERACIÓN de
    // ESA contribución; como el "antes" y el "después" pueden diferir, −1 cae
    // en un bucket y +1 en el otro.
    expect(carga).toMatch(/if \(esInternacional\(operacion\)\) c\.INTERNACIONAL\.ops \+= opDelta;\s*\n\s*else c\.NACIONAL\.ops \+= opDelta;/);
    // En pasajeros, la columna NACIONAL/INTERNACIONAL se resuelve por fila.
    expect(pasajeros).toMatch(/const columna = esInternacional\(operacion\) \? 'INTERNACIONAL' : 'NACIONAL';/);
  });

  test('las filas de ajuste alimentan SÓLO el oficio de Subsecretaría, no los reportes por FECHA', () => {
    // Un ajuste corrige un manifiesto ya cerrado, o sea de una fecha cuyo
    // informe ya se emitió. Si entrara a los bloques agrupados por FECHA,
    // regenerar la Plantilla del día A daría 180 donde se reportaron 150.
    [pasajeros, carga].forEach((src) => {
      expect(src).toMatch(/const esAjuste = columnas\.esAjuste/);
      expect(src).toMatch(/if \(esAjuste\) continue;/);
    });
    // El corte está DESPUÉS del bloque de Subsecretaría y ANTES del de FECHA.
    const bloque = (src) => {
      const inicio = src.indexOf('for (const fila of filas)');
      const fin = src.indexOf('return {', inicio);
      return src.slice(inicio, fin);
    };
    const pax = bloque(pasajeros);
    expect(pax.indexOf('Subsecretaría')).toBeLessThan(pax.indexOf('if (esAjuste) continue;'));
    expect(pax.indexOf('if (esAjuste) continue;'))
      .toBeLessThan(pax.indexOf('const fecha = aIso(columnas.fecha'));
    const car = bloque(carga);
    expect(car.indexOf('Subsecretaría')).toBeLessThan(car.indexOf('if (esAjuste) continue;'));
    expect(car.indexOf('if (esAjuste) continue;'))
      .toBeLessThan(car.indexOf('const fecha = aIso(columnas.fecha'));
  });

  test('la paginación usa una clave única de la vista, no "id" (que una fila sintética repite)', () => {
    [pasajeros, carga].forEach((src) => {
      expect(src).toMatch(/const orden = columnas\.uid \|\| 'id';/);
      expect(src).toMatch(/\.order\(orden, \{ ascending: true \}\)/);
      expect(src).not.toMatch(/\.order\('id', \{ ascending: true \}\)/);
    });
    expect(sql).toMatch(/'M' \|\| lpad\(m\.id::text, 18, '0'\) AS _uid/);
    expect(sql).toMatch(/'X' \|\| lpad\(a\.id::text, 18, '0'\) \|\| 'A'/);
    expect(sql).toMatch(/'X' \|\| lpad\(a\.id::text, 18, '0'\) \|\| 'D'/);
  });
});

describe('FIJO y el informe: una sola verdad matemática', () => {
  test('FIJO usa el MISMO delta_numerico que consume el cierre', () => {
    const resumen = fnSC('conciliacion_resumen_lote_abierto');
    expect(resumen).toMatch(/SELECT delta_numerico\s+FROM public\.conciliacion_ajustes\s+WHERE estado = 'pendiente'/);
    expect(resumen).toMatch(/_conci_jsonb_sum_numerico\(v_totales_ajustes, a\.delta_numerico\)/);
    expect(fnSC('conciliacion_cerrar_subsecretaria')).toMatch(/_conci_jsonb_sum_numerico\(v_totales_ajustes, a\.delta_numerico\)/);
  });

  test('FIJO usa los mismos campos numéricos que los totales del cierre', () => {
    expect(fnSC('conciliacion_resumen_lote_abierto')).toMatch(/public\._conci_totales_numericos\(to_jsonb\(m\)\)/);
    expect(fnSC('conciliacion_cerrar_subsecretaria')).toMatch(/public\._conci_totales_numericos\(to_jsonb\(m\)\)/);
  });

  test('la cabecera se inserta ya con sus totales definitivos y no se recalcula después', () => {
    const cerrar = fnSC('conciliacion_cerrar_subsecretaria');
    expect(cerrar).toMatch(/INSERT INTO public\.conciliacion_cierres_subsecretaria \([\s\S]*?total_manifiestos, total_ajustes, totales_fijo, totales_ajustes, totales_reportados/);
    expect(cerrar).not.toMatch(/UPDATE public\.conciliacion_cierres_subsecretaria/);
  });

  test('el cliente pide el resumen del LOTE, sin fecha', () => {
    expect(js).toMatch(/rpc\('conciliacion_resumen_lote_abierto'\)/);
    expect(js).not.toMatch(/conciliacion_resumen_periodo/);
  });
});

describe('Reautenticación: se mantiene, y se mantiene sin declararla validada', () => {
  test('existe el helper basado en el claim amr y falla CERRADO', () => {
    const f = fn('_conci_reautenticacion_reciente');
    expect(f).toMatch(/auth\.jwt\(\)/);
    expect(f).toMatch(/'amr'/);
    expect(f).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*RETURN false;/);
    expect(f).toMatch(/jsonb_typeof\(v_amr\) <> 'array' THEN\s*\n\s*RETURN false;/);
  });

  test('ventana de 300 s, la misma en los tres puntos de escritura', () => {
    expect(sql).toMatch(/p_max_segundos integer DEFAULT 300/);
    expect((sql.match(/_conci_reautenticacion_reciente\(300\)/g) || []).length).toBe(3);
  });

  test('sigue documentado como NO validado contra Supabase real', () => {
    expect(sql).toMatch(/PENDIENTE DE VALIDAR CONTRA SUPABASE REAL/);
    expect(sql).toMatch(/NO se declara validado/);
    expect(sql).toMatch(/Falla CERRADO, nunca abierto/);
  });

  test('la doble confirmación del cliente no se retira y la contraseña no se almacena', () => {
    expect(js).toMatch(/signInWithPassword\(\{ email, password \}\)/);
    expect(js).toMatch(/conci-cierre-paso-1/);
    expect(js).toMatch(/conci-cierre-paso-2/);
    expect(js).toMatch(/password = '';/);
    expect(js).not.toMatch(/localStorage\.setItem\([^)]*password/i);
  });
});

describe('SECURITY DEFINER: search_path duro y EXECUTE revocado a PUBLIC', () => {
  /** Todas las funciones SECURITY DEFINER declaradas en la migración. */
  const definers = () => {
    const nombres = [];
    const re = /CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(([^)]*)\)[\s\S]*?^\$\$;/gm;
    let m;
    while ((m = re.exec(sql)) !== null) {
      if (/SECURITY DEFINER/.test(m[0])) nombres.push(m[1]);
    }
    return nombres;
  };

  test('hay funciones SECURITY DEFINER y todas fijan un search_path seguro con pg_temp al final', () => {
    const nombres = definers();
    expect(nombres.length).toBeGreaterThan(0);
    nombres.forEach((nombre) => {
      const cuerpo = fn(nombre);
      expect(cuerpo).toMatch(/SET search_path = pg_catalog,(?: public,)? pg_temp/);
      // pg_temp explícito Y al final: PostgreSQL lo busca PRIMERO si no se
      // nombra, y ahí es donde un esquema temporal podría secuestrar nombres.
      expect(cuerpo).not.toMatch(/SET search_path = pg_temp/);
      expect(cuerpo).not.toMatch(/SET search_path = public\s*$/m);
    });
  });

  test('TODA función SECURITY DEFINER tiene su REVOKE ALL ... FROM PUBLIC explícito', () => {
    definers().forEach((nombre) => {
      const re = new RegExp(`REVOKE ALL ON FUNCTION public\\.${nombre}\\(`);
      expect(sql).toMatch(re);
    });
  });

  test('los helpers internos NO se otorgan a authenticated', () => {
    const internos = [
      '_conci_tiene_flag_permiso', '_conci_usuario_nombre', '_conci_reautenticacion_reciente',
      '_conci_permitir_escritura_cerrada', '_conci_fin_escritura_cerrada',
      '_conci_lock_contabilidad', '_conci_tiene_lock_contabilidad',
      '_conci_campos_numericos_cierre', '_conci_campos_editables_cierre',
      '_conci_jsonb_sum_numerico', '_conci_totales_numericos', '_conci_delta_numerico',
    ];
    internos.forEach((nombre) => {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nombre}\\(`));
      expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nombre}\\([^)]*\\) TO`));
    });
  });

  test('los RPC públicos legítimos sí tienen REVOKE + GRANT a authenticated, y nada a anon', () => {
    const publicos = [
      'conciliacion_cerrar_subsecretaria\\(\\)',
      'conciliacion_solicitar_correccion\\(bigint, text, text, text\\)',
      'conciliacion_resolver_solicitud_correccion\\(bigint, boolean, text\\)',
      'conciliacion_manifiestos_set_privilegio\\(uuid, text, boolean\\)',
      'conciliacion_privilegios_de_usuario\\(uuid\\)',
      'conciliacion_puede_cerrar_subsecretaria\\(\\)',
      'conciliacion_puede_autorizar_correccion\\(\\)',
      'conciliacion_resumen_lote_abierto\\(\\)',
      'conciliacion_ajustes_detalle\\(bigint\\)',
      'conciliacion_solicitudes_pendientes\\(\\)',
    ];
    publicos.forEach((firma) => {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${firma} FROM PUBLIC`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${firma} TO authenticated`));
    });
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO anon/);
  });

  test('ninguna función de escritura confía en un actor enviado por el cliente', () => {
    RPC_SENSIBLES.forEach((nombre) => {
      const firma = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}\\([\\s\\S]*?\\)\\s*\\nRETURNS jsonb`))[0];
      expect(firma).not.toMatch(/p_usuario_(modifica|autoriza|actor)/);
    });
  });
});

describe('Sin fuga de privilegios ajenos', () => {
  test('las funciones puede_* NO reciben un uuid arbitrario', () => {
    expect(sql).toMatch(/FUNCTION public\.conciliacion_puede_cerrar_subsecretaria\(\)/);
    expect(sql).toMatch(/FUNCTION public\.conciliacion_puede_autorizar_correccion\(\)/);
    expect(sql).not.toMatch(/FUNCTION public\.conciliacion_puede_cerrar_subsecretaria\(\s*\n?\s*p_user_id/);
    expect(sql).not.toMatch(/FUNCTION public\.conciliacion_puede_autorizar_correccion\(\s*\n?\s*p_user_id/);
    // Y las versiones antiguas con parámetro se eliminan explícitamente.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.conciliacion_puede_cerrar_subsecretaria\(uuid\);/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.conciliacion_puede_autorizar_correccion\(uuid\);/);
  });

  test('resuelven auth.uid() del lado servidor', () => {
    ['conciliacion_puede_cerrar_subsecretaria', 'conciliacion_puede_autorizar_correccion'].forEach((nombre) => {
      expect(fnSC(nombre)).toMatch(/v_uid uuid := auth\.uid\(\);/);
    });
  });

  test('el único RPC que acepta un uuid ajeno exige admin en cada llamada', () => {
    const admin = fnSC('conciliacion_privilegios_de_usuario');
    expect(admin).toMatch(/access_level\(auth\.uid\(\)\) IS DISTINCT FROM 'admin'/);
    expect(admin).toMatch(/RAISE EXCEPTION[\s\S]*?42501/);
  });
});

describe('RLS y visibilidad coherente', () => {
  const tablas = [
    'conciliacion_cierre_config',
    'conciliacion_cierres_subsecretaria',
    'conciliacion_cierres_snapshot',
    'conciliacion_ajustes',
    'conciliacion_correcciones',
  ];

  test.each(tablas)('RLS habilitado en %s', (tabla) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${tabla} ENABLE ROW LEVEL SECURITY`));
  });

  test('ninguna tabla nueva otorga INSERT/UPDATE/DELETE a authenticated', () => {
    const grants = sql.match(new RegExp(`GRANT [^;]*ON public\\.(${tablas.join('|')}) TO authenticated`, 'g')) || [];
    expect(grants.length).toBe(tablas.length);
    grants.forEach((g) => {
      expect(g).toMatch(/^GRANT SELECT ON/);
      expect(g).not.toMatch(/INSERT|UPDATE|DELETE/);
    });
  });

  test('no hay policy de escritura para authenticated en ninguna de ellas', () => {
    tablas.forEach((tabla) => {
      const re = new RegExp(`CREATE POLICY [a-z_]*\\s+ON public\\.${tabla} FOR (INSERT|UPDATE|DELETE)`, 'i');
      expect(sql).not.toMatch(re);
    });
  });

  test('las tablas que alimentan la vista se leen con el MISMO criterio que la tabla de captura', () => {
    // Si fueran más estrechas, un usuario con Conciliación en modo LECTURA
    // —que sí puede abrir Reportes— generaría un oficio al que le faltarían en
    // silencio todos los periodos cerrados, porque la vista es security_invoker
    // y no le dejaría ver los snapshots.
    ['conciliacion_cierres_subsecretaria', 'conciliacion_cierres_snapshot', 'conciliacion_ajustes'].forEach((tabla) => {
      const re = new RegExp(`CREATE POLICY ${tabla}_select\\s+ON public\\.${tabla} FOR SELECT TO authenticated\\s+USING \\(auth\\.role\\(\\) = 'authenticated'\\)`);
      expect(sql).toMatch(re);
    });
  });

  test('la configuración del baseline sí queda acotada al módulo (no la usa ningún informe)', () => {
    expect(sql).toMatch(/CREATE POLICY conciliacion_cierre_config_select[\s\S]*?USING \(public\.conciliacion_manifiestos_access_level\(auth\.uid\(\)\) <> 'none'\)/);
  });

  test('conciliacion_correcciones sólo la ve quien autoriza o su propio autor', () => {
    expect(sql).toMatch(/CREATE POLICY conciliacion_correcciones_select[\s\S]*?USING \(\s*\n\s*public\.conciliacion_puede_autorizar_correccion\(\)\s*\n\s*OR usuario_modifica = auth\.uid\(\)\s*\n\s*\)/);
  });

  test('los RPC de lectura de detalle/bandeja NO son SECURITY DEFINER: no dan la vuelta al RLS', () => {
    ['conciliacion_ajustes_detalle', 'conciliacion_solicitudes_pendientes'].forEach((nombre) => {
      expect(fn(nombre)).not.toMatch(/SECURITY DEFINER/);
    });
    // Y ya no hay una rama "si puede autorizar devuelvo todo" escrita a mano,
    // que es justo donde la visibilidad podía divergir del RLS.
    expect(fnSC('conciliacion_solicitudes_pendientes')).not.toMatch(/puede_autorizar_correccion/);
  });

  test('el detalle no expone la fila completa antes/después ni datos sensibles de más', () => {
    const detalle = fnSC('conciliacion_ajustes_detalle');
    expect(detalle).not.toMatch(/a\.datos_antes/);
    expect(detalle).not.toMatch(/a\.datos_despues/);
  });
});

describe('Seguridad de la vista', () => {
  test('se crea directamente con security_invoker (no con un ALTER condicional después)', () => {
    expect(sql).toMatch(/CREATE VIEW public\.v_conciliacion_manifiestos_reportable\s*\nWITH \(security_invoker = true\) AS/);
    expect(sql).not.toMatch(/ALTER VIEW[^;]*security_invoker/);
    expect(sqlSC).not.toMatch(/IF current_setting\('server_version_num'\)::int >= 150000 THEN/);
  });

  test('sólo se otorga SELECT a authenticated, nunca a anon', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.v_conciliacion_manifiestos_reportable TO authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*v_conciliacion_manifiestos_reportable[^;]*anon/);
  });
});

describe('SQL dinámico: whitelist y parámetros', () => {
  test('el UPDATE dinámico parametriza el id con USING', () => {
    const updates = sql.match(/EXECUTE format\('UPDATE public\.%I SET %I = %L WHERE id = \$1',[\s\S]*?USING [^;]+;/g) || [];
    expect(updates.length).toBe(2);
    updates.forEach((stmt) => expect(stmt).toMatch(/USING (p_manifiesto_id|v_sol\.manifiesto_id);/));
  });

  test('el nombre de columna se valida contra la whitelist antes de llegar a un EXECUTE', () => {
    const solicitar = fnSC('conciliacion_solicitar_correccion');
    const idxWhitelist = solicitar.indexOf('_conci_campos_editables_cierre()');
    const idxExecute = solicitar.indexOf('EXECUTE format');
    expect(idxWhitelist).toBeGreaterThan(-1);
    expect(idxWhitelist).toBeLessThan(idxExecute);
  });

  test('sin concatenación de entrada del usuario', () => {
    expect(sql).not.toMatch(/'UPDATE.*'\s*\|\|\s*p_/);
    expect(sql).not.toMatch(/'SELECT.*'\s*\|\|\s*p_/);
  });
});

describe('Campos que mueven totales: ni de más ni de menos', () => {
  test('incluye pasajeros/exentos/TUA, equipaje, carga y correo', () => {
    const f = fn('_conci_campos_numericos_cierre');
    [
      'TOTAL PAX', 'DIPLOMATICOS', 'EN COMISION', 'INFANTES', 'TRANSITOS', 'CONEXIONES',
      'OTROS EXENTOS', 'TOTAL EXENTOS', 'PAX QUE PAGAN TUA', 'KGS. DE EQUIPAJE',
      'KGS. DE CARGA NACIONAL', 'KGS. DE CARGA INTERNACIONAL', 'KG DE CARGA TOTAL', 'CORREO',
    ].forEach((campo) => expect(f).toContain(`'${campo}'`));
  });

  test('excluye lo que ningún informe totaliza y los derivados', () => {
    const f = fn('_conci_campos_numericos_cierre');
    expect(f).not.toContain("'HRS. CUMPLIDAS'");
    expect(f).not.toContain("'CAPACIDAD MÁXIMA'");
    expect(f).not.toContain("'FACTOR DE OCUPACIÓN'");
  });

  test('esos campos sí siguen siendo corregibles y auditables', () => {
    const f = fn('_conci_campos_editables_cierre');
    expect(f).toContain("'HRS. CUMPLIDAS'");
    expect(f).toContain("'CAPACIDAD MÁXIMA'");
    expect(f).toContain("'OBSERVACIONES'");
  });

  test('las listas del SQL y del módulo JS no pueden divergir', () => {
    const extraer = (nombreFn) => {
      const cuerpo = fn(nombreFn);
      const arreglo = cuerpo.match(/SELECT ARRAY\[([\s\S]*?)\]::text\[\]/)[1];
      return (arreglo.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)).sort();
    };
    const extraerJs = (nombreConst) => {
      const bloque = js.match(new RegExp(`const ${nombreConst} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`))[1];
      return (bloque.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)).sort();
    };
    expect(extraerJs('CAMPOS_NUMERICOS')).toEqual(extraer('_conci_campos_numericos_cierre'));
    // La whitelist vigente es la de 055: la de 053 + "KGS. DE CARGA EN TRANSITO".
    const sql055 = leer('supabase/migrations/055_conciliacion_manifiestos_carga_en_transito.sql');
    const cuerpo055 = sql055.match(/CREATE OR REPLACE FUNCTION public\._conci_campos_editables_cierre[\s\S]*?^\$\$;/m)[0];
    const editables055 = (cuerpo055.match(/SELECT ARRAY\[([\s\S]*?)\]::text\[\]/)[1].match(/'[^']+'/g) || [])
      .map((s) => s.slice(1, -1)).sort();
    expect(extraerJs('CAMPOS_EDITABLES')).toEqual(editables055);
    expect(editables055).toEqual([...extraer('_conci_campos_editables_cierre'), 'KGS. DE CARGA EN TRANSITO'].sort());
  });

  test('queda advertido por escrito que las claves de totales no se suman entre sí', () => {
    expect(sql).toMatch(/NO se deben sumar entre\s*\n?--?\s*sí/i);
    expect(sql).toMatch(/KG DE CARGA TOTAL" ya incluye/);
  });
});

describe('Solicitud rechazada: cero cambios funcionales', () => {
  test('la rama de rechazo sólo escribe la auditoría', () => {
    const cuerpo = fnSC('conciliacion_resolver_solicitud_correccion');
    const idxNo = cuerpo.indexOf('IF NOT p_aprobar THEN');
    const idxFin = cuerpo.indexOf("RETURN jsonb_build_object('solicitud_id', p_solicitud_id, 'estado', 'rechazada');");
    const bloque = cuerpo.slice(idxNo, idxFin);
    expect(bloque).toMatch(/UPDATE public\.conciliacion_correcciones/);
    expect(bloque).not.toMatch(/INSERT INTO public\.conciliacion_ajustes/);
    expect(bloque).not.toMatch(/EXECUTE format\('UPDATE/);
    expect(bloque).not.toMatch(/_conci_permitir_escritura_cerrada/);
  });
});

describe('No se depende de funciones que ninguna migración versionada crea', () => {
  test('_cm_historial_usuario_actual sólo se invoca comprobando antes que exista', () => {
    const f = fn('_conci_usuario_nombre');
    expect(f).toMatch(/to_regprocedure\('public\._cm_historial_usuario_actual\(\)'\) IS NOT NULL/);
    expect(sql.replace(f, '')).not.toMatch(/FROM public\._cm_historial_usuario_actual\(\)/);
  });

  test('los tres RPC de escritura obtienen el nombre por el envoltorio seguro', () => {
    RPC_SENSIBLES.forEach((nombre) => {
      expect(fnSC(nombre)).toMatch(/v_nombre := public\._conci_usuario_nombre\(\);/);
    });
  });
});

describe('Idempotencia y reinstalación segura', () => {
  test('todas las tablas nuevas usan IF NOT EXISTS', () => {
    const creates = sql.match(/CREATE TABLE (IF NOT EXISTS )?public\.conciliacion_\w+/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    creates.forEach((c) => expect(c).toMatch(/IF NOT EXISTS/));
  });

  test('todos los índices usan IF NOT EXISTS', () => {
    const creates = sqlSC.match(/CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?\w+/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    creates.forEach((c) => expect(c).toMatch(/IF NOT EXISTS/));
  });

  test('trigger y policies se recrean con DROP ... IF EXISTS', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_conciliacion_manifiestos_proteger_cierre/);
    (sql.match(/CREATE POLICY (\w+)/g) || []).forEach((p) => {
      const nombre = p.replace('CREATE POLICY ', '');
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${nombre} ON`));
    });
  });

  test('la reinstalación limpia NUNCA destruye cierres existentes: aborta con mensaje', () => {
    const bloque = sql.match(/IF to_regclass\('public\.conciliacion_cierres_subsecretaria'\)[\s\S]*?END \$\$;/)[0];
    expect(bloque).toMatch(/IF EXISTS \(SELECT 1 FROM public\.conciliacion_cierres_subsecretaria\) THEN[\s\S]*?RAISE EXCEPTION/);
    const idxGuarda = bloque.indexOf('RAISE EXCEPTION');
    const idxDrop = bloque.indexOf('DROP TABLE');
    expect(idxGuarda).toBeGreaterThan(-1);
    expect(idxGuarda).toBeLessThan(idxDrop);
  });

  test('el FK del candado se agrega con guarda pg_constraint', () => {
    expect(sql).toMatch(/SELECT 1 FROM pg_constraint WHERE conname = 'fk_conciliacion_manifiestos_cierre'/);
  });
});

describe('Integración JavaScript — hooks mínimos, sin reintroducir código revertido', () => {
  test('script.js expone exactamente los 2 hooks opcionales, protegidos por typeof y try/catch', () => {
    expect((scriptJs.match(/window\._conciCierreOnSummaryData === 'function'/g) || []).length).toBe(1);
    expect((scriptJs.match(/window\._conciCierreExtraRowAction === 'function'/g) || []).length).toBe(1);
    expect(scriptJs).toMatch(/try \{ window\._conciCierreOnSummaryData\(rows, cols\); \} catch \(_\) \{\}/);
    expect(scriptJs).toMatch(/try \{ window\._conciCierreExtraRowAction\(group, persistedId\); \} catch \(_\) \{\}/);
  });

  test('las columnas del cierre no viajan en una importación', () => {
    const bloque = scriptJs.match(/const _CONCI_IMPORT_IGNORED_COLUMNS = new Set\(\[([\s\S]*?)\]\)/)[1];
    expect(bloque).toContain("'cierre_id'");
    expect(bloque).toContain("'cierre_capturado_en'");
  });

  test('conci-cierre-subsecretaria.js define ambos hooks y usa los dos privilegios separados', () => {
    expect(js).toMatch(/window\._conciCierreOnSummaryData = function/);
    expect(js).toMatch(/window\._conciCierreExtraRowAction = function/);
    expect(js).toMatch(/function puedeCerrar\(\)/);
    expect(js).toMatch(/function puedeAutorizarCorreccion\(\)/);
  });

  test('index.html registra el script con cache-busting y defer, y tiene botones y tarjetas', () => {
    expect(indexHtml).toMatch(/<script src="js\/conci-cierre-subsecretaria\.js\?v=[\w-]+" defer><\/script>/);
    ['btn-conci-cierre-subsecretaria', 'btn-conci-corregir-cerrado', 'btn-conci-solicitudes-pendientes',
      'mf-cierre-card-fijo', 'mf-cierre-card-previo', 'mf-cierre-card-total'].forEach((id) => {
      expect(indexHtml).toMatch(new RegExp(`id="${id}"`));
    });
  });

  test('los botones nuevos empiezan ocultos — la BD protege, la UI no decide por sí sola', () => {
    expect(indexHtml.match(/<button[^>]*id="btn-conci-cierre-subsecretaria"[^>]*>/)[0]).toMatch(/d-none/);
  });
});
