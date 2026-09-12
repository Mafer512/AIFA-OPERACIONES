/**
 * Núcleo del módulo de Aviación General / FBO.
 *
 * Lo que se prueba aquí no son utilidades genéricas: son las decisiones que
 * separan un histórico confiable de uno que parece bien y está mal.
 *
 *   · "NA" en una hora es AUSENCIA DE DATO, no medianoche. Si se colara como
 *     00:00, cualquier cálculo de puntualidad que se haga después sobre este
 *     histórico saldría con un pico de vuelos a las doce de la noche que nadie
 *     sabría explicar.
 *   · Una fecha de Excel no puede corrimiento de un día. Armarla con
 *     toISOString() lo provoca en México a partir de las 18:00, y el error es
 *     invisible: las fechas siguen pareciendo fechas.
 *   · pax_ag es columna GENERADA en PostgreSQL. Si el payload la incluye,
 *     Postgres rechaza el INSERT completo — no la ignora.
 *   · El hash identifica al MOVIMIENTO, no al renglón del archivo. De eso
 *     depende que reimportar el mismo Excel no duplique el histórico.
 */

const Core = require('../js/aviacion-general/core.js');

describe('horas', () => {
    test('los vacíos del Excel se convierten en NULL, nunca en medianoche', () => {
        ['NA', 'N/A', '-', '--', '', '   ', 'SIN DATO', '#N/A', null, undefined]
            .forEach((valor) => {
                expect(Core.normalizarHora(valor)).toBeNull();
            });
        // Medianoche de verdad sí se conserva: es un dato, no una ausencia.
        expect(Core.normalizarHora('00:00')).toBe('00:00:00');
    });

    test('interpreta la fracción nativa de Excel', () => {
        expect(Core.normalizarHora(0.354166666666667)).toBe('08:30:00');
        expect(Core.normalizarHora(0.5)).toBe('12:00:00');
        // Una celda que arrastra fecha viene como 1.xx: sólo importa el decimal.
        expect(Core.normalizarHora(1.5)).toBe('12:00:00');
        // Un entero suelto no es una hora.
        expect(Core.normalizarHora(3)).toBeNull();
    });

    test('acepta los formatos con que se anota a mano', () => {
        expect(Core.normalizarHora('8:30')).toBe('08:30:00');
        expect(Core.normalizarHora('08:30:45')).toBe('08:30:45');
        expect(Core.normalizarHora('0830')).toBe('08:30:00');
        expect(Core.normalizarHora('830')).toBe('08:30:00');
        expect(Core.normalizarHora('8:30 PM')).toBe('20:30:00');
        expect(Core.normalizarHora('12:15 AM')).toBe('00:15:00');
    });

    test('rechaza horas imposibles en vez de recortarlas', () => {
        expect(Core.normalizarHora('25:00')).toBeNull();
        expect(Core.normalizarHora('10:75')).toBeNull();
    });

    test('un objeto Date (lo que entrega SheetJS) se lee en horario local', () => {
        expect(Core.normalizarHora(new Date(2026, 2, 15, 7, 5, 0))).toBe('07:05:00');
    });
});

describe('fechas', () => {
    test('la serie de Excel no se corre un día', () => {
        // 45000 = 2023-03-15. El error clásico es que salga el 14.
        expect(Core.normalizarFecha(45000)).toBe('2023-03-15');
    });

    test('un Date tardío no salta al día siguiente por convertirse a UTC', () => {
        // 23:30 hora local: con toISOString() esto se volvería el día 16.
        expect(Core.normalizarFecha(new Date(2026, 2, 15, 23, 30))).toBe('2026-03-15');
    });

    test('día primero, que es como se capturan las bitácoras', () => {
        expect(Core.normalizarFecha('03/04/2026')).toBe('2026-04-03');
        expect(Core.normalizarFecha('3-4-2026')).toBe('2026-04-03');
        expect(Core.normalizarFecha('2026-04-03')).toBe('2026-04-03');
    });

    test('una fecha que no existe se rechaza, no se ajusta al mes siguiente', () => {
        expect(Core.normalizarFecha('31/02/2026')).toBeNull();
        expect(Core.normalizarFecha('NA')).toBeNull();
        expect(Core.normalizarFecha('')).toBeNull();
    });
});

describe('matrícula', () => {
    test('se guarda como texto aunque el Excel la traiga numérica', () => {
        expect(Core.normalizarMatricula(1234)).toBe('1234');
    });

    test('la misma aeronave escrita con prisa es la misma aeronave', () => {
        expect(Core.normalizarMatricula(' xa-mam ')).toBe('XA-MAM');
        expect(Core.normalizarMatricula('XA MAM')).toBe('XAMAM');
    });

    test('los vacíos no se convierten en la cadena "NA"', () => {
        expect(Core.normalizarMatricula('NA')).toBe('');
        expect(Core.normalizarMatricula('-')).toBe('');
    });
});

describe('catálogos con sinónimos', () => {
    test('reconoce cómo se escribe en las bitácoras', () => {
        ['LLEGADA', 'llegada', 'ARRIBO', 'LLEG', 'L'].forEach((v) => {
            expect(Core.normalizarTipoOperacion(v)).toBe('LLEGADA');
        });
        ['SALIDA', 'sal', 'DESPEGUE', 'S'].forEach((v) => {
            expect(Core.normalizarTipoOperacion(v)).toBe('SALIDA');
        });
        ['NACIONAL', 'nal', 'N'].forEach((v) => {
            expect(Core.normalizarAmbito(v)).toBe('NACIONAL');
        });
        ['INTERNACIONAL', 'INT', 'intl'].forEach((v) => {
            expect(Core.normalizarAmbito(v)).toBe('INTERNACIONAL');
        });
    });

    test('lo que no reconoce lo deja vacío para que el validador lo señale, no adivina', () => {
        expect(Core.normalizarTipoOperacion('SOBREVUELO')).toBe('');
        expect(Core.normalizarAmbito('REGIONAL')).toBe('');
    });
});

describe('huella del registro (hash_origen)', () => {
    const base = {
        fecha_operacion: '2026-03-15', tipo_operacion: 'LLEGADA', matricula: 'XA-MAM',
        folio_rotacion: 12, hora_programada: '08:30:00', hora_real: '08:41:00',
        aeropuerto_origen_destino: 'MMTO'
    };

    test('el mismo movimiento da la misma huella aunque cambie lo accesorio', () => {
        const conNota = Object.assign({}, base, { observaciones: 'Se agregó después', adultos: 3 });
        expect(Core.hashOrigen(conNota)).toBe(Core.hashOrigen(base));
    });

    test('cambiar un dato de la llave natural cambia la huella', () => {
        expect(Core.hashOrigen(Object.assign({}, base, { matricula: 'XA-MAN' })))
            .not.toBe(Core.hashOrigen(base));
        expect(Core.hashOrigen(Object.assign({}, base, { tipo_operacion: 'SALIDA' })))
            .not.toBe(Core.hashOrigen(base));
    });

    test('es estable entre corridas: de eso depende no duplicar al reimportar', () => {
        expect(Core.hashOrigen(base)).toBe(Core.hashOrigen(base));
        expect(Core.hashOrigen(base)).toHaveLength(16);
    });
});

describe('mapeo de columnas del Excel', () => {
    const encabezados = [
        'No.', 'FECHA', 'TIPO DE OPERACIÓN', 'NACIONAL', 'NOMBRE DEL OPERADOR',
        'MATRÍCULA', 'TIPO DE AERONAVE', 'DESTINO / ORIGEN', 'HR. PROG.', 'HR. REAL',
        'ADULTOS', 'INFANTES', 'PAX. A.G.', 'PAX. O.D.', 'ESTADO', 'PAÍS', 'ALGO RARO'
    ];

    test('reconoce el layout original pese a acentos, puntos y espacios', () => {
        const d = Core.detectarColumnas(encabezados);
        expect(d.faltantes).toEqual([]);
        expect(d.mapa.fecha_operacion).toBe('FECHA');
        expect(d.mapa.matricula).toBe('MATRÍCULA');
        expect(d.mapa.aeropuerto_origen_destino).toBe('DESTINO / ORIGEN');
        expect(d.mapa.hora_programada).toBe('HR. PROG.');
    });

    test('PAX. A.G. se ignora a propósito: la base la calcula y rechazaría el INSERT', () => {
        const d = Core.detectarColumnas(encabezados);
        expect(d.mapa.pax_ag).toBeUndefined();
        expect(d.ignoradas.map((c) => c.titulo)).toContain('PAX. A.G.');
    });

    test('avisa de lo que no reconoció en vez de descartarlo en silencio', () => {
        const d = Core.detectarColumnas(encabezados);
        expect(d.desconocidas.map((c) => c.titulo)).toContain('ALGO RARO');
    });

    test('nombra las columnas obligatorias que falten', () => {
        const d = Core.detectarColumnas(['No.', 'FECHA', 'ADULTOS']);
        expect(d.faltantes).toContain('matricula');
        expect(d.faltantes).toContain('tipo_operacion');
    });
});

describe('normalización de una fila completa', () => {
    const mapa = Core.detectarColumnas([
        'No.', 'FECHA', 'TIPO DE OPERACIÓN', 'NACIONAL', 'NOMBRE DEL OPERADOR',
        'MATRÍCULA', 'TIPO DE AERONAVE', 'DESTINO / ORIGEN', 'HR. PROG.', 'HR. REAL',
        'ADULTOS', 'INFANTES'
    ]).mapa;

    const cruda = {
        'No.': '12', 'FECHA': '15/03/2026', 'TIPO DE OPERACIÓN': 'llegada',
        'NACIONAL': 'nal', 'NOMBRE DEL OPERADOR': '  aerolíneas ejecutivas  ',
        'MATRÍCULA': 'xa-mam', 'TIPO DE AERONAVE': 'g650', 'DESTINO / ORIGEN': 'mmto',
        'HR. PROG.': 'NA', 'HR. REAL': '08:41', 'ADULTOS': '3', 'INFANTES': ''
    };

    test('deja la fila lista para la base', () => {
        const { movimiento, errores } = Core.normalizarFilaExcel(cruda, { mapa, filaOrigen: 7 });
        expect(errores).toEqual([]);
        expect(movimiento).toMatchObject({
            folio_rotacion: 12,
            fecha_operacion: '2026-03-15',
            tipo_operacion: 'LLEGADA',
            ambito_operacion: 'NACIONAL',
            operador: 'AEROLÍNEAS EJECUTIVAS',
            matricula: 'XA-MAM',
            tipo_aeronave: 'G650',
            aeropuerto_origen_destino: 'MMTO',
            hora_programada: null,
            hora_real: '08:41:00',
            adultos: 3,
            // La celda de INFANTES venía vacía: eso es "no se anotó", no "cero".
            // Así están 3,080 de las 10,396 filas ya cargadas.
            infantes: null,
            fila_origen: 7
        });
    });

    test('el aeropuerto vacío NO invalida la fila: falta en la mitad del histórico real', () => {
        const sinAeropuerto = Object.assign({}, cruda, { 'DESTINO / ORIGEN': '' });
        const { movimiento, errores } = Core.normalizarFilaExcel(sinAeropuerto, { mapa, filaOrigen: 7 });
        expect(errores).toEqual([]);
        expect(movimiento.aeropuerto_origen_destino).toBe('');
    });

    test('un negativo en pasajeros se señala en vez de convertirse en 0', () => {
        const negativo = Object.assign({}, cruda, { 'ADULTOS': '-2' });
        const { errores } = Core.normalizarFilaExcel(negativo, { mapa, filaOrigen: 7 });
        expect(errores.map((e) => e.campo)).toContain('adultos');
    });

    test('avisa cuando había un valor y no se pudo interpretar', () => {
        const { avisos } = Core.normalizarFilaExcel(cruda, { mapa, filaOrigen: 7 });
        expect(avisos.join(' ')).toMatch(/Hora programada no interpretable/);
    });

    test('rescata la nota de la columna sin encabezado', () => {
        const conNota = Object.assign({}, cruda, { __EMPTY: 'Llegó con demora por clima' });
        const { movimiento } = Core.normalizarFilaExcel(conNota, { mapa, filaOrigen: 7 });
        expect(movimiento.observaciones).toBe('Llegó con demora por clima');
    });

    test('una fila incompleta se rechaza señalando el campo, no tumba la importación', () => {
        const mala = Object.assign({}, cruda, { 'MATRÍCULA': '', 'TIPO DE OPERACIÓN': 'SOBREVUELO' });
        const { errores } = Core.normalizarFilaExcel(mala, { mapa, filaOrigen: 9 });
        const campos = errores.map((e) => e.campo);
        expect(campos).toContain('matricula');
        expect(campos).toContain('tipo_operacion');
    });
});

describe('payload hacia PostgREST', () => {
    const mov = {
        folio_rotacion: 1, fecha_operacion: '2026-03-15', tipo_operacion: 'LLEGADA',
        ambito_operacion: 'NACIONAL', operador: 'X', matricula: 'XA-A', tipo_aeronave: 'C421',
        aeropuerto_origen_destino: 'MMTO', hora_programada: null, hora_real: null,
        adultos: 2, infantes: 1, pax_od: null, estado: null, pais: null,
        observaciones: null, hash_origen: 'abc', fila_origen: 3
    };

    test('nunca incluye pax_ag: es columna generada y Postgres rechazaría el INSERT', () => {
        expect(Core.aPayload(mov)).not.toHaveProperty('pax_ag');
    });

    test('no arrastra claves auxiliares que la tabla no espera del cliente', () => {
        const payload = Core.aPayload(mov);
        expect(payload).not.toHaveProperty('fila_origen');
        expect(payload).not.toHaveProperty('hash_origen');
    });

    test('adultos e infantes conservan el null: "no se anotó" no es "viajaron cero"', () => {
        // Regresión: se forzaban a 0 creyendo el diccionario, que marcaba la
        // columna NOT NULL. La tabla real tiene 2,670 filas con adultos en null.
        // Rellenar con ceros falsearía cualquier promedio de ocupación.
        const payload = Core.aPayload(Object.assign({}, mov, { adultos: null, infantes: undefined }));
        expect(payload.adultos).toBeNull();
        expect(payload.infantes).toBeNull();
    });

    test('un cero capturado a propósito sí viaja como 0', () => {
        const payload = Core.aPayload(Object.assign({}, mov, { adultos: 0, infantes: 0 }));
        expect(payload.adultos).toBe(0);
        expect(payload.infantes).toBe(0);
    });

    test('los extras de trazabilidad se pueden adjuntar sin tocar el resto', () => {
        const payload = Core.aPayload(mov, { tipo_fuente: 'IMPORTACION_EXCEL', archivo_origen: 'bitacora.xlsx' });
        expect(payload.tipo_fuente).toBe('IMPORTACION_EXCEL');
        expect(payload.archivo_origen).toBe('bitacora.xlsx');
    });
});

describe('presentación', () => {
    test('la fecha larga no pasa por new Date(): no puede correrse un día', () => {
        expect(Core.fechaLarga('2026-03-15')).toBe('15 Mar 2026');
        expect(Core.fechaLarga('2026-01-01')).toBe('1 Ene 2026');
        expect(Core.fechaLarga(null)).toBe('—');
    });

    test('la hora se acorta para la tabla y la ausencia se ve como ausencia', () => {
        expect(Core.horaCorta('08:41:00')).toBe('08:41');
        expect(Core.horaCorta(null)).toBe('—');
    });

    test('pax total es el espejo de la columna generada', () => {
        expect(Core.paxTotal({ adultos: 3, infantes: 2 })).toBe(5);
        expect(Core.paxTotal({})).toBe(0);
    });
});

describe('filtros', () => {
    test('el estatus ACTIVO por omisión no cuenta como filtro puesto', () => {
        expect(Core.hayFiltros(Core.filtrosVacios())).toBe(false);
        expect(Core.hayFiltros(Object.assign(Core.filtrosVacios(), { estatus_registro: 'TODOS' }))).toBe(true);
        expect(Core.hayFiltros(Object.assign(Core.filtrosVacios(), { matricula: 'XA' }))).toBe(true);
    });

    test('el rango por omisión es el año en curso completo', () => {
        const r = Core.rangoAnioActual(new Date(2026, 5, 10));
        expect(r).toEqual({ fecha_desde: '2026-01-01', fecha_hasta: '2026-12-31' });
    });
});
