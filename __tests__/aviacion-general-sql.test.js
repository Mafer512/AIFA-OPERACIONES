/**
 * Migración 046 — módulo de Aviación General / FBO.
 *
 * No hay PostgreSQL en la batería de pruebas, así que esto no ejecuta el SQL:
 * vigila las invariantes que, de romperse, sólo se descubrirían en producción y
 * con datos de por medio.
 *
 * Lo que se cuida y por qué:
 *
 *   · Que el INSERT de la importación NO mencione pax_ag. Es columna generada:
 *     si aparece, Postgres rechaza la fila entera, y el error ("cannot insert a
 *     non-DEFAULT value") no señala que el culpable es un listado de columnas
 *     escrito de más.
 *   · Que el archivo siga siendo ADITIVO. Un DROP o un ALTER TABLE colado aquí
 *     tocaría la tabla que ya existe con su histórico.
 *   · Que RLS siga comentado. Se decidió dejarlo apagado hasta definir los
 *     perfiles de GAG; encenderlo por accidente deja el módulo inservible desde
 *     el primer minuto.
 *   · Que termine en ROLLBACK. Es la convención de las migraciones de este
 *     repositorio: se corre, se lee la verificación y sólo entonces se cambia
 *     por COMMIT.
 *   · Que las columnas que la migración declara esperar sean EXACTAMENTE las
 *     del diccionario de datos.
 */

const fs = require('fs');
const path = require('path');

// Se normaliza CRLF: Git puede cambiarlo al pasar por el índice y una prueba
// estructural no debería depender de eso.
const sql = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'migrations', '046_aviacion_general_fbo.sql'),
    'utf8'
).replace(/\r\n/g, '\n');

/** Quita los comentarios de línea para poder afirmar sobre SQL que sí corre. */
const sqlVivo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const COLUMNAS_DICCIONARIO = [
    'id', 'folio_rotacion', 'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
    'operador', 'matricula', 'tipo_aeronave', 'aeropuerto_origen_destino',
    'hora_programada', 'hora_real', 'adultos', 'infantes', 'pax_ag', 'pax_od',
    'estado', 'pais', 'observaciones', 'movimiento_relacionado_id', 'tipo_fuente',
    'archivo_origen', 'hoja_origen', 'fila_origen', 'hash_origen',
    'estado_validacion', 'validado_por', 'fecha_validacion', 'observacion_validacion',
    'creado_por', 'fecha_creacion', 'modificado_por', 'fecha_modificacion', 'version',
    'estatus_registro', 'motivo_anulacion', 'eliminado_por', 'fecha_eliminacion'
];

describe('la migración es aditiva', () => {
    test('no crea ni redefine las tablas: se aplica sobre las que ya existen', () => {
        expect(sqlVivo).not.toMatch(/CREATE\s+TABLE/i);
        expect(sqlVivo).not.toMatch(/DROP\s+TABLE/i);
    });

    test('no altera la estructura de la tabla con el histórico', () => {
        // El único ALTER TABLE admisible sería el de RLS, y ése va comentado.
        expect(sqlVivo).not.toMatch(/ALTER\s+TABLE/i);
    });

    test('no borra datos', () => {
        expect(sqlVivo).not.toMatch(/\bTRUNCATE\b/i);
        expect(sqlVivo).not.toMatch(/\bDELETE\s+FROM\b/i);
    });

    test('no toca objetos de otros módulos', () => {
        ['maestra_operaciones', 'mv_estadistica', 'conciliacion', 'manifiestos']
            .forEach((ajeno) => {
                expect(sqlVivo.includes(ajeno)).toBe(false);
            });
    });

    test('todos los índices son IF NOT EXISTS', () => {
        const indices = sqlVivo.match(/CREATE\s+INDEX[^;]*/gi) || [];
        expect(indices.length).toBeGreaterThan(0);
        indices.forEach((i) => expect(i).toMatch(/IF\s+NOT\s+EXISTS/i));
    });
});

describe('contrato con el diccionario de datos', () => {
    test('espera exactamente las 37 columnas del diccionario', () => {
        const bloque = sql.match(/v_esperadas text\[\] := ARRAY\[([\s\S]*?)\];/);
        expect(bloque).not.toBeNull();
        const declaradas = (bloque[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
        expect(declaradas.sort()).toEqual([...COLUMNAS_DICCIONARIO].sort());
        expect(declaradas).toHaveLength(37);
    });

    test('aborta si falta la tabla o una columna, en vez de crear objetos rotos', () => {
        expect(sql).toMatch(/RAISE EXCEPTION[\s\S]*?No existe public\.aviacion_general_operaciones/);
        expect(sql).toMatch(/RAISE EXCEPTION[\s\S]*?Faltan columnas/);
    });
});

describe('pax_ag es columna generada', () => {
    test('el INSERT de la importación no la menciona', () => {
        const insert = sqlVivo.match(/INSERT INTO public\.aviacion_general_operaciones\s*\(([\s\S]*?)\)\s*VALUES/);
        expect(insert).not.toBeNull();
        expect(insert[1]).not.toMatch(/\bpax_ag\b/);
        // pax_od sí, que es un campo normal y no debe confundirse con el anterior.
        expect(insert[1]).toMatch(/\bpax_od\b/);
    });

    test('ningún UPDATE intenta escribirla', () => {
        const updates = sqlVivo.match(/UPDATE public\.aviacion_general_operaciones[\s\S]*?(?=;)/gi) || [];
        expect(updates.length).toBeGreaterThan(0);
        updates.forEach((u) => expect(u).not.toMatch(/\bpax_ag\s*=/));
    });
});

describe('agregación: el GROUP BY apunta a columnas, no a agregados', () => {
    /**
     * Regresión de un error que sólo aparece al EJECUTAR, nunca al leer:
     *
     *   ERROR 42803: aggregate functions are not allowed in GROUP BY
     *
     * Ocurre cuando se arma el `jsonb_build_object(...)` dentro del mismo
     * SELECT que agrupa. Esa consulta tiene UNA sola columna de salida —el
     * objeto entero— así que `GROUP BY 1` apunta a ese objeto, que contiene
     * `count(*)`, y Postgres aborta.
     *
     * La forma correcta es agregar primero en una subconsulta con columnas con
     * nombre y armar el JSON después. Eso es lo que se vigila aquí.
     */
    test('ningún GROUP BY por ordinal cuelga de un SELECT que construye el JSON', () => {
        const ordinales = [...sqlVivo.matchAll(/GROUP BY\s+\d/g)];
        expect(ordinales.length).toBeGreaterThan(0); // si no hay, la prueba no vigila nada

        ordinales.forEach((m) => {
            // El SELECT más cercano hacia atrás es el dueño de este GROUP BY.
            const inicio = sqlVivo.lastIndexOf('SELECT', m.index);
            const listaDeSeleccion = sqlVivo.slice(inicio, m.index);
            expect(listaDeSeleccion).not.toMatch(/jsonb_build_object\s*\(/);
            // Y expone columnas con nombre, que es a lo que apunta el ordinal.
            expect(listaDeSeleccion).toMatch(/\sAS\s+\w+/i);
        });
    });

    test('el resumen ya no ordena convirtiendo el JSON a texto y de vuelta', () => {
        const resumen = sqlVivo.match(/FUNCTION public\.aviacion_general_resumen[\s\S]*?\$fn\$;/);
        expect(resumen).not.toBeNull();
        expect(resumen[0]).not.toMatch(/ORDER BY\s+\(x->>/);
    });

    test('los desgloses del resumen siguen entregando las mismas claves que pinta el tablero', () => {
        const resumen = sqlVivo.match(/FUNCTION public\.aviacion_general_resumen[\s\S]*?\$fn\$;/)[0];
        ['totales', 'por_mes', 'por_ambito', 'por_tipo_operacion',
         'top_operadores', 'top_aeronaves', 'top_aeropuertos', 'top_matriculas']
            .forEach((clave) => expect(resumen).toContain(`'${clave}',`));
        // Las que consume vista-resumen.js de cada renglón.
        ['periodo', 'movimientos', 'llegadas', 'salidas', 'pax', 'clave']
            .forEach((campo) => expect(resumen).toContain(`'${campo}'`));
    });
});

describe('antiduplicados de la importación', () => {
    /**
     * Regresión de un defecto que sólo se veía con datos reales de por medio:
     * el histórico ya cargado trae hash_origen SHA-256 (64 caracteres) hecho
     * por otro proceso, mientras que el navegador calcula uno de 16. Comparar
     * hashes nunca daba coincidencia, así que reimportar un archivo ya cargado
     * habría duplicado las 10,396 filas en silencio.
     */
    const importar = sqlVivo.match(/FUNCTION public\.aviacion_general_importar[\s\S]*?\$fn\$;/)[0];

    test('NO decide duplicados comparando hash_origen', () => {
        expect(importar).not.toMatch(/WHERE\s+hash_origen\s*=/);
        expect(importar).not.toMatch(/hash_origen\s*=\s*ANY/);
    });

    test('compara la llave natural contra lo ya cargado', () => {
        const existe = importar.match(/IF EXISTS \([\s\S]*?\) THEN/);
        expect(existe).not.toBeNull();
        ['folio_rotacion', 'tipo_operacion', 'fecha_operacion', 'upper(matricula)']
            .forEach((campo) => expect(existe[0]).toContain(campo));
    });

    test('sigue guardando hash_origen para trazabilidad', () => {
        expect(importar).toMatch(/hash_origen/);
        expect(importar).toMatch(/v_hash/);
    });

    test('el detector de repetidos usa la MISMA llave que la importación', () => {
        // Si divergieran, la pantalla señalaría unos repetidos y la importación
        // rechazaría otros, que es peor que no tener ninguna de las dos.
        const dup = sqlVivo.match(/FUNCTION public\.aviacion_general_duplicados[\s\S]*?\$fn\$;/)[0];
        expect(dup).toMatch(/GROUP BY folio_rotacion, tipo_operacion, fecha_operacion, upper\(matricula\)/);
        expect(dup).toMatch(/HAVING count\(\*\) > 1/);
    });

    test('el detector de repetidos no modifica nada: sólo señala', () => {
        const dup = sqlVivo.match(/FUNCTION public\.aviacion_general_duplicados[\s\S]*?\$fn\$;/)[0];
        expect(dup).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
        expect(dup).toMatch(/LANGUAGE sql\s+STABLE/);
    });
});

describe('lo que los datos reales desmintieron del diccionario', () => {
    const importar = sqlVivo.match(/FUNCTION public\.aviacion_general_importar[\s\S]*?\$fn\$;/)[0];

    test('no exige aeropuerto_origen_destino: falta en 5,440 de 10,396 filas', () => {
        expect(importar).not.toMatch(/Falta el aeropuerto/);
    });

    test('no rellena adultos ni infantes con 0 al importar', () => {
        // COALESCE(...,0) en el INSERT convertiría "no se anotó" en "cero".
        const insert = importar.match(/INSERT INTO[\s\S]*?\);/)[0];
        expect(insert).toMatch(/NULLIF\(v_fila->>'adultos', ''\)::int/);
        expect(insert).toMatch(/NULLIF\(v_fila->>'infantes', ''\)::int/);
        expect(insert).not.toMatch(/COALESCE\(\(v_fila->>'adultos'\)::int, 0\)/);
    });
});

describe('RLS queda apagado a propósito', () => {
    test('ninguna línea viva enciende row level security', () => {
        expect(sqlVivo).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
        expect(sqlVivo).not.toMatch(/CREATE\s+POLICY/i);
    });

    test('pero las políticas quedan redactadas en comentarios, listas para el día que se definan los perfiles', () => {
        expect(sql).toMatch(/--\s*ALTER TABLE public\.aviacion_general_operaciones\s+ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/--\s*CREATE POLICY ag_ops_select/);
        expect(sql).toMatch(/--\s*CREATE POLICY ag_ops_insert/);
        expect(sql).toMatch(/--\s*CREATE POLICY ag_ops_update/);
    });
});

describe('funciones del módulo', () => {
    const esperadas = [
        'aviacion_general_filtro_ok', 'aviacion_general_resumen', 'aviacion_general_opciones',
        'aviacion_general_importar', 'aviacion_general_validar', 'aviacion_general_baja',
        'aviacion_general_enlazar_rotaciones', 'aviacion_general_duplicados'
    ];

    test('están todas las que el cliente invoca', () => {
        esperadas.forEach((fn) => {
            expect(sqlVivo).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
        });
    });

    test('las que el navegador llama son SECURITY INVOKER: el día que se encienda RLS lo respetan solas', () => {
        expect(sqlVivo).not.toMatch(/SECURITY\s+DEFINER/i);
        const invocadas = sqlVivo.match(/SECURITY INVOKER/g) || [];
        expect(invocadas.length).toBeGreaterThanOrEqual(6);
    });

    test('todas quedan ejecutables por la sesión del portal', () => {
        esperadas.forEach((fn) => {
            expect(sqlVivo).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\b`));
        });
    });

    test('observar un registro exige comentario también del lado del servidor', () => {
        expect(sqlVivo).toMatch(/p_estado = 'OBSERVADO'[\s\S]*?RAISE EXCEPTION/);
    });

    test('la baja lógica exige motivo y no borra la fila', () => {
        expect(sqlVivo).toMatch(/Dar de baja un movimiento exige un motivo/);
        const baja = sqlVivo.match(/FUNCTION public\.aviacion_general_baja[\s\S]*?\$fn\$;/);
        expect(baja[0]).toMatch(/SET\s+estatus_registro\s*=/);
        expect(baja[0]).not.toMatch(/DELETE/i);
    });
});

describe('047 — conteo oficial por rotación', () => {
    /**
     * El reporte oficial de GAG cuenta por rotación: ancla cada salida a la
     * fecha de la llegada con la que forma pareja. Comprobado contra los datos
     * de 2022, ese anclaje reproduce nueve de los diez meses al dígito.
     */
    const sql047 = fs.readFileSync(
        path.resolve(__dirname, '..', 'supabase', 'migrations', '047_aviacion_general_conteo_oficial.sql'),
        'utf8'
    ).replace(/\r\n/g, '\n');
    const vivo047 = sql047.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    test('el modo por omisión es el OFICIAL', () => {
        expect(vivo047).toMatch(/p_modo\s+text\s+DEFAULT\s+'rotacion'/);
    });

    test('la ventana de anclaje está acotada: el folio se reinicia cada año', () => {
        // Sin acotar por fecha, una salida de 2026 con folio 95 podría
        // engancharse a una llegada de 2025 con el mismo folio.
        const ancla = vivo047.match(/FUNCTION public\.aviacion_general_ancla[\s\S]*?\$fn\$;/)[0];
        expect(ancla).toMatch(/p_fecha\s*-\s*60/);
        expect(ancla).toMatch(/l\.fecha_operacion\s*<=\s*p_fecha/);
        expect(ancla).toMatch(/tipo_operacion\s*=\s*'LLEGADA'/);
    });

    test('el rango de fechas se aplica sobre la fecha de conteo, no sobre la del movimiento', () => {
        // De eso depende que la salida del 2 de enero de 2023 aparezca al pedir
        // diciembre de 2022, que es lo que hace el reporte oficial.
        expect(vivo047).toMatch(/fecha_conteo\s*>=\s*\(p_filtros->>'fecha_desde'\)::date/);
        expect(vivo047).toMatch(/fecha_conteo\s*<=\s*\(p_filtros->>'fecha_hasta'\)::date/);
        // Y por eso las fechas se le quitan al filtro general antes de aplicarlo.
        expect(vivo047).toMatch(/\(p_filtros - 'fecha_desde'\) - 'fecha_hasta'/);
    });

    test('las llegadas no se anclan a nada: son su propia fecha', () => {
        expect(vivo047).toMatch(/WHEN o\.tipo_operacion = 'LLEGADA'\s+THEN o\.fecha_operacion/);
    });

    test('entrega los pasajeros separados por llegada y salida, como el reporte', () => {
        ['pax_llegada', 'pax_salida'].forEach((c) => expect(vivo047).toContain(`'${c}'`));
    });

    test('no inventa el movimiento que falta: no inserta ni actualiza nada', () => {
        expect(vivo047).not.toMatch(/\bINSERT\s+INTO\b/i);
        expect(vivo047).not.toMatch(/\bUPDATE\s+public\./i);
        expect(vivo047).not.toMatch(/\bDELETE\s+FROM\b/i);
    });

    test('el desglose de origen lee el código y, si no lo hay, la ciudad', () => {
        expect(vivo047).toMatch(/COALESCE\(NULLIF\(aeropuerto_origen_destino, ''\),\s*\n?\s*NULLIF\(ciudad_origen_destino, ''\)/);
    });

    test('termina en ROLLBACK, como el resto de las migraciones', () => {
        expect(sql047.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    });
});

describe('048 — la salida reconstruida del GN-106', () => {
    /**
     * Es la ÚNICA migración del módulo que inserta un dato. Lo que se vigila
     * aquí es que ese dato entre MARCADO como lo que es —una reconstrucción a
     * partir del reporte oficial— y no disfrazado de movimiento capturado.
     */
    const sql048 = fs.readFileSync(
        path.resolve(__dirname, '..', 'supabase', 'migrations', '048_aviacion_general_salida_gn106.sql'),
        'utf8'
    ).replace(/\r\n/g, '\n');
    const vivo048 = sql048.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    test('entra como MIGRACION, no como captura ni como importación', () => {
        expect(vivo048).toMatch(/'MIGRACION'/);
        expect(vivo048).not.toMatch(/'CAPTURA_MANUAL'/);
        expect(vivo048).not.toMatch(/'IMPORTACION_EXCEL'/);
    });

    test('queda OBSERVADO con el motivo, no PENDIENTE en silencio', () => {
        expect(vivo048).toMatch(/'OBSERVADO'/);
        expect(vivo048).toMatch(/observacion_validacion/);
        expect(vivo048).toMatch(/Falta confirmar/);
    });

    test('no inventa horas: las deja nulas', () => {
        const insert = vivo048.match(/INSERT INTO public\.aviacion_general_operaciones[\s\S]*?FROM public/)[0];
        expect(insert).toMatch(/NULL,\s*--[^\n]*hora programada|NULL,\s*\n\s*NULL,\s*--/);
        // Y no pone una hora inventada.
        expect(insert).not.toMatch(/'\d{2}:\d{2}:\d{2}'/);
    });

    test('los pasajeros van en 0, que es lo que cuadra con el reporte', () => {
        expect(vivo048).toMatch(/\n\s*0,\s*--/);
    });

    test('es idempotente: no duplica si ya existe la salida', () => {
        expect(vivo048).toMatch(/AND NOT EXISTS \(/);
        expect(vivo048).toMatch(/s\.tipo_operacion\s*=\s*'SALIDA'/);
    });

    test('aborta si la llegada que da origen al caso ya no es la misma', () => {
        expect(vivo048).toMatch(/No se encontró la llegada de GN-106/);
        expect(vivo048).toMatch(/folio 202200195/);
    });

    test('deja escrito cómo deshacerlo', () => {
        expect(sql048).toMatch(/PARA DESHACERLO/);
        expect(sql048).toMatch(/DELETE FROM public\.aviacion_general_operaciones/);
    });

    test('termina en ROLLBACK', () => {
        expect(sql048.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    });
});

describe('convención de las migraciones del repositorio', () => {
    test('abre transacción y termina en ROLLBACK para poder revisarla antes de aplicar', () => {
        expect(sqlVivo).toMatch(/^\s*BEGIN;/m);
        expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    });

    test('trae bloque de verificación con NOTICE legibles', () => {
        expect(sql).toMatch(/VERIFICACIÓN/);
        expect(sql).toMatch(/RAISE NOTICE/);
    });

    test('los NOTICE usan % y no %s, que en PL\\/pgSQL no es marcador', () => {
        const notices = sql.match(/RAISE NOTICE '[^']*'/g) || [];
        notices.forEach((n) => expect(n).not.toMatch(/%s/));
    });
});
