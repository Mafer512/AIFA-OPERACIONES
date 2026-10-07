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

    root.ConciSaldosOficio = { ...SALDOS, aplica };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ConciSaldosOficio;
})(typeof window !== 'undefined' ? window : globalThis);
