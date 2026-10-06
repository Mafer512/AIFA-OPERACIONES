/* Avisos por periodo de los manifiestos — public.manifiestos_avisos_periodo
 * (supabase/migrations/058). Hoy hay uno: "Carga ene–ago 2026 incompleta",
 * porque los manifiestos de carga de esos meses todavía no están en ninguna
 * de las dos tablas de origen. Se quita sin desplegar la app:
 *     UPDATE public.manifiestos_avisos_periodo SET activo = false
 *      WHERE clave = 'carga_2026_ene_ago';
 * Lo usan el inicio (script.js) y Estadística (estadistica-panel.js,
 * estadistico-informe.js). Si la tabla no existe o la consulta falla, no se
 * muestra nada: el aviso es informativo y nunca debe estorbar.
 */
(function () {
    'use strict';

    let avisos = [];
    let promesa = null;

    const iso = (valor) => String(valor || '').slice(0, 10);

    // Avisos activos de un ámbito ('inicio' | 'estadistica') que se cruzan con
    // [desde, hasta]. categoria opcional: 'carga' | 'comercial'.
    function filtrar(lista, ambito, desde, hasta, categoria) {
        const d = iso(desde);
        const h = iso(hasta) || d;
        if (!d) return [];
        return (lista || []).filter((a) => a && a.activo !== false
            && (!ambito || !Array.isArray(a.ambitos) || a.ambitos.includes(ambito))
            && (!categoria || !a.categoria || a.categoria === 'todas' || a.categoria === categoria)
            && iso(a.desde) <= h && iso(a.hasta) >= d);
    }

    function cargar(forzar) {
        if (promesa && !forzar) return promesa;
        promesa = (async () => {
            try {
                const client = window.supabaseClient
                    || (window.ensureSupabaseClient && await window.ensureSupabaseClient());
                if (!client) return avisos;
                const { data, error } = await client.from('manifiestos_avisos_periodo')
                    .select('clave,texto,detalle,desde,hasta,categoria,ambitos,activo')
                    .eq('activo', true);
                if (error) throw error;
                avisos = Array.isArray(data) ? data : [];
                try { document.dispatchEvent(new CustomEvent('manifiestos-avisos:listos')); } catch (_) { /* sin DOM */ }
            } catch (error) {
                console.info('[Avisos de manifiestos] Sin avisos de periodo:', error?.message || error);
                avisos = [];
            }
            return avisos;
        })();
        return promesa;
    }

    const api = {
        cargar,
        filtrar,
        para: (ambito, desde, hasta, categoria) => filtrar(avisos, ambito, desde, hasta, categoria),
        lista: () => avisos.slice()
    };

    if (typeof window !== 'undefined') window.ManifiestosAvisos = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
