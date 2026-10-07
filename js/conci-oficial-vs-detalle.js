/* Conciliación · Oficial vs Detalle
 *
 * Por mes y por categoría (Comercial, Carga, Aviación General), la cifra
 * oficial (v_cifras_oficiales_vigentes) contra lo que suma el detalle
 * (totales_detalle_por_dia: manifiestos por FECHA y directorio de AG), para
 * los meses completos hasta fn_fecha_corte_oficial. Todo sale de
 * js/totales-service.js: aquí sólo se resta y se pinta.
 *
 * Diferencia = detalle − oficial; % sobre la cifra oficial.
 */
(function (root) {
    'use strict';

    const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
        'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const CATEGORIAS = [
        { clave: 'comercial', titulo: 'Comercial', segunda: 'pasajeros', etiqueta: 'Pasajeros' },
        { clave: 'carga', titulo: 'Carga', segunda: 'toneladas', etiqueta: 'Toneladas' },
        { clave: 'general', titulo: 'Aviación General', segunda: 'pasajeros', etiqueta: 'Pasajeros' }
    ];
    const pad = (n) => String(n).padStart(2, '0');
    const finDeMes = (anio, mes) => `${anio}-${pad(mes)}-${pad(new Date(anio, mes, 0).getDate())}`;

    function fmt(valor, decimales) {
        if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return '—';
        return Number(valor).toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    }

    function diferencia(oficial, detalle) {
        if (oficial === null || oficial === undefined) return { abs: null, pct: null };
        const abs = (Number(detalle) || 0) - Number(oficial);
        return { abs, pct: Number(oficial) ? (abs / Number(oficial)) * 100 : null };
    }

    // Filas de la tabla para un año: una por mes y categoría.
    function construirFilas(anio, corte, oficialPorMes, detallePorDia) {
        const filas = [];
        for (let mes = 1; mes <= 12; mes += 1) {
            const fin = finDeMes(anio, mes);
            if (fin > corte) break;
            const clave = `${anio}-${pad(mes)}`;
            const oficial = oficialPorMes.get(clave) || {};
            const detalle = {
                comercial: { operaciones: 0, pasajeros: 0 },
                carga: { operaciones: 0, toneladas: 0 },
                general: { operaciones: 0, pasajeros: 0 }
            };
            detallePorDia.forEach((dia, fecha) => {
                if (fecha.slice(0, 7) !== clave) return;
                CATEGORIAS.forEach(({ clave: cat }) => {
                    Object.keys(detalle[cat]).forEach((k) => { detalle[cat][k] += Number(dia[cat]?.[k]) || 0; });
                });
            });
            CATEGORIAS.forEach((cat) => {
                const o = oficial[cat.clave] || null;
                const d = detalle[cat.clave];
                const segDetalle = cat.segunda === 'toneladas' ? Math.round(d.toneladas * 100) / 100 : d[cat.segunda];
                filas.push({
                    mes, clave, categoria: cat.titulo, etiqueta: cat.etiqueta, decimales: cat.segunda === 'toneladas' ? 2 : 0,
                    opsOficial: o ? o.operaciones : null, opsDetalle: d.operaciones,
                    ops: diferencia(o ? o.operaciones : null, d.operaciones),
                    segOficial: o ? o[cat.segunda] : null,
                    segDetalle,
                    seg: diferencia(o ? o[cat.segunda] : null, segDetalle)
                });
            });
        }
        return filas;
    }

    function celdaDif(dif, decimales) {
        if (dif.abs === null) return '<td class="text-end text-muted">—</td><td class="text-end text-muted">—</td>';
        const fuera = dif.pct !== null && Math.abs(dif.pct) > 2;
        const clase = dif.abs === 0 ? 'text-success' : (fuera ? 'text-danger fw-semibold' : '');
        const signo = dif.abs > 0 ? '+' : '';
        return `<td class="text-end ${clase}">${signo}${fmt(dif.abs, decimales)}</td>`
            + `<td class="text-end ${clase}">${dif.pct === null ? '—' : `${signo}${fmt(dif.pct, 2)}%`}</td>`;
    }

    function pintar(filas, tabla) {
        if (!tabla) return;
        tabla.querySelector('thead').innerHTML = `<tr>
            <th>Mes</th><th>Categoría</th>
            <th class="text-end">Ops. oficial</th><th class="text-end">Ops. detalle</th><th class="text-end">Dif.</th><th class="text-end">%</th>
            <th>Métrica</th>
            <th class="text-end">Oficial</th><th class="text-end">Detalle</th><th class="text-end">Dif.</th><th class="text-end">%</th>
        </tr>`;
        tabla.querySelector('tbody').innerHTML = filas.length
            ? filas.map((f) => `<tr>
                <td>${MESES[f.mes - 1]}</td><td>${f.categoria}</td>
                <td class="text-end">${fmt(f.opsOficial, 0)}</td><td class="text-end">${fmt(f.opsDetalle, 0)}</td>${celdaDif(f.ops, 0)}
                <td>${f.etiqueta}</td>
                <td class="text-end">${fmt(f.segOficial, f.decimales)}</td><td class="text-end">${fmt(f.segDetalle, f.decimales)}</td>${celdaDif(f.seg, f.decimales)}
            </tr>`).join('')
            : '<tr><td colspan="11" class="text-center text-muted">Sin meses oficiales en este año.</td></tr>';
    }

    /* ── Sólo para super admin ─────────────────────────────────────────────
       La pestaña nace oculta en index.html y sólo se muestra a quien tiene el
       rol super admin; los demás roles no ven ni el botón ni consultan nada.
       El rol llega escrito de varias formas ("superadmin", "Super Admin",
       "SUPER_ADMIN"): se compara sin espacios ni guiones. */
    function rolActual() {
        try {
            if (typeof root._conciCurrentUserRole === 'function') return root._conciCurrentUserRole();
        } catch (_) { /* sin la tabla de Conciliación, la sesión */ }
        try { return root.sessionStorage?.getItem('user_role') || root.dataManager?.userRole || ''; } catch (_) { return ''; }
    }
    const esSuperAdmin = () => String(rolActual() || '').toLowerCase().replace(/[^a-z]/g, '') === 'superadmin';

    function aplicarVisibilidad() {
        if (typeof document === 'undefined') return false;
        const tab = document.getElementById('tab-conci-oficial-detalle');
        if (!tab) return false;
        const ve = esSuperAdmin();
        (tab.closest('li') || tab).classList.toggle('d-none', !ve);
        document.getElementById('pane-conci-oficial-detalle')?.classList.toggle('d-none', !ve);
        // Si quedó abierta (otra sesión en la misma pestaña), vuelve al Itinerario.
        if (!ve && tab.classList.contains('active')) {
            const inicio = document.getElementById('tab-conci-itinerario');
            const Tab = root.bootstrap && root.bootstrap.Tab;
            if (inicio && Tab && typeof Tab.getOrCreateInstance === 'function') Tab.getOrCreateInstance(inicio).show();
            else {
                tab.classList.remove('active');
                document.getElementById('pane-conci-oficial-detalle')?.classList.remove('active', 'show');
                inicio?.classList.add('active');
                document.getElementById('pane-conci-itinerario')?.classList.add('active', 'show');
            }
        }
        return ve;
    }

    async function cargar(anioPedido) {
        if (!esSuperAdmin()) return;
        const servicio = root.TotalesService;
        const estado = document.getElementById('conci-ovd-estado');
        const tabla = document.getElementById('conci-ovd-tabla');
        const selector = document.getElementById('conci-ovd-anio');
        if (!servicio || !tabla) return;
        if (estado) estado.textContent = 'Consultando cifras oficiales y detalle…';
        try {
            const corte = await servicio.getCorteOficial();
            const anioCorte = Number(corte.slice(0, 4));
            if (selector && !selector.options.length) {
                for (let a = anioCorte; a >= 2022; a -= 1) selector.add(new Option(String(a), String(a)));
            }
            const anio = Number(anioPedido || (selector && selector.value) || anioCorte);
            const hasta = `${anio}-12-31` < corte ? `${anio}-12-31` : corte;
            const [oficial, detalle] = await Promise.all([
                servicio.getOficialMensual(),
                `${anio}-01-01` <= hasta ? servicio.getDetalleDiario(`${anio}-01-01`, hasta) : Promise.resolve(new Map())
            ]);
            pintar(construirFilas(anio, corte, oficial, detalle), tabla);
            servicio.pintarLeyendas(document.getElementById('pane-conci-oficial-detalle'));
            if (estado) estado.textContent = '';
        } catch (error) {
            console.warn('[Oficial vs Detalle] No se pudo consultar:', error);
            if (estado) estado.textContent = 'No fue posible consultar las cifras. Intenta actualizar.';
        }
    }

    function iniciar() {
        const tab = document.getElementById('tab-conci-oficial-detalle');
        if (!tab || tab._ovdListo) return;
        tab._ovdListo = true;
        // El rol se confirma al iniciar sesión (admin-mode-changed) y puede
        // cambiar si otra persona entra en la misma ventana.
        aplicarVisibilidad();
        root.addEventListener?.('admin-mode-changed', aplicarVisibilidad);
        document.getElementById('conciliacion-tabs')?.addEventListener('show.bs.tab', aplicarVisibilidad);
        tab.addEventListener('shown.bs.tab', () => cargar());
        document.getElementById('conci-ovd-anio')?.addEventListener('change', (ev) => cargar(ev.target.value));
        document.getElementById('conci-ovd-actualizar')?.addEventListener('click', () => {
            root.TotalesService?.invalidar?.();
            cargar();
        });
        if (tab.classList.contains('active')) cargar();
    }

    const api = { construirFilas, cargar, esSuperAdmin, aplicarVisibilidad };
    root.ConciOficialVsDetalle = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
        else iniciar();
    }
})(typeof window !== 'undefined' ? window : globalThis);
