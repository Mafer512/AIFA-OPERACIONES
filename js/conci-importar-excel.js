/* ───────────────────────────────────────────────────────────────────────────
   Conciliación Manifiestos · Importar Excel

   Sube un libro diario o mensual (.xlsx, .xls o .csv) y lo vuelca en la tabla
   sin pisar lo ya capturado.

   QUÉ REUTILIZA (no se reinventa nada de esto)
     (el libro lo lee este módulo: busca la hoja y la fila de encabezados)
     _conciImportBuildColumnMap .... encabezado del archivo → columna del sistema
     _conciPrepareValueForDatabase . deja cada valor como lo espera la columna
     _conciTuaRecalcularPayload .... cuadra TOTAL EXENTOS y PAX QUE PAGAN TUA
     _conciWriteRowSafe ............ escribe con la red de duplicados por vuelo
     _conciIsCalculatedColumn ...... qué columnas calcula el sistema

   EN QUÉ SE DIFERENCIA DEL IMPORTADOR VIEJO (_conciImportManifiestosFile)
     Aquel SUSTITUÍA el manifiesto existente con lo que trajera el archivo y
     borraba las coincidencias repetidas. Aquí no: sobre un manifiesto que ya
     existe sólo se rellenan las celdas VACÍAS. Lo capturado por una persona
     nunca se sobrescribe con el archivo; si el archivo difiere, se cuenta como
     conflicto y se reporta, pero no se toca.

   LO QUE NUNCA ESCRIBE
     - Columnas calculadas por el sistema (HRS. CUMPLIDAS, PUNTUALIDAD,
       DEMORA ± 15 MIN.) y las suyas propias: CAPTURÓ, EVIDENCIA, CAPACIDAD
       MÁXIMA, FACTOR DE OCUPACIÓN y la hora de generación.
     - Manifiestos ya congelados por el Cierre de Subsecretaría: se omiten y se
       informan. Corregir uno cerrado tiene su propio camino ("Corregir
       cerrado" / "Solicitudes"), que deja rastro de quién autorizó el cambio.
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const TABLA = 'Conciliación Manifiestos';

    /* ── Núcleo sin DOM ni red: todo esto se prueba solo ─────────────────── */

    const texto = (valor) => String(valor ?? '').trim();

    const clave = (valor) => texto(valor)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '');

    // Columnas que el sistema calcula o llena solo. El archivo puede traerlas
    // —el libro de Excel las tiene— y aun así no se escriben.
    const PROPIAS_DEL_SISTEMA = [
        'CAPTURO', 'EVIDENCIA', 'CAPACIDADMAXIMA', 'FACTORDEOCUPACION',
        'HORAYFECHAGENERACION', 'DEMORA15MIN', 'PUNTUALIDADCANCELACION',
        'HRSCUMPLIDAS', 'ID', 'CIERREID', 'CLIENTEUUID', 'MOVEMENTKEY'
    ];

    function esColumnaDelSistema(columna) {
        const k = clave(columna);
        if (!k) return true;
        if (PROPIAS_DEL_SISTEMA.includes(k)) return true;
        if (k.startsWith('PORTAL') || k.startsWith('CREATED') || k.startsWith('UPDATED')) return true;
        // Lo que la captura tiene bloqueado por ser calculado, tampoco entra.
        if (typeof window !== 'undefined' && typeof window._conciIsCalculatedColumn === 'function') {
            try { if (window._conciIsCalculatedColumn(columna)) return true; } catch (_) { /* sin dato */ }
        }
        return false;
    }

    // LLEGADA / SALIDA. Es la mitad de la llave, así que una fila sin esto no
    // se puede conciliar con nada.
    function direccionDeManifiesto(valor) {
        const k = clave(valor);
        if (/LLEG|ARRIV/.test(k)) return 'LLEGADA';
        if (/SAL|DEP/.test(k)) return 'SALIDA';
        return '';
    }

    // Fecha a AAAA-MM-DD. Acepta dd/mm/aaaa, aaaa-mm-dd y el serial de Excel,
    // que es lo que sale al leer una celda de fecha sin formato.
    function fechaIso(valor, anioBase) {
        const crudo = texto(valor);
        if (!crudo) return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(crudo)) return crudo.slice(0, 10);
        if (/^\d+(\.\d+)?$/.test(crudo)) {
            const serial = Number(crudo);
            // Excel cuenta desde el 30/12/1899 y cree que 1900 fue bisiesto.
            if (serial > 20000 && serial < 80000) {
                const ms = Math.round((serial - 25569) * 86400000);
                const f = new Date(ms);
                if (!Number.isNaN(f.getTime())) {
                    return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
                }
            }
        }
        const partes = (typeof window !== 'undefined' && typeof window._conciParseDateTimeParts === 'function')
            ? window._conciParseDateTimeParts(crudo, anioBase)
            : null;
        if (!partes || !Number.isFinite(partes.day) || !Number.isFinite(partes.month)) return '';
        const anio = Number.isFinite(partes.year) ? partes.year : anioBase;
        if (!anio || partes.month < 1 || partes.month > 12 || partes.day < 1 || partes.day > 31) return '';
        return `${anio}-${String(partes.month).padStart(2, '0')}-${String(partes.day).padStart(2, '0')}`;
    }

    // Sólo el número del vuelo: "VB 9501", "VB9501" y "9501" son el mismo.
    function numeroDeVuelo(valor, aerolinea) {
        let v = clave(valor);
        const a = clave(aerolinea);
        if (a && v.startsWith(a)) v = v.slice(a.length);
        const m = v.match(/(\d+[A-Z]?)$/);
        return m ? m[1] : v;
    }

    /**
     * La llave compuesta: FECHA + # DE VUELO + TIPO DE MANIFIESTO.
     * La aerolínea viaja aparte para desempatar: dos aerolíneas pueden usar el
     * mismo número de vuelo el mismo día (código compartido), y ahí fusionar a
     * ciegas mezclaría dos operaciones distintas.
     */
    function llaveDeFila(fila, columnas, anioBase) {
        const fecha = fechaIso(fila?.[columnas.fecha], anioBase);
        const direccion = direccionDeManifiesto(fila?.[columnas.tipo]);
        const aerolinea = clave(fila?.[columnas.aerolinea]);
        const ruta = clave(fila?.[columnas.ruta]);
        const vuelo = numeroDeVuelo(fila?.[columnas.vuelo], fila?.[columnas.aerolinea]);
        if (!fecha || !direccion || !vuelo) return null;
        return { id: `${fecha}|${vuelo}|${direccion}`, fecha, vuelo, direccion, aerolinea, ruta };
    }

    const CAMPOS_PAX = ['TOTALPAX', 'DIPLOMATICOS', 'ENCOMISION', 'INFANTES', 'TRANSITOS',
        'CONEXIONES', 'OTROSEXENTOS', 'TOTALEXENTOS', 'PAXQUEPAGANTUA', 'KGSDEEQUIPAJE'];
    const CAMPOS_CARGA = ['KGSDECARGANACIONAL', 'KGSDECARGAINTERNACIONAL', 'KGDECARGATOTAL',
        'CORREO', 'IMPORTACION', 'EXPORTACION', 'KGSCARGALLEGADANLU', 'KGDECARGASALIDANLU', 'TRANSITO'];

    const tieneAlguno = (payload, campos) => Object.keys(payload || {})
        .some(col => campos.includes(clave(col)) && texto(payload[col]) !== '');

    /**
     * ¿La fila es de pasajeros o de carga? Primero por lo que declare el propio
     * archivo (una columna TIPO que diga PASAJEROS o CARGA); si no lo dice
     * —el libro suele traer LLEGADA/SALIDA ahí—, por los campos que trae con
     * valor. Una fila puede traer los dos (un vuelo de pasajeros con carga en
     * bodega) y entonces es MIXTA: se importan ambos lados.
     */
    function clasificaFila(payload, textoTipo) {
        const k = clave(textoTipo);
        if (/CARGA|CARGO|FREIGHT/.test(k)) return 'CARGA';
        if (/PASAJER|PAX/.test(k)) return 'PASAJEROS';
        const pax = tieneAlguno(payload, CAMPOS_PAX);
        const carga = tieneAlguno(payload, CAMPOS_CARGA);
        if (pax && carga) return 'MIXTA';
        if (carga) return 'CARGA';
        if (pax) return 'PASAJEROS';
        return 'SIN DATOS';
    }

    /**
     * Qué escribir sobre un manifiesto que YA existe.
     *
     * Regla: sólo las celdas vacías. Lo que alguien ya capturó no se toca,
     * aunque el archivo traiga otra cosa; esa diferencia se devuelve aparte
     * como conflicto para poder informarla sin cambiar nada.
     */
    function combinar(existente, entrante) {
        const relleno = {};
        const conflictos = [];
        Object.keys(entrante || {}).forEach(columna => {
            if (esColumnaDelSistema(columna)) return;
            const nuevo = entrante[columna];
            if (nuevo === null || nuevo === undefined || texto(nuevo) === '') return;
            const actual = existente ? existente[columna] : undefined;
            if (actual === null || actual === undefined || texto(actual) === '') {
                relleno[columna] = nuevo;
            } else if (clave(actual) !== clave(nuevo)) {
                conflictos.push({ columna, actual, nuevo });
            }
        });
        return { relleno, conflictos };
    }

    /** Lo que se inserta cuando el manifiesto no existe: todo menos lo del sistema. */
    function paraInsertar(entrante) {
        const payload = {};
        Object.keys(entrante || {}).forEach(columna => {
            if (esColumnaDelSistema(columna)) return;
            const valor = entrante[columna];
            if (valor === null || valor === undefined || texto(valor) === '') return;
            payload[columna] = valor;
        });
        return payload;
    }

    /**
     * Decide qué hacer con cada fila del archivo contra lo que hay en la base.
     * No escribe: devuelve el plan, que es lo que se muestra antes de aplicar.
     */
    /** Huella de una fila para reconocer la misma captura escrita dos veces. */
    function huella(payload) {
        return Object.keys(payload || {}).sort()
            .map(k => `${clave(k)}=${texto(payload[k])}`)
            .filter(p => !p.endsWith('='))
            .join('|');
    }

    /**
     * De los manifiestos libres con esa misma llave, cuál le toca a esta fila.
     *
     * Se desempata por aerolínea y luego por destino / origen. Si después de eso
     * siguen quedando varios, no se adivina: vale más dejarlo a mano que
     * rellenar las celdas vacías del manifiesto equivocado.
     */
    function emparejar(libres, llave) {
        let candidatos = libres;
        if (candidatos.length > 1 && llave.aerolinea) {
            const mismos = candidatos.filter(c => clave(c.__aerolinea) === llave.aerolinea);
            if (mismos.length) candidatos = mismos;
        }
        if (candidatos.length > 1 && llave.ruta) {
            const mismos = candidatos.filter(c => clave(c.__ruta) === llave.ruta);
            if (mismos.length) candidatos = mismos;
        }
        return candidatos.length === 1 ? candidatos[0] : { varios: candidatos.length };
    }

    function planificar(filasArchivo, existentesPorLlave, opciones = {}) {
        const plan = { insertar: [], actualizar: [], omitidas: [], conflictos: [] };
        // Por llave: las huellas que ya entraron del archivo y los manifiestos
        // de la base ya emparejados, para que dos filas no peleen por el mismo.
        const huellas = new Map();
        const tomados = new Map();

        (filasArchivo || []).forEach(fila => {
            const { llave, payload, renglon, familia } = fila;
            if (!llave) {
                plan.omitidas.push({ renglon, motivo: 'sin fecha, número de vuelo o tipo de manifiesto' });
                return;
            }
            if (familia === 'SIN DATOS' && !opciones.permitirVacias) {
                plan.omitidas.push({ renglon, motivo: 'no trae datos de pasajeros ni de carga' });
                return;
            }

            // Un vuelo puede repetirse el mismo día y en el mismo sentido: son
            // dos rotaciones distintas y las dos cuentan. Lo que sí se descarta
            // es la misma captura escrita dos veces, celda por celda igual.
            const suHuella = huella(payload);
            const yaVistas = huellas.get(llave.id) || new Map();
            if (yaVistas.has(suHuella)) {
                plan.omitidas.push({ renglon, motivo: `repetida en el archivo (ya venía en el renglón ${yaVistas.get(suHuella)})` });
                return;
            }
            yaVistas.set(suHuella, renglon);
            huellas.set(llave.id, yaVistas);

            const tomadosAqui = tomados.get(llave.id) || new Set();
            const libres = (existentesPorLlave.get(llave.id) || []).filter(c => !tomadosAqui.has(c));

            const existente = libres.length ? emparejar(libres, llave) : null;
            if (existente && existente.varios) {
                plan.omitidas.push({ renglon, motivo: `${existente.varios} manifiestos distintos coinciden con esa fecha, vuelo y tipo` });
                return;
            }
            if (!existente) {
                plan.insertar.push({ renglon, familia, payload: paraInsertar(payload) });
                return;
            }
            tomadosAqui.add(existente);
            tomados.set(llave.id, tomadosAqui);

            if (existente.__cerrado) {
                plan.omitidas.push({ renglon, motivo: 'cerrado por Subsecretaría: usa "Corregir cerrado"' });
                return;
            }
            const { relleno, conflictos } = combinar(existente, payload);
            if (conflictos.length) plan.conflictos.push({ renglon, conflictos });
            if (Object.keys(relleno).length) {
                plan.actualizar.push({ renglon, familia, id: existente.id, payload: relleno, campos: Object.keys(relleno).length });
            } else {
                plan.omitidas.push({ renglon, motivo: conflictos.length ? 'ya capturado, con diferencias' : 'ya capturado, sin datos nuevos' });
            }
        });

        return plan;
    }

    /* ── Lectura del archivo ─────────────────────────────────────────────── */

    /* ── Elegir hoja y fila de encabezados ───────────────────────────────

       El libro del área no empieza con los encabezados: en la hoja DATA la
       fila 1 lleva una fórmula auxiliar de duplicados y los nombres de
       columna están en la fila 2. Además el libro trae ocho hojas, y varias
       —CANCELADOS, INFORMATIVOS, las tablas dinámicas— también tienen algo
       parecido a encabezados.

       Dar por hecho "primera hoja, primera fila" hacía que se leyera la hoja
       equivocada y no se importara nada. Aquí se buscan: se puntúa cada fila
       de las primeras diez de cada hoja por cuántos nombres de columna de
       manifiesto reconoce, y gana la hoja con mejor encabezado y más datos
       debajo. */

    const COLUMNAS_DE_MANIFIESTO = [
        'FECHA', 'TIPODEMANIFIESTO', 'AEROLINEA', 'DEVUELO', 'TIPODEOPERACION',
        'DESTINOORIGEN', 'MATRICULA', 'AERONAVE', 'SLOTASIGNADO', 'TOTALPAX',
        'CIERRESUBSECRETARIA', 'MES', 'RUTA', 'ESTATUSMATRICULA'
    ];

    function puntuaEncabezado(fila) {
        if (!Array.isArray(fila)) return 0;
        const vistos = new Set();
        fila.forEach(celda => {
            const k = clave(celda);
            if (!k) return;
            const acierto = COLUMNAS_DE_MANIFIESTO.find(nombre => k === nombre || k.includes(nombre));
            if (acierto) vistos.add(acierto);
        });
        return vistos.size;
    }

    /** De una matriz de celdas, dónde están los encabezados y qué tan buenos son. */
    function encabezadoDeMatriz(matriz) {
        let mejor = { indice: -1, puntos: 0 };
        (matriz || []).slice(0, 10).forEach((fila, i) => {
            const puntos = puntuaEncabezado(fila);
            if (puntos > mejor.puntos) mejor = { indice: i, puntos };
        });
        return mejor;
    }

    /** La hoja que de verdad trae los manifiestos, con su fila de encabezados. */
    function elegirHoja(hojas) {
        let elegida = null;
        (hojas || []).forEach(hoja => {
            const { indice, puntos } = encabezadoDeMatriz(hoja.matriz);
            if (indice === -1 || puntos < 3) return;
            const datos = hoja.matriz.slice(indice + 1)
                .filter(f => Array.isArray(f) && f.some(v => texto(v) !== '')).length;
            if (!datos) return;
            const candidata = { nombre: hoja.nombre, indice, puntos, datos, matriz: hoja.matriz };
            // Manda la calidad del encabezado; con empate, la hoja con más
            // registros (DATA frente a CANCELADOS o INFORMATIVOS).
            if (!elegida || candidata.puntos > elegida.puntos
                || (candidata.puntos === elegida.puntos && candidata.datos > elegida.datos)) {
                elegida = candidata;
            }
        });
        return elegida;
    }

    /** ¿El formato de la celda es de fecha u hora? */
    function formatoDeFecha(celda) {
        let z = celda.z;
        const ssf = window.XLSX && window.XLSX.SSF;
        if (typeof z === 'number' && ssf && typeof ssf.get_table === 'function') {
            z = ssf.get_table()[z];
        }
        if (typeof z !== 'string' || !z) return false;
        if (ssf && typeof ssf.is_date === 'function') {
            try { return ssf.is_date(z); } catch (_) { /* se decide abajo */ }
        }
        // Sin el ayudante de la librería: los tokens de fecha y hora fuera de
        // los textos entrecomillados del formato.
        return /[dmyhs]/i.test(z.replace(/"[^"]*"/g, '').replace(/\\./g, ''));
    }

    /**
     * El valor de una celda, tomado del dato y no de cómo Excel lo dibuja.
     *
     * Importa para las fechas: el libro del área guarda FECHA como número de
     * serie y la muestra con formato de Estados Unidos, así que el 1 de
     * septiembre se ve como "9/1/26". Leer ese texto lo convertía en 9 de enero
     * y habría importado el mes entero con la fecha equivocada.
     *
     * La cuenta se hace sobre el número de serie y no sobre el objeto de fecha
     * que ofrece la librería: la versión que carga el sitio lo arma en hora
     * local y otras en UTC, y esas horas de diferencia alcanzan para mover un
     * manifiesto al día anterior. El serial es el mismo en todas partes.
     *
     * Excel cuenta los días desde el 30/12/1899; menos de 1 es sólo una hora.
     */
    function valorDeCelda(celda) {
        if (!celda) return '';

        if (celda.t === 'n' && typeof celda.v === 'number' && formatoDeFecha(celda)) {
            const serial = celda.v;
            const dias = Math.floor(serial);
            let minutos = Math.round((serial - dias) * 1440);
            let corrimiento = 0;
            if (minutos >= 1440) { minutos -= 1440; corrimiento = 1; } // 23:59:40 → 00:00 del día siguiente
            const dosCifras = (n) => String(n).padStart(2, '0');
            const hora = `${dosCifras(Math.floor(minutos / 60))}:${dosCifras(minutos % 60)}`;
            if (dias < 1) return hora; // celda de sólo hora

            const f = new Date(Math.round((dias + corrimiento - 25569) * 86400000));
            if (Number.isNaN(f.getTime())) return texto(celda.w);
            const dia = `${dosCifras(f.getUTCDate())}/${dosCifras(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`;
            return minutos ? `${dia} ${hora}` : dia;
        }

        if (celda.w !== undefined && celda.w !== null && String(celda.w).trim() !== '') return String(celda.w);
        return celda.v === undefined || celda.v === null ? '' : String(celda.v);
    }

    /**
     * La hoja como matriz de textos.
     *
     * Se recorren las celdas que existen, no el rango que la hoja declara: el
     * libro del área dice abarcar hasta el renglón 1,048,576 y recorrerlo
     * entero dejaría la página colgada un buen rato.
     */
    function matrizDeHoja(hoja) {
        if (!hoja) return [];
        const matriz = [];
        Object.keys(hoja).forEach(ref => {
            if (ref.charAt(0) === '!') return;
            const valor = valorDeCelda(hoja[ref]);
            if (valor === '') return;
            const { r, c } = window.XLSX.utils.decode_cell(ref);
            if (!matriz[r]) matriz[r] = [];
            matriz[r][c] = valor;
        });
        for (let i = 0; i < matriz.length; i++) if (!matriz[i]) matriz[i] = [];
        return matriz;
    }

    /** Lee el archivo y devuelve encabezados y filas ya recortados. */
    async function leerLibro(archivo) {
        const nombre = texto(archivo && archivo.name) || 'archivo';
        let hojas = [];

        if (/\.csv$/i.test(nombre)) {
            const contenido = (await archivo.text()).replace(/^\uFEFF/, '');
            const lineas = contenido.split(/\r?\n/).filter(l => texto(l) !== '');
            if (lineas.length < 2) throw new Error('El CSV no trae encabezados y registros.');
            const separador = [',', ';', '\t']
                .map(s => ({ s, n: lineas[0].split(s).length }))
                .sort((a, b) => b.n - a.n)[0].s;
            hojas = [{ nombre: 'CSV', matriz: lineas.map(l => l.split(separador).map(c => texto(c).replace(/^"|"$/g, ''))) }];
        } else if (/\.(xlsx|xls)$/i.test(nombre)) {
            if (!window.XLSX) throw new Error('La librería de Excel no cargó. Recarga la página e inténtalo de nuevo.');
            const libro = window.XLSX.read(await archivo.arrayBuffer(), {
                type: 'array', cellNF: true
            });
            hojas = (libro.SheetNames || []).map(n => ({
                nombre: n,
                matriz: matrizDeHoja(libro.Sheets[n])
            }));
        } else {
            throw new Error('Formato no compatible. Elige un archivo .xlsx, .xls o .csv.');
        }

        const hoja = elegirHoja(hojas);
        if (!hoja) {
            throw new Error('No se encontró una hoja con columnas de manifiestos (FECHA, TIPO DE MANIFIESTO, AEROLINEA, # DE VUELO…).');
        }
        return {
            sheetName: hoja.nombre,
            filaEncabezado: hoja.indice + 1,
            headers: hoja.matriz[hoja.indice],
            rows: hoja.matriz.slice(hoja.indice + 1)
                .filter(f => Array.isArray(f) && f.some(v => texto(v) !== ''))
        };
    }
    async function leerArchivo(archivo, columnasEsquema, anioBase) {
        const leidas = await leerLibro(archivo);
        const mapa = window._conciImportBuildColumnMap(leidas.headers, columnasEsquema);
        if (!mapa.length) {
            throw new Error('Los encabezados del archivo no coinciden con ninguna columna de Conciliación Manifiestos.');
        }
        const columnas = {
            fecha: window._conciImportFindColumn(columnasEsquema, 'fecha'),
            tipo: window._conciImportFindColumn(columnasEsquema, 'tipo'),
            vuelo: window._conciImportFindColumn(columnasEsquema, 'vuelo'),
            aerolinea: window._conciImportFindColumn(columnasEsquema, 'aerolinea'),
            ruta: window._conciImportFindColumn(columnasEsquema, 'ruta')
        };
        if (!columnas.fecha || !columnas.tipo || !columnas.vuelo) {
            throw new Error('Falta en el archivo alguna de las tres columnas de la llave: FECHA, # DE VUELO o TIPO DE MANIFIESTO.');
        }

        const filas = [];
        let relleno = 0;
        (leidas.rows || []).forEach((cruda, i) => {
            const payload = {};
            let tipoCrudo = '';
            mapa.forEach(({ index, target }) => {
                const valor = window._conciImportValue(cruda?.[index]);
                if (valor === '') return;
                if (target === columnas.tipo) tipoCrudo = valor;
                payload[target] = window._conciPrepareValueForDatabase(target, valor);
            });
            if (!Object.keys(payload).length) return;

            // El libro arrastra sus fórmulas miles de renglones hacia abajo:
            // debajo del último manifiesto quedan filas que sólo traen
            // columnas calculadas y ninguna de la llave. No son manifiestos
            // incompletos, son relleno, y no tienen que salir en el informe.
            const traeAlgoDeLlave = [columnas.fecha, columnas.vuelo, columnas.tipo]
                .some(col => col && texto(payload[col]) !== '');
            if (!traeAlgoDeLlave) { relleno += 1; return; }

            const direccion = direccionDeManifiesto(payload[columnas.tipo]);
            if (direccion) payload[columnas.tipo] = direccion === 'LLEGADA' ? 'Llegada' : 'Salida';
            if (typeof window._conciTuaRecalcularPayload === 'function') window._conciTuaRecalcularPayload(payload);

            filas.push({
                renglon: i + (leidas.filaEncabezado || 1) + 1, // el renglón tal como se ve en Excel
                payload,
                familia: clasificaFila(payload, tipoCrudo || payload[columnas.tipo]),
                llave: llaveDeFila(payload, columnas, anioBase)
            });
        });

        return {
            hoja: leidas.sheetName, filaEncabezado: leidas.filaEncabezado,
            columnas, filas, relleno, columnasMapeadas: mapa.length
        };
    }

    /* ── Lo que ya está en la base ───────────────────────────────────────── */

    /**
     * Lo que ya está capturado, con TODAS sus columnas.
     *
     * Traer sólo las de la llave sería más barato, pero entonces el resto
     * parecería vacío y la importación lo rellenaría encima: justo lo que no
     * debe pasar. Para que salga barato de todos modos, se acota a las fechas
     * que trae el archivo usando la fecha normalizada de la tabla, la misma
     * que usa la pantalla para filtrar por día.
     */
    async function leerExistentes(client, columnas, columnasEsquema, anioBase, fechas) {
        const tieneCierre = (columnasEsquema || []).some(c => clave(c) === 'CIERREID');
        const ordenadas = [...(fechas || [])].filter(Boolean).sort();
        const info = typeof window._conciGetManifestColInfo === 'function'
            ? await window._conciGetManifestColInfo(client)
            : null;
        const columnaFecha = info && info.portalDateKey;

        const filas = [];
        const tam = 1000;
        for (let desde = 0; ; desde += tam) {
            let consulta = client.from(TABLA).select('*');
            if (columnaFecha && ordenadas.length) {
                // Un día de margen a cada lado: un manifiesto programado el
                // día N puede operar el N+1 y se guarda con el día programado.
                consulta = consulta
                    .gte(columnaFecha, diaDesplazado(ordenadas[0], -1))
                    .lte(columnaFecha, diaDesplazado(ordenadas[ordenadas.length - 1], 1));
            }
            const { data, error } = await consulta.order('id', { ascending: true }).range(desde, desde + tam - 1);
            if (error) throw new Error(`No se pudo leer lo ya capturado: ${error.message}`);
            if (!data || !data.length) break;
            filas.push(...data);
            if (data.length < tam) break;
        }

        const porLlave = new Map();
        filas.forEach(fila => {
            const llave = llaveDeFila(fila, columnas, anioBase);
            if (!llave) return;
            const marcada = Object.assign({}, fila, {
                __aerolinea: columnas.aerolinea ? fila[columnas.aerolinea] : '',
                __ruta: columnas.ruta ? fila[columnas.ruta] : '',
                __cerrado: tieneCierre && fila.cierre_id !== null && fila.cierre_id !== undefined
            });
            if (!porLlave.has(llave.id)) porLlave.set(llave.id, []);
            porLlave.get(llave.id).push(marcada);
        });
        return porLlave;
    }

    /** Una fecha ISO movida N días, para el margen de la consulta. */
    function diaDesplazado(iso, dias) {
        const p = String(iso || '').split('-').map(Number);
        if (p.length !== 3 || p.some(n => !Number.isFinite(n))) return iso;
        const f = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias));
        return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
    }
    /* ── Escritura ───────────────────────────────────────────────────────── */

    async function aplicar(client, plan, alAvanzar) {
        const resultado = { insertados: 0, actualizados: 0, fallidos: [] };
        const total = plan.insertar.length + plan.actualizar.length;
        let hechos = 0;

        const lote = async (items, esActualizacion) => {
            for (let i = 0; i < items.length; i += 10) {
                const grupo = items.slice(i, i + 10);
                // De 10 en 10: la base aguanta el paralelo y así una falla
                // suelta no arrastra a las demás.
                await Promise.all(grupo.map(async item => {
                    try {
                        const r = await window._conciWriteRowSafe(
                            client, item.payload, esActualizacion ? item.id : null,
                            esActualizacion ? {} : { recoverMovementConflict: true }
                        );
                        if (r && r.ok) {
                            if (esActualizacion) resultado.actualizados++; else resultado.insertados++;
                        } else {
                            resultado.fallidos.push({ renglon: item.renglon, motivo: r?.error?.message || 'la base rechazó el registro' });
                        }
                    } catch (error) {
                        resultado.fallidos.push({ renglon: item.renglon, motivo: error?.message || String(error) });
                    }
                    hechos++;
                    if (typeof alAvanzar === 'function') alAvanzar(hechos, total);
                }));
            }
        };

        // Primero lo que completa lo existente y luego las altas: si algo falla
        // a la mitad, lo ya capturado queda intacto y sólo faltarán altas.
        await lote(plan.actualizar, true);
        await lote(plan.insertar, false);
        return resultado;
    }

    /* ── Interfaz ────────────────────────────────────────────────────────── */

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    let planActual = null;
    let archivoActual = null;

    function puedeImportar() {
        try {
            return typeof window._conciCanCurrentUserManage === 'function'
                ? window._conciCanCurrentUserManage()
                : false;
        } catch (_) { return false; }
    }

    function estado(html, tono = 'secondary') {
        const caja = $('conci-import-estado');
        if (caja) caja.innerHTML = `<div class="alert alert-${tono} py-2 px-3 mb-0" style="font-size:.8rem">${html}</div>`;
    }

    /* AERONAVE que el archivo trae y el catálogo no reconoce (texto libre como
       "A-320", un ICAO que cubre varios modelos, un modelo mal escrito). Se
       importan tal cual —no se pierde el dato— pero se avisan antes de aplicar,
       y en la tabla quedan marcadas para revisión. Sin el catálogo cargado no
       hay contra qué comparar y no se avisa nada. */
    function aeronavesFueraDeCatalogo(plan) {
        const vista = window._conciAeronaveDisplay;
        if (typeof vista !== 'function') return [];
        const cuenta = new Map();
        [...(plan?.insertar || []), ...(plan?.actualizar || [])].forEach(({ payload }) => {
            const columna = Object.keys(payload || {}).find(c => /^aeronave$/i.test(String(c).trim()));
            const valor = columna ? texto(payload[columna]) : '';
            if (!valor || !vista(valor).sinCatalogo) return;
            cuenta.set(valor, (cuenta.get(valor) || 0) + 1);
        });
        return [...cuenta].map(([valor, filas]) => ({ valor, filas }))
            .sort((a, b) => b.filas - a.filas || a.valor.localeCompare(b.valor, 'es'));
    }

    function pintarResumen(plan) {
        const caja = $('conci-import-resumen');
        if (!caja) return;
        const sinCatalogo = aeronavesFueraDeCatalogo(plan);
        const avisoAeronaves = sinCatalogo.length ? `<details class="mt-2"><summary class="text-warning" style="cursor:pointer">AERONAVE fuera del catálogo: se importa tal cual y queda marcada para revisión (${sinCatalogo.length})</summary>
                <ul class="mb-0 mt-1" style="font-size:.75rem">${sinCatalogo.slice(0, 20).map(a => `<li>"${esc(a.valor)}" · ${a.filas} fila${a.filas === 1 ? '' : 's'}</li>`).join('')}${sinCatalogo.length > 20 ? `<li>… y ${sinCatalogo.length - 20} más</li>` : ''}</ul></details>` : '';
        const lista = (items, titulo, tono) => {
            if (!items.length) return '';
            const muestra = items.slice(0, 12).map(o => `<li>Renglón ${o.renglon}: ${esc(o.motivo || '')}</li>`).join('');
            const resto = items.length > 12 ? `<li>… y ${items.length - 12} más</li>` : '';
            return `<details class="mt-2"><summary class="text-${tono}" style="cursor:pointer">${titulo} (${items.length})</summary>
                <ul class="mb-0 mt-1" style="font-size:.75rem">${muestra}${resto}</ul></details>`;
        };
        const conflictos = plan.conflictos.map(c => ({
            renglon: c.renglon,
            motivo: c.conflictos.map(x => `${x.columna}: en el sistema "${x.actual}", en el archivo "${x.nuevo}"`).join(' · ')
        }));
        caja.innerHTML = `
            <div class="d-flex gap-2 flex-wrap">
                <span class="badge bg-success">${plan.insertar.length} nuevos</span>
                <span class="badge bg-primary">${plan.actualizar.length} se completan</span>
                <span class="badge bg-secondary">${plan.omitidas.length} sin cambios</span>
                ${conflictos.length ? `<span class="badge bg-warning text-dark">${conflictos.length} con diferencias</span>` : ''}
            </div>
            ${lista(plan.omitidas, 'Filas que no se tocarán', 'secondary')}
            ${lista(conflictos, 'Diferencias contra lo ya capturado (no se sobrescriben)', 'warning')}
            ${avisoAeronaves}`;
        caja.classList.remove('d-none');
    }

    async function revisar(archivo) {
        archivoActual = archivo;
        planActual = null;
        $('btn-conci-import-aplicar')?.setAttribute('disabled', 'disabled');
        estado(`<i class="fas fa-spinner fa-spin me-1"></i>Leyendo <strong>${esc(archivo.name)}</strong>…`, 'secondary');
        try {
            let client = window.supabaseClient;
            if (!client && window.ensureSupabaseClient) client = await window.ensureSupabaseClient();
            if (!client) throw new Error('No se pudo conectar con la base de datos.');

            const info = await window._conciGetManifestColInfo(client);
            const columnasEsquema = info?.sampleRow ? Object.keys(info.sampleRow) : [];
            if (!columnasEsquema.length) throw new Error('No se pudieron leer las columnas de la tabla.');

            const anioBase = Number($('filter-conci-manifiestos-year')?.value) || new Date().getFullYear();
            const leido = await leerArchivo(archivo, columnasEsquema, anioBase);
            if (!leido.filas.length) throw new Error('El archivo no trae registros con datos.');

            const fechas = new Set(leido.filas.map(f => f.llave && f.llave.fecha).filter(Boolean));
            const existentes = await leerExistentes(client, leido.columnas, columnasEsquema, anioBase, fechas);
            planActual = planificar(leido.filas, existentes);

            // Se dice de qué hoja y de qué renglón se leyó, y cuántos
            // renglones de relleno se dejaron fuera: así se ve de dónde salen
            // los números del resumen y no parece que falten registros.
            estado(`Hoja <strong>${esc(leido.hoja)}</strong> (encabezados en el renglón ${leido.filaEncabezado}): `
                + `${leido.filas.length} manifiestos y ${leido.columnasMapeadas} columnas reconocidas.`
                + (leido.relleno ? ` Se omitieron ${leido.relleno} renglones sin fecha ni vuelo.` : ''), 'info');
            pintarResumen(planActual);
            if (planActual.insertar.length || planActual.actualizar.length) {
                $('btn-conci-import-aplicar')?.removeAttribute('disabled');
            }
        } catch (error) {
            console.error('[Importar Excel]', error);
            estado(`No se pudo leer el archivo: ${esc(error.message || error)}`, 'danger');
        }
    }

    async function aplicarPlan() {
        if (!planActual) return;
        const boton = $('btn-conci-import-aplicar');
        const original = boton ? boton.innerHTML : '';
        if (boton) { boton.disabled = true; boton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Importando'; }
        try {
            let client = window.supabaseClient;
            if (!client && window.ensureSupabaseClient) client = await window.ensureSupabaseClient();
            const r = await aplicar(client, planActual, (hechos, total) => {
                estado(`Guardando ${hechos} de ${total}…`, 'secondary');
            });
            const fallidos = r.fallidos.length
                ? ` · <span class="text-danger">${r.fallidos.length} con error</span>`
                : '';
            estado(`Listo: <strong>${r.insertados}</strong> nuevos y <strong>${r.actualizados}</strong> completados${fallidos}.`, 'success');
            if (r.fallidos.length) pintarResumen(Object.assign({}, planActual, { omitidas: r.fallidos, conflictos: [] }));
            planActual = null;
            if (typeof window.loadConciliacionManifiestos === 'function') {
                window._conciRenderCache?.clear?.();
                window._conciRenderedKey = '';
                await window.loadConciliacionManifiestos({ forceRefresh: true });
            }
        } catch (error) {
            console.error('[Importar Excel]', error);
            estado(`La importación se detuvo: ${esc(error.message || error)}`, 'danger');
        } finally {
            if (boton) { boton.innerHTML = original; boton.disabled = true; }
        }
    }

    // El marcado vive aquí y no en index.html: así la función entra y sale
    // completa en un solo archivo, igual que el módulo del cierre.
    function asegurarModal() {
        if ($('conci-import-modal')) return;
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'conci-import-modal';
        modal.tabIndex = -1;
        modal.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header py-2">
                    <h6 class="modal-title"><i class="fas fa-file-import me-2 text-success"></i>Importar manifiestos desde Excel</h6>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                </div>
                <div class="modal-body">
                    <div id="conci-import-zona" class="conci-import-zona" role="button" tabindex="0">
                        <i class="fas fa-cloud-arrow-up fa-2x mb-2 text-success"></i>
                        <div class="fw-semibold">Arrastra el archivo aquí o haz clic para elegirlo</div>
                        <div class="text-muted" style="font-size:.78rem">Se aceptan .xlsx, .xls y .csv</div>
                        <input type="file" id="conci-import-archivo" class="d-none" accept=".xlsx,.xls,.csv">
                    </div>
                    <div id="conci-import-estado" class="mt-3"></div>
                    <div id="conci-import-resumen" class="mt-2 d-none"></div>
                    <p class="text-muted mt-3 mb-0" style="font-size:.75rem">
                        Sobre un manifiesto que ya existe sólo se rellenan las celdas vacías: lo que alguien ya
                        capturó no se sobrescribe. Los manifiestos cerrados por Subsecretaría se omiten, y las
                        columnas que calcula el sistema —Capturó, Demora ± 15 min, Puntualidad, Evidencia,
                        Capacidad y Factor de ocupación— no se tocan nunca.
                    </p>
                </div>
                <div class="modal-footer py-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button>
                    <button type="button" class="btn btn-sm btn-success" id="btn-conci-import-aplicar" disabled>
                        <i class="fas fa-database me-1"></i>Importar a la base
                    </button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    function abrir() {
        if (!puedeImportar()) {
            alert('Solo capturistas, editores o administradores pueden importar manifiestos.');
            return;
        }
        asegurarModal();
        enlazar();
        planActual = null;
        archivoActual = null;
        const entrada = $('conci-import-archivo');
        if (entrada) entrada.value = '';
        $('conci-import-resumen')?.classList.add('d-none');
        $('btn-conci-import-aplicar')?.setAttribute('disabled', 'disabled');
        estado('Arrastra el archivo o haz clic para elegirlo. Se aceptan .xlsx, .xls y .csv.', 'secondary');
        const modal = $('conci-import-modal');
        if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show();
    }

    function enlazar() {
        const boton = $('btn-conci-importar-excel');
        if (boton && !boton.dataset.listo) {
            boton.dataset.listo = '1';
            boton.addEventListener('click', abrir);
        }
        const zona = $('conci-import-zona');
        const entrada = $('conci-import-archivo');
        if (zona && !zona.dataset.listo) {
            zona.dataset.listo = '1';
            zona.addEventListener('click', () => entrada?.click());
            ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => {
                e.preventDefault(); zona.classList.add('conci-import-zona-activa');
            }));
            ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => {
                e.preventDefault(); zona.classList.remove('conci-import-zona-activa');
            }));
            zona.addEventListener('drop', e => {
                const archivo = e.dataTransfer?.files?.[0];
                if (archivo) revisar(archivo);
            });
        }
        if (entrada && !entrada.dataset.listo) {
            entrada.dataset.listo = '1';
            entrada.addEventListener('change', () => {
                if (entrada.files?.[0]) revisar(entrada.files[0]);
            });
        }
        const aplicarBtn = $('btn-conci-import-aplicar');
        if (aplicarBtn && !aplicarBtn.dataset.listo) {
            aplicarBtn.dataset.listo = '1';
            aplicarBtn.addEventListener('click', aplicarPlan);
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enlazar);
        else enlazar();
    }

    // Lo que se prueba aparte del DOM.
    window.ConciImportarExcel = {
        esColumnaDelSistema, direccionDeManifiesto, fechaIso, numeroDeVuelo,
        llaveDeFila, clasificaFila, combinar, paraInsertar, planificar, diaDesplazado,
        puntuaEncabezado, encabezadoDeMatriz, elegirHoja, leerLibro, valorDeCelda, formatoDeFecha,
        huella, emparejar, aeronavesFueraDeCatalogo,
        leerArchivo, leerExistentes, aplicar, abrir, enlazar
    };
})();
