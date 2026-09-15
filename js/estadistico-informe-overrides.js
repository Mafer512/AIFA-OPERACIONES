/* OVERRIDE TEMPORAL Y REVERSIBLE — ÚNICA fuente de cifras oficiales para el
 * módulo Estadística (pestaña Estadística de Conciliación): la consumen por
 * igual las tarjetas de pantalla (Operaciones, Pasajeros, Carga, Cifras del
 * día) y el PDF "Informe Estadístico". No hay una segunda estructura para
 * las tarjetas: ambas capas leen este mismo objeto.
 *
 * QUÉ ES: mientras la base de datos interna (manifiestos / monthly_operations)
 * termina de ponerse al corriente, este archivo fuerza las cifras del último
 * informe oficial, para que la pantalla y el PDF puedan usarse ya.
 *
 * QUÉ NO ES: esto NO toca Supabase, NO modifica manifiestos ni operaciones
 * individuales, NO cambia otros módulos ni el "Resumen Estadístico" (el otro
 * PDF). Sólo lo consume js/estadistico-informe.js, como un parche de último
 * paso sobre las cifras ya calculadas (state.acumulado, state.diaCorte, y la
 * tabla mensual/cronológica de cada sección del PDF) — nunca se escribe de
 * vuelta a ningún lado.
 *
 * CÓMO DESACTIVARLO: poner ACTIVO en false más abajo (o quitar el <script>
 * de este archivo en index.html). Todo vuelve a salir 100% de lo que calculan
 * monthly_operations/annual_operations + manifiestos, sin rastro.
 *
 * HISTORIAL (cada actualización oficial reemplaza sólo lo que cambió; el
 * resto de la estructura se queda igual — nunca se crea una segunda):
 *  - 2026-09-11 (corte 10-sep): primera carga, ver commit
 *    "Informe Estadistico: override temporal de cifras oficiales".
 *  - 2026-09-15 (corte 14-sep): ajuste incremental — SÓLO septiembre 2026
 *    (mes 9 de cada `mensual`), `totalPorAnio[2026]`, `acumulado`, `diaCorte`
 *    y las dos últimas filas + TOTAL de cada `cronologico`. Enero-agosto
 *    2026 y 2022-2025 NO se tocaron.
 *
 * Alcance de cada tipo de aviación (ver detalle en cada bloque):
 *  - comercial: 2022-2025 ya son correctos en el sistema y NO se tocan; sólo
 *    se fuerza 2026 (mensual, total del año y acumulado).
 *  - general: hay diferencias históricas también en 2022-2025, así que se
 *    fuerzan los totales de esos años además de 2026. El desglose MENSUAL
 *    sólo se fuerza donde el informe oficial lo trae (operaciones 2024,
 *    operaciones+pasajeros 2025 y 2026); no se inventa lo que falta.
 *  - carga: sólo se corrige el redondeo de 2024/2025 y se agrega 2026;
 *    2022/2023 no estaban señalados como distintos.
 */
(function (root) {
    'use strict';

    const ACTIVO = true;

    root.OFFICIAL_STATISTICS_OVERRIDES = {
        activo: ACTIVO,

        actualizacionTexto: '15 de septiembre de 2026',
        corte: { anio: 2026, mes: 9, dia: 14 },
        corteIso: '2026-09-14',
        corteTexto: '14 de septiembre de 2026',

        // Tarjetas del encabezado: "Del 21 de marzo de 2022 al {corte} se acumulan".
        encabezado: {
            totalOperaciones: 186836,
            totalPasajeros: 22323601,
            comercial: { ops: 176349, pax: 22248050 },
            general: { ops: 10487, pax: 75551 }
        },

        tipos: {
            comercial: {
                mensual: {
                    2026: {
                        1: { ops: 4643, pax: 601184 }, 2: { ops: 4113, pax: 514583 },
                        3: { ops: 4609, pax: 593095 }, 4: { ops: 4786, pax: 639049 },
                        5: { ops: 4757, pax: 670381 }, 6: { ops: 4590, pax: 593921 },
                        7: { ops: 5054, pax: 712027 }, 8: { ops: 5147, pax: 730001 },
                        9: { ops: 2112, pax: 273460 }, 10: { ops: 0, pax: 0 },
                        11: { ops: 0, pax: 0 }, 12: { ops: 0, pax: 0 }
                    }
                },
                totalPorAnio: {
                    2026: { ops: 39811, pax: 5327701 }
                },
                acumulado: { ops: 176349, pax: 22248050 },
                diaCorte: { ops: 225, pax: 29189 },
                cronologico: [
                    { label: 'ENE. A DIC. 2022', ops: 8996, pax: 912415 },
                    { label: 'ENE. A DIC. 2023', ops: 23211, pax: 2631261 },
                    { label: 'ENE. A DIC. 2024', ops: 51734, pax: 6318454 },
                    { label: 'ENE. A DIC. 2025', ops: 52597, pax: 7058219 },
                    { label: 'ENE. A AGO. 2026', ops: 37699, pax: 5054241 },
                    { label: 'DEL 1 AL 13 SEP. 2026', ops: 1887, pax: 244271 },
                    { label: '14 SEP. 2026', ops: 225, pax: 29189 },
                    { label: 'TOTAL', ops: 176349, pax: 22248050 }
                ]
            },

            general: {
                mensual: {
                    // Sólo operaciones: el informe oficial no trae desglose
                    // mensual de pasajeros para 2024, sólo el total del año.
                    2024: {
                        1: { ops: 178 }, 2: { ops: 223 }, 3: { ops: 192 }, 4: { ops: 218 },
                        5: { ops: 261 }, 6: { ops: 174 }, 7: { ops: 199 }, 8: { ops: 185 },
                        9: { ops: 271 }, 10: { ops: 348 }, 11: { ops: 242 }, 12: { ops: 286 }
                    },
                    2025: {
                        1: { ops: 251, pax: 2353 }, 2: { ops: 242, pax: 1348 }, 3: { ops: 272, pax: 1601 },
                        4: { ops: 249, pax: 1840 }, 5: { ops: 226, pax: 1576 }, 6: { ops: 209, pax: 3177 },
                        7: { ops: 234, pax: 1515 }, 8: { ops: 282, pax: 3033 }, 9: { ops: 249, pax: 948 },
                        10: { ops: 315, pax: 1298 }, 11: { ops: 285, pax: 1089 }, 12: { ops: 257, pax: 1336 }
                    },
                    2026: {
                        1: { ops: 194, pax: 549 }, 2: { ops: 242, pax: 985 }, 3: { ops: 263, pax: 1349 },
                        4: { ops: 246, pax: 1502 }, 5: { ops: 225, pax: 5793 }, 6: { ops: 276, pax: 1230 },
                        7: { ops: 245, pax: 3015 }, 8: { ops: 201, pax: 505 }, 9: { ops: 77, pax: 327 },
                        10: { ops: 0, pax: 0 }, 11: { ops: 0, pax: 0 }, 12: { ops: 0, pax: 0 }
                    }
                },
                totalPorAnio: {
                    2022: { ops: 458, pax: 1385 },
                    2023: { ops: 2212, pax: 8160 },
                    2024: { ops: 2777, pax: 29637 },
                    2025: { ops: 3071, pax: 21114 },
                    2026: { ops: 1969, pax: 15255 }
                },
                acumulado: { ops: 10487, pax: 75551 },
                diaCorte: { ops: 9, pax: 12 },
                cronologico: [
                    { label: 'ENE. A DIC. 2022', ops: 458, pax: 1385 },
                    { label: 'ENE. A DIC. 2023', ops: 2212, pax: 8160 },
                    { label: 'ENE. A DIC. 2024', ops: 2777, pax: 29637 },
                    { label: 'ENE. A DIC. 2025', ops: 3071, pax: 21114 },
                    { label: 'ENE. A AGO. 2026', ops: 1892, pax: 14928 },
                    { label: 'DEL 1 AL 13 SEP. 2026', ops: 68, pax: 315 },
                    { label: '14 SEP. 2026', ops: 9, pax: 12 },
                    { label: 'TOTAL', ops: 10487, pax: 75551 }
                ]
            },

            carga: {
                mensual: {
                    2026: {
                        1: { ops: 1035, tons: 31579.77 }, 2: { ops: 1008, tons: 32265.40 },
                        3: { ops: 1061, tons: 35900.33 }, 4: { ops: 1047, tons: 33478.36 },
                        5: { ops: 1070, tons: 34039.07 }, 6: { ops: 1145, tons: 35206.46 },
                        7: { ops: 1098, tons: 36089.41 }, 8: { ops: 1196, tons: 38197.59 },
                        9: { ops: 549, tons: 15715.24 }, 10: { ops: 0, tons: 0 },
                        11: { ops: 0, tons: 0 }, 12: { ops: 0, tons: 0 }
                    }
                },
                // Sólo redondeo de 2024/2025 (el sistema puede mostrar .16/.75;
                // lo oficial es .17/.74) y el dato nuevo de 2026.
                totalPorAnio: {
                    2024: { ops: 13219, tons: 447341.17 },
                    2025: { ops: 12041, tons: 406192.74 },
                    2026: { ops: 9209, tons: 292471.63 }
                },
                acumulado: { ops: 40055, tons: 1332330.55 },
                diaCorte: { ops: 39, tons: 1054.65 },
                cronologico: [
                    { label: 'ENE. A DIC. 2022', ops: 8, tons: 5.19 },
                    { label: 'ENE. A DIC. 2023', ops: 5578, tons: 186319.83 },
                    { label: 'ENE. A DIC. 2024', ops: 13219, tons: 447341.17 },
                    { label: 'ENE. A DIC. 2025', ops: 12041, tons: 406192.74 },
                    { label: 'ENE. A AGO. 2026', ops: 8660, tons: 276756.39 },
                    { label: 'DEL 1 AL 13 SEP. 2026', ops: 510, tons: 14660.59 },
                    { label: '14 SEP. 2026', ops: 39, tons: 1054.65 },
                    { label: 'TOTAL', ops: 40055, tons: 1332330.55 }
                ]
            }
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
