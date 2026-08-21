/* Núcleo puro del Informe Estadístico (Conciliación · pestaña Estadística).
 *
 * Dos fuentes, con papeles distintos:
 *   · monthly_operations / annual_operations — la cifra mensual OFICIAL de las
 *     tres aviaciones (Comercial, General y Carga) desde 2022. Es la fuente de
 *     verdad del informe y lo que se imprime en el desglose mensual.
 *   · v_informe_estadistico_resumen / _aerolinea (manifiestos ya conciliados) —
 *     el detalle que la tabla mensual no tiene: cifras del día de corte, factor
 *     de ocupación, participación por aerolínea, y la cifra del mes en curso
 *     mientras no esté ratificado.
 * mergeOficiales() combina ambas con la regla de precedencia documentada ahí.
 * No depende del DOM ni modifica los datos de origen.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InformeEstadisticoCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MONTHS = Object.freeze([
        { number: 1, short: 'Ene', name: 'Enero' },
        { number: 2, short: 'Feb', name: 'Febrero' },
        { number: 3, short: 'Mar', name: 'Marzo' },
        { number: 4, short: 'Abr', name: 'Abril' },
        { number: 5, short: 'May', name: 'Mayo' },
        { number: 6, short: 'Jun', name: 'Junio' },
        { number: 7, short: 'Jul', name: 'Julio' },
        { number: 8, short: 'Ago', name: 'Agosto' },
        { number: 9, short: 'Sep', name: 'Septiembre' },
        { number: 10, short: 'Oct', name: 'Octubre' },
        { number: 11, short: 'Nov', name: 'Noviembre' },
        { number: 12, short: 'Dic', name: 'Diciembre' }
    ]);

    const TIPOS = Object.freeze(['comercial', 'general', 'carga']);

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return 0;
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const normalized = String(value).trim().replace(/[\s ]/g, '').replace(/,/g, '');
        const number = Number(normalized);
        return Number.isFinite(number) ? number : 0;
    }

    function emptyCounters() {
        return {
            ops: 0, opsLlegada: 0, opsSalida: 0, opsNacional: 0, opsInternacional: 0,
            pax: 0, paxNacional: 0, paxInternacional: 0,
            kg: 0, kgNacional: 0, kgInternacional: 0,
            opsRespaldoItinerario: 0
        };
    }

    // opsRespaldoItinerario: operaciones que aún NO tienen manifiesto
    // conciliado (v_informe_manifiestos_normalizado.capturado = false) y se
    // cuentan aquí temporalmente vía datos_origen->itinerario_vuelos_editable
    // mientras avanza la auditoría de "Conciliación Manifiestos".
    function addResumenRow(target, row) {
        const ops = toNumber(row.operaciones);
        const pax = toNumber(row.pax_total);
        const kg = toNumber(row.carga_kg_total);
        target.ops += ops;
        target.pax += pax;
        target.kg += kg;
        target.opsRespaldoItinerario += toNumber(row.operaciones_respaldo_itinerario);
        if (row.direccion === 'A') target.opsLlegada += ops;
        else if (row.direccion === 'D') target.opsSalida += ops;
        if (row.nacional_internacional === 'Nacional') {
            target.opsNacional += ops;
            target.paxNacional += pax;
            target.kgNacional += kg;
        } else if (row.nacional_internacional === 'Internacional') {
            target.opsInternacional += ops;
            target.paxInternacional += pax;
            target.kgInternacional += kg;
        }
    }

    // Agrega las filas de v_informe_estadistico_resumen (solo comercial/carga,
    // ya que Aviación General no sale de manifiestos) por año y por año-mes.
    function aggregateResumen(resumenRows) {
        const porAnio = new Map();
        const porAnioMes = new Map();
        const anios = new Set();

        const ensure = (map, key) => {
            if (!map.has(key)) {
                map.set(key, { comercial: emptyCounters(), carga: emptyCounters() });
            }
            return map.get(key);
        };

        (resumenRows || []).forEach(row => {
            const anio = Number(row?.anio);
            const mes = Number(row?.mes);
            const tipo = row?.tipo_aviacion === 'carga' ? 'carga' : 'comercial';
            if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) return;
            anios.add(anio);
            addResumenRow(ensure(porAnio, anio)[tipo], row);
            addResumenRow(ensure(porAnioMes, `${anio}-${mes}`)[tipo], row);
        });

        return {
            porAnio,
            porAnioMes,
            anios: [...anios].sort((a, b) => a - b)
        };
    }

    const CAMPOS_CONTADOR = Object.freeze(Object.keys(emptyCounters()));

    // Nombres de columna de las cifras mensuales oficiales, por tipo de
    // aviación. Carga se captura en TONELADAS y aquí todo se maneja en kg.
    const CAMPOS_MENSUALES = Object.freeze({
        comercial: { ops: 'comercial_ops', pax: 'comercial_pax' },
        general: { ops: 'general_ops', pax: 'general_pax' },
        carga: { ops: 'carga_ops', tons: 'carga_tons' }
    });
    const CAMPOS_ANUALES = Object.freeze({
        comercial: { ops: 'comercial_ops_total', pax: 'comercial_pax_total' },
        general: { ops: 'general_ops_total', pax: 'general_pax_total' },
        carga: { ops: 'carga_ops_total', tons: 'carga_tons_total' }
    });

    // null cuando la celda viene vacía: en la tabla oficial un hueco significa
    // "todavía no hay dato", no "cero" (p. ej. diciembre 2025 tiene pasajeros
    // pero no operaciones).
    function valorOficial(row, campo) {
        if (!campo) return null;
        const v = row?.[campo];
        if (v === null || v === undefined || v === '') return null;
        return toNumber(v);
    }

    function aplicaOficial(destino, row, campos) {
        const ops = valorOficial(row, campos.ops);
        const pax = valorOficial(row, campos.pax);
        const tons = valorOficial(row, campos.tons);
        if (ops === null && pax === null && tons === null) return false;
        if (ops !== null) destino.ops = ops;
        if (pax !== null) destino.pax = pax;
        if (tons !== null) destino.kg = tons * 1000;
        // La fuente oficial no trae desglose Nacional/Internacional ni por
        // dirección, y dejar el de manifiestos junto a un total oficial daría
        // renglones que no suman. Se marcan como sin desglose.
        destino.opsLlegada = 0; destino.opsSalida = 0;
        destino.opsNacional = 0; destino.opsInternacional = 0;
        destino.paxNacional = 0; destino.paxInternacional = 0;
        destino.kgNacional = 0; destino.kgInternacional = 0;
        destino.fuente = 'oficial';
        return true;
    }

    // Combina lo agregado de manifiestos con las cifras mensuales OFICIALES
    // (monthly_operations / annual_operations), para las TRES aviaciones.
    //
    // La tabla mensual es la fuente de verdad del informe: ahí el área captura
    // la cifra ratificada de cada mes desde 2022. Los manifiestos sólo cubren
    // lo ya conciliado —unos miles de renglones de los últimos meses—, así que
    // no pueden sostener la historia; lo que sí aportan es el detalle diario
    // (cifras del día de corte, factor de ocupación, aerolíneas), que la tabla
    // mensual no tiene.
    //
    // Regla de precedencia, la misma que ya usa js/comparativa-historica.js:
    //   · mes con cifra oficial (is_official distinto de false) -> manda esa;
    //   · mes marcado preliminar, o que aún no existe en la tabla mensual
    //     -> se queda lo agregado de manifiestos;
    //   · celda vacía dentro de una cifra oficial -> se deja lo de manifiestos.
    // Aviación General siempre sale de la tabla mensual: no se captura como
    // manifiesto comercial.
    function mergeOficiales(aggregated, monthlyOpsRows, annualOpsRows) {
        (monthlyOpsRows || []).forEach(row => {
            const anio = Number(row?.year);
            const mes = Number(row?.month);
            if (!Number.isInteger(anio) || !Number.isInteger(mes)) return;
            const key = `${anio}-${mes}`;
            if (!aggregated.porAnioMes.has(key)) {
                aggregated.porAnioMes.set(key, { comercial: emptyCounters(), carga: emptyCounters() });
            }
            const entry = aggregated.porAnioMes.get(key);
            const preliminar = row.is_official === false;
            TIPOS.forEach(tipo => {
                if (!entry[tipo]) entry[tipo] = emptyCounters();
                // General no tiene contraparte en manifiestos: aunque el mes
                // esté marcado preliminar, la única cifra que existe es esta.
                if (preliminar && tipo !== 'general' && entry[tipo].ops > 0) return;
                aplicaOficial(entry[tipo], row, CAMPOS_MENSUALES[tipo]);
            });
            aggregated.anios.push(anio);
        });

        // El total por año se DERIVA de los meses ya combinados, para que la
        // fila "TOTAL POR AÑO" siempre cuadre con la columna que tiene encima.
        // annual_operations sólo entra para años que no tengan ningún mes.
        const aniosConMes = new Set();
        const totalesPorAnio = new Map();
        aggregated.porAnioMes.forEach((entry, key) => {
            const anio = Number(String(key).split('-')[0]);
            if (!Number.isInteger(anio)) return;
            aniosConMes.add(anio);
            if (!totalesPorAnio.has(anio)) {
                totalesPorAnio.set(anio, { comercial: emptyCounters(), general: emptyCounters(), carga: emptyCounters() });
            }
            const total = totalesPorAnio.get(anio);
            TIPOS.forEach(tipo => {
                const c = entry[tipo];
                if (!c) return;
                CAMPOS_CONTADOR.forEach(campo => { total[tipo][campo] += c[campo] || 0; });
            });
        });
        totalesPorAnio.forEach((total, anio) => { aggregated.porAnio.set(anio, total); });

        (annualOpsRows || []).forEach(row => {
            const anio = Number(row?.year);
            if (!Number.isInteger(anio)) return;
            aggregated.anios.push(anio);
            if (aniosConMes.has(anio)) return;   // ya se derivó de sus meses
            if (!aggregated.porAnio.has(anio)) {
                aggregated.porAnio.set(anio, { comercial: emptyCounters(), carga: emptyCounters() });
            }
            const total = aggregated.porAnio.get(anio);
            TIPOS.forEach(tipo => {
                if (!total[tipo]) total[tipo] = emptyCounters();
                aplicaOficial(total[tipo], row, CAMPOS_ANUALES[tipo]);
            });
        });

        aggregated.anios = [...new Set(aggregated.anios)].sort((a, b) => a - b);
        return aggregated;
    }

    function sumTipo(entries, tipo) {
        return entries.reduce((acc, entry) => {
            const counters = entry?.[tipo];
            if (!counters) return acc;
            Object.keys(acc).forEach(key => { acc[key] += counters[key] || 0; });
            return acc;
        }, emptyCounters());
    }

    // Totales acumulados (todo el histórico presente en el agregado) por tipo
    // de aviación — alimenta las tarjetas resumen del informe.
    function buildAcumulado(aggregated) {
        const entries = [...(aggregated?.porAnio?.values() || [])];
        const acumulado = {};
        TIPOS.forEach(tipo => { acumulado[tipo] = sumTipo(entries, tipo); });
        acumulado.totalOperaciones = acumulado.comercial.ops + acumulado.general.ops;
        acumulado.totalPasajeros = acumulado.comercial.pax + acumulado.general.pax;
        return acumulado;
    }

    function withDerivedTotals(entry) {
        const out = {};
        TIPOS.forEach(tipo => { out[tipo] = entry?.[tipo] || emptyCounters(); });
        out.totalOperaciones = out.comercial.ops + out.general.ops;
        out.totalPasajeros = out.comercial.pax + out.general.pax;
        return out;
    }

    // Totales de un año específico (no acumulado histórico) — base de la
    // comparativa año contra año y de la proyección de cierre anual.
    function yearTotals(aggregated, anio) {
        return withDerivedTotals(aggregated?.porAnio?.get(Number(anio)));
    }

    // Totales de un mes específico de un año — base de la proyección de
    // cierre de mes y de la comparativa mes-a-mes entre dos años.
    function monthTotals(aggregated, anio, mes) {
        return withDerivedTotals(aggregated?.porAnioMes?.get(`${Number(anio)}-${Number(mes)}`));
    }

    function pctChange(current, base) {
        if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
        return ((current - base) / base) * 100;
    }

    // Comparativa año contra año (Herramienta 1). Si se pasa `mes`, compara
    // ese mes específico entre los dos años; si no, compara el año completo.
    function compareYears(aggregated, anioA, anioB, mes) {
        const a = mes ? monthTotals(aggregated, anioA, mes) : yearTotals(aggregated, anioA);
        const b = mes ? monthTotals(aggregated, anioB, mes) : yearTotals(aggregated, anioB);
        const rows = [
            { label: 'Operaciones Comercial', a: a.comercial.ops, b: b.comercial.ops },
            { label: 'Pasajeros Comercial', a: a.comercial.pax, b: b.comercial.pax },
            { label: 'Operaciones General', a: a.general.ops, b: b.general.ops },
            { label: 'Pasajeros General', a: a.general.pax, b: b.general.pax },
            { label: 'Operaciones Carga', a: a.carga.ops, b: b.carga.ops },
            { label: 'Toneladas de Carga', a: (a.carga.kg || 0) / 1000, b: (b.carga.kg || 0) / 1000 },
            { label: 'Total Operaciones (Comercial+General)', a: a.totalOperaciones, b: b.totalOperaciones },
            { label: 'Total Pasajeros', a: a.totalPasajeros, b: b.totalPasajeros }
        ].map(row => ({ ...row, variacion: pctChange(row.a, row.b) }));
        return { anioA: Number(anioA), anioB: Number(anioB), mes: mes ? Number(mes) : null, rows };
    }

    function isLeapYear(anio) {
        const y = Number(anio);
        return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    }

    function daysInMonth(anio, mes) {
        return new Date(Number(anio), Number(mes), 0).getDate();
    }

    function daysInYear(anio) {
        return isLeapYear(anio) ? 366 : 365;
    }

    // Día del año (1-366) de una fecha — usado para proyectar el cierre anual
    // con la misma proporción de días transcurridos.
    function dayOfYear(anio, mes, dia) {
        const start = Date.UTC(Number(anio), 0, 1);
        const target = Date.UTC(Number(anio), Number(mes) - 1, Number(dia));
        return Math.round((target - start) / 86400000) + 1;
    }

    function projectValue(valueAtCutoff, elapsedUnits, totalUnits) {
        if (!Number.isFinite(valueAtCutoff) || !elapsedUnits || elapsedUnits <= 0 || !totalUnits) return null;
        return valueAtCutoff * (totalUnits / elapsedUnits);
    }

    // Proyección de cierre (Herramienta 2): regla de tres simple sobre lo ya
    // capturado hasta `diaCorte` (día del mes) frente a los días del mes.
    function projectMonthClosure(aggregated, anio, mes, diaCorte) {
        const totals = monthTotals(aggregated, anio, mes);
        const totalDias = daysInMonth(anio, mes);
        const build = (tipo) => ({
            opsActual: totals[tipo].ops,
            opsProyectado: projectValue(totals[tipo].ops, diaCorte, totalDias),
            paxActual: totals[tipo].pax,
            paxProyectado: projectValue(totals[tipo].pax, diaCorte, totalDias)
        });
        return {
            anio: Number(anio), mes: Number(mes), diaCorte, totalDias,
            comercial: build('comercial'), general: build('general'), carga: build('carga')
        };
    }

    // Igual que projectMonthClosure pero para el año completo, usando el día
    // del año transcurrido frente a los días totales del año (bisiesto o no).
    function projectYearClosure(aggregated, anio, diaDelAnio) {
        const totals = yearTotals(aggregated, anio);
        const totalDias = daysInYear(anio);
        const build = (tipo) => ({
            opsActual: totals[tipo].ops,
            opsProyectado: projectValue(totals[tipo].ops, diaDelAnio, totalDias),
            paxActual: totals[tipo].pax,
            paxProyectado: projectValue(totals[tipo].pax, diaDelAnio, totalDias)
        });
        return {
            anio: Number(anio), diaDelAnio, totalDias,
            comercial: build('comercial'), general: build('general'), carga: build('carga')
        };
    }

    // Serie mensual de operaciones por tipo de aviación, para la gráfica de
    // barras (Herramienta 3) del desglose mensual de un año.
    function buildMonthlySeries(aggregated, anio) {
        const labels = [];
        const comercialOps = [];
        const generalOps = [];
        const cargaOps = [];
        MONTHS.forEach(month => {
            const entry = aggregated?.porAnioMes?.get(`${Number(anio)}-${month.number}`);
            labels.push(month.short);
            comercialOps.push(entry?.comercial?.ops || 0);
            generalOps.push(entry?.general?.ops || 0);
            cargaOps.push(entry?.carga?.ops || 0);
        });
        return { labels, comercialOps, generalOps, cargaOps };
    }

    // Pivotea el agregado a "meses como filas, años como columnas" — mismo
    // layout que el Informe Estadístico oficial (RESUMEN ESTADÍSTICO) — para
    // un tipo de aviación dado. TOTAL POR AÑO: un valor por año. ACUMULADO:
    // UN SOLO total general (mismo número que buildAcumulado para ese tipo),
    // mostrado como celda fusionada bajo cada grupo OPERACIONES/PASAJEROS —
    // no es una suma corrida año sobre año, es el gran total del histórico.
    function buildTablaMensualPorAnios(aggregated, tipo, anios) {
        const aniosOrdenados = [...new Set(anios || [])].sort((a, b) => a - b);
        const rows = MONTHS.map(month => {
            const celdas = {};
            aniosOrdenados.forEach(anio => {
                const c = aggregated?.porAnioMes?.get(`${anio}-${month.number}`)?.[tipo];
                celdas[anio] = { ops: c?.ops || 0, pax: c?.pax || 0, kg: c?.kg || 0 };
            });
            return { mes: month.name, celdas };
        });
        const totalPorAnio = {};
        const totalGeneral = { ops: 0, pax: 0, kg: 0 };
        aniosOrdenados.forEach(anio => {
            const c = aggregated?.porAnio?.get(anio)?.[tipo];
            const ops = c?.ops || 0, pax = c?.pax || 0, kg = c?.kg || 0;
            totalPorAnio[anio] = { ops, pax, kg };
            totalGeneral.ops += ops; totalGeneral.pax += pax; totalGeneral.kg += kg;
        });
        return { anios: aniosOrdenados, rows, totalPorAnio, totalGeneral };
    }

    // Tabla cronológica secundaria que acompaña a cada tabla mensual del
    // informe oficial: un renglón por cada año YA CERRADO ("ENE. A DIC.
    // {año}"), un renglón "ENE. A {mes anterior}. {año en curso}" (año en
    // curso menos el mes en curso), un renglón "DEL 1 AL {ayer} {mes}."
    // (mes en curso menos el corte de hoy) y un renglón con la fecha de hoy
    // sola — igual como el AIFA separa "cifras cerradas" de "dato del día,
    // preliminar". `hoy` = {anio, mes, dia}; `diaCorte` = contador de un solo
    // tipo (ya filtrado), normalmente de aggregateDiaCorte(rows)[tipo].
    // `diaCorte` es opcional: cuando no hay corte diario disponible para ese
    // tipo (Aviación General no tiene cifra por día — sale de fuentes
    // oficiales mensuales, nunca de manifiestos), se omite el desglose
    // "del 1 al ayer" / "hoy" y el año en curso queda como un solo renglón
    // "ENE. A {mes actual}.".
    function buildResumenCronologico(aggregated, tipo, anios, hoy, diaCorte) {
        const aniosOrdenados = [...new Set(anios || [])].sort((a, b) => a - b);
        const rows = [];
        const tieneCorteDiario = diaCorte !== undefined && diaCorte !== null;
        const dc = diaCorte || { ops: 0, pax: 0, kg: 0 };
        aniosOrdenados.forEach(anio => {
            if (anio < hoy.anio) {
                const t = yearTotals(aggregated, anio)[tipo];
                rows.push({ label: `ENE. A DIC. ${anio}`, ops: t.ops, pax: t.pax, kg: t.kg });
                return;
            }
            if (anio > hoy.anio) return;
            const anioTotal = yearTotals(aggregated, anio)[tipo];
            if (!tieneCorteDiario) {
                const mesAbrev = MONTHS[hoy.mes - 1].short.toUpperCase();
                rows.push({ label: `ENE. A ${mesAbrev}. ${anio}`, ops: anioTotal.ops, pax: anioTotal.pax, kg: anioTotal.kg });
                return;
            }
            const mesTotal = monthTotals(aggregated, anio, hoy.mes)[tipo];
            const previo = {
                ops: anioTotal.ops - mesTotal.ops,
                pax: anioTotal.pax - mesTotal.pax,
                kg: (anioTotal.kg || 0) - (mesTotal.kg || 0)
            };
            if (hoy.mes > 1) {
                rows.push({ label: `ENE. A ${MONTHS[hoy.mes - 2].short.toUpperCase()}. ${anio}`, ...previo });
            }
            const diasAntes = {
                ops: mesTotal.ops - dc.ops,
                pax: mesTotal.pax - dc.pax,
                kg: (mesTotal.kg || 0) - (dc.kg || 0)
            };
            const mesAbrev = MONTHS[hoy.mes - 1].short.toUpperCase();
            if (hoy.dia > 1) {
                rows.push({ label: `DEL 1 AL ${hoy.dia - 1} ${mesAbrev}. ${anio}`, ...diasAntes });
            }
            rows.push({ label: `${hoy.dia} ${mesAbrev}. ${anio}`, ops: dc.ops, pax: dc.pax, kg: dc.kg });
        });
        const total = rows.reduce((acc, row) => {
            acc.ops += row.ops; acc.pax += row.pax; acc.kg += row.kg || 0;
            return acc;
        }, { ops: 0, pax: 0, kg: 0 });
        rows.push({ label: 'TOTAL', ...total });
        return rows;
    }

    // Días del rango [desdeIso, hastaIso] sin ninguna fila capturada
    // (Herramienta 4: alerta de huecos de captura recientes). `rows` ya viene
    // filtrado a ese rango por el llamador (misma consulta que factor de
    // ocupación); esta función solo detecta qué fechas no aparecen en absoluto.
    function findMissingDays(rows, desdeIso, hastaIso) {
        const missing = [];
        if (!desdeIso || !hastaIso) return missing;
        const present = new Set();
        (rows || []).forEach(row => {
            const fecha = row?.fecha_operacion;
            if (fecha) present.add(String(fecha).slice(0, 10));
        });
        const cursor = new Date(`${desdeIso}T12:00:00Z`);
        const end = new Date(`${hastaIso}T12:00:00Z`);
        while (cursor <= end) {
            const iso = cursor.toISOString().slice(0, 10);
            if (!present.has(iso)) missing.push(iso);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return missing;
    }

    function buildComparativaRows(comparacion) {
        return [
            ['Indicador', `Año ${comparacion.anioA}`, `Año ${comparacion.anioB}`, 'Variación %'],
            ...comparacion.rows.map(r => [r.label, r.a, r.b, pct(r.variacion)])
        ];
    }

    function buildProyeccionRows(proyeccion) {
        const row = (label, tipo) => [
            label, proyeccion[tipo].opsActual, proyeccion[tipo].opsProyectado,
            proyeccion[tipo].paxActual, proyeccion[tipo].paxProyectado
        ];
        return [
            ['Tipo', 'Ops. al corte', 'Ops. proyectado', 'Pax. al corte', 'Pax. proyectado'],
            row('Comercial', 'comercial'), row('General', 'general'), row('Carga', 'carga')
        ];
    }

    // Participación por aerolínea para un año dado, a partir de
    // v_informe_estadistico_aerolinea. Ordena por operaciones descendente.
    function aggregateAerolinea(aerolineaRows, anio) {
        const byAirline = new Map();
        (aerolineaRows || []).forEach(row => {
            if (Number(row?.anio) !== Number(anio)) return;
            const nombre = String(row?.aerolinea || 'SIN AEROLÍNEA');
            if (!byAirline.has(nombre)) {
                byAirline.set(nombre, { aerolinea: nombre, ops: 0, pax: 0, kg: 0, tipo: row.tipo_aviacion === 'carga' ? 'carga' : 'comercial' });
            }
            const item = byAirline.get(nombre);
            item.ops += toNumber(row.operaciones);
            item.pax += toNumber(row.pax_total);
            item.kg += toNumber(row.carga_kg_total);
            if (row.tipo_aviacion === 'carga' && item.pax === 0) item.tipo = 'carga';
        });

        const rows = [...byAirline.values()].sort((a, b) => b.ops - a.ops);
        const totalOps = rows.reduce((sum, item) => sum + item.ops, 0);
        const totalPax = rows.reduce((sum, item) => sum + item.pax, 0);
        rows.forEach(item => {
            item.participacionOps = totalOps > 0 ? (item.ops / totalOps) * 100 : 0;
            item.participacionPax = totalPax > 0 ? (item.pax / totalPax) * 100 : 0;
        });
        return { anio: Number(anio), rows, totalOps, totalPax };
    }

    // Cifras de un día específico (filas crudas ya normalizadas de
    // v_informe_manifiestos_normalizado, filtradas a esa fecha por el llamador).
    function aggregateDiaCorte(rows) {
        const result = { fecha: null, comercial: emptyCounters(), carga: emptyCounters() };
        (rows || []).forEach(row => {
            const tipo = row?.es_carga ? 'carga' : 'comercial';
            const ops = 1;
            const pax = toNumber(row.pax_total);
            const kg = toNumber(row.carga_kg);
            result[tipo].ops += ops;
            result[tipo].pax += pax;
            result[tipo].kg += kg;
            if (row.direccion === 'A') result[tipo].opsLlegada += ops;
            else if (row.direccion === 'D') result[tipo].opsSalida += ops;
            if (row.nacional_internacional === 'Nacional') {
                result[tipo].opsNacional += ops;
            } else if (row.nacional_internacional === 'Internacional') {
                result[tipo].opsInternacional += ops;
            }
            if (row.fecha_operacion) result.fecha = row.fecha_operacion;
        });
        return result;
    }

    // Orden institucional de aerolíneas en el Factor de Ocupación, tomado del
    // documento AUTORIZADO. NO es alfabético ni por volumen: es el orden fijo
    // con el que se publica el informe. Las aerolíneas que no estén en esta
    // lista se acomodan después, ya sí alfabéticamente.
    const ORDEN_AEROLINEAS = Object.freeze([
        'AEROMEXICO', 'VOLARIS', 'VIVA AEROBUS', 'AEROLINEA EM',
        'CONVIASA', 'ARAJET', 'AERUS'
    ]);

    function normalizaAerolinea(nombre) {
        return String(nombre || '')
            .toUpperCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            // \s+, no s+: sin la diagonal invertida esto borraba las eses
            // ("VOLARIS" -> "VOLARI"), ningún nombre casaba con
            // ORDEN_AEROLINEAS y el factor de ocupación salía en orden
            // alfabético en vez del orden institucional.
            .replace(/\s+/g, ' ')
            .trim();
    }

    function ordenAerolinea(nombre) {
        const i = ORDEN_AEROLINEAS.indexOf(normalizaAerolinea(nombre));
        return i === -1 ? ORDEN_AEROLINEAS.length : i;
    }

    // Factor de ocupación promedio por aerolínea/destino/dirección, a partir de
    // filas crudas de v_informe_manifiestos_normalizado (últimos N días, ya
    // filtradas por el llamador). La capacidad de asientos ya viene resuelta
    // en cada fila (capacidad_matricula, vía matricula_id → matriculas_manifiestos
    // en la vista SQL) — no requiere un mapa aparte.
    function computeOccupancyFactors(rows) {
        const groups = new Map();
        (rows || []).forEach(row => {
            const capacidad = Number(row?.capacidad_matricula);
            if (!capacidad || !(capacidad > 0)) return;
            const pax = toNumber(row.pax_total);
            const aerolinea = String(row?.aerolinea || 'SIN AEROLÍNEA');
            // `destino` gana sobre `endpoint_code`: el llamador ya resolvió el
            // código de ruta a nombre de ciudad ("CUN" -> "CANCÚN"), y el
            // informe se ordena y se imprime por ciudad, no por código.
            const destino = String(row?.destino || row?.endpoint_code || '').trim().toUpperCase() || 'SIN DESTINO';
            const direccion = row?.direccion === 'A' ? 'llegada' : (row?.direccion === 'D' ? 'salida' : 'otro');
            const key = `${aerolinea}|${destino}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    aerolinea, destino,
                    llegada: { sumaFactor: 0, vuelos: 0 },
                    salida: { sumaFactor: 0, vuelos: 0 }
                });
            }
            const group = groups.get(key);
            if (direccion === 'otro') return;
            const factor = (pax / capacidad) * 100;
            group[direccion].sumaFactor += factor;
            group[direccion].vuelos += 1;
        });

        const rowsOut = [...groups.values()].map(group => {
            const factorLlegada = group.llegada.vuelos > 0 ? group.llegada.sumaFactor / group.llegada.vuelos : null;
            const factorSalida = group.salida.vuelos > 0 ? group.salida.sumaFactor / group.salida.vuelos : null;
            const vuelos = group.llegada.vuelos + group.salida.vuelos;
            const factorTotal = vuelos > 0
                ? (group.llegada.sumaFactor + group.salida.sumaFactor) / vuelos
                : null;
            return {
                aerolinea: group.aerolinea,
                destino: group.destino,
                factorSalida,
                factorLlegada,
                factorTotal
            };
        }).sort((a, b) => {
            const oa = ordenAerolinea(a.aerolinea), ob = ordenAerolinea(b.aerolinea);
            if (oa !== ob) return oa - ob;
            return a.aerolinea.localeCompare(b.aerolinea, 'es') || a.destino.localeCompare(b.destino, 'es');
        });

        const withTotal = rowsOut.filter(r => Number.isFinite(r.factorTotal));
        const promedioGeneral = withTotal.length
            ? withTotal.reduce((sum, r) => sum + r.factorTotal, 0) / withTotal.length
            : null;

        return { rows: rowsOut, promedioGeneral };
    }

    function pct(value) {
        return Number.isFinite(value) ? `${value.toFixed(2)}%` : '';
    }

    function buildAcumuladoRows(acumulado) {
        return [
            ['Tipo de aviación', 'Operaciones', 'Pasajeros', 'Toneladas de carga (kg)'],
            ['Aviación Comercial', acumulado.comercial.ops, acumulado.comercial.pax, ''],
            ['Aviación General', acumulado.general.ops, acumulado.general.pax, ''],
            ['Aviación de Carga', acumulado.carga.ops, '', acumulado.carga.kg],
            ['Total Comercial + General', acumulado.totalOperaciones, acumulado.totalPasajeros, '']
        ];
    }

    function buildMensualRows(aggregated, anio) {
        const rows = [['Mes', 'Tipo', 'Ops. Nacional', 'Ops. Internacional', 'Ops. Total', 'Pax. Nacional', 'Pax. Internacional', 'Pax. Total']];
        MONTHS.forEach(month => {
            const entry = aggregated.porAnioMes.get(`${anio}-${month.number}`);
            if (!entry) return;
            TIPOS.forEach(tipo => {
                const c = entry[tipo];
                if (!c || c.ops === 0) return;
                rows.push([
                    month.name, tipo,
                    c.opsNacional || '', c.opsInternacional || '', c.ops,
                    c.paxNacional || '', c.paxInternacional || '', c.pax
                ]);
            });
        });
        return rows;
    }

    function buildAerolineaRows(aerolineaAgg) {
        return [
            ['Aerolínea', 'Tipo', 'Operaciones', 'Participación Ops.', 'Pasajeros', 'Participación Pax.'],
            ...aerolineaAgg.rows.map(item => [
                item.aerolinea, item.tipo, item.ops, pct(item.participacionOps), item.pax, pct(item.participacionPax)
            ])
        ];
    }

    function buildOcupacionRows(occupancy) {
        return [
            ['Aerolínea', 'Destino', 'Factor de salida', 'Factor de llegada', 'Factor total'],
            ...occupancy.rows.map(item => [
                item.aerolinea, item.destino, pct(item.factorSalida), pct(item.factorLlegada), pct(item.factorTotal)
            ])
        ];
    }

    return Object.freeze({
        MONTHS,
        TIPOS,
        toNumber,
        aggregateResumen,
        mergeOficiales,
        buildAcumulado,
        yearTotals,
        monthTotals,
        pctChange,
        compareYears,
        isLeapYear,
        daysInMonth,
        daysInYear,
        dayOfYear,
        projectValue,
        projectMonthClosure,
        projectYearClosure,
        buildMonthlySeries,
        buildTablaMensualPorAnios,
        buildResumenCronologico,
        findMissingDays,
        normalizaAerolinea,
        aggregateAerolinea,
        aggregateDiaCorte,
        computeOccupancyFactors,
        buildAcumuladoRows,
        buildMensualRows,
        buildAerolineaRows,
        buildOcupacionRows,
        buildComparativaRows,
        buildProyeccionRows
    });
});
