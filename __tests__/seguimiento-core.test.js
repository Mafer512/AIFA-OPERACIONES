/**
 * Seguimiento · reglas sin interfaz (js/seguimiento-core.js).
 *
 * Lo que de verdad importa que no falle en silencio: qué cuenta como vencido
 * y por vencer, cuándo vence la siguiente renovación, qué se esconde con los
 * filtros, los indicadores de cumplimiento y el mensaje que le llega al
 * responsable por WhatsApp.
 */
const C = require('../js/seguimiento-core');

const HOY = '2026-10-08';
const tarea = (o = {}) => Object.assign({
    id: 't1', folio: 12, titulo: 'Antena SENEAM', tipo: 'orden', subdireccion: 'SSO', estatus: 'pendiente',
    prioridad: 'alta', fecha_limite: '2026-10-20', aviso_dias: 7, recurrencia: 'ninguna', checklist: [], etiquetas: [],
}, o);

describe('fechas', () => {
    test('sumar meses no se desborda al mes siguiente', () => {
        expect(C.sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
        expect(C.sumarMeses('2028-01-31', 1)).toBe('2028-02-29');
        expect(C.sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
        expect(C.sumarMeses('2026-05-28', 12)).toBe('2027-05-28');
    });

    test('días entre fechas, en días calendario', () => {
        expect(C.diasEntre('2026-10-08', '2026-10-20')).toBe(12);
        expect(C.diasEntre('2026-10-08', '2026-10-01')).toBe(-7);
        // Cambio de horario de invierno (25 oct): sigue siendo un día por día.
        expect(C.diasEntre('2026-10-24', '2026-10-26')).toBe(2);
        expect(C.diasEntre('2026-10-08', null)).toBeNull();
    });

    test('formatos para la gente', () => {
        expect(C.fechaCorta('2026-05-28')).toBe('28 may 26');
        expect(C.fechaLarga('2026-05-28')).toBe('28 de mayo de 2026');
        expect(C.relativo('2026-10-09', HOY)).toBe('mañana');
        expect(C.relativo('2026-10-05', HOY)).toBe('hace 3 días');
        expect(C.relativo(HOY, HOY)).toBe('hoy');
    });

    test('una fecha imposible no es fecha', () => {
        expect(C.deISO('2026-02-31')).toBeNull();
        expect(C.deISO('')).toBeNull();
    });
});

describe('situación de una tarea', () => {
    test.each([
        ['2026-10-01', 'vencida'],
        [HOY, 'vence_hoy'],
        ['2026-10-15', 'por_vencer'],   // a 7 días: dentro del aviso
        ['2026-10-16', 'a_tiempo'],     // a 8 días: fuera del aviso
        [null, 'sin_fecha'],
    ])('fecha límite %s → %s', (limite, esperado) => {
        expect(C.situacion(tarea({ fecha_limite: limite }), HOY)).toBe(esperado);
    });

    test('el aviso es el de cada tarea: un certificado avisa con 60 días', () => {
        expect(C.situacion(tarea({ fecha_limite: '2026-12-01', aviso_dias: 60 }), HOY)).toBe('por_vencer');
        expect(C.situacion(tarea({ fecha_limite: '2026-12-01', aviso_dias: 7 }), HOY)).toBe('a_tiempo');
    });

    test('lo cerrado ya no vence', () => {
        expect(C.situacion(tarea({ fecha_limite: '2026-01-01', estatus: 'completada' }), HOY)).toBe('completada');
        expect(C.situacion(tarea({ fecha_limite: '2026-01-01', estatus: 'cancelada' }), HOY)).toBe('cancelada');
    });

    test('a tiempo si se cerró a más tardar el día límite', () => {
        expect(C.completadaATiempo(tarea({ estatus: 'completada', fecha_limite: '2026-10-08', completada_en: '2026-10-08T22:00:00' }))).toBe(true);
        expect(C.completadaATiempo(tarea({ estatus: 'completada', fecha_limite: '2026-10-08', completada_en: '2026-10-09T09:00:00' }))).toBe(false);
        expect(C.completadaATiempo(tarea({ estatus: 'pendiente' }))).toBeNull();
    });
});

describe('renovaciones', () => {
    test('la siguiente se cuenta desde la fecha límite anterior, no desde el cierre', () => {
        const cert = tarea({ id: 'a', tipo: 'certificado', recurrencia: 'anual', fecha_inicio: '2026-04-28', fecha_limite: '2026-05-28',
            estatus: 'completada', completada_en: '2026-06-10T10:00:00', checklist: [{ id: 'x', texto: 'Pagar derechos', hecho: true }] });
        const sig = C.siguienteOcurrencia(cert);
        expect(sig.fecha_limite).toBe('2027-05-28');
        expect(sig.fecha_inicio).toBe('2027-04-28');   // conserva la duración de 30 días
        expect(sig.estatus).toBe('pendiente');
        expect(sig.checklist).toEqual([{ id: 'x', texto: 'Pagar derechos', hecho: false }]);
        expect(sig.tarea_origen).toBe('a');
        expect(sig).not.toHaveProperty('id');
        expect(sig).not.toHaveProperty('siguiente_id');
    });

    test('la cadena conserva la primera tarea como origen', () => {
        expect(C.siguienteOcurrencia(tarea({ id: 'b', recurrencia: 'semestral', tarea_origen: 'a' })).tarea_origen).toBe('a');
    });

    test('repetición personalizada: cada 18 meses, cada 3 años', () => {
        const t = tarea({ id: 'c', recurrencia: 'personalizada', recurrencia_meses: 18, fecha_limite: '2026-12-31' });
        expect(C.nombreRecurrencia(t)).toBe('Cada 18 meses');
        const sig = C.siguienteOcurrencia(t);
        expect(sig.fecha_limite).toBe('2028-06-30');
        expect(sig).toMatchObject({ recurrencia: 'personalizada', recurrencia_meses: 18 });
        expect(C.textoCada(36)).toBe('Cada 3 años');
        expect(C.textoCada(12)).toBe('Cada año');
        expect(C.textoCada(1)).toBe('Cada mes');
        // Si coincide con una opción fija se guarda como esa; si no, personalizada.
        expect(C.recurrenciaDeMeses(24)).toEqual({ recurrencia: 'bienal', recurrencia_meses: null });
        expect(C.recurrenciaDeMeses(36)).toEqual({ recurrencia: 'personalizada', recurrencia_meses: 36 });
        // Un valor fuera de rango no programa nada.
        expect(C.mesesRecurrencia(tarea({ recurrencia: 'personalizada', recurrencia_meses: 0 }))).toBe(0);
        expect(C.mesesRecurrencia(tarea({ recurrencia: 'personalizada', recurrencia_meses: 999 }))).toBe(0);
    });

    test('sin recurrencia o sin fecha no hay siguiente', () => {
        expect(C.siguienteOcurrencia(tarea())).toBeNull();
        expect(C.siguienteOcurrencia(tarea({ recurrencia: 'anual', fecha_limite: null }))).toBeNull();
    });
});

describe('filtros, orden y grupos', () => {
    const lista = [
        tarea({ id: '1', titulo: 'Licencia de radiocomunicación', subdireccion: 'SSO', fecha_limite: '2026-10-01', responsable: 'Luis García' }),
        tarea({ id: '2', titulo: 'Mantenimiento de subestación', subdireccion: 'SGE', fecha_limite: '2026-11-30', prioridad: 'urgente' }),
        tarea({ id: '3', titulo: 'Informe mensual', subdireccion: 'SSO', estatus: 'completada', fecha_limite: '2026-09-30' }),
        tarea({ id: '4', titulo: 'Póliza de seguro', subdireccion: 'SSC', fecha_limite: null, etiquetas: ['contratos'] }),
    ];

    test('sin "ver cerradas" se esconden las completadas', () => {
        expect(C.filtrar(lista, {}, HOY).map(t => t.id)).toEqual(['1', '2', '4']);
        expect(C.filtrar(lista, { verCerradas: true }, HOY)).toHaveLength(4);
        // Pedir el estatus completada explícitamente también las muestra.
        expect(C.filtrar(lista, { estatus: ['completada'] }, HOY).map(t => t.id)).toEqual(['3']);
    });

    test('la búsqueda ignora acentos y busca en responsable, folio y etiquetas', () => {
        expect(C.filtrar(lista, { texto: 'radiocomunicacion' }, HOY).map(t => t.id)).toEqual(['1']);
        expect(C.filtrar(lista, { texto: 'garcia' }, HOY).map(t => t.id)).toEqual(['1']);
        expect(C.filtrar(lista, { texto: 'contratos' }, HOY).map(t => t.id)).toEqual(['4']);
        expect(C.filtrar(lista, { texto: 'SEG-0012' }, HOY)).toHaveLength(3);
    });

    test('filtrar por situación: "por vencer" incluye las que vencen hoy', () => {
        const l = [tarea({ id: 'h', fecha_limite: HOY }), tarea({ id: 'p', fecha_limite: '2026-10-12' }), tarea({ id: 'v', fecha_limite: '2026-10-01' })];
        expect(C.filtrar(l, { situacion: 'por_vencer' }, HOY).map(t => t.id)).toEqual(['h', 'p']);
        expect(C.filtrar(l, { situacion: 'vencida' }, HOY).map(t => t.id)).toEqual(['v']);
    });

    test('por fecha límite: abiertas primero y las sin fecha al final', () => {
        expect(C.ordenar(lista, 'fecha_limite', true).map(t => t.id)).toEqual(['1', '2', '4', '3']);
    });

    test('por subdirección salen todas, aunque estén vacías, para poder agregarles', () => {
        const g = C.agrupar(C.filtrar(lista, {}, HOY), 'subdireccion', HOY);
        expect(g.map(x => x.clave)).toEqual(['SSO', 'SSA', 'SSC', 'SI', 'SGE', 'DO']);
        expect(g.find(x => x.clave === 'SSO').tareas.map(t => t.id)).toEqual(['1']);
        expect(g.find(x => x.clave === 'SSA').tareas).toEqual([]);
    });

    test('por responsable, "Sin responsable" va al final', () => {
        const g = C.agrupar(lista, 'responsable', HOY);
        expect(g[g.length - 1].nombre).toBe('Sin responsable');
        expect(g[0].nombre).toBe('Luis García');
    });
});

describe('indicadores', () => {
    test('cuenta abiertas, vencidas, por vencer y cumplimiento a tiempo', () => {
        const s = C.estadisticas([
            tarea({ fecha_limite: '2026-10-01' }),                                  // vencida
            tarea({ fecha_limite: '2026-10-10', estatus: 'en_proceso' }),           // por vencer
            tarea({ estatus: 'completada', fecha_limite: '2026-10-05', completada_en: '2026-10-04T10:00:00' }),
            tarea({ estatus: 'completada', fecha_limite: '2026-09-05', completada_en: '2026-09-20T10:00:00' }),
            tarea({ estatus: 'cancelada' }),                                         // no cuenta
        ], HOY);
        expect(s).toMatchObject({ total: 4, abiertas: 2, pendientes: 1, en_proceso: 1, vencidas: 1, por_vencer: 1, completadas: 2, completadas_mes: 1 });
        expect(s.cumplimiento).toBe(50);
        expect(s.avance).toBe(50);
    });

    test('sin cierres con fecha, el cumplimiento queda pendiente y no en 0%', () => {
        expect(C.estadisticas([tarea()], HOY).cumplimiento).toBeNull();
    });
});

describe('WhatsApp', () => {
    test.each([
        ['55 3981 5561', '525539815561'],
        ['+52 1 55 3981 5561', '525539815561'],
        ['(55) 3981-5561', '525539815561'],
        ['123', ''],
        ['', ''],
    ])('%s → %s', (raw, esperado) => {
        expect(C.telefonoWhatsApp(raw)).toBe(esperado);
    });

    test('el mensaje dice qué, de quién, para cuándo y qué falta', () => {
        const t = tarea({ responsable: 'Luis García Pérez', fecha_limite: '2026-10-01', referencia: 'AIFA/DO/0742/2026',
            checklist: [{ id: '1', texto: 'Cotización', hecho: true }, { id: '2', texto: 'Oficio de solicitud', hecho: false }] });
        const m = C.mensajeWhatsApp(t, HOY, 'Isaac López');
        expect(m).toContain('Hola Luis,');
        expect(m).toContain('*Antena SENEAM* (SEG-0012)');
        expect(m).toContain('Subdirección de Seguridad Operacional');
        expect(m).toContain('1 de octubre de 2026 (venció hace 7 días)');
        expect(m).toContain('Oficio de solicitud');
        expect(m).not.toContain('Cotización');
        expect(m).toContain('nueva fecha de cumplimiento');
        expect(m).toContain('— Isaac López');
    });

    test('el enlace lleva el número y el texto codificado', () => {
        const url = C.urlWhatsApp(tarea({ responsable_tel: '55 1234 5678' }), HOY, 'X');
        expect(url.startsWith('https://wa.me/525512345678?text=')).toBe(true);
        expect(decodeURIComponent(url.split('?text=')[1])).toContain('Antena SENEAM');
    });
});

describe('detalles', () => {
    test('iniciales: nombre y primer apellido', () => {
        expect(C.iniciales('Gonzalo Sandoval González')).toBe('GS');
        expect(C.iniciales('Isaac Azhael López Cancino')).toBe('IL');
        expect(C.iniciales('Luis García')).toBe('LG');
        expect(C.iniciales('isaac.lopez@aifa.operaciones')).toBe('IL');
        expect(C.iniciales('')).toBe('?');
    });

    test('etiquetas sin repetidas ni vacías', () => {
        expect(C.etiquetasDeTexto('contratos, #SENEAM, Contratos, , radio')).toEqual(['contratos', 'SENEAM', 'radio']);
    });

    test('la bitácora sólo registra lo que cambió', () => {
        expect(C.cambios({ estatus: 'pendiente', prioridad: 'alta' }, { estatus: 'completada', prioridad: 'alta' }))
            .toEqual([{ campo: 'estatus', de: 'pendiente', a: 'completada' }]);
        expect(C.etiquetaValor('estatus', 'en_revision')).toBe('En revisión');
    });

    test('el folio se lee igual en todos lados', () => {
        expect(C.folio(7)).toBe('SEG-0007');
    });

    test('los nombres de evidencia siempre pasan la política del bucket', () => {
        // db/create_seguimiento.sql: <uuid>/[A-Za-z0-9_-]{6,64}.(pdf|jpg|png)
        const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'db', 'create_seguimiento.sql'), 'utf8');
        expect(sql).toContain("'^[0-9a-f-]{36}/[A-Za-z0-9_-]{6,64}\\.(pdf|jpg|png)$'");
        const re = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{6,64}\.(pdf|jpg|png)$/;
        for (let i = 0; i < 500; i++) {
            expect(re.test('3f2b8c1e-0000-4000-8000-1234567890ab/' + C.idCorto() + '.pdf')).toBe(true);
        }
    });
});
