/**
 * @jest-environment jsdom
 *
 * El Resumen Estadístico es el SEGUNDO documento de la pestaña "Estadística" y
 * no comparte formato con el Informe: hoja carta, 17 páginas y varias secciones
 * que todavía no tienen origen de datos en el sistema. Estas pruebas fijan
 * justo eso: que las hojas estén completas, que lo que sí tiene fuente cuadre,
 * y que lo que no la tiene salga MARCADO y con "—" en vez de ceros.
 */

const Resumen = require('../js/resumen-estadistico');
const Core = require('../js/estadistico-informe-core');

const corte = { anio: 2026, mes: 8, dia: 11 };

// Cifra mensual oficial recortada a lo indispensable: 2022 y 2026 para poder
// comprobar el acumulado corrido entre años.
const monthlyOpsRows = [
    { year: 2022, month: 3, comercial_ops: 138, comercial_pax: 14225, general_ops: 34, general_pax: 51, carga_ops: 2, carga_tons: 0.49 },
    { year: 2022, month: 4, comercial_ops: 356, comercial_pax: 35593, general_ops: 24, general_pax: 54, carga_ops: 0, carga_tons: 0 },
    { year: 2026, month: 1, comercial_ops: 4643, comercial_pax: 601184, general_ops: 194, general_pax: 549, carga_ops: 1035, carga_tons: 31579.77 },
    { year: 2026, month: 8, comercial_ops: 1881, comercial_pax: 227269, general_ops: 61, general_pax: 154, carga_ops: 303, carga_tons: 5337.93 }
];

function construirDatos(extra) {
    const aggregated = Core.mergeOficiales(Core.aggregateResumen([]), monthlyOpsRows, []);
    return Object.assign({
        acumulado: Core.buildAcumulado(aggregated),
        aggregated,
        anios: aggregated.anios.slice(),
        corte,
        diaCorte: Core.aggregateDiaCorte([]),
        promedioMes: {},
        ocupacion: { rows: [], promedioGeneral: null },
        ocupacionDesdeTexto: '28 de julio de 2026',
        ocupacionHastaTexto: '11 de agosto de 2026',
        aerolineasPorAnio: new Map(),
        fauna: null,
        puntosConexionHtml: '<div>puntos</div>',
        cargaNacional: null,
        cargaInternacional: null
    }, extra || {});
}

function render(datos) {
    document.body.innerHTML = Resumen.buildHtml(datos);
    return document.body;
}

describe('Resumen Estadístico', () => {
    test('el documento sale en hoja CARTA — el Informe Estadístico va en oficio, son formatos distintos', () => {
        expect(Resumen.PAGINA.formato).toBe('letter');
    });

    test('arma las 17 hojas del documento original', () => {
        const dom = render(construirDatos());
        expect(dom.querySelectorAll('.resumen-hoja')).toHaveLength(17);
    });

    test('el acumulado por año es CORRIDO: cada año arrastra los anteriores', () => {
        const dom = render(construirDatos());
        const texto = dom.querySelector('.resumen-hoja').textContent;
        // 2022 cierra con 494 operaciones comerciales (138 + 356) y 2026 con
        // 6,524 (4,643 + 1,881); el acumulado del año en curso debe ser la suma.
        expect(texto).toContain('494');
        expect(texto).toContain('6,524');
        expect(texto).toContain('7,018');   // 494 + 6,524
    });

    test('la columna del año en curso se rotula "CIFRA AL" con la fecha de corte', () => {
        const dom = render(construirDatos());
        expect(dom.querySelector('.resumen-hoja').textContent).toContain('CIFRA AL');
        expect(dom.querySelector('.resumen-hoja').innerHTML).toContain('11/08/2026');
    });

    // Lo que el área pidió explícitamente: conservar las hojas aunque no haya
    // datos, pero que se vea que están pendientes. Una tabla en blanco sin
    // marca se lee como "cero".
    test('las secciones sin origen de datos van marcadas y con "—", nunca con ceros', () => {
        const dom = render(construirDatos());
        const marcadas = [...dom.querySelectorAll('.resumen-hoja')]
            .filter((h) => h.textContent.includes('PENDIENTE DE CAPTURA'));
        expect(marcadas.length).toBeGreaterThanOrEqual(11);
        marcadas.forEach((hoja) => {
            expect(hoja.textContent).toContain('Requiere:');
            expect(hoja.textContent).toContain('—');
        });
    });

    test('cada sección pendiente dice qué fuente le hace falta', () => {
        const dom = render(construirDatos());
        const texto = dom.textContent;
        ['Aduana No. 50', 'pedimentos', 'encuesta de satisfacción', 'boletas', 'ingresos facturados']
            .forEach((pista) => expect(texto.toLowerCase()).toContain(pista.toLowerCase()));
    });

    test('la participación por aerolínea reparte porcentajes sobre el total del año', () => {
        const porAnio = new Map([[2025, [
            { aerolinea: 'VIVA AEROBUS', ops: 30, pax: 3000 },
            { aerolinea: 'VOLARIS', ops: 10, pax: 1000 }
        ]]]);
        const dom = render(construirDatos({ aerolineasPorAnio: porAnio }));
        const hoja = [...dom.querySelectorAll('.resumen-hoja')]
            .find((h) => h.textContent.includes('PARTICIPACIÓN POR AEROLÍNEA'));
        expect(hoja.textContent).toContain('75.00%');
        expect(hoja.textContent).toContain('25.00%');
        expect(hoja.textContent).toContain('100.00%');
    });

    test('el control de fauna suma las capturas del año por clase', () => {
        const porMes = Core.MONTHS.map(() => ({ mamifero: 0, reptil: 0, ave: 0 }));
        porMes[0] = { mamifero: 6, reptil: 1, ave: 3 };
        porMes[2] = { mamifero: 18, reptil: 0, ave: 3 };
        const dom = render(construirDatos({
            fauna: { porMes, totales: { mamifero: 24, reptil: 1, ave: 6 }, acumulado: 428 }
        }));
        const hoja = [...dom.querySelectorAll('.resumen-hoja')]
            .find((h) => h.textContent.includes('CONTROL DE FAUNA'));
        expect(hoja.textContent).toContain('24');
        expect(hoja.textContent).toContain('31');   // total del año: 24 + 1 + 6
        expect(hoja.textContent).toContain('428');  // acumulado histórico
    });

    test('sin capturas de fauna la tabla queda marcada, no en cero', () => {
        const dom = render(construirDatos({ fauna: null }));
        const hoja = [...dom.querySelectorAll('.resumen-hoja')]
            .find((h) => h.textContent.includes('CONTROL DE FAUNA'));
        expect(hoja.textContent).toContain('—');
        expect(hoja.querySelector('td')).not.toBeNull();
    });

    test('el bloque de puntos de conexión se reutiliza tal cual del Informe Estadístico', () => {
        const dom = render(construirDatos({ puntosConexionHtml: '<div id="marca-puntos">tabla</div>' }));
        expect(dom.querySelector('#marca-puntos')).not.toBeNull();
    });

    test('las toneladas llevan siempre dos decimales', () => {
        const dom = render(construirDatos());
        // El total anual en la hoja 1 y el detalle mensual en la hoja 2.
        expect(dom.querySelector('.resumen-hoja').textContent).toMatch(/36,917\.70/);
        expect(dom.textContent).toMatch(/31,579\.77/);
        expect(dom.querySelector('.resumen-hoja').textContent).toMatch(/0\.49/);
    });
});
