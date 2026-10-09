/* Totales unificados — ÚNICA capa que decide de dónde sale cada total.
 *
 * Regla (Dirección de Operación, 2026-10):
 *   · Totales MENSUALES y ANUALES: los meses COMPLETOS con fin <= corte oficial
 *     (fn_fecha_corte_oficial, config_fuentes.fecha_corte_oficial) salen de
 *     v_cifras_oficiales_vigentes; lo posterior al corte y los días sueltos de
 *     un rango libre salen del DETALLE.
 *   · DETALLE (día, semana, listados): totales_detalle_por_dia (migración 062b),
 *     por la FECHA del manifiesto. Comercial y Carga: maestra_manifiestos con
 *     FECHA <= fn_fecha_corte_maestra y "Conciliación Manifiestos" después.
 *     Aviación General: aviacion_general_operaciones, con la misma regla que
 *     aviacion_general_resumen (FBO), así Inicio y FBO coinciden.
 *   · Con filtros dimensionales (aerolínea, matrícula, origen/destino, …) no
 *     hay cifra oficial: quien llama usa su propio detalle y muestra AVISO_DETALLE.
 *
 * Ninguna pantalla decide la fuente por su cuenta: todas llaman a getTotales()
 * (o a filasMensuales()/filasAnuales(), que son lo mismo con la forma de las
 * tablas viejas monthly_operations/annual_operations).
 *
 * Caché en memoria con TTL de 5 minutos. Si el corte oficial o el de la maestra
 * cambian, se vacía todo lo demás.
 */
(function (root) {
    'use strict';

    const TTL_MS = 5 * 60 * 1000;
    const DETALLE_TIMEOUT_MS = 15000;
    const AVISO_DETALLE = 'Cifras de detalle operativo; pueden diferir de la cifra oficial';
    const CATEGORIAS = Object.freeze(['comercial', 'carga', 'general']);
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
        'septiembre', 'octubre', 'noviembre', 'diciembre'];
    // Llaves de filtro que NO son dimensionales (el rango de fechas).
    const LLAVES_NO_DIMENSIONALES = new Set(['fecha_inicio', 'fecha_fin', 'desde', 'hasta', 'fecha_desde', 'fecha_hasta']);
    const PRIMER_MES = '2022-01-01';

    const pad = (n) => String(n).padStart(2, '0');
    const iso = (valor) => String(valor || '').slice(0, 10);
    const diasEnMes = (anio, mes) => new Date(anio, mes, 0).getDate();
    const finDeMes = (anio, mes) => `${anio}-${pad(mes)}-${pad(diasEnMes(anio, mes))}`;
    const redondear2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

    function vacio() {
        return {
            comercial: { operaciones: 0, pasajeros: 0 },
            carga: { operaciones: 0, toneladas: 0 },
            general: { operaciones: 0, pasajeros: 0 }
        };
    }

    function sumarEn(destino, origen, cats) {
        (cats || CATEGORIAS).forEach((cat) => {
            const d = destino[cat];
            const o = origen && origen[cat];
            if (!o) return;
            Object.keys(d).forEach((k) => { d[k] += Number(o[k]) || 0; });
        });
        return destino;
    }

    function redondearToneladas(valores) {
        valores.carga.toneladas = redondear2(valores.carga.toneladas);
        return valores;
    }

    function hayFiltros(filtros) {
        if (!filtros || typeof filtros !== 'object') return false;
        return Object.keys(filtros).some((k) => {
            if (LLAVES_NO_DIMENSIONALES.has(k)) return false;
            const v = filtros[k];
            if (Array.isArray(v)) return v.length > 0;
            return v !== null && v !== undefined && String(v).trim() !== '';
        });
    }

    function nombreMes(isoFecha) {
        const [anio, mes] = iso(isoFecha).split('-').map(Number);
        return anio && mes ? `${MESES[mes - 1]} ${anio}` : '';
    }

    function leyendaFuente(corteOficial) {
        return corteOficial
            ? `Cifras oficiales hasta ${nombreMes(corteOficial)} · posteriores: conciliación de manifiestos`
            : 'Cifras de conciliación de manifiestos';
    }

    // Meses que toca [desde, hasta], con el tramo de cada uno dentro del rango.
    function mesesDelRango(desde, hasta) {
        const salida = [];
        const [a0, m0] = desde.split('-').map(Number);
        const [a1, m1] = hasta.split('-').map(Number);
        for (let anio = a0, mes = m0; anio < a1 || (anio === a1 && mes <= m1);) {
            const ini = `${anio}-${pad(mes)}-01`;
            const fin = finDeMes(anio, mes);
            const tramoIni = desde > ini ? desde : ini;
            const tramoFin = hasta < fin ? hasta : fin;
            salida.push({ clave: `${anio}-${pad(mes)}`, anio, mes, ini, fin, tramoIni, tramoFin,
                completo: tramoIni === ini && tramoFin === fin });
            mes += 1;
            if (mes > 12) { mes = 1; anio += 1; }
        }
        return salida;
    }

    function sumarDias(isoFecha, dias) {
        const [a, m, d] = iso(isoFecha).split('-').map(Number);
        const f = new Date(a, m - 1, d + dias);
        return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
    }

    // Une los tramos de detalle contiguos para pedirlos en una sola consulta.
    function unirTramos(tramos) {
        const ordenados = tramos.slice().sort((a, b) => a.desde.localeCompare(b.desde));
        const unidos = [];
        ordenados.forEach((t) => {
            const ultimo = unidos[unidos.length - 1];
            if (ultimo && sumarDias(ultimo.hasta, 1) >= t.desde) {
                if (t.hasta > ultimo.hasta) ultimo.hasta = t.hasta;
            } else {
                unidos.push({ desde: t.desde, hasta: t.hasta });
            }
        });
        return unidos;
    }

    function crear(opciones) {
        const cfg = Object.assign({
            cliente: null,                       // () => cliente de Supabase (o promesa)
            ahora: () => Date.now(),
            hoy: () => {
                const d = new Date();
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            }
        }, opciones || {});

        const cache = new Map();
        const cortesVistos = {};

        async function cliente() {
            const fuente = cfg.cliente
                || (() => root.supabaseClient || (root.ensureSupabaseClient && root.ensureSupabaseClient()));
            const c = await fuente();
            if (!c) throw new Error('No hay conexión con la base de datos.');
            return c;
        }

        function cacheado(clave, fn) {
            const entrada = cache.get(clave);
            if (entrada && cfg.ahora() - entrada.t < TTL_MS) return entrada.p;
            const p = Promise.resolve().then(fn);
            cache.set(clave, { t: cfg.ahora(), p });
            p.catch(() => { if (cache.get(clave)?.p === p) cache.delete(clave); });
            return p;
        }

        function invalidar() {
            cache.clear();
        }

        async function leerCorte(rpc) {
            const valor = await cacheado(`corte:${rpc}`, async () => {
                const c = await cliente();
                const { data, error } = await c.rpc(rpc);
                if (error) throw error;
                const fecha = iso(Array.isArray(data) ? data[0] : data);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`${rpc} no devolvió una fecha`);
                return fecha;
            });
            // Si el corte cambió, todo lo calculado con el corte anterior se tira.
            if (cortesVistos[rpc] && cortesVistos[rpc] !== valor) {
                invalidar();
                cache.set(`corte:${rpc}`, { t: cfg.ahora(), p: Promise.resolve(valor) });
            }
            cortesVistos[rpc] = valor;
            return valor;
        }

        // En cuanto se conoce el corte oficial (ya con sesión), se pintan las
        // leyendas declaradas en el HTML; otra vez si el corte cambia.
        let leyendasDe = null;
        async function getCorteOficial() {
            const corte = await leerCorte('fn_fecha_corte_oficial');
            if (leyendasDe !== corte) {
                leyendasDe = corte;
                setTimeout(() => { pintarLeyendas().catch(() => {}); }, 0);
            }
            return corte;
        }
        const getCorteMaestra = () => leerCorte('fn_fecha_corte_maestra');

        // 'AAAA-MM' -> { comercial, carga, general } con sólo las categorías que
        // la cifra oficial trae.
        function getOficialMensual() {
            return cacheado('oficial', async () => {
                const c = await cliente();
                const mapa = new Map();
                for (let desde = 0; ; desde += 1000) {
                    const { data, error } = await c.from('v_cifras_oficiales_vigentes')
                        .select('anio,mes,categoria,operaciones,pasajeros,toneladas')
                        .order('anio', { ascending: true }).order('mes', { ascending: true })
                        .order('categoria', { ascending: true })
                        .range(desde, desde + 999);
                    if (error) throw error;
                    (data || []).forEach((r) => {
                        const cat = String(r.categoria || '').toLowerCase();
                        if (!CATEGORIAS.includes(cat)) return;
                        const clave = `${r.anio}-${pad(r.mes)}`;
                        if (!mapa.has(clave)) mapa.set(clave, {});
                        mapa.get(clave)[cat] = cat === 'carga'
                            ? { operaciones: Number(r.operaciones) || 0, toneladas: Number(r.toneladas) || 0 }
                            : { operaciones: Number(r.operaciones) || 0, pasajeros: Number(r.pasajeros) || 0 };
                    });
                    if (!data || data.length < 1000) break;
                }
                return mapa;
            });
        }

        // Detalle diario: Map 'AAAA-MM-DD' -> { comercial, carga, general }.
        function getDetalleDiario(desde, hasta, opciones) {
            const d = iso(desde);
            const h = iso(hasta || desde);
            if (opciones && opciones.forzar) cache.delete(`detalle:${d}:${h}`);
            return cacheado(`detalle:${d}:${h}`, () => {
                const controller = new AbortController();
                let timer;
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error('La consulta de cifras tardó demasiado. Intenta actualizar.'));
                        controller.abort();
                    }, d === h ? DETALLE_TIMEOUT_MS : 60000);
                });
                const consulta = (async () => {
                    const c = await cliente();
                    if (controller.signal.aborted) throw new Error('Consulta cancelada');
                    const mapa = new Map();
                    for (let offset = 0; ; offset += 1000) {
                        const query = c.rpc('totales_detalle_por_dia', { p_desde: d, p_hasta: h })
                            .range(offset, offset + 999);
                        const { data, error } = await (query.abortSignal ? query.abortSignal(controller.signal) : query);
                        if (error) throw error;
                        (data || []).forEach((r) => {
                            const fecha = iso(r.fecha);
                            const cat = String(r.categoria || '').toLowerCase();
                            if (!fecha || !CATEGORIAS.includes(cat)) return;
                            if (!mapa.has(fecha)) mapa.set(fecha, vacio());
                            const dia = mapa.get(fecha)[cat];
                            dia.operaciones += Number(r.operaciones) || 0;
                            if (cat === 'carga') dia.toneladas += Number(r.toneladas) || 0;
                            else dia.pasajeros += Number(r.pasajeros) || 0;
                        });
                        if (!data || data.length < 1000) break;
                    }
                    return mapa;
                })();
                return Promise.race([consulta, timeout]).finally(() => clearTimeout(timer));
            });
        }

        function sumarDetalle(mapa, desde, hasta) {
            const total = vacio();
            mapa.forEach((dia, fecha) => {
                if (fecha >= desde && fecha <= hasta) sumarEn(total, dia);
            });
            return total;
        }

        // getTotales({ desde, hasta, granularidad: 'total'|'mes'|'anio', filtros })
        async function getTotales(params) {
            const p = params || {};
            const desde = iso(p.desde);
            const hasta = iso(p.hasta);
            if (!desde || !hasta || hasta < desde) throw new Error('getTotales necesita desde <= hasta (AAAA-MM-DD).');
            if (hayFiltros(p.filtros)) {
                return { filtrado: true, aviso: AVISO_DETALLE, leyenda: AVISO_DETALLE, total: null, periodos: [] };
            }
            const [corte, oficial] = await Promise.all([getCorteOficial(), getOficialMensual()]);
            const meses = mesesDelRango(desde, hasta);

            // Qué meses (y qué categorías) son oficiales.
            meses.forEach((m) => {
                m.fuentes = {};
                const ofi = m.completo && m.fin <= corte ? oficial.get(m.clave) : null;
                CATEGORIAS.forEach((cat) => { m.fuentes[cat] = ofi && ofi[cat] ? 'oficial' : 'detalle'; });
                m.necesitaDetalle = CATEGORIAS.some((cat) => m.fuentes[cat] === 'detalle');
            });

            const tramos = unirTramos(meses.filter((m) => m.necesitaDetalle)
                .map((m) => ({ desde: m.tramoIni, hasta: m.tramoFin })));
            const detalles = await Promise.all(tramos.map((t) => getDetalleDiario(t.desde, t.hasta)));
            const detalle = new Map();
            detalles.forEach((mapa) => mapa.forEach((v, k) => detalle.set(k, v)));

            const porMes = meses.map((m) => {
                const valores = vacio();
                const ofi = oficial.get(m.clave) || {};
                const calc = m.necesitaDetalle ? sumarDetalle(detalle, m.tramoIni, m.tramoFin) : null;
                CATEGORIAS.forEach((cat) => {
                    valores[cat] = Object.assign({}, m.fuentes[cat] === 'oficial' ? ofi[cat] : calc[cat]);
                });
                const usadas = new Set(Object.values(m.fuentes));
                return Object.assign(redondearToneladas(valores), {
                    clave: m.clave, anio: m.anio, mes: m.mes, desde: m.tramoIni, hasta: m.tramoFin,
                    completo: m.completo, fuentes: m.fuentes,
                    fuente: usadas.size > 1 ? 'mixta' : [...usadas][0]
                });
            });

            const agrupar = (lista, claveDe) => {
                const grupos = new Map();
                lista.forEach((m) => {
                    const k = claveDe(m);
                    if (!grupos.has(k)) grupos.set(k, { clave: k, anio: m.anio, desde: m.desde, hasta: m.hasta, valores: vacio(), fuentes: new Set() });
                    const g = grupos.get(k);
                    sumarEn(g.valores, m);
                    if (m.hasta > g.hasta) g.hasta = m.hasta;
                    Object.values(m.fuentes).forEach((f) => g.fuentes.add(f));
                });
                return [...grupos.values()].map((g) => Object.assign(redondearToneladas(g.valores), {
                    clave: g.clave, anio: g.anio, desde: g.desde, hasta: g.hasta,
                    fuente: g.fuentes.size > 1 ? 'mixta' : [...g.fuentes][0]
                }));
            };

            const total = agrupar(porMes, () => 'total')[0] || Object.assign(vacio(), { fuente: 'detalle' });
            const periodos = p.granularidad === 'mes' ? porMes
                : p.granularidad === 'anio' ? agrupar(porMes, (m) => String(m.anio))
                : [];
            return {
                filtrado: false,
                corteOficial: corte,
                total,
                periodos,
                combinaFuentes: total.fuente === 'mixta',
                leyenda: leyendaFuente(corte),
                aviso: null
            };
        }

        // Toda la historia (desde 2022) hasta el fin del mes en curso, por mes.
        async function historiaMensual() {
            const hoy = cfg.hoy();
            const [a, m] = hoy.split('-').map(Number);
            const r = await getTotales({ desde: PRIMER_MES, hasta: finDeMes(a, m), granularidad: 'mes' });
            return r.periodos.filter((p) => p.desde <= hoy && CATEGORIAS.some((cat) =>
                Object.values(p[cat]).some((v) => Number(v) !== 0)));
        }

        // Con la forma de monthly_operations, para las pantallas que ya la leían.
        async function filasMensuales() {
            const meses = await historiaMensual();
            return meses.map((p) => ({
                year: p.anio, month: p.mes,
                comercial_ops: p.comercial.operaciones, comercial_pax: p.comercial.pasajeros,
                carga_ops: p.carga.operaciones, carga_tons: p.carga.toneladas,
                general_ops: p.general.operaciones, general_pax: p.general.pasajeros,
                is_official: p.fuente === 'oficial',
                fuente: p.fuente
            }));
        }

        // Con la forma de annual_operations; cada año es la suma de sus meses.
        async function filasAnuales() {
            const meses = await filasMensuales();
            const porAnio = new Map();
            meses.forEach((r) => {
                if (!porAnio.has(r.year)) porAnio.set(r.year, {
                    year: r.year, comercial_ops_total: 0, comercial_pax_total: 0, carga_ops_total: 0,
                    carga_tons_total: 0, general_ops_total: 0, general_pax_total: 0, is_official: true
                });
                const a = porAnio.get(r.year);
                a.comercial_ops_total += r.comercial_ops; a.comercial_pax_total += r.comercial_pax;
                a.carga_ops_total += r.carga_ops; a.carga_tons_total += r.carga_tons;
                a.general_ops_total += r.general_ops; a.general_pax_total += r.general_pax;
                a.is_official = a.is_official && r.is_official;
            });
            return [...porAnio.values()]
                .map((a) => Object.assign(a, { carga_tons_total: redondear2(a.carga_tons_total) }))
                .sort((x, y) => y.year - x.year);
        }

        // Rellena las leyendas declaradas en el HTML:
        //   [data-totales-leyenda]           → "Cifras oficiales hasta … · posteriores: …"
        //   [data-totales-leyenda="detalle"] → aviso de detalle + la leyenda
        async function pintarLeyendas(raiz) {
            const host = raiz || (typeof document !== 'undefined' ? document : null);
            if (!host || typeof host.querySelectorAll !== 'function') return;
            let corte = null;
            try { corte = await leerCorte('fn_fecha_corte_oficial'); } catch (_) { /* informativo */ }
            // Sin corte (todavía sin sesión) no se escribe nada: mejor vacío que equivocado.
            if (!corte) return;
            host.querySelectorAll('[data-totales-leyenda]').forEach((el) => {
                el.textContent = el.getAttribute('data-totales-leyenda') === 'detalle'
                    ? `${AVISO_DETALLE} · ${leyendaFuente(corte)}`
                    : leyendaFuente(corte);
            });
        }

        return {
            AVISO_DETALLE,
            CATEGORIAS,
            hayFiltros,
            leyendaFuente,
            nombreMes,
            getCorteOficial,
            getCorteMaestra,
            getOficialMensual,
            getDetalleDiario,
            getTotales,
            historiaMensual,
            filasMensuales,
            filasAnuales,
            pintarLeyendas,
            invalidar,
            _mesesDelRango: mesesDelRango
        };
    }

    const api = crear();
    api.crear = crear;
    if (typeof root !== 'undefined' && root) root.TotalesService = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', () => {
            // Las leyendas necesitan sesión para leer el corte: se reintenta cada
            // 5 segundos (hasta 10 minutos) hasta conseguirlo. Después, cada vez
            // que una pantalla lee el corte se vuelven a pintar.
            let intentos = 0;
            const intentar = () => {
                api.getCorteOficial().catch(() => {
                    intentos += 1;
                    if (intentos < 120) setTimeout(intentar, 5000);
                });
            };
            setTimeout(intentar, 1500);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
