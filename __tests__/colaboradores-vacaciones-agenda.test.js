/**
 * El historial de vacaciones de la Agenda se importa a agenda_2026.vacaciones
 * con días exactos, tipo (permiso a cuenta, sin goce, medio militar) y los
 * datos del trámite. Aquí se cubre lo que la ficha hace con eso: qué descuenta
 * de los 20 días, qué días pinta el calendario y qué años se pueden consultar.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function trozo(desde, hasta) {
    const i = app.indexOf(desde);
    if (i < 0) throw new Error('No se encontró: ' + desde);
    const j = app.indexOf(hasta, i + desde.length);
    return app.slice(i, j);
}

function cargarHelpers() {
    const helpers = trozo('const VAC_ANIO_MIN', '/** Lee el array vacaciones');
    const esc = trozo('function _vacEsc(s)', '\n');
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', `${helpers}\n${esc}\nmodule.exports = { VAC_ANIO_MIN, _vacCuenta, _vacDiasDe, _vacTituloPeriodo, _vacDetalleAgenda };`)(mod);
    return mod.exports;
}

const h = cargarHelpers();

describe('qué descuenta de los 20 días', () => {
    test('vacaciones y permisos a cuenta sí; cancelados, sin goce y medio militar no', () => {
        expect(h._vacCuenta({ estado: 'disfrutado', tipo: 'vacaciones', computa: true })).toBe(true);
        expect(h._vacCuenta({ estado: 'programado', tipo: 'permiso_a_cuenta', computa: true })).toBe(true);
        expect(h._vacCuenta({ estado: 'cancelado', computa: true })).toBe(false);
        expect(h._vacCuenta({ estado: 'disfrutado', tipo: 'medio_militar', computa: false })).toBe(false);
        expect(h._vacCuenta({ estado: 'disfrutado', tipo: 'permiso_sin_goce', computa: false })).toBe(false);
    });

    test('los períodos capturados a mano (sin computa) siguen contando', () => {
        expect(h._vacCuenta({ estado: 'programado', fecha_inicio: '2026-01-05' })).toBe(true);
    });

    test('todas las sumas de días usan la misma regla', () => {
        const bloque = trozo('VACACIONES DE COLABORADORES', 'window.vacCalAbrir      = vacCalAbrir;');
        expect(bloque).not.toMatch(/filter\(r => r\.estado !== 'cancelado' && r\.fecha_inicio >= anivInfo/);
        expect((bloque.match(/_vacCuenta\(r\) && r\.fecha_inicio >= anivInfo\.isoIni/g) || []).length).toBe(3);
    });
});

describe('días exactos en el calendario', () => {
    test('usa la lista de la Agenda cuando existe (días salteados)', () => {
        const r = { fecha_inicio: '2025-04-28', fecha_fin: '2025-05-05', dias: ['2025-04-28', '2025-04-29', '2025-04-30', '2025-05-02', '2025-05-05'] };
        expect(h._vacDiasDe(r)).toEqual(r.dias);
    });

    test('sin lista, pinta el rango completo, aun cruzando de año', () => {
        expect(h._vacDiasDe({ fecha_inicio: '2023-12-30', fecha_fin: '2024-01-02' }))
            .toEqual(['2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02']);
    });

    test('la vista toma los días de _vacDiasDe e incluye períodos que cruzan de año', () => {
        const filtrar = trozo('function vacCalFiltrar()', 'function vacCalModo');
        expect(filtrar).toMatch(/r\.fecha_inicio <= fin && r\.fecha_fin >= ini/);
        const carga = trozo('async function vacCalCargar', 'function _vacLlenarAreas');
        expect(carga).toMatch(/_dias: _vacDiasDe\(v\)/);
    });
});

describe('años consultables', () => {
    test('arrancan en 2022, donde empieza la Agenda', () => {
        expect(h.VAC_ANIO_MIN).toBe(2022);
        const html = trozo('id="vac-cal-anio-filter"', '</select>');
        expect(html).not.toMatch(/<option value="20\d\d"/);
    });
});

describe('tarjeta del período', () => {
    test('muestra el tipo cuando no es vacación normal y el trámite de la Agenda', () => {
        const html = h._vacDetalleAgenda({
            tipo: 'medio_militar',
            agenda: { tipo_solicitud: 'Solicitud individual de vacaciones', fecha_solicitud: '7/11/25', no_oficio: '1234', fecha_oficio: '10/11/2025', periodo: '14,18 Nov. 2025' },
        });
        expect(html).toContain('Medio militar');
        expect(html).toContain('Oficio 1234 · 10/11/2025');
        expect(html).toContain('Agenda: 14,18 Nov. 2025');
    });

    test('escapa el texto que viene de la hoja', () => {
        const html = h._vacDetalleAgenda({ agenda: { periodo: '<b>x</b>' } });
        expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });

    test('un período capturado a mano se ve igual que antes', () => {
        expect(h._vacDetalleAgenda({ estado: 'programado' })).toBe('');
        expect(h._vacTituloPeriodo({ periodo_num: 3 })).toBe('Período 3');
    });
});
