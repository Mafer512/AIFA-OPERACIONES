/**
 * @jest-environment node
 *
 * Manifiestos, de mayo de 2026 en adelante, y el mapa de calor día por día.
 *
 * El módulo de Manifiestos nació leyendo tablas importadas de Excel, con
 * columnas en mayúsculas y una tabla por período. De mayo de 2026 en adelante
 * el dato bueno vive en maestra_operaciones, que se llena sola. Aquí se
 * comprueba lo que puede romperse en silencio al traducir de una a la otra:
 *
 *   · que la hora capturada no se corra seis horas al pasar por el huso local
 *     (era el error que habría pintado los vuelos de la tarde como de
 *     madrugada, y el mapa de calor entero habría quedado mal),
 *   · que un vuelo llegado siga contando como llegada y uno internacional no
 *     se cuele entre los nacionales,
 *   · que un renglón que ya tiene manifiesto capturado se distinga del que
 *     sólo está programado en el itinerario,
 *   · y que el mapa de calor sepa decir tanto "los martes a las 7" como
 *     "el martes 12 a las 7".
 */

const maestra = require('../js/manifiestos-maestra.js');

/* Un vuelo conciliado: llegó de Cancún el jueves 14 de mayo de 2026 a las 14:30.
   hora_operacion llega de PostgREST en UTC, como lo entrega la base. */
const LLEGADA_CUN = {
    id: 1,
    fecha_operacion: '2026-05-14',
    tipo_movimiento: 'LLEGADA',
    tipo_manifiesto: 'MANIFIESTO DE LLEGADA',
    numero_vuelo: '4021',
    tipo_operacion: 'Nacional',
    aerolinea_origen: 'VIVA',
    hora_operacion: '2026-05-14T14:30:00+00:00',
    hora_recepcion: '2026-05-14T15:10:00+00:00',
    pax_total: 180,
    pax_pagan_tua_reportados: 172,
    pax_infantes: 3,
    equipaje_kg: 2400,
    origen_origen: 'CUN',
    fuente_principal: 'CONCILIACION_MANIFIESTOS',
};

/* Un vuelo que el itinerario ya programó pero nadie ha conciliado: no trae
   aerolínea, ni pasajeros, ni tipo de operación capturado. */
const PROGRAMADO_MIA = {
    id: 2,
    fecha_operacion: '2026-05-15',
    tipo_movimiento: 'SALIDA',
    numero_vuelo: '900',
    routing: 'NLU-MIA',
    slot_asignado: '2026-05-15T06:05:00+00:00',
    hora_recepcion: null,
    fuente_principal: 'ITINERARIO_VUELOS_EDITABLE',
};

const PAISES = new Map([['CUN', 'México'], ['MIA', 'Estados Unidos']]);

describe('la hora que se capturó es la que se pinta', () => {
    test('un timestamp en UTC no se corre al huso del navegador', () => {
        expect(maestra.textoHora('2026-05-14T14:30:00+00:00')).toBe('14:30');
        expect(maestra.textoHora('2026-05-14T00:20:00+00:00')).toBe('00:20');
    });

    test('también entiende una hora suelta y un espacio en vez de la T', () => {
        expect(maestra.textoHora('7:05')).toBe('07:05');
        expect(maestra.textoHora('2026-05-14 23:45:00')).toBe('23:45');
    });

    test('lo que no es una hora se queda en blanco, no en cero', () => {
        expect(maestra.textoHora(null)).toBe('');
        expect(maestra.textoHora('')).toBe('');
        expect(maestra.textoHora('pendiente')).toBe('');
    });

    test('la fecha tampoco cambia de día al leerse', () => {
        expect(maestra.textoFecha('2026-05-14')).toBe('2026-05-14');
        expect(maestra.textoFecha('2026-05-14T00:00:00+00:00')).toBe('2026-05-14');
    });
});

describe('el renglón traducido habla el idioma de las gráficas', () => {
    const fila = maestra.mapearFila(LLEGADA_CUN, {
        nombreAerolinea: () => 'VIVA Aerobus',
        paisesPorIata: PAISES,
    });

    test('trae las columnas que los accesores buscan', () => {
        expect(fila['FECHA']).toBe('2026-05-14');
        expect(fila['MES']).toBe('Mayo');
        expect(fila['AEROLINEA']).toBe('VIVA Aerobus');
        expect(fila['# DE VUELO']).toBe('4021');
        expect(fila['TOTAL PAX']).toBe(180);
        expect(fila['PAX QUE PAGAN TUA']).toBe(172);
        expect(fila['KGS. DE EQUIPAJE']).toBe(2400);
        expect(fila['DESTINO / ORIGEN']).toBe('CUN');
        expect(fila['HR. DE OPERACIÓN']).toBe('14:30');
    });

    test('la dirección sale de tipo_movimiento, que nunca viene vacío', () => {
        // Los accesores deciden llegada/salida con includes('llegada').
        expect(fila['TIPO DE MANIFIESTO'].toLowerCase()).toContain('llegada');
        const salida = maestra.mapearFila(PROGRAMADO_MIA, {});
        expect(salida['TIPO DE MANIFIESTO'].toLowerCase()).toContain('salida');
    });

    test('un vuelo sin manifiesto deja los pasajeros vacíos, no en cero', () => {
        const programado = maestra.mapearFila(PROGRAMADO_MIA, { paisesPorIata: PAISES });
        expect(programado['TOTAL PAX']).toBe('');
        expect(programado['AEROLINEA']).toBe('');
    });

    test('el slot sirve de hora cuando todavía no hay hora de operación', () => {
        const programado = maestra.mapearFila(PROGRAMADO_MIA, {});
        expect(programado['HR. DE OPERACIÓN']).toBe('06:05');
    });
});

describe('nacional o internacional', () => {
    test('manda lo que se capturó', () => {
        expect(maestra.clasificaOperacion({ tipo_operacion: 'Internacional', origen_origen: 'CUN' }, PAISES))
            .toBe('Internacional');
    });

    test('sin captura se deduce del aeropuerto del otro extremo', () => {
        expect(maestra.clasificaOperacion({ tipo_movimiento: 'SALIDA', routing: 'NLU-MIA' }, PAISES))
            .toBe('Internacional');
        expect(maestra.clasificaOperacion({ tipo_movimiento: 'LLEGADA', origen_origen: 'CUN' }, PAISES))
            .toBe('Nacional');
    });

    test('un código OACI mexicano es nacional aunque no esté en el catálogo', () => {
        expect(maestra.clasificaOperacion({ tipo_movimiento: 'SALIDA', destino_origen: 'MMGL' }, new Map()))
            .toBe('Nacional');
    });

    test('si no alcanza para saberlo se deja en blanco, no se inventa', () => {
        expect(maestra.clasificaOperacion({ tipo_movimiento: 'SALIDA', destino_origen: 'XXX' }, new Map())).toBe('');
        expect(maestra.clasificaOperacion({ tipo_movimiento: 'SALIDA' }, PAISES)).toBe('');
    });

    test('"Internacional" no se cuenta como nacional', () => {
        // isDom() del módulo pide 'dom', o 'nac' sin 'int'. Con los textos que
        // produce esta traducción, una internacional nunca cae del lado nacional.
        const esNacional = t => t.toLowerCase().includes('dom')
            || (t.toLowerCase().includes('nac') && !t.toLowerCase().includes('int'));
        expect(esNacional('Internacional')).toBe(false);
        expect(esNacional('Nacional')).toBe(true);
    });
});

describe('de dónde salió el renglón', () => {
    test('con hora de recepción es manifiesto capturado', () => {
        expect(maestra.origenDeFila(LLEGADA_CUN)).toBe('manifiesto');
    });

    test('lo sigue siendo aunque el renglón lo haya creado el itinerario', () => {
        // fuente_principal sólo se escribe al insertar: un vuelo que entró por
        // el itinerario y después se concilió conserva esa etiqueta.
        expect(maestra.origenDeFila({
            fuente_principal: 'ITINERARIO_VUELOS_EDITABLE',
            hora_recepcion: '2026-05-14T15:10:00+00:00',
        })).toBe('manifiesto');
    });

    test('sin manifiesto es sólo un vuelo programado', () => {
        expect(maestra.origenDeFila(PROGRAMADO_MIA)).toBe('itinerario');
    });
});

describe('el otro extremo de la ruta', () => {
    test('de una salida se toma a dónde fue', () => {
        expect(maestra.extremoDeRuta('NLU-MIA', 'SALIDA')).toBe('MIA');
        expect(maestra.extremoDeRuta('MMSM/CUN', 'SALIDA')).toBe('CUN');
    });

    test('de una llegada se toma de dónde vino', () => {
        expect(maestra.extremoDeRuta('GDL-NLU', 'LLEGADA')).toBe('GDL');
    });

    test('una ruta vacía no inventa destino', () => {
        expect(maestra.extremoDeRuta('', 'SALIDA')).toBe('');
        expect(maestra.extremoDeRuta(null, 'LLEGADA')).toBe('');
    });
});

describe('el mapa de calor, de las dos formas', () => {
    // Tres operaciones: dos el jueves 14 de mayo (una a las 07:00 y otra a las
    // 14:00) y una el jueves siguiente, también a las 07:00.
    const FILAS = [
        { dia: '2026-05-14', hora: 7, pax: 100, vuelo: 'A' },
        { dia: '2026-05-14', hora: 14, pax: 50, vuelo: 'B' },
        { dia: '2026-05-21', hora: 7, pax: 70, vuelo: 'C' },
    ];
    const estado = maestra.construirMapaCalor(FILAS, {
        hora: f => f.hora,
        dia: f => f.dia,
        pax: f => f.pax,
        detalle: f => ({ vuelo: f.vuelo }),
    });

    test('por día de la semana suma los dos jueves en la misma columna', () => {
        const JUEVES = 3; // lunes = 0
        expect(estado.semana.pax[7][JUEVES]).toBe(170);
        expect(estado.semana.ops[7][JUEVES]).toBe(2);
        expect(estado.semana.pax[14][JUEVES]).toBe(50);
    });

    test('por fecha los separa: cada jueves tiene su columna', () => {
        expect(estado.clavesDia).toEqual(['2026-05-14', '2026-05-21']);
        expect(estado.porDia.get('2026-05-14').pax[7]).toBe(100);
        expect(estado.porDia.get('2026-05-21').pax[7]).toBe(70);
        expect(estado.porDia.get('2026-05-14').ops[14]).toBe(1);
    });

    test('cada día sabe qué día de la semana fue y si cayó en fin de semana', () => {
        const dia = estado.porDia.get('2026-05-14');
        expect(dia.diaSemanaLargo).toBe('Jueves');
        expect(dia.etiqueta).toBe('14 May');
        expect(dia.finDeSemana).toBe(false);
        const sabado = maestra.construirMapaCalor(
            [{ dia: '2026-05-16', hora: 9, pax: 1 }],
            { hora: f => f.hora, dia: f => f.dia, pax: f => f.pax }
        );
        expect(sabado.porDia.get('2026-05-16').finDeSemana).toBe(true);
    });

    test('los días se agrupan por mes para poder elegir cuál se dibuja', () => {
        expect(estado.clavesMes).toEqual(['2026-05']);
        expect(estado.porMes.get('2026-05').etiqueta).toBe('Mayo 2026');
        expect(estado.porMes.get('2026-05').dias).toEqual(['2026-05-14', '2026-05-21']);
    });

    test('las semanas se numeran y se etiquetan de lunes a domingo', () => {
        expect(estado.clavesSemana).toEqual(['2026-05-11', '2026-05-18']);
        expect(estado.porSemana.get('2026-05-11').etiqueta).toBe('S1 11 May–17 May');
        expect(estado.porSemana.get('2026-05-11').pax[7][3]).toBe(100);
        expect(estado.porSemana.get('2026-05-18').pax[7][3]).toBe(70);
    });

    test('cada celda guarda los vuelos que la formaron, en las dos vistas', () => {
        expect(estado.semana.detalles[7][3].map(d => d.vuelo)).toEqual(['A', 'C']);
        expect(estado.porDia.get('2026-05-14').detalles[7].map(d => d.vuelo)).toEqual(['A']);
    });

    test('los renglones sin hora o sin fecha no entran al mapa', () => {
        const parcial = maestra.construirMapaCalor(
            [
                { dia: '2026-05-14', hora: -1, pax: 99 },
                { dia: '', hora: 8, pax: 99 },
                { dia: '2026-05-14', hora: 8, pax: 5 },
            ],
            { hora: f => f.hora, dia: f => f.dia, pax: f => f.pax }
        );
        expect(parcial.clavesDia).toEqual(['2026-05-14']);
        expect(parcial.porDia.get('2026-05-14').ops[8]).toBe(1);
        expect(parcial.porDia.get('2026-05-14').pax[8]).toBe(5);
    });
});

describe('lo que se le pide a la base', () => {
    test('no se pide datos_origen: es el renglón completo del AODB en jsonb', () => {
        expect(maestra.COLUMNAS).not.toContain('datos_origen');
        expect(maestra.COLUMNAS).toContain('fecha_operacion');
        expect(maestra.COLUMNAS).toContain('hora_operacion');
        expect(maestra.COLUMNAS).toContain('pax_total');
        expect(maestra.COLUMNAS).toContain('hora_recepcion');
    });
});
