/**
 * Lectura del Layout del sistema FBO → operaciones_fbo (js/aviacion-general/layout-fbo.js).
 *
 * El fixture es el archivo real, docs/fbo/Lay-out.xlsx, leído con SheetJS
 * exactamente como lo lee la pantalla (hojasDesdeLibro, sin cellDates). Los
 * casos AG-2026-000004 y AG-2026-000011 se cotejaron contra las operaciones
 * BASE2026-0855 y BASE2026-0862 que ya están en la base: mismas cifras.
 */

const path = require('path');
const XLSX = require('xlsx');
const Layout = require('../js/aviacion-general/layout-fbo.js');

const RUTA_FIXTURE = path.resolve(__dirname, '..', 'docs', 'fbo', 'Lay-out.xlsx');

function hojasDelFixture() {
    const libro = XLSX.readFile(RUTA_FIXTURE, { cellDates: false });
    return Layout.hojasDesdeLibro(libro, XLSX);
}

const HOJAS = hojasDelFixture();
const RESULTADO = Layout.parsearLayout(HOJAS);
const porRegistro = (registro, resultado = RESULTADO) => resultado.filas.find((f) => f.registro === registro);

// ── Utilidades para armar archivos sintéticos con los encabezados reales ────
const GLOBAL = HOJAS.find((h) => h.nombre === 'Global');
const I_ENC = Layout.detectarFilaEncabezado(GLOBAL.filas);
const ENCABEZADOS = GLOBAL.filas[I_ENC];
const FILA_BASE = GLOBAL.filas.find((f) => f && f[0] === 'AG-2026-000011');

/** Copia de la fila AG-2026-000011 con celdas cambiadas por título de columna. */
function filaCon(cambios) {
    const fila = FILA_BASE.slice();
    Object.entries(cambios).forEach(([titulo, valor]) => {
        const i = ENCABEZADOS.indexOf(titulo);
        if (i < 0) throw new Error(`Encabezado inexistente en el fixture: ${titulo}`);
        fila[i] = valor;
    });
    return fila;
}

function archivo(filas, { titulos = 3, nombre = 'Global' } = {}) {
    const arriba = Array.from({ length: titulos }, (_, i) => (i === 0 ? ['Operaciones del periodo'] : []));
    return Layout.parsearLayout([{ nombre, filas: [...arriba, ENCABEZADOS, ...filas] }]);
}

const motivos = (fila, tipo = 'errores') => fila[tipo].map((i) => `${i.campo}: ${i.motivo}`).join(' | ');

describe('lectura del fixture docs/fbo/Lay-out.xlsx', () => {
    test('usa la hoja Global, encuentra el encabezado en la fila 4 y lee 43 filas', () => {
        expect(RESULTADO.error).toBeNull();
        expect(RESULTADO.hoja).toBe('Global');
        expect(RESULTADO.filaEncabezado).toBe(4);
        expect(RESULTADO.filas).toHaveLength(43);
        expect(RESULTADO.columnasFaltantes).toEqual([]);
    });

    test('ninguna fila del fixture trae errores que la bloqueen', () => {
        const conError = RESULTADO.filas.filter((f) => f.errores.length);
        expect(conError.map((f) => `${f.registro}: ${motivos(f)}`)).toEqual([]);
    });

    test('AG-2026-000004: NAC, 4 pax de llegada, 5 de salida, 3974 min, MTOW 4.10', () => {
        const f = porRegistro('AG-2026-000004');
        expect(f.filaExcel).toBe(7);
        const o = f.operacion;
        expect(o.nac_int_llegada).toBe('NAC');
        expect(o.nac_int_salida).toBe('NAC');
        expect(o.pax_llegada_totales).toBe(4);
        expect(o.pax_llegada_adultos).toBe(4);
        expect(o.pax_llegada_infantes).toBe(0);
        expect(o.pax_salida_totales).toBe(5);
        expect(o.pax_salida_adultos).toBe(5);
        expect(o.tiempo_permanencia_min).toBe(3974);
        expect(o.mtow).toBe(4.1);
        expect(o.mtow.toFixed(2)).toBe('4.10');
        expect(o.mzfw).toBe(3.99);
        expect(o.origen).toBe('MMTP');
        expect(o.destino).toBe('MMQT');
        expect(o.matricula).toBe('N279FV');
        expect(o.vuelo_operado_por).toBe('FBO');
        expect(o.tipo_ala).toBe('FIJA');
        expect(o.uds_traslado_pax).toBe(2);
    });

    test('las fechas son hora local: un aterrizaje a las 22:10 no se corre al día siguiente', () => {
        // En UTC serían las 04:10 del 2 de agosto: el error clásico de toISOString().
        const o = porRegistro('AG-2026-000004').operacion;
        expect(o.fecha_aterrizaje).toBe('2026-08-01');
        expect(o.hora_aterrizaje).toBe('22:10:00');
        expect(o.fecha_salida_posicion).toBe('2026-08-04');
        expect(o.hora_salida_posicion).toBe('16:29:00');
    });

    test('AG-2026-000011: KAEX → KELP, 126 pax de llegada, 15 de salida, 68 min', () => {
        const o = porRegistro('AG-2026-000011').operacion;
        expect(o.origen).toBe('KAEX');
        expect(o.destino).toBe('KELP');
        expect(o.pax_llegada_totales).toBe(126);
        expect(o.pax_salida_totales).toBe(15);
        expect(o.tiempo_permanencia_min).toBe(68);
        expect(o.nac_int_llegada).toBe('INT');
        expect(o.mtow).toBe(70.08);
    });

    test('ROTARY_WING se convierte en ROTATIVA y FIXED_WING en FIJA', () => {
        const alas = RESULTADO.filas.map((f) => f.operacion.tipo_ala);
        expect(alas.filter((a) => a === 'ROTATIVA')).toHaveLength(5);
        expect(alas.filter((a) => a === 'FIJA')).toHaveLength(38);
        expect(alas.some((a) => /_WING$/.test(String(a)))).toBe(false);
    });

    test('no se lee nada de cobranza', () => {
        const claves = Object.keys(porRegistro('AG-2026-000004').operacion);
        expect(claves.filter((k) => /mxn|iva|importe|cobr|subtotal|pagado|pendiente|folio/i.test(k))).toEqual([]);
    });

    test('las columnas de la operación son exactamente las de operaciones_fbo (sin id)', () => {
        expect(Object.keys(porRegistro('AG-2026-000004').operacion).sort()).toEqual([
            'registro', 'operador', 'vuelo_operado_por', 'matricula', 'tipo_aeronave', 'tipo_ala',
            'origen', 'nac_int_llegada', 'fecha_aterrizaje', 'hora_aterrizaje', 'hora_llegada_posicion',
            'hora_desembarque', 'tiempo_desembarque', 'pax_llegada_adultos', 'pax_llegada_infantes',
            'pax_llegada_totales', 'destino', 'nac_int_salida', 'fecha_salida_posicion', 'hora_embarque',
            'hora_salida_posicion', 'hora_despegue', 'pax_salida_adultos', 'pax_salida_infantes',
            'pax_salida_totales', 'pax_pagan_tua', 'tiempo_embarque', 'tiempo_permanencia_min',
            'uds_traslado_pax', 'uds_acarreo_equipaje', 'mtow', 'mzfw', 'oficial_operaciones'
        ].sort());
    });

    test('sin Fin desembarque ni Inicio embarque: advertencias, no errores, y tiempos en null', () => {
        const f = porRegistro('AG-2026-000004');
        expect(f.errores).toEqual([]);
        expect(motivos(f, 'advertencias')).toContain('Falta Fin desembarque');
        expect(motivos(f, 'advertencias')).toContain('Falta Inicio embarque');
        expect(f.operacion.tiempo_desembarque).toBeNull();
        expect(f.operacion.tiempo_embarque).toBeNull();
    });
});

describe('detección del encabezado y de la hoja', () => {
    test('encuentra el encabezado aunque cambie el número de filas de título', () => {
        const sinTitulos = archivo([FILA_BASE], { titulos: 0 });
        expect(sinTitulos.filaEncabezado).toBe(1);
        expect(sinTitulos.filas[0].filaExcel).toBe(2);

        const conSeis = archivo([FILA_BASE], { titulos: 6 });
        expect(conSeis.filaEncabezado).toBe(7);
        expect(conSeis.filas[0].filaExcel).toBe(8);
        expect(conSeis.filas[0].operacion.tiempo_permanencia_min).toBe(68);
    });

    test('compara encabezados sin acentos ni mayúsculas', () => {
        const enc = ENCABEZADOS.map((t) => (t ? String(t).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t));
        const r = Layout.parsearLayout([{ nombre: 'Global', filas: [enc, FILA_BASE] }]);
        expect(r.error).toBeNull();
        expect(r.filas[0].operacion.origen).toBe('KAEX');
        expect(r.filas[0].operacion.oficial_operaciones).toBeNull();
    });

    test('sin hoja Global toma la primera con los encabezados; las de resumen no cuentan', () => {
        const resumenes = HOJAS.filter((h) => h.nombre !== 'Global');
        const otra = Object.assign({}, GLOBAL, { nombre: 'Operaciones agosto' });
        const r = Layout.parsearLayout([...resumenes, otra]);
        expect(r.hoja).toBe('Operaciones agosto');
        expect(r.filas).toHaveLength(43);
    });

    test('un libro sin el Layout se reporta en vez de leer basura', () => {
        const r = Layout.parsearLayout(HOJAS.filter((h) => h.nombre !== 'Global'));
        expect(r.error).toMatch(/No se encontró una hoja/);
        expect(r.filas).toEqual([]);
    });

    test('ignora filas vacías', () => {
        const r = archivo([[], FILA_BASE, [null, null, '']]);
        expect(r.filas).toHaveLength(1);
    });
});

describe('errores que bloquean la fila', () => {
    test('Registro duplicado dentro del archivo bloquea todas sus ocurrencias', () => {
        const r = archivo([filaCon({ Registro: 'AG-X-1' }), filaCon({ Registro: 'AG-X-2' }), filaCon({ Registro: 'AG-X-1' })]);
        const [a, b, c] = r.filas;
        expect(motivos(a)).toMatch(/Registro duplicado en el archivo \(filas 5, 7\)/);
        expect(motivos(c)).toMatch(/Registro duplicado/);
        expect(b.errores).toEqual([]);
    });

    test('fila con datos de operación pero sin Registro', () => {
        const r = archivo([filaCon({ Registro: null })]);
        expect(r.filas).toHaveLength(1);
        expect(motivos(r.filas[0])).toContain('Registro: Sin Registro');
    });

    test('fecha u hora imposibles de interpretar', () => {
        const r = archivo([
            filaCon({ Registro: 'R1', Aterrizaje: 'ayer en la tarde' }),
            filaCon({ Registro: 'R2', 'Salida posición': '2026-02-30 10:00' }),
            filaCon({ Registro: 'R3', Despegue: '2026-08-04 25:10' })
        ]);
        expect(motivos(r.filas[0])).toMatch(/^Aterrizaje: No se pudo interpretar la fecha\/hora "ayer en la tarde"/);
        expect(motivos(r.filas[1])).toMatch(/Salida posición: No se pudo interpretar/);
        expect(motivos(r.filas[2])).toMatch(/Despegue: No se pudo interpretar/);
    });

    test('acepta fechas como texto YYYY-MM-DD HH:mm[:ss]', () => {
        const r = archivo([filaCon({
            Registro: 'R1', Aterrizaje: '2026-08-04 10:13', 'Llegada a plataforma': '2026-08-04 10:16:00',
            'Salida posición': '2026-08-04 11:24:30'
        })]);
        const f = r.filas[0];
        expect(f.errores).toEqual([]);
        expect(f.operacion.fecha_aterrizaje).toBe('2026-08-04');
        expect(f.operacion.hora_aterrizaje).toBe('10:13:00');
        expect(f.operacion.hora_salida_posicion).toBe('11:24:30');
        expect(f.operacion.tiempo_permanencia_min).toBe(69); // 68.5 min se redondea
    });

    test('salida anterior a la llegada', () => {
        const r = archivo([filaCon({ Registro: 'R1', Aterrizaje: '2026-10-24 09:00', 'Llegada a plataforma': '2026-10-24 09:05',
                                     'Salida posición': '2026-09-24 12:00', Despegue: '2026-09-24 12:10' })]);
        expect(motivos(r.filas[0])).toMatch(/Salida posición: La salida \(2026-09-24 12:00\) es anterior a la llegada \(2026-10-24 09:00\)/);
        // Y la permanencia negativa no se guarda.
        expect(r.filas[0].operacion.tiempo_permanencia_min).toBeNull();
    });

    test('un conteo de pasajeros que no es número no se convierte en 0', () => {
        const r = archivo([filaCon({ Registro: 'R1', 'Adultos llegada': 'tres' })]);
        expect(motivos(r.filas[0])).toMatch(/Adultos llegada: "tres" no es un número entero válido/);
    });
});

describe('advertencias que no bloquean', () => {
    test('operación abierta, matrícula vacía y ámbito desconocido', () => {
        const r = archivo([filaCon({
            Registro: 'R1', 'Matrícula': null, 'Salida posición': null, Despegue: null,
            'Llegada nacional/internacional': 'SPACE'
        })]);
        const f = r.filas[0];
        expect(f.errores).toEqual([]);
        const a = motivos(f, 'advertencias');
        expect(a).toContain('Operación abierta (sin Salida posición)');
        expect(a).toContain('Matrícula vacía');
        expect(a).toContain('Ámbito de llegada desconocido (SPACE)');
        expect(f.operacion.fecha_salida_posicion).toBeNull();
        expect(f.operacion.tiempo_permanencia_min).toBeNull();
    });

    test('vacíos en pasajeros y unidades valen 0; toneladas vacías, null', () => {
        const r = archivo([filaCon({
            Registro: 'R1', 'Adultos llegada': null, 'Menores llegada': '', 'Infantes llegada': null,
            'Unidades traslado pasajeros': null, 'MTOW t': ''
        })]);
        const o = r.filas[0].operacion;
        expect(o.pax_llegada_adultos).toBe(0);
        expect(o.pax_llegada_totales).toBe(0);
        expect(o.uds_traslado_pax).toBe(0);
        expect(o.mtow).toBeNull();
    });

    test('Origen cae en Local y luego en IATA cuando falta el OACI', () => {
        const r = archivo([
            filaCon({ Registro: 'R1', 'Origen OACI': null, 'Origen Local': 'TOL1' }),
            filaCon({ Registro: 'R2', 'Origen OACI': ' ', 'Origen Local': null, 'Origen IATA': 'AEX' })
        ]);
        expect(r.filas[0].operacion.origen).toBe('TOL1');
        expect(r.filas[1].operacion.origen).toBe('AEX');
    });

    test('salida: adultos = total − infantes, nunca negativo; pagan TUA es cantidad', () => {
        const r = archivo([filaCon({
            Registro: 'R1',
            'Salida nacional Total salida': 2, 'Salida internacional Total salida': 1,
            'Salida nacional Infantes': 3, 'Salida internacional Infantes': 1,
            'Salida nacional Pagan TUA': 2, 'Salida internacional Pagan TUA': 1
        })]);
        const o = r.filas[0].operacion;
        expect(o.pax_salida_totales).toBe(3);
        expect(o.pax_salida_infantes).toBe(4);
        expect(o.pax_salida_adultos).toBe(0);
        expect(o.pax_pagan_tua).toBe(3);
    });
});

describe('lectura de fecha y hora', () => {
    test('serie de Excel sin pasar por UTC: 18:30 sigue siendo el mismo día', () => {
        // 2026-08-01 = serie 46235.
        const r = Layout.leerInstante(46235 + 18.5 / 24);
        expect(r.valor).toMatchObject({ fecha: '2026-08-01', hora: '18:30:00' });
    });

    test('Date de cellDates: se toman sus componentes locales', () => {
        const r = Layout.leerInstante(new Date(2026, 7, 1, 23, 45, 0));
        expect(r.valor).toMatchObject({ fecha: '2026-08-01', hora: '23:45:00' });
    });

    test('vacío es null; una hora suelta en una columna de fecha y hora es error', () => {
        expect(Layout.leerInstante(null)).toEqual({ ok: true, valor: null });
        expect(Layout.leerInstante('  ')).toEqual({ ok: true, valor: null });
        expect(Layout.leerInstante(0.5).ok).toBe(false);
    });

    test('intervalo en formato de Postgres, también de más de 24 horas', () => {
        const a = Layout.leerInstante('2026-08-01 22:15').valor;
        const b = Layout.leerInstante('2026-08-04 16:29').valor;
        expect(Layout.intervalo(a, b)).toBe('66:14:00');
        expect(Layout.intervalo(a, null)).toBeNull();
    });
});

describe('contra lo ya guardado (vista previa)', () => {
    test('una coincidencia única por matrícula + fecha reemplaza la operación BASE', () => {
        const r = Layout.clasificarContraBase(['AG-1', 'AG-2'], {
            existentes: ['AG-2'],
            coincidencias: [{ registro: 'AG-1', registro_existente: 'BASE2026-0855' }]
        });
        expect(r[0]).toEqual({ registro: 'AG-1', existe: false, reemplazaRegistro: 'BASE2026-0855', error: null });
        expect(r[1]).toEqual({ registro: 'AG-2', existe: true, reemplazaRegistro: null, error: null });
    });

    test('varias coincidencias: ambigua, se bloquea', () => {
        const [r] = Layout.clasificarContraBase(['AG-1'], {
            coincidencias: [
                { registro: 'AG-1', registro_existente: 'BASE-1' },
                { registro: 'AG-1', registro_existente: 'BASE-2' }
            ]
        });
        expect(r.reemplazaRegistro).toBeNull();
        expect(r.error).toMatch(/Coincide con 2 operaciones guardadas.*BASE-1, BASE-2.*ambigua/);
    });

    test('dos filas del archivo apuntando a la misma operación guardada: las dos se bloquean', () => {
        const r = Layout.clasificarContraBase(['AG-1', 'AG-2'], {
            coincidencias: [
                { registro: 'AG-1', registro_existente: 'BASE-1' },
                { registro: 'AG-2', registro_existente: 'BASE-1' }
            ]
        });
        expect(r.every((c) => c.error && !c.reemplazaRegistro)).toBe(true);
    });

    test('una coincidencia que es otra fila del mismo archivo no es "la otra operación"', () => {
        const [r] = Layout.clasificarContraBase(['AG-1', 'AG-2'], {
            coincidencias: [{ registro: 'AG-1', registro_existente: 'AG-2' }]
        });
        expect(r).toEqual({ registro: 'AG-1', existe: false, reemplazaRegistro: null, error: null });
    });

    test('el payload lleva reemplaza_registro sólo cuando aplica', () => {
        const o = porRegistro('AG-2026-000004').operacion;
        expect(Layout.aPayload(o, null)).not.toHaveProperty('reemplaza_registro');
        expect(Layout.aPayload(o, 'BASE2026-0855').reemplaza_registro).toBe('BASE2026-0855');
        expect(o).not.toHaveProperty('reemplaza_registro');
    });
});

describe('reporte de validación en CSV', () => {
    test('trae fila, registro, tipo, campo y motivo, escapando comas y comillas', () => {
        const csv = Layout.reporteCsv([
            { filaExcel: 9, registro: 'R2', tipo: 'ADVERTENCIA', campo: 'Matrícula', motivo: 'Matrícula vacía' },
            { filaExcel: 5, registro: 'R1', tipo: 'ERROR', campo: 'Aterrizaje', motivo: 'No se pudo interpretar "a, b"' }
        ]);
        const lineas = csv.split('\r\n');
        expect(lineas[0]).toBe('Fila de Excel,Registro,Tipo,Campo,Motivo');
        expect(lineas[1]).toBe('5,R1,ERROR,Aterrizaje,"No se pudo interpretar ""a, b"""');
        expect(lineas[2]).toBe('9,R2,ADVERTENCIA,Matrícula,Matrícula vacía');
    });

    test('el reporte del fixture lista las advertencias de sus 43 filas', () => {
        const inc = Layout.incidencias(RESULTADO.filas);
        expect(inc.length).toBeGreaterThan(0);
        expect(inc.every((i) => i.tipo === 'ADVERTENCIA')).toBe(true);
        expect(Layout.reporteCsv(inc).split('\r\n')).toHaveLength(inc.length + 1);
    });
});
