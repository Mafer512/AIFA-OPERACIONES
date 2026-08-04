const fs = require('fs');
const path = require('path');
const policy = require('../js/colaboradores-directory-policy');

const TODAY = '2026-08-04';
const active = overrides => ({
    num: '100',
    nombre: 'Persona Activa',
    estatus: 'Activo',
    fecha_baja: '',
    sexo: 'Masculino',
    comisionado: '0',
    direccion_comisionado: '',
    subdireccion_comisionado: '',
    gerencia_comisionado: '',
    coordinacion_comisionado: '',
    curp: '',
    rfc: '',
    ...overrides,
});

describe('política del Resumen del Directorio', () => {
    test('incluye una persona activa real', () => {
        const result = policy.buildUniverse([active()], { today: TODAY });
        expect(result.summary.total).toBe(1);
        expect(result.summary.excluded.total).toBe(0);
    });

    test('excluye una baja sin eliminar el registro fuente', () => {
        const record = active({ estatus: 'Baja' });
        const result = policy.buildUniverse([record], { today: TODAY });
        expect(result.summary.total).toBe(0);
        expect(result.summary.excluded.terminated).toBe(1);
        expect(result.excluded[0].record).toBe(record);
    });

    test('clasifica una VACANTE como vacante antes que como baja', () => {
        const result = policy.buildUniverse([
            active({ num: '', nombre: 'VACANTE 12', estatus: 'Baja', sexo: '' }),
        ], { today: TODAY });
        expect(result.summary.excluded.vacancy).toBe(1);
        expect(result.summary.excluded.terminated).toBe(0);
    });

    test('excluye únicamente una comisión marcada explícitamente fuera', () => {
        const result = policy.buildUniverse([
            active({ comisionado: 'Comisionado fuera del área' }),
        ], { today: TODAY });
        expect(result.summary.excluded.commissionedOut).toBe(1);
    });

    test('excluye una comisión de Operación hacia otra dirección', () => {
        const result = policy.buildUniverse([
            active({ comisionado: '1', direccion_comisionado: 'Dirección de Administración' }),
        ], { today: TODAY });
        expect(result.summary.excluded.commissionedOut).toBe(1);
    });

    test('incluye una comisión interna expresada con el indicador 1', () => {
        const result = policy.buildUniverse([
            active({ comisionado: '1', direccion_comisionado: 'Dirección de Operación' }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(1);
        expect(result.summary.excluded.commissionedOut).toBe(0);
    });

    test('no excluye una comisión sin destino verificable', () => {
        const result = policy.buildUniverse([
            active({ comisionado: '1', direccion_comisionado: '0' }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(1);
    });

    test('incluye personal externo comisionado hacia el área', () => {
        const result = policy.buildUniverse([
            active({
                num: '',
                curp: 'AABC900101HDFRRL01',
                comisionado: '1',
                direccion_comisionado: 'Dir. Opn.',
            }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(1);
    });

    test('excluye un registro sin estatus bajo la regla estricta de activo', () => {
        const result = policy.buildUniverse([active({ estatus: '' })], { today: TODAY });
        expect(result.summary.total).toBe(0);
        expect(result.summary.excluded.other).toBe(1);
        expect(result.excluded[0].detail).toBe('registro sin estatus');
    });

    test('elimina duplicados activos por número de empleado', () => {
        const result = policy.buildUniverse([
            active({ num: '12-2´', nombre: 'Primera versión' }),
            active({ num: '12-2', nombre: 'Versión duplicada' }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(1);
        expect(result.summary.excluded.duplicate).toBe(1);
    });

    test('mantiene activo a quien tiene una fecha de baja futura', () => {
        const result = policy.buildUniverse([
            active({ fecha_baja: '8/5/26' }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(1);
    });

    test('excluye un estatus activo con fecha de baja ya cumplida', () => {
        const result = policy.buildUniverse([
            active({ fecha_baja: '8/3/26' }),
        ], { today: TODAY });
        expect(result.summary.total).toBe(0);
        expect(result.summary.excluded.terminated).toBe(1);
    });

    test('hombres y mujeres se cuentan sólo dentro del mismo universo activo', () => {
        const result = policy.buildUniverse([
            active({ num: '1', sexo: 'Masculino' }),
            active({ num: '2', sexo: 'Femenino' }),
            active({ num: '3', sexo: '', nombre: 'Sin sexo definido' }),
            active({ num: '4', sexo: 'Femenino', estatus: 'Baja' }),
            active({ num: '', nombre: 'VACANTE', estatus: 'Baja', sexo: 'Masculino' }),
        ], { today: TODAY });
        expect(result.summary).toMatchObject({ total: 3, men: 1, women: 1, genderOther: 1 });
        expect(result.summary.men + result.summary.women + result.summary.genderOther).toBe(result.summary.total);
    });

    test('la integración del dashboard utiliza la política central y conserva el histórico completo', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        expect(html).toContain('js/colaboradores-directory-policy.js?v=20260804');
        expect(html).toContain('const universe = colabObtenerUniversoDirectorio();');
        expect(html).toContain('const data = universe.included;');
        expect(html).toContain('var masc = universe.summary.men;');
        expect(html).toContain('var fem  = universe.summary.women;');
        expect(html).toContain('allRecords: true');
        expect(html).toContain('window.colabAuditarResumenDirectorio');
    });
});
