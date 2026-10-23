/**
 * Núcleo de "Solicitud de Slots → SSIM".
 *
 * Los casos salen de una solicitud real de VIVA (VB) al COyH de AIFA. Lo que
 * se cuida aquí:
 *
 *   · Sólo N y R generan tramos. C y D son el horario que se va: si se
 *     colaran al SSIM, el aeropuerto cargaría el vuelo viejo y el nuevo.
 *   · La hoja da días UTC del evento EN NLU. Una llegada a las 00:20 UTC sale
 *     del origen el día anterior: el periodo y los días del tramo se recorren,
 *     no se copian.
 *   · "9212" es un número de vuelo, no la aerolínea "92" con el vuelo 12.
 *   · Sin tiempo de bloque no hay archivo. Inventar la hora del otro extremo
 *     produce un SSIM que se ve correcto y no lo es.
 */

const Core = require('../js/ssim-slots/core.js');

const sale = (mov, vuelo, hora, destino, dias, desde, hasta, obs = '') =>
    ({ mov, linea: 'VB', vueloSale: vuelo, equipo: 'A320', horaSale: hora, destino, dias, desde, hasta, tipoSale: 'J', obs });
const llega = (mov, vuelo, hora, origen, dias, desde, hasta, obs = '') =>
    ({ mov, linea: 'VB', vueloLlega: vuelo, equipo: 'A320', horaLlega: hora, origen, dias, desde, hasta, tipoLlega: 'J', obs });

function solicitudVB(filas) {
    const sol = Core.nuevaSolicitud();
    sol.encabezado.aerolinea = 'AEROENLACES NACIONALES S.A DE C.V';
    sol.encabezado.iata = 'VB';
    sol.filas = filas || [
        sale('C', '9212', '0313', 'OAX', '5', '16/10/26', '23/10/26'),
        sale('R', '9212', '2257', 'OAX', '4', '15/10/26', '22/10/26'),
        sale('C', '9212', '0248', 'OAX', '6', '31/10/26', '31/10/26'),
        sale('R', '9212', '0202', 'OAX', '6', '31/10/26', '31/10/26'),
        llega('C', '9213', '0602', 'OAX', '5', '16/10/26', '23/10/26'),
        llega('R', '9213', '0157', 'OAX', '5', '16/10/26', '23/10/26'),
        llega('C', '9407', '0233', 'MTY', '5', '16/10/26', '23/10/26'),
        llega('R', '9407', '0620', 'MTY', '5', '16/10/26', '23/10/26'),
        sale('C', '9406', '2258', 'MTY', '4', '29/10/26', '29/10/26'),
        sale('R', '9606', '0242', 'MTY', '5', '30/10/26', '30/10/26')
    ];
    sol.bloques = { 'NLU-OAX': 70, 'OAX-NLU': 70, 'NLU-MTY': 95, 'MTY-NLU': 95 };
    return sol;
}

const AHORA = new Date(2026, 9, 15, 10, 30);
const tramos3 = (texto) => texto.split('\r\n').filter((l) => l[0] === '3');

describe('normalización de lo capturado', () => {
    test('fechas en los formatos que llegan de la hoja', () => {
        expect(Core.normalizarFecha('16/10/26')).toBe('2026-10-16');
        expect(Core.normalizarFecha('16/10/2026')).toBe('2026-10-16');
        expect(Core.normalizarFecha('16OCT26')).toBe('2026-10-16');
        expect(Core.normalizarFecha(46311)).toBe('2026-10-16'); // serie de Excel
        expect(Core.normalizarFecha('31/02/26')).toBe('');
    });

    test('horas: texto, con dos puntos y fracción de día de Excel', () => {
        expect(Core.normalizarHora('0313')).toBe('0313');
        expect(Core.normalizarHora('313')).toBe('0313');
        expect(Core.normalizarHora('22:57')).toBe('2257');
        expect(Core.normalizarHora(0.95625)).toBe('2257');
        expect(Core.normalizarHora('2460')).toBe('');
    });

    test('frecuencia con guiones bajos como en la hoja', () => {
        expect(Core.normalizarDias(['_', '_', '_', '_', '5', '_', '_'])).toBe('5');
        expect(Core.normalizarDias('1 3 5 7')).toBe('1357');
    });

    test('diferencia UTC: Tijuana cambia con el horario de verano de EUA', () => {
        expect(Core.husoEstacion('TIJ', '2026-10-31')).toBe('-0700');
        expect(Core.husoEstacion('TIJ', '2026-11-02')).toBe('-0800');
        expect(Core.husoEstacion('NLU', '2026-07-01')).toBe('-0600');
        expect(Core.husoEstacion('XYZ', '2026-07-01', { XYZ: '-5' })).toBe('-0500');
    });

    test('temporada IATA: W26 empieza el último domingo de octubre', () => {
        expect(Core.temporadaIata('2026-10-24')).toBe('S26');
        expect(Core.temporadaIata('2026-10-25')).toBe('W26');
        expect(Core.temporadaIata('2027-02-01')).toBe('W26');
    });
});

describe('análisis de la solicitud', () => {
    test('sin tiempo de bloque no se genera archivo', () => {
        const sol = solicitudVB();
        sol.bloques = {};
        const g = Core.generarSsim(sol, null, AHORA);
        expect(g.ok).toBe(false);
        expect(g.texto).toBe('');
        expect(g.analisis.errores.map((e) => e.msg)).toEqual(expect.arrayContaining([
            'Falta el tiempo de bloque de la ruta NLU-OAX (minutos).',
            'Falta el tiempo de bloque de la ruta MTY-NLU (minutos).'
        ]));
    });

    test('sólo N y R generan tramos; C y D quedan como salidas del itinerario', () => {
        const a = Core.analizar(solicitudVB());
        expect(a.errores).toEqual([]);
        expect(a.itinerarios.map((it) => it.mov)).toEqual(['R', 'R', 'R', 'R', 'R']);
        expect(a.salen.map((it) => it.mov)).toEqual(['C', 'C', 'C', 'C', 'C']);
    });

    test('avisa cuando la revisión cambia el número de vuelo sin explicarlo', () => {
        const a = Core.analizar(solicitudVB());
        expect(a.avisos).toContainEqual({ fila: 10, msg: 'La revisión cambia el número de vuelo 9406 → 9606 sin observación que lo explique.' });
    });

    test('con la observación "Cambio H y N vlo" no avisa', () => {
        const a = Core.analizar(solicitudVB([
            llega('C', '9213', '0547', 'OAX', '6', '17/10/26', '24/10/26', 'Cambio H y N vlo'),
            llega('R', '9215', '2257', 'OAX', '5', '16/10/26', '23/10/26', 'Cambio H y N vlo')
        ]));
        expect(a.avisos).toEqual([]);
    });

    test('C sin su R debajo se señala', () => {
        const a = Core.analizar(solicitudVB([sale('C', '9212', '0313', 'OAX', '5', '16/10/26', '23/10/26')]));
        expect(a.avisos[0].msg).toMatch(/seguido de su revisión/);
    });

    test('vigencia que no empieza en día de operación se ajusta y se avisa', () => {
        const a = Core.analizar(solicitudVB([sale('N', '9212', '2257', 'OAX', '4', '14/10/26', '24/10/26')]));
        expect(a.errores).toEqual([]);
        expect(a.avisos[0].msg).toMatch(/se ajusta a 15\/10\/26–22\/10\/26/);
        expect(a.itinerarios[0].tramos[0].desde).toBe('2026-10-15');
        expect(a.itinerarios[0].tramos[0].hasta).toBe('2026-10-22');
    });

    test('dos renglones que operan el mismo vuelo el mismo día son error', () => {
        const a = Core.analizar(solicitudVB([
            sale('N', '9212', '2257', 'OAX', '4', '15/10/26', '22/10/26'),
            sale('N', '9212', '2300', 'OAX', '4', '22/10/26', '29/10/26')
        ]));
        expect(a.errores.some((e) => /también en el renglón 1/.test(e.msg))).toBe(true);
    });

    test('equipo sin equivalencia IATA es error', () => {
        const fila = sale('N', '9212', '2257', 'OAX', '4', '15/10/26', '22/10/26');
        fila.equipo = 'ZZZZ';
        const a = Core.analizar(solicitudVB([fila]));
        expect(a.errores.some((e) => /sin equivalencia IATA/.test(e.msg))).toBe(true);
    });

    test('resumen por fecha: entra lo nuevo, sale lo que cambia', () => {
        const a = Core.analizar(solicitudVB());
        const r = Core.resumenPorFecha(a);
        expect(r.find((x) => x.fecha === '2026-10-16')).toEqual({ fecha: '2026-10-16', entran: 2, salen: 3, dia: 5, neto: -1 });
    });
});

describe('archivo SSIM', () => {
    test('estructura: 200 caracteres, bloques de 5, series y trailer', () => {
        const g = Core.generarSsim(solicitudVB(), null, AHORA);
        expect(g.ok).toBe(true);
        const lineas = g.texto.replace(/\r\n$/, '').split('\r\n');
        expect(lineas.every((l) => l.length === 200)).toBe(true);
        expect(lineas.length % 5).toBe(0);
        const datos = lineas.filter((l) => !/^0+$/.test(l));
        datos.forEach((l, i) => expect(l.slice(194)).toBe(String(i + 1).padStart(6, '0')));
        const trailer = datos[datos.length - 1];
        expect(trailer.slice(0, 12)).toBe('5 VB 15OCT26');
        expect(trailer.slice(187, 194)).toBe(String(datos.length - 1).padStart(6, '0') + 'E');
        expect(g.nombre).toBe('VB_NLU_SOLICITUD_20261015.ssim');
    });

    test('"9212" es el vuelo 9212 de VB, no la aerolínea 92', () => {
        const t = tramos3(Core.generarSsim(solicitudVB(), null, AHORA).texto);
        expect(t[0].slice(0, 14)).toBe('3 VB 92120101J');
    });

    test('UTC: salida 22:57 llega al otro día y se marca la variación de fecha', () => {
        const t = tramos3(Core.generarSsim(solicitudVB(), null, AHORA).texto);
        const r9212 = t[0];
        expect(r9212.slice(14, 35)).toBe('15OCT2622OCT26   4   ');
        expect(r9212.slice(36, 75)).toBe('NLU22572257-0600  OAX00070007-0600  320');
        expect(r9212.slice(119, 121)).toBe('DD');
        expect(r9212.slice(192, 194)).toBe('01');
    });

    test('las variaciones de un mismo vuelo llevan IVI consecutivo por fecha', () => {
        const t = tramos3(Core.generarSsim(solicitudVB(), null, AHORA).texto);
        const ivis = t.filter((l) => l.slice(5, 9) === '9212').map((l) => l.slice(9, 11) + l.slice(14, 21));
        expect(ivis).toEqual(['0115OCT26', '0231OCT26']);
    });

    test('hora local: 02:02 UTC del sábado es 20:02 del viernes', () => {
        const sol = solicitudVB();
        sol.opciones.modoHora = 'L';
        const g = Core.generarSsim(sol, null, AHORA);
        const t = tramos3(g.texto).find((l) => l.slice(5, 11) === '921202');
        expect(g.texto.split('\r\n')[5].slice(0, 2)).toBe('2L');
        expect(t.slice(14, 35)).toBe('30OCT2630OCT26    5  ');
        expect(t.slice(36, 52)).toBe('NLU20022002-0600');
        expect(t.slice(192, 194)).toBe('  ');
    });

    test('llegada temprano en UTC: el tramo sale del origen el día anterior', () => {
        const sol = solicitudVB([llega('N', '9407', '0030', 'MTY', '5', '16/10/26', '23/10/26')]);
        const t = tramos3(Core.generarSsim(sol, null, AHORA).texto)[0];
        expect(t.slice(14, 35)).toBe('15OCT2622OCT26   4   ');
        expect(t.slice(36, 70)).toBe('MTY22552255-0600  NLU00300030-0600');
        expect(t.slice(192, 194)).toBe('01');
    });

    test('mismo número de llegada y salida: un vuelo con escala, dos tramos del mismo IVI', () => {
        const sol = solicitudVB([{
            mov: 'N', linea: 'VB', vueloLlega: '1234', vueloSale: '1234', equipo: 'A20N',
            horaLlega: '1500', horaSale: '1600', origen: 'OAX', destino: 'MTY',
            dias: '1357', desde: '19/10/26', hasta: '25/10/26', tipoLlega: 'J', tipoSale: 'J'
        }]);
        const t = tramos3(Core.generarSsim(sol, null, AHORA).texto);
        expect(t.map((l) => l.slice(5, 13) + ' ' + l.slice(36, 39) + '-' + l.slice(54, 57) + ' ' + l.slice(72, 75)))
            .toEqual(['12340101 OAX-NLU 32N', '12340102 NLU-MTY 32N']);
    });

    test('internacional: el estatus MCT es II', () => {
        const sol = solicitudVB([sale('N', '9300', '1500', 'BOG', '1', '19/10/26', '26/10/26')]);
        sol.bloques['NLU-BOG'] = 280;
        const t = tramos3(Core.generarSsim(sol, null, AHORA).texto)[0];
        expect(t.slice(47, 52)).toBe('-0600');
        expect(t.slice(65, 70)).toBe('-0500');
        expect(t.slice(119, 121)).toBe('II');
    });

    test('lo generado se puede volver a leer', () => {
        const g = Core.generarSsim(solicitudVB(), null, AHORA);
        const leidos = Core.leerSsim(g.texto);
        expect(leidos).toHaveLength(5);
        expect(leidos[0]).toMatchObject({ linea: 'VB', vuelo: '9212', ivi: '01', origen: 'NLU', destino: 'OAX', std: '2257', sta: '0007', varFecha: '01' });
    });
});

describe('lectura desde Excel', () => {
    test('pegar renglones con las 7 casillas de frecuencia', () => {
        const texto = [
            'C\tVB\t\t9212\tA320\t\t0313\t\tOAX\t_\t_\t_\t_\t5\t_\t_\t16/10/26\t23/10/26\t\tJ\t\t',
            'R\tVB\t\t9212\tA320\t\t2257\t\tOAX\t_\t_\t_\t4\t_\t_\t_\t15/10/26\t22/10/26\t\tJ\t\t',
            'R\tVB\t9215\t\tA320\t2257\t\tOAX\t\t_\t_\t_\t_\t5\t_\t_\t16/10/26\t23/10/26\tJ\t\t\tCambio H y N vlo'
        ].join('\r\n');
        const filas = Core.parsearPegado(texto);
        expect(filas).toHaveLength(3);
        expect(filas[1]).toMatchObject({ mov: 'R', vueloSale: '9212', horaSale: '2257', destino: 'OAX', dias: '4', desde: '2026-10-15', tipoSale: 'J' });
        expect(filas[2]).toMatchObject({ vueloLlega: '9215', horaLlega: '2257', origen: 'OAX', tipoLlega: 'J', obs: 'Cambio H y N vlo' });
    });

    test('hoja completa: encabezado por etiquetas y renglones por tipo de movimiento', () => {
        const hoja = [
            ['', 'COMITÉ DE OPERACIÓN Y HORARIOS'],
            ['Línea Aérea:', 'AEROENLACES NACIONALES S.A DE C.V', '', '', 'Fecha:', '', '09/10/2026'],
            ['Representante:', 'HECTOR PACHECO ESTRADA'],
            ['Teléfono Oficina:', '5534904925'],
            ['Tipo Movimiento (D, N, C, R)', 'Línea Aérea', 'No. de Vuelo'],
            ['', '', 'Llega', 'Sale', '', 'Llega', 'Sale', 'Origen', 'Destino'],
            ['C', 'VB', '', 9212, 'A320', '', '0313', '', 'OAX', '_', '_', '_', '_', 5, '_', '_', '16/10/26', '23/10/26', '', 'J']
        ];
        const r = Core.leerHoja(hoja);
        expect(r.encabezado).toMatchObject({ aerolinea: 'AEROENLACES NACIONALES S.A DE C.V', representante: 'HECTOR PACHECO ESTRADA', telOficina: '5534904925', fecha: '2026-10-09' });
        expect(r.filas).toHaveLength(1);
        expect(r.filas[0]).toMatchObject({ mov: 'C', vueloSale: '9212', dias: '5', hasta: '2026-10-23' });
    });
});
