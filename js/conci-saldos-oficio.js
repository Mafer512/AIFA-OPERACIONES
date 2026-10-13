/* ==========================================================================
   Conciliación › saldos oficiales de los oficios a la Subsecretaría
   --------------------------------------------------------------------------
   Los acumulados del oficio (mes, año y desde el inicio de operaciones del
   AIFA) son sumas corridas: el del día anterior más el dato del día. La base
   de manifiestos no tiene todo lo que esas sumas ya traen —pasajeros de enero
   a julio de 2026 y los años 2022 a 2025— y hay días cuyo dato se envió antes
   de una corrección del libro. Por eso:

   · SALDO: los acumulados parten de los del oficio del 30/09/2026, tal cual
     se enviaron (cierre de septiembre). Para cualquier otra fecha, los
     reportes de Subsecretaría y el mensaje del SWEAR le suman (o restan) los
     datos diarios que calcula la aplicación.
   · ENVIADOS: los días de octubre cuyo libro cambió después de enviar el
     oficio llevan el dato enviado, para que todo cuadre desde el 01/10/2026.

   Fuentes:
     Pasajeros: "REPORTE GENERAL OCTUBRE 2026", hoja SUBSECRETARÍA, bloque
                30/09 (el que arrastran los oficios de octubre).
     Carga:     "BASE DE CARGA 2026" (rep2), hoja Subsecretaría, bloques
                30/09, 01/10 y 02/10.

   Comprobado: saldo + datos del 01 al 06/10 = oficio del 06/10/2026
   (5,759,386 pax / 43,102 ops; 320,156 t / 12,119 ops).
   ========================================================================== */
(function (root) {
    'use strict';

    const t = (total, nacional, internacional) => ({ total, nacional, internacional });

    const SALDOS = Object.freeze({
        fecha: '2026-09-30',
        pasajeros: {
            mes: { pax: t(585515, 544629, 40886), ops: t(4512, 4195, 317) },
            anio: { pax: t(5639756, 5341270, 298486), ops: t(42217, 39942, 2275) },
            historico: { pax: t(22560304, 21252299, 1308005), ops: t(178766, 167120, 11646) }
        },
        carga: {
            mes: { ton: t(35866, 911, 34955), ops: t(1311, 277, 1034) },
            anio: { ton: t(312620, 6042, 306578), ops: t(11868, 2762, 9106) },
            historico: { ton: t(1352023, 44391, 1307632), ops: t(44079, 4526, 39553) }
        },
        // Dato del día tal como se envió, cuando el libro cambió después.
        enviados: {
            carga: {
                // El libro hoy: 1,448 t (48 nac / 1,400 int).
                '2026-10-01': { ton: t(1443, 47, 1396), ops: t(50, 9, 41) },
                // El libro hoy: 1,275 t (25 / 1,250) y 40 ops (4 / 36).
                '2026-10-02': { ton: t(1275, 28, 1247), ops: t(40, 5, 35) }
            }
        }
    });

    /* ── 2025 para la variación del mensaje del SWEAR ──────────────────────
       La base no tiene 2025. Fuente: "VARIACION 2025-2026..xlsx": totales
       por mes de enero a septiembre y día por día de enero, marzo y octubre
       (pasajeros por FECHA; carga en kilos, como "Suma de Total dia").
       El acumulado del año a una fecha es, como en el libro, la suma de los
       meses anteriores más los días del mes hasta esa fecha; la carga se
       pasa a toneladas al final y se redondea a enteras. */
    const MENSUAL_2025 = Object.freeze({
        pax: [565716, 488440, 570097, 621197, 586299, 541400, 604758, 630952, 546457],
        ton: [27764.46673, 26629, 33154.9695, 30786, 34191, 37708, 35650, 35738, 31077]
    });
    const DIARIO_2025 = Object.freeze({
        1: {
            pax: [18182, 21938, 22306, 21610, 22149, 20745, 18238, 17462, 19715, 19175, 18688, 18827, 18175, 16606, 16226, 18590,
                18331, 16684, 17186, 17490, 15385, 15233, 17622, 18271, 16052, 17734, 17030, 15685, 15654, 19264, 19463],
            kg: [707685.5, 912897.98, 800832, 530461.79, 986822.9, 421972.47, 744234, 578863.32, 984198.84, 957389, 929448.68,
                1348112.66, 497820.65, 972790.4, 973294, 1246063.28, 891908.7, 1038311.04, 963059.9, 325220.5, 1002346.5,
                1058377.68, 1363594.92, 1086419, 486629.18, 1268438.7, 506957.18, 958825.16, 1062069.8, 1024168.4, 1135252.6]
        },
        3: {
            pax: [17191, 18992, 17891, 16611, 16434, 17468, 19238, 17111, 18444, 17792, 16539, 17038, 20149, 21042, 19025, 18453,
                20128, 18100, 16985, 19343, 18844, 17892, 18601, 19433, 17417, 16320, 19425, 19658, 17343, 20807, 20383],
            kg: [934565.94, 1060629.4, 721501, 972044, 1066970, 1210679.95, 1351992, 1024642.1, 1064597.6, 886742.8, 896986.8,
                1228955, 1017019.22, 1473763, 1009889.46, 994788.1, 621486.24, 786933.8, 1277767, 1475012.25, 1452922,
                1172004.91, 1002222.7, 914525.9, 779425, 1167455.1, 1492042.7, 1498928.08, 779213.55, 949172.9, 870091]
        },
        10: {
            pax: [16083, 17538, 19170, 15798, 19435, 19307, 15557, 16465, 19570, 19623, 16215, 19450, 19732, 16814, 18050, 19633,
                20384, 16920, 21081, 20397, 17745, 18818, 19666, 21088, 17407, 20828, 21187, 17245, 18609, 21687, 23127],
            kg: [1241308.6, 1357422.3, 1144062.61, 850463, 876297.4, 1408031.6, 891139, 1172892, 1102327.13, 1170382, 936449.77,
                1228164.85, 1183070.1, 976093.93, 1195961.76, 1417625.3, 1261250, 812523.48, 1047218.2, 1528736, 1358253.45,
                1448745.6, 1412297.9, 1418474, 977014.18, 963321.3, 1256267, 1130138.5, 1504360.35, 1695658.8, 1307460.5]
        }
    });

    /** Total de un mes de 2025: el del libro o, si sólo hay días, su suma. */
    function mes2025(mes) {
        if (mes <= MENSUAL_2025.pax.length) return { pax: MENSUAL_2025.pax[mes - 1], ton: MENSUAL_2025.ton[mes - 1] };
        const d = DIARIO_2025[mes];
        if (!d || d.pax.length !== new Date(2025, mes, 0).getDate()) return null;
        return { pax: d.pax.reduce((s, v) => s + v, 0), ton: d.kg.reduce((s, v) => s + v, 0) / 1000 };
    }

    /**
     * Acumulado del año 2025 al día dado (AAAA-MM-DD): { pax, ton } con las
     * toneladas enteras, o null si el libro no alcanza para esa fecha (no se
     * inventa: sin los días del mes, sólo vale el último día de ese mes).
     */
    function acumuladoAnioAnterior(iso) {
        const [anio, mes, dia] = String(iso || '').split('-').map(Number);
        if (anio !== 2025 || !(mes >= 1 && mes <= 12) || !(dia >= 1)) return null;
        let pax = 0;
        let ton = 0;
        for (let m = 1; m < mes; m++) {
            const t = mes2025(m);
            if (!t) return null;
            pax += t.pax;
            ton += t.ton;
        }
        const d = DIARIO_2025[mes];
        if (d) {
            if (dia > d.pax.length) return null;
            for (let i = 0; i < dia; i++) { pax += d.pax[i]; ton += d.kg[i] / 1000; }
        } else {
            const t = mes2025(mes);
            if (!t || dia !== new Date(2025, mes, 0).getDate()) return null;
            pax += t.pax;
            ton += t.ton;
        }
        return { pax, ton: Math.round(ton) };
    }

    /**
     * ¿El saldo de este alcance aplica a un corte? El mes, si es el mismo mes;
     * el año, si es el mismo año; desde el inicio, siempre.
     */
    function aplica(alcance, corteIso) {
        if (alcance === 'historico') return true;
        if (alcance === 'anio') return corteIso.slice(0, 4) === SALDOS.fecha.slice(0, 4);
        if (alcance === 'mes') return corteIso.slice(0, 7) === SALDOS.fecha.slice(0, 7);
        return false;
    }

    root.ConciSaldosOficio = { ...SALDOS, aplica, acumuladoAnioAnterior };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ConciSaldosOficio;
})(typeof window !== 'undefined' ? window : globalThis);
