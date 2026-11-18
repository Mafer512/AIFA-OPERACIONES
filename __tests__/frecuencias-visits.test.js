/**
 * Frecuencias semanales: lectura del archivo de Visits y conteo.
 *
 * Una frecuencia es una salida. De cada visita (llegada + salida de un avión)
 * el cargador toma los dos tramos; la tabla cuenta las salidas y el detalle
 * guarda las dos. Así el módulo cuadra con el Excel de frecuencias que sale del
 * mismo archivo (semana del 16 al 22 de noviembre de 2026: Excel = salidas en
 * las 50 rutas con datos completos; antes el módulo mostraba llegadas + salidas).
 */
const fs = require('fs');
const path = require('path');
const F = require('../js/frecuencias_upload_test.js');

const raiz = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const ENC = 'Status,[Arr] Airline code,[Arr] Flight Designator,[Arr] Routing,[Arr] SIBT,[Dep] Airline code,[Dep] Flight Designator,[Dep] Routing,[Dep] SOBT';
const INI = new Date(2026, 10, 16);
const FIN = new Date(2026, 10, 22, 23, 59, 59, 999);

describe('leer el CSV sin perder filas', () => {
    test('comas, comillas dobles y saltos de línea dentro de un campo', () => {
        const filas = F.parsearCSV('a,b,c\n"1, uno","dice ""hola""","línea\nnueva"\n2,,3\n');
        expect(filas).toEqual([['a', 'b', 'c'], ['1, uno', 'dice "hola"', 'línea\nnueva'], ['2', '', '3']]);
    });

    test('también si se volvió a guardar desde Excel en español (punto y coma) y con BOM', () => {
        expect(F.parsearCSV('﻿a;b\n1;"x;y"')).toEqual([['a', 'b'], ['1', 'x;y']]);
    });

    test('la otra punta de la ruta, en los dos formatos del archivo', () => {
        expect(F.otraPunta('NLU-CUN', 'DEP')).toBe('CUN');
        expect(F.otraPunta('CUN-NLU', 'ARR')).toBe('CUN');
        expect(F.otraPunta('MTY-NLU-TIJ', 'DEP')).toBe('TIJ');   // columna única «Routing»
        expect(F.otraPunta('MTY-NLU-TIJ', 'ARR')).toBe('MTY');
        expect(F.otraPunta('NLU-TIJ', 'ARR')).toBe('');           // vuelo que nace en AIFA: no hay llegada
    });

    test('horas: «16NOV 06:16», con «(Dep)» o con fecha completa', () => {
        expect(F.leerHora('16NOV 06:16', 2026).fecha).toEqual(new Date(2026, 10, 16, 6, 16));
        expect(F.leerHora('16NOV 06:16 (Dep)', 2026).fecha).toEqual(new Date(2026, 10, 16, 6, 16));
        expect(F.leerHora('16/11/2026 06:16', 2020)).toEqual({ fecha: new Date(2026, 10, 16, 6, 16), conAnio: true });
        expect(F.leerHora('mañana temprano', 2026)).toBeNull();
    });
});

describe('contar la semana', () => {
    const csv = [
        ENC,
        // Ida y vuelta Mexicana a Acapulco el jueves: una frecuencia (una salida) y su llegada.
        '"Take off","XN","XN 1943","ACA-NLU","19NOV 18:40","XN","XN 1942","NLU-ACA","19NOV 16:00"',
        // Viva en «W»: llega de Monterrey y sale a Tijuana.
        '"Take off","VB","VB 7379","MTY-NLU","17NOV 14:45","VB","VB 5067","NLU-TIJ","17NOV 21:40"',
        // Fila corta (sin la salida): antes se descartaba completa; la llegada sí cuenta.
        '"Landed","Y4","Y4 3296","TIJ-NLU","18NOV 21:41"',
        // Un campo con salto de línea dentro: antes partía la fila en dos y se perdía.
        '"Take off","AM","AM 520","CUN-NLU","20NOV 10:00","AM","AM 521","NLU-CUN","20NOV 11:30","nota\ncon salto"',
        // De otra semana, repetida e ilegible.
        '"Take off","AM","AM 530","GDL-NLU","25NOV 10:00","AM","AM 531","NLU-GDL","25NOV 11:00"',
        '"Take off","XN","XN 1943","ACA-NLU","19NOV 18:40","XN","XN 1942","NLU-ACA","19NOV 16:00"',
        '"Take off","VB","VB 1","MID-NLU","sin hora","VB","VB 2","NLU-MID",""',
    ].join('\n');

    const r = F.leerVisits(csv, INI, FIN);
    const de = clave => r.mapa.get(clave);

    test('cada ruta lleva sus salidas (frecuencias) y sus llegadas por separado', () => {
        expect(de('ACA-XN')).toMatchObject({ salidas: 1, llegadas: 1 });
        expect(de('TIJ-VB')).toMatchObject({ salidas: 1, llegadas: 0 });
        expect(de('MTY-VB')).toMatchObject({ salidas: 0, llegadas: 1 });
        expect(de('TIJ-Y4')).toMatchObject({ salidas: 0, llegadas: 1 });
        expect(de('CUN-AM')).toMatchObject({ salidas: 1, llegadas: 1 });
        expect(de('ACA-XN').flights.map(f => f.flight).sort()).toEqual(['XN1942 (Sal)', 'XN1943 (Lleg)']);
    });

    test('lo que no entra se cuenta y se explica, para cuadrar contra el Excel', () => {
        expect(r.resumen).toMatchObject({ visitas: 7, salidas: 3, llegadas: 4, fueraDeSemana: 2, repetidos: 2, horaIlegible: 1, sinDatos: 1 });
        expect(r.total).toBe(7);
        const texto = F.textoResumen(r.resumen);
        expect(texto).toContain('7 visitas leídas: 3 salidas (frecuencias) y 4 llegadas de la semana.');
        expect(texto).toContain('2 tramos eran de otras fechas.');
        expect(texto).toContain('«sin hora»');
    });

    test('avisa con claridad si al archivo le faltan columnas', () => {
        expect(F.leerVisits('Status,Algo\n1,2', INI, FIN).error).toContain('Routing');
        expect(F.leerVisits('Routing,Otra\nMTY-NLU-TIJ,x', INI, FIN).error).toContain('SOBT');
        expect(F.leerVisits('', INI, FIN).error).toContain('vacío');
    });

    // El archivo de muestra no va en el repositorio (trae datos reales): si no está, se salta.
    const hayMuestra = fs.existsSync(path.join(raiz, 'Visits_13JUL26 (2).csv'));
    (hayMuestra ? test : test.skip)('el archivo de muestra (columna única «Routing») ya se puede cargar', () => {
        const muestra = leer('Visits_13JUL26 (2).csv');
        const m = F.leerVisits(muestra, new Date(2026, 6, 6), new Date(2026, 6, 12, 23, 59, 59));
        expect(m.error).toBeUndefined();
        expect(m.resumen.visitas).toBe(135);
        expect(m.resumen.salidas).toBeGreaterThan(0);
        expect(m.resumen.llegadas).toBeGreaterThan(0);
    });
});

describe('en la base: cada día cuenta las salidas', () => {
    const sql = leer('db/frecuencias_contar_salidas.sql');

    test('cuenta «(Sal)» en el detalle que guarda la fila; el detalle conserva salida y llegada', () => {
        expect(sql).toMatch(/replace\(p_detalle, '\(Sal\)', ''\)\)\) \/ 5/);
        // Mismo cálculo, en JS, sobre un detalle real del módulo (Acapulco – Mexicana, jueves).
        const salidas = d => (d.length - d.replace(/\(Sal\)/g, '').length) / 5;
        expect(salidas('XN1942 (Sal) 16:00<br>XN1943 (Lleg) 18:40')).toBe(1);
        expect(salidas('VB2281 (Sal) 06:16<br>VB2272 (Lleg) 08:46<br>VB2273 (Sal) 09:31')).toBe(2);
    });

    test('nacionales e internacionales, sólo al generar; lo capturado a mano no se toca', () => {
        expect(sql).toContain('BEFORE INSERT ON public.weekly_frequencies\n');
        expect(sql).toContain('BEFORE INSERT ON public.weekly_frequencies_int');
        expect(sql).not.toMatch(/BEFORE INSERT OR UPDATE ON public\.weekly_frequencies\b/);
        expect((sql.match(/WHERE public\._freq_de_visits\(/g) || []).length).toBe(2);
        // Corre antes que el que vuelve a sumar los siete días.
        expect('trg_freq_contar_salidas' < 'trg_freq_weekly_total').toBe(true);
    });
});
