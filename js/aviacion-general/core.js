/* Núcleo puro del módulo de Aviación General / FBO.
 *
 * No toca el DOM, no habla con Supabase y no guarda estado global. Recibe
 * valores crudos —de un Excel, de un formulario, de la base— y los convierte
 * en movimientos que cumplen el contrato de la tabla
 * public.aviacion_general_operaciones.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO APARTE
 *
 *   Lo que aquí se decide es lo mismo que decidiría un capturista a mano:
 *   que "NA" en una hora significa "no se registró" y no las 00:00, que
 *   "xa-mam" y "XA-MAM " son la misma aeronave, que 0.354166 en una celda de
 *   Excel son las 08:30. Son reglas que se aplican en tres pantallas distintas
 *   —captura, importación y corrección— y que si se escriben tres veces
 *   divergen a la primera prisa. Al vivir sueltas de la interfaz también se
 *   pueden probar sin navegador: __tests__/aviacion-general-core.test.js.
 *
 * LO QUE ESTE ARCHIVO NO HACE
 *
 *   No calcula métricas. Cuántas operaciones hubo, cuántos pasajeros, quién es
 *   el operador más frecuente: todo eso lo suma PostgreSQL en
 *   aviacion_general_resumen (migración 046) y aquí nunca se recalcula. La
 *   única suma que sí ocurre es adultos + infantes, y sólo para la vista previa
 *   de la importación —en la base esa columna es GENERADA y jamás se envía—.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AviacionGeneralCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    // ── Contrato de la tabla ────────────────────────────────────────────────
    // Estos son los valores que aceptan las restricciones CHECK verificadas
    // contra la base: chk_ag_tipo_operacion, chk_ag_ambito_operacion,
    // chk_ag_estado_validacion, chk_ag_estatus_registro, chk_ag_tipo_fuente.
    const TIPOS_OPERACION    = Object.freeze(['LLEGADA', 'SALIDA']);
    const AMBITOS            = Object.freeze(['NACIONAL', 'INTERNACIONAL']);
    const ESTADOS_VALIDACION = Object.freeze(['PENDIENTE', 'VALIDADO', 'OBSERVADO']);
    const ESTATUS_REGISTRO   = Object.freeze(['ACTIVO', 'ANULADO', 'ELIMINADO']);
    const TIPOS_FUENTE       = Object.freeze(['CAPTURA_MANUAL', 'IMPORTACION_EXCEL', 'MIGRACION', 'INTEGRACION']);

    // Columnas que el cliente puede escribir. pax_ag NO está y no puede estar:
    // es columna generada y Postgres rechaza el INSERT completo si se la manda,
    // aunque el valor sea el correcto.
    const CAMPOS_ESCRIBIBLES = Object.freeze([
        'folio_rotacion', 'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
        'operador', 'matricula', 'tipo_aeronave', 'aeropuerto_origen_destino',
        'hora_programada', 'hora_real', 'adultos', 'infantes', 'pax_od',
        'estado', 'pais', 'observaciones', 'movimiento_relacionado_id'
    ]);

    // Texto que en el Excel original significa "no hay dato". Sale del
    // diccionario: «Los valores NA, - u otros inválidos deberán migrarse como
    // NULL». Se comparan ya normalizados a mayúsculas y sin espacios.
    const VACIOS = Object.freeze(['', '-', '--', '---', 'NA', 'N/A', 'N.A.', 'NULL', 'NONE', 'S/D', 'SD', 'SIN DATO', '#N/A', '.', 'X']);

    // ── Utilidades de texto ─────────────────────────────────────────────────

    /** Colapsa espacios, recorta y pasa a mayúsculas. null/undefined → ''. */
    function normalizarTexto(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor).replace(/\s+/g, ' ').trim().toUpperCase();
    }

    /** Igual que normalizarTexto pero devuelve null cuando el valor es "vacío". */
    function textoONulo(valor) {
        const t = normalizarTexto(valor);
        return VACIOS.includes(t) ? null : t;
    }

    /**
     * Observaciones: se conserva la capitalización original porque son frases
     * escritas por una persona, no claves. Sólo se recorta.
     */
    function normalizarObservacion(valor) {
        if (valor === null || valor === undefined) return null;
        const t = String(valor).replace(/\s+/g, ' ').trim();
        if (!t || VACIOS.includes(t.toUpperCase())) return null;
        return t;
    }

    /**
     * Matrícula. El diccionario advierte que el Excel a veces la trae numérica
     * (una matrícula como 1234 llega como número 1234) y que debe guardarse
     * como texto. Se quitan espacios internos porque "XA MAM" y "XA-MAM" son la
     * misma aeronave escrita con prisa; no se inventa el guion si no venía.
     */
    function normalizarMatricula(valor) {
        const t = normalizarTexto(valor);
        if (!t || VACIOS.includes(t)) return '';
        return t.replace(/\s+/g, '');
    }

    // ── Fechas ──────────────────────────────────────────────────────────────

    /**
     * Acepta Date, número de serie de Excel, ISO (YYYY-MM-DD) y los formatos
     * con los que la gente escribe fechas a mano: d/m/aaaa y d-m-aaaa.
     *
     * Devuelve 'YYYY-MM-DD' o null. Se trabaja SIEMPRE en horario local y se
     * arma la cadena a mano en vez de usar toISOString(), que convierte a UTC
     * y en México adelanta la fecha un día entero a partir de las 18:00.
     */
    function normalizarFecha(valor) {
        if (valor === null || valor === undefined || valor === '') return null;

        if (valor instanceof Date && !isNaN(valor.getTime())) {
            return fechaLocalISO(valor);
        }

        // Serie de Excel: días desde el 30/12/1899. El rango se acota a algo
        // razonable (1990-2100) para no tragarse un 3 que en realidad era otra
        // cosa mal tecleada.
        if (typeof valor === 'number' && isFinite(valor)) {
            if (valor < 32874 || valor > 73415) return null;
            return fechaLocalISO(serieExcelAFecha(valor));
        }

        const t = String(valor).trim();
        if (!t || VACIOS.includes(t.toUpperCase())) return null;

        let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return armarFechaISO(+m[1], +m[2], +m[3]);

        m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
        if (m) {
            let anio = +m[3];
            if (anio < 100) anio += anio < 50 ? 2000 : 1900;
            // Día primero: es el formato en que se capturan las bitácoras aquí.
            return armarFechaISO(anio, +m[2], +m[1]);
        }

        if (/^\d+(\.\d+)?$/.test(t)) return normalizarFecha(Number(t));

        return null;
    }

    function serieExcelAFecha(serie) {
        // 25569 = días entre 1899-12-30 y 1970-01-01. Se reconstruye en horario
        // local a partir de los componentes UTC para que no se corra un día.
        const utc = new Date(Math.round((serie - 25569) * 86400 * 1000));
        return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }

    function fechaLocalISO(fecha) {
        return armarFechaISO(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate());
    }

    function armarFechaISO(anio, mes, dia) {
        if (!(anio >= 1900 && anio <= 2100)) return null;
        if (!(mes >= 1 && mes <= 12)) return null;
        if (!(dia >= 1 && dia <= 31)) return null;
        // Rebote de meses cortos: 31/02 no es una fecha, es un error de captura.
        const prueba = new Date(anio, mes - 1, dia);
        if (prueba.getMonth() !== mes - 1 || prueba.getDate() !== dia) return null;
        return [
            String(anio).padStart(4, '0'),
            String(mes).padStart(2, '0'),
            String(dia).padStart(2, '0')
        ].join('-');
    }

    // ── Horas ───────────────────────────────────────────────────────────────

    /**
     * Devuelve 'HH:MM:SS' o null.
     *
     * Los cuatro orígenes que hay que soportar:
     *   · Date            — lo que entrega SheetJS con cellDates:true.
     *   · fracción 0..1   — la representación nativa de una hora en Excel
     *                       (0.354166… = 08:30).
     *   · 'HH:MM[:SS]'    — con o sin am/pm.
     *   · 'HHMM'          — cuatro dígitos pegados, como se anota en torre.
     *
     * Cualquier otra cosa —incluido NA, - o vacío— es null, nunca 00:00. La
     * diferencia importa: 00:00 es medianoche, null es "no se registró", y
     * confundirlas falsea cualquier cálculo de puntualidad posterior.
     */
    function normalizarHora(valor) {
        if (valor === null || valor === undefined || valor === '') return null;

        if (valor instanceof Date && !isNaN(valor.getTime())) {
            return armarHora(valor.getHours(), valor.getMinutes(), valor.getSeconds());
        }

        if (typeof valor === 'number' && isFinite(valor)) {
            return fraccionAHora(valor);
        }

        const t = String(valor).trim();
        if (!t || VACIOS.includes(t.toUpperCase())) return null;

        // 08:30, 8:30:00, 08:30 PM
        let m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM|A\.M\.|P\.M\.)?$/i);
        if (m) {
            let h = +m[1];
            const min = +m[2];
            const seg = m[3] ? +m[3] : 0;
            const sufijo = (m[4] || '').replace(/\./g, '').toUpperCase();
            if (sufijo === 'PM' && h < 12) h += 12;
            if (sufijo === 'AM' && h === 12) h = 0;
            return armarHora(h, min, seg);
        }

        // 0830 / 830 — sin separador.
        m = t.match(/^(\d{3,4})$/);
        if (m) {
            const n = m[1].padStart(4, '0');
            return armarHora(+n.slice(0, 2), +n.slice(2), 0);
        }

        // 0.354166 escrito como texto.
        if (/^\d*\.\d+$/.test(t)) return fraccionAHora(Number(t));

        return null;
    }

    function fraccionAHora(n) {
        // Excel puede traer 1.354166 cuando la celda arrastra una fecha: sólo
        // interesa la parte decimal.
        const frac = n - Math.floor(n);
        if (n < 0) return null;
        if (n >= 1 && frac === 0) return null; // un entero suelto no es una hora
        const totalSeg = Math.round(frac * 86400);
        if (totalSeg >= 86400) return null;
        return armarHora(Math.floor(totalSeg / 3600), Math.floor((totalSeg % 3600) / 60), totalSeg % 60);
    }

    function armarHora(h, m, s) {
        if (!(h >= 0 && h <= 23) || !(m >= 0 && m <= 59) || !(s >= 0 && s <= 59)) return null;
        return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
    }

    /** 'HH:MM:SS' → 'HH:MM' para mostrar. null → '—'. */
    function horaCorta(valor) {
        if (!valor) return '—';
        const m = String(valor).match(/^(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]}` : String(valor);
    }

    // ── Números ─────────────────────────────────────────────────────────────

    /** Entero >= 0, tolerante a "12", " 12 ", 12.0 y a los vacíos del Excel. */
    function normalizarEntero(valor, { porOmision = null, minimo = null } = {}) {
        if (valor === null || valor === undefined || valor === '') return porOmision;
        if (typeof valor === 'string') {
            const t = valor.trim();
            if (!t || VACIOS.includes(t.toUpperCase())) return porOmision;
            valor = t.replace(/[\s,]/g, '');
        }
        const n = Number(valor);
        if (!isFinite(n)) return porOmision;
        const entero = Math.trunc(n);
        if (minimo !== null && entero < minimo) return porOmision;
        return entero;
    }

    // ── Catálogos con sinónimos ─────────────────────────────────────────────

    /**
     * El Excel no siempre dice LLEGADA y SALIDA: dice ARRIBO, LLEG, L, SAL, S.
     * Se aceptan los sinónimos que aparecen en las bitácoras; lo que no se
     * reconoce devuelve '' y el validador lo rechaza con nombre y motivo, en
     * vez de adivinar.
     */
    function normalizarTipoOperacion(valor) {
        const t = normalizarTexto(valor);
        if (!t) return '';
        if (/^(LLEGADA|LLEGADAS|LLEG|ARRIBO|ARRIVAL|ENTRADA|L|A)$/.test(t)) return 'LLEGADA';
        if (/^(SALIDA|SALIDAS|SAL|DEPARTURE|DESPEGUE|S|D)$/.test(t)) return 'SALIDA';
        return '';
    }

    function normalizarAmbito(valor) {
        const t = normalizarTexto(valor);
        if (!t) return '';
        if (/^(NACIONAL|NAL|NACIONALES|DOMESTICO|DOM|N)$/.test(t)) return 'NACIONAL';
        if (/^(INTERNACIONAL|INT|INTL|INTERNACIONALES|I)$/.test(t)) return 'INTERNACIONAL';
        return '';
    }

    // ── Huella del registro de origen ───────────────────────────────────────

    /**
     * Huella del registro, para trazabilidad e integridad.
     *
     * OJO CON LO QUE ESTO **NO** HACE: no decide qué es un duplicado.
     *
     * El histórico ya cargado (10,396 filas) trae hash_origen de 64 caracteres
     * —un SHA-256 calculado por el proceso que lo subió, con una receta que
     * este repositorio no conoce—. Cualquier hash que se calcule aquí es de
     * otro algoritmo y nunca coincidiría con aquéllos, así que usarlo para
     * detectar repetidos habría duplicado el histórico entero en la primera
     * reimportación sin avisar.
     *
     * Quien decide si un movimiento ya existe es aviacion_general_importar()
     * (migración 046), comparando la LLAVE NATURAL —folio de rotación, tipo de
     * movimiento, fecha y matrícula— que no depende de quién calculó qué.
     *
     * Es FNV-1a de 32 bits corrido dos veces con semillas distintas → 16
     * caracteres hexadecimales. No es criptográfico y no pretende serlo. Se
     * eligió síncrono a propósito, para que el núcleo se pueda probar en Node
     * sin crypto.subtle y sin async.
     */
    function hashOrigen(mov) {
        const llave = [
            mov.fecha_operacion || '',
            mov.tipo_operacion || '',
            normalizarMatricula(mov.matricula),
            mov.folio_rotacion === null || mov.folio_rotacion === undefined ? '' : String(mov.folio_rotacion),
            mov.hora_programada || '',
            mov.hora_real || '',
            normalizarTexto(mov.aeropuerto_origen_destino)
        ].join('|');
        return fnv1a(llave, 0x811c9dc5) + fnv1a(llave, 0x01000193);
    }

    function fnv1a(texto, semilla) {
        let h = semilla >>> 0;
        for (let i = 0; i < texto.length; i++) {
            h ^= texto.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    }

    // ── Mapeo de encabezados del Excel ──────────────────────────────────────

    /**
     * Sinónimos de cada columna del layout original. Se comparan ya
     * normalizados (sin acentos, sin puntos, sin espacios), de modo que
     * "MATRÍCULA", "matricula" y "MATRICULA." caen en el mismo lugar.
     *
     * El diccionario menciona una columna SIN encabezado que traía una nota:
     * esa se recoge aparte, en leerNotaSinEncabezado().
     */
    const ALIAS_COLUMNAS = Object.freeze({
        folio_rotacion:            ['NO', 'NUM', 'NUMERO', 'FOLIO', 'FOLIOROTACION', 'ROTACION', '#'],
        fecha_operacion:           ['FECHA', 'FECHAOPERACION', 'FECHADEOPERACION', 'DIA'],
        tipo_operacion:            ['TIPODEOPERACION', 'TIPOOPERACION', 'TIPO', 'OPERACION', 'MOVIMIENTO'],
        ambito_operacion:          ['NACIONAL', 'AMBITO', 'AMBITOOPERACION', 'NACIONALINTERNACIONAL', 'TIPOVUELO'],
        operador:                  ['NOMBREDELOPERADOR', 'OPERADOR', 'NOMBREOPERADOR', 'EMPRESA', 'PROPIETARIO'],
        matricula:                 ['MATRICULA', 'MATRICULAS', 'AERONAVE', 'REGISTRO'],
        tipo_aeronave:             ['TIPODEAERONAVE', 'TIPOAERONAVE', 'EQUIPO', 'MODELO'],
        aeropuerto_origen_destino: ['DESTINOORIGEN', 'ORIGENDESTINO', 'DESTINO', 'ORIGEN', 'AEROPUERTO', 'DESTINOORIGENES'],
        hora_programada:           ['HRPROG', 'HORAPROG', 'HORAPROGRAMADA', 'HRPROGRAMADA', 'PROGRAMADA', 'ETA', 'ETD'],
        hora_real:                 ['HRREAL', 'HORAREAL', 'REAL', 'ATA', 'ATD'],
        adultos:                   ['ADULTOS', 'ADULTO', 'PAXADULTOS'],
        infantes:                  ['INFANTES', 'INFANTE', 'MENORES', 'PAXINFANTES'],
        pax_od:                    ['PAXOD', 'PAXOD1', 'PASAJEROSOD'],
        estado:                    ['ESTADO', 'ENTIDAD'],
        pais:                      ['PAIS'],
        observaciones:             ['OBSERVACIONES', 'OBSERVACION', 'NOTAS', 'NOTA', 'COMENTARIOS', 'COMENTARIO']
    });

    // PAX. A.G. se reconoce para poder IGNORARLA explícitamente: es la columna
    // generada. Si se colara al INSERT, Postgres rechaza la fila entera.
    const COLUMNAS_IGNORADAS = Object.freeze(['PAXAG', 'PAXAG1', 'TOTALPAX', 'PAXTOTAL']);

    /** Quita acentos, signos y espacios para comparar encabezados. */
    function claveEncabezado(texto) {
        return String(texto === null || texto === undefined ? '' : texto)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9#]/g, '');
    }

    /**
     * Empareja los encabezados reales del archivo con los campos de la tabla.
     * Devuelve { mapa, reconocidas, ignoradas, desconocidas, faltantes }.
     *
     * Se informa TODO: lo que casó, lo que se ignoró a propósito y lo que no se
     * reconoció. Una importación que en silencio descarta una columna es una
     * importación que nadie audita después.
     */
    function detectarColumnas(encabezados) {
        const mapa = {};
        const ignoradas = [];
        const desconocidas = [];
        const usados = new Set();

        (encabezados || []).forEach((titulo, indice) => {
            const clave = claveEncabezado(titulo);
            if (!clave) return; // columna sin encabezado: se trata aparte

            if (COLUMNAS_IGNORADAS.includes(clave)) {
                ignoradas.push({ indice, titulo, motivo: 'Columna calculada por la base (PAX A.G.)' });
                return;
            }

            const campo = Object.keys(ALIAS_COLUMNAS).find(
                (c) => !usados.has(c) && ALIAS_COLUMNAS[c].includes(clave)
            );

            if (campo) {
                mapa[campo] = titulo;
                usados.add(campo);
            } else {
                desconocidas.push({ indice, titulo });
            }
        });

        const obligatorias = [
            'fecha_operacion', 'tipo_operacion', 'ambito_operacion',
            'operador', 'matricula', 'tipo_aeronave', 'aeropuerto_origen_destino'
        ];

        return {
            mapa,
            reconocidas: Object.keys(mapa),
            ignoradas,
            desconocidas,
            faltantes: obligatorias.filter((c) => !(c in mapa))
        };
    }

    /**
     * La nota que el diccionario encontró «en una columna sin encabezado».
     * SheetJS bautiza esas columnas como __EMPTY, __EMPTY_1, etc. Se rescatan
     * todas y se pegan, porque perder una observación operativa por no tener
     * título es perder justo el dato que alguien se tomó la molestia de anotar.
     */
    function leerNotaSinEncabezado(filaCruda) {
        return Object.keys(filaCruda || {})
            .filter((k) => /^__EMPTY/.test(k))
            .map((k) => normalizarObservacion(filaCruda[k]))
            .filter(Boolean)
            .join(' · ') || null;
    }

    // ── Normalización de una fila ───────────────────────────────────────────

    /**
     * Convierte un renglón crudo del Excel en un movimiento listo para la base.
     *
     * Devuelve { movimiento, errores, avisos }. NO lanza excepciones: una fila
     * mala no debe tumbar la importación de las otras 1,891, tiene que quedar
     * listada con su número de fila y su motivo.
     */
    function normalizarFilaExcel(filaCruda, opciones) {
        const { mapa = {}, filaOrigen = null } = opciones || {};
        const leer = (campo) => {
            const titulo = mapa[campo];
            return titulo === undefined ? undefined : filaCruda[titulo];
        };

        const mov = {
            folio_rotacion:            normalizarEntero(leer('folio_rotacion')),
            fecha_operacion:           normalizarFecha(leer('fecha_operacion')),
            tipo_operacion:            normalizarTipoOperacion(leer('tipo_operacion')),
            ambito_operacion:          normalizarAmbito(leer('ambito_operacion')),
            operador:                  textoONulo(leer('operador')) || '',
            matricula:                 normalizarMatricula(leer('matricula')),
            tipo_aeronave:             textoONulo(leer('tipo_aeronave')) || '',
            aeropuerto_origen_destino: textoONulo(leer('aeropuerto_origen_destino')) || '',
            hora_programada:           normalizarHora(leer('hora_programada')),
            hora_real:                 normalizarHora(leer('hora_real')),
            // Sin porOmision ni minimo: una celda vacía queda en null ("no se
            // anotó", que es como están miles de filas del histórico) y un
            // negativo llega tal cual para que validarMovimiento lo señale, en
            // vez de convertirse en 0 y pasar desapercibido.
            adultos:                   normalizarEntero(leer('adultos')),
            infantes:                  normalizarEntero(leer('infantes')),
            pax_od:                    normalizarEntero(leer('pax_od')),
            estado:                    textoONulo(leer('estado')),
            pais:                      textoONulo(leer('pais')),
            observaciones:             normalizarObservacion(leer('observaciones')),
            fila_origen:               filaOrigen
        };

        const nota = leerNotaSinEncabezado(filaCruda);
        if (nota) {
            mov.observaciones = mov.observaciones ? `${mov.observaciones} · ${nota}` : nota;
        }

        const avisos = [];
        // Un valor presente que NO se pudo interpretar merece aviso: se está
        // guardando null donde el archivo sí decía algo.
        if (mapa.hora_programada && leer('hora_programada') && mov.hora_programada === null) {
            avisos.push(`Hora programada no interpretable ("${String(leer('hora_programada')).trim()}"), se guarda vacía`);
        }
        if (mapa.hora_real && leer('hora_real') && mov.hora_real === null) {
            avisos.push(`Hora real no interpretable ("${String(leer('hora_real')).trim()}"), se guarda vacía`);
        }

        mov.hash_origen = hashOrigen(mov);

        return { movimiento: mov, errores: validarMovimiento(mov), avisos };
    }

    /**
     * Reglas que la base también impone. Se comprueban aquí para poder señalar
     * la fila y el campo; la base sigue siendo la autoridad final.
     */
    function validarMovimiento(mov) {
        const errores = [];
        const m = mov || {};

        if (!m.fecha_operacion) errores.push({ campo: 'fecha_operacion', mensaje: 'Falta la fecha de operación o no se pudo interpretar' });
        if (!TIPOS_OPERACION.includes(m.tipo_operacion)) errores.push({ campo: 'tipo_operacion', mensaje: 'El tipo de operación debe ser LLEGADA o SALIDA' });
        if (!AMBITOS.includes(m.ambito_operacion)) errores.push({ campo: 'ambito_operacion', mensaje: 'El ámbito debe ser NACIONAL o INTERNACIONAL' });
        if (!m.operador) errores.push({ campo: 'operador', mensaje: 'Falta el nombre del operador' });
        if (!m.matricula) errores.push({ campo: 'matricula', mensaje: 'Falta la matrícula' });
        if (!m.tipo_aeronave) errores.push({ campo: 'tipo_aeronave', mensaje: 'Falta el tipo de aeronave' });
        if (m.folio_rotacion === null || m.folio_rotacion === undefined) errores.push({ campo: 'folio_rotacion', mensaje: 'Falta el folio de rotación (columna "No.")' });

        // aeropuerto_origen_destino NO se exige.
        //
        // El diccionario lo marcaba obligatorio, pero el histórico ya cargado lo
        // tiene vacío en 5,440 de sus 10,396 filas. Manda la tabla: pedirlo aquí
        // rechazaría media bitácora de cada año al importar, y bloquearía la
        // captura de movimientos que legítimamente no lo traen.

        // adultos/infantes: sólo se revisa que no sean negativos. Vacío es un
        // valor legítimo —"no se anotó"— y distinto de cero.
        if (m.adultos !== null && m.adultos !== undefined && m.adultos < 0) {
            errores.push({ campo: 'adultos', mensaje: 'Los adultos no pueden ser negativos' });
        }
        if (m.infantes !== null && m.infantes !== undefined && m.infantes < 0) {
            errores.push({ campo: 'infantes', mensaje: 'Los infantes no pueden ser negativos' });
        }

        // Longitudes del diccionario. Cortar en silencio sería peor: mejor
        // avisar y que alguien decida qué se abrevia.
        if (m.matricula && m.matricula.length > 30) errores.push({ campo: 'matricula', mensaje: 'La matrícula excede 30 caracteres' });
        if (m.tipo_aeronave && m.tipo_aeronave.length > 30) errores.push({ campo: 'tipo_aeronave', mensaje: 'El tipo de aeronave excede 30 caracteres' });
        if (m.aeropuerto_origen_destino && m.aeropuerto_origen_destino.length > 10) errores.push({ campo: 'aeropuerto_origen_destino', mensaje: 'El aeropuerto excede 10 caracteres' });

        return errores;
    }

    /**
     * Deja el objeto tal como lo espera PostgREST: sólo campos escribibles,
     * sin pax_ag, sin claves auxiliares de la interfaz, con los vacíos en null.
     */
    function aPayload(mov, extras) {
        const salida = {};
        CAMPOS_ESCRIBIBLES.forEach((campo) => {
            if (mov[campo] === undefined) return;
            salida[campo] = mov[campo] === '' ? null : mov[campo];
        });
        // adultos e infantes viajan como null cuando no se anotaron.
        //
        // Antes se forzaban a 0 creyendo que la columna era NOT NULL, como decía
        // el diccionario. No lo es: el histórico ya cargado tiene 2,670 filas con
        // adultos en null y 3,080 con infantes en null. Y la diferencia importa:
        // "no se anotaron pasajeros" no es "viajaron cero pasajeros", y meter
        // ceros donde había huecos falsea cualquier promedio que se saque
        // después.
        salida.adultos = mov.adultos === undefined ? null : mov.adultos;
        salida.infantes = mov.infantes === undefined ? null : mov.infantes;
        return Object.assign(salida, extras || {});
    }

    /**
     * adultos + infantes. Espejo de la columna generada, sólo para la vista
     * previa de la importación y el formulario de captura: el valor que manda
     * es SIEMPRE el que calcula la base.
     */
    function paxTotal(mov) {
        const a = Number(mov && mov.adultos) || 0;
        const i = Number(mov && mov.infantes) || 0;
        return a + i;
    }

    // ── Formato para pantalla ───────────────────────────────────────────────

    const MESES_CORTOS = Object.freeze(['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']);

    /** 'YYYY-MM-DD' → '15 Mar 2026'. Sin new Date(): evita el corrimiento UTC. */
    function fechaLarga(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return '—';
        return `${+m[3]} ${MESES_CORTOS[+m[2] - 1]} ${m[1]}`;
    }

    /** '2026-03' → 'Mar 2026'. */
    function periodoLargo(periodo) {
        const m = String(periodo || '').match(/^(\d{4})-(\d{2})$/);
        if (!m) return String(periodo || '—');
        return `${MESES_CORTOS[+m[2] - 1]} ${m[1]}`;
    }

    function numero(valor) {
        const n = Number(valor || 0);
        return new Intl.NumberFormat('es-MX').format(Math.round(n));
    }

    /** Rango por omisión de los filtros: el año en curso completo. */
    function rangoAnioActual(hoy) {
        const f = hoy instanceof Date ? hoy : new Date();
        const anio = f.getFullYear();
        return { fecha_desde: `${anio}-01-01`, fecha_hasta: `${anio}-12-31` };
    }

    function filtrosVacios() {
        return {
            fecha_desde: '', fecha_hasta: '', tipo_operacion: '', ambito_operacion: '',
            operador: '', matricula: '', tipo_aeronave: '', aeropuerto: '',
            estado_validacion: '', estatus_registro: 'ACTIVO', texto: ''
        };
    }

    /** ¿Hay algún filtro puesto además del estatus por omisión? */
    function hayFiltros(filtros) {
        const base = filtrosVacios();
        return Object.keys(base).some((k) => {
            if (k === 'estatus_registro') return (filtros[k] || 'ACTIVO') !== 'ACTIVO';
            return String(filtros[k] || '') !== '';
        });
    }

    return {
        // contrato
        TIPOS_OPERACION, AMBITOS, ESTADOS_VALIDACION, ESTATUS_REGISTRO, TIPOS_FUENTE,
        CAMPOS_ESCRIBIBLES, ALIAS_COLUMNAS,
        // normalización
        normalizarTexto, textoONulo, normalizarObservacion, normalizarMatricula,
        normalizarFecha, normalizarHora, normalizarEntero,
        normalizarTipoOperacion, normalizarAmbito,
        // importación
        claveEncabezado, detectarColumnas, leerNotaSinEncabezado, normalizarFilaExcel,
        hashOrigen,
        // validación y salida
        validarMovimiento, aPayload, paxTotal,
        // presentación
        horaCorta, fechaLarga, periodoLargo, numero,
        // filtros
        filtrosVacios, hayFiltros, rangoAnioActual
    };
});
