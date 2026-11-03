/**
 * @jest-environment jsdom
 *
 * Vista de Dirección General: con el rol director_general el Inicio muestra
 * solo el banner de cifras con sus tarjetas, los accesos directos de siempre
 * y dos accesos más —Resumen estadístico del periodo y SWEAR— que llaman a
 * las MISMAS funciones de su pantalla de origen, y debajo Operaciones Totales.
 * Subdirecciones, Comparativa Histórica y Conciliación quedan fuera.
 * Para los demás roles nada cambia.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = leer('index.html');
const css = leer('director-general.css');
const script = leer('script.js');
const informe = leer('js', 'estadistico-informe.js');
const fuente = leer('js', 'vista-director-general.js');

// La barra lateral tal como está en index.html (accesos, barra nueva y
// Subdirecciones) y el botón de usuario del encabezado.
const nav = html.slice(html.indexOf('<nav class="nav flex-column si-nav" id="sidebar-nav">'),
    html.indexOf('</nav>', html.indexOf('id="sidebar-nav"')) + '</nav>'.length);
const ventanaInforme = html.slice(html.indexOf('<div class="modal fade" id="modalDgInforme"'), html.indexOf('<!-- MODAL: MENSAJE PARA WHATSAPP'));
// El acordeón de Operaciones Totales, dentro de su pestaña Comparativa.
const FIN_ACORDEON = '</div><!-- /accordion -->';
const acordeon = html.slice(html.indexOf('<div class="accordion accordion-flush" id="yoy-accordion">'), html.indexOf(FIN_ACORDEON) + FIN_ACORDEON.length);
const $ = (id) => document.getElementById(id);
const esperar = () => new Promise((r) => setTimeout(r, 0));
const ordenAccesos = (raizAccesos) => [...raizAccesos.querySelectorAll(':scope > a.si-quick')].map((a) => a.dataset.section);
const ORDEN = ['operaciones-totales', 'inicio', 'frecuencias-semana', 'conciliacion', 'aviacion-general', 'puntualidad-agosto', 'demoras'];

function montar(rol) {
    document.body.className = 'navdeck-mode';
    document.body.innerHTML = `
        <header class="header"><h1 class="main-title"><span class="main-title-app">AEROPUERTO INTERNACIONAL FELIPE ÁNGELES</span></h1>
        <button id="hdr-user-btn"><span class="hdr-user-icono"><i class="fas fa-user"></i></span>
            <b id="hdr-user-nombre">Jennifer Morelia Torres Neri</b></button></header>
        ${nav}
        <div id="analisis-yoy-pane"><div class="ag-wrapper"><p data-totales-leyenda></p>${acordeon}</div></div>
        ${ventanaInforme}`;
    sessionStorage.clear();
    if (rol) sessionStorage.setItem('user_role', rol);
    delete window.InformeEstadistico;
    delete window.conciMensajeEnvio;
    window.eval(fuente);
}

const cambiarRol = (role) => window.dispatchEvent(new CustomEvent('admin-mode-changed', { detail: { role } }));

describe('la vista se enciende solo con el rol Director General', () => {
    test('sin ese rol todo queda como siempre: sin clase y barra oculta', () => {
        montar('superadmin');
        expect(document.body.classList.contains('rol-director-general')).toBe(false);
        expect($('dg-barra').hidden).toBe(true);
        expect(ordenAccesos($('sidebar-nav'))).toEqual(ORDEN);
    });

    test('con el rol, la barra nueva aparece justo después de los accesos de siempre, que no se mueven', () => {
        montar('director_general');
        expect(document.body.classList.contains('rol-director-general')).toBe(true);
        expect($('dg-barra').hidden).toBe(false);
        expect(ordenAccesos($('sidebar-nav'))).toEqual(ORDEN);
        expect($('dg-barra').previousElementSibling.dataset.section).toBe('demoras');
        expect($('dg-barra').querySelectorAll('a.si-quick')).toHaveLength(0);
    });

    test('el rol llega o se va con admin-mode-changed y la barra aparece o se oculta', () => {
        montar('');
        cambiarRol('director_general');
        expect(document.body.classList.contains('rol-director-general')).toBe(true);
        expect($('dg-barra').hidden).toBe(false);

        cambiarRol('editor');
        expect(document.body.classList.contains('rol-director-general')).toBe(false);
        expect($('dg-barra').hidden).toBe(true);
        expect(ordenAccesos($('sidebar-nav'))).toEqual(ORDEN);

        cambiarRol(null); // cierre de sesión
        expect(document.body.classList.contains('rol-director-general')).toBe(false);
    });

    test('pone las iniciales del nombre en el botón de usuario', () => {
        montar('director_general');
        expect(document.querySelector('.hdr-user-iniciales').textContent).toBe('JM');
        expect(window.VistaDirectorGeneral.iniciales('David Escudero')).toBe('DE');
    });

    test('el título "Panel de operaciones" solo se agrega al encender la vista', () => {
        montar('superadmin');
        expect(document.querySelector('.main-title-dg')).toBeNull();
        cambiarRol('director_general');
        const titulo = document.querySelector('.header .main-title .main-title-dg');
        expect(titulo.firstChild.textContent).toBe('Aeropuerto Internacional Felipe Ángeles');
        expect(titulo.querySelector('small').textContent).toBe('Panel de operaciones');
        cambiarRol('director_general');
        expect(document.querySelectorAll('.main-title-dg')).toHaveLength(1);
    });

    test('el fondo del banner, las tarjetas y los accesos son los del Inicio de siempre', () => {
        // La hoja de la vista no toca la foto del banner, las tarjetas ni los accesos.
        ['ndw-hero-media', 'ndw-hero-foto', '.ndw-card {', '.ndw-card-icon', '.dg-barra .si-link'].forEach((sel) => {
            expect(css).not.toContain(sel);
        });
        // Sin pie de página.
        expect(css).not.toContain('dg-pie');
        expect(fuente).not.toContain('dg-pie');
    });
});

describe('Operaciones Totales en el Inicio', () => {
    const ORIGINAL = ['yoy-sub-comercial', 'yoy-sub-aerolineas', 'yoy-sub-general', 'yoy-sub-carga'];
    const EN_INICIO = ['yoy-sub-comercial', 'yoy-sub-carga', 'yoy-sub-general', 'yoy-sub-aerolineas'];
    const orden = () => [...$('yoy-accordion').children].map((el) => el.id);
    const enSuPantalla = () => $('analisis-yoy-pane').querySelector('.ag-wrapper > #yoy-accordion') !== null;

    test('sin el rol, el acordeón se queda en su pantalla y en su orden de siempre', () => {
        montar('superadmin');
        expect($('dg-operaciones').hidden).toBe(true);
        expect(enSuPantalla()).toBe(true);
        expect(orden()).toEqual(ORIGINAL);
    });

    test('con el rol, pasa al Inicio debajo de los accesos: Comercial, Carga, General y Estadístico por Aerolínea', () => {
        montar('director_general');
        expect($('dg-operaciones').hidden).toBe(false);
        expect($('dg-operaciones').previousElementSibling.id).toBe('dg-barra');
        expect($('dg-operaciones').querySelector('h2').textContent).toBe('Operaciones Totales');
        expect($('dg-operaciones').querySelector('[data-totales-leyenda]')).not.toBeNull();
        expect($('yoy-accordion').parentNode.id).toBe('dg-operaciones');
        expect(enSuPantalla()).toBe(false);
        expect(orden()).toEqual(EN_INICIO);
    });

    test('son los mismos nodos: lo que ya estaba enlazado sigue funcionando', () => {
        montar('superadmin');
        const comercial = $('yoy-sub-comercial');
        const exportar = jest.fn();
        $('yoy-export-btn').addEventListener('click', exportar);
        cambiarRol('director_general');
        expect($('yoy-sub-comercial')).toBe(comercial);
        $('yoy-export-btn').click();
        expect(exportar).toHaveBeenCalledTimes(1);
        // Cada id existe una sola vez: no hay copia.
        EN_INICIO.forEach((id) => expect(document.querySelectorAll(`#${id}`)).toHaveLength(1));
    });

    test('al salir del rol regresa a su lugar y a su orden; al volver, se trae otra vez', () => {
        montar('director_general');
        cambiarRol('editor');
        expect($('dg-operaciones').hidden).toBe(true);
        expect(enSuPantalla()).toBe(true);
        expect(orden()).toEqual(ORIGINAL);
        // Sin restos del marcador que guardaba el lugar.
        expect($('analisis-yoy-pane').innerHTML).not.toContain('Inicio de Dirección General');

        cambiarRol('director_general');
        cambiarRol('director_general');
        expect($('yoy-accordion').parentNode.id).toBe('dg-operaciones');
        expect(orden()).toEqual(EN_INICIO);

        cambiarRol(null); // cierre de sesión
        expect(enSuPantalla()).toBe(true);
        expect(orden()).toEqual(ORIGINAL);
    });

    const ABIERTAS_DE_SIEMPRE = ['acc-com-body', 'acc-gen-body', 'acc-cargo-body'];
    const abiertas = () => [...document.querySelectorAll('#yoy-accordion > .accordion-item > .accordion-collapse.show')].map((c) => c.id);
    const botonDe = (id) => document.querySelector(`[data-bs-target="#${id}"]`);
    // Como Bootstrap: primero avisa show.bs.collapse y luego abre.
    const abrir = (id) => {
        $(id).dispatchEvent(new Event('show.bs.collapse', { bubbles: true }));
        $(id).classList.add('show');
    };

    test('en el Inicio empiezan cerradas; de regreso en su pantalla quedan como estaban', () => {
        montar('superadmin');
        expect(abiertas()).toEqual(ABIERTAS_DE_SIEMPRE);

        cambiarRol('director_general');
        expect(abiertas()).toEqual([]);
        ['acc-com-body', 'acc-airline-body', 'acc-gen-body', 'acc-cargo-body'].forEach((id) => {
            expect(botonDe(id).classList.contains('collapsed')).toBe(true);
            expect(botonDe(id).getAttribute('aria-expanded')).toBe('false');
        });

        cambiarRol('editor');
        expect(abiertas()).toEqual(ABIERTAS_DE_SIEMPRE);
        expect(botonDe('acc-com-body').classList.contains('collapsed')).toBe(false);
        expect(botonDe('acc-com-body').getAttribute('aria-expanded')).toBe('true');
        expect(botonDe('acc-airline-body').getAttribute('aria-expanded')).toBe('false');
    });

    test('en el Inicio, abrir una sección cierra la que estaba abierta', () => {
        montar('director_general');
        abrir('acc-com-body');
        expect(abiertas()).toEqual(['acc-com-body']);
        abrir('acc-cargo-body');
        expect(abiertas()).toEqual(['acc-cargo-body']);
        expect(botonDe('acc-com-body').getAttribute('aria-expanded')).toBe('false');

        // Con Bootstrap cargado, la cierra con su propio Collapse (con animación).
        const hide = jest.fn();
        const getOrCreateInstance = jest.fn(() => ({ hide }));
        window.bootstrap = { Collapse: { getOrCreateInstance } };
        abrir('acc-airline-body');
        expect(getOrCreateInstance).toHaveBeenCalledWith($('acc-cargo-body'), { toggle: false });
        expect(hide).toHaveBeenCalledTimes(1);
        delete window.bootstrap;
    });

    test('en su pantalla de siempre, abrir una sección no cierra las demás', () => {
        montar('superadmin');
        abrir('acc-airline-body');
        expect(abiertas()).toEqual(['acc-com-body', 'acc-airline-body', 'acc-gen-body', 'acc-cargo-body']);
    });

    test('Comparativa Histórica y Conciliación se ocultan solo con la clase del rol', () => {
        ['#sidebar-nav > .si-quick--hist', '#sidebar-nav > .si-quick--conci'].forEach((sel) => {
            expect(css).toContain(`:root body.rol-director-general ${sel}`);
        });
        expect(css).toMatch(/\.dg-operaciones\[hidden\],[\s\S]*?display: none !important;/);
    });
});

describe('los dos accesos nuevos llaman a las funciones de su pantalla de origen', () => {
    const OPCIONES = { anios: [2026, 2025, 2024, 2023, 2022], corteIso: '2026-10-12', corteMin: '2022-03-21', corteMax: '2026-10-12' };
    const ventanaAbierta = () => $('modalDgInforme').classList.contains('show');
    const fijarCorte = (valor) => { $('dg-iv-corte').value = valor; $('dg-iv-corte').dispatchEvent(new Event('change', { bubbles: true })); };
    const elegir = (id, valor) => { $(id).value = valor; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
    const opcionesDe = (id) => [...$(id).options].map((o) => o.textContent);
    function conInforme(descargarPdf) {
        window.InformeEstadistico = { opcionesPdf: jest.fn().mockResolvedValue(OPCIONES), descargarPdf };
    }

    test('Informe oficial: antes de descargar pregunta la fecha de corte y los años', async () => {
        montar('director_general');
        const descargarPdf = jest.fn();
        conInforme(descargarPdf);
        expect(document.querySelector('[data-dg-informe] span').textContent).toBe('Informe oficial');

        document.querySelector('[data-dg-informe]').click();
        expect(ventanaAbierta()).toBe(true);
        await esperar(); await esperar();
        expect(descargarPdf).not.toHaveBeenCalled();
        // Corte por omisión: ayer, como el informe oficial.
        expect($('dg-iv-corte').value).toBe('2026-10-12');
        expect($('dg-iv-ayuda').textContent).toBe('El informe acumula del 21 de marzo de 2022 al 12 de octubre de 2026, y las cifras del día son las de esa fecha.');
        // Año y vs, como en la pestaña; con "Todos los años" no hay contra qué comparar.
        expect(opcionesDe('dg-iv-anio')).toEqual(['Todos los años', '2026', '2025', '2024', '2023', '2022']);
        expect($('dg-iv-vs').disabled).toBe(true);
        expect($('dg-iv-descargar').disabled).toBe(false);
    });

    test('descarga con el corte y los años elegidos, sin visto bueno', async () => {
        montar('director_general');
        const descargarPdf = jest.fn(async (avisar) => { avisar('Generando el PDF: hoja 1 de 2…'); return { fileName: 'informe.pdf', corteIso: '2026-09-30', anios: [2026, 2025] }; });
        conInforme(descargarPdf);
        document.querySelector('[data-dg-informe]').click();
        await esperar(); await esperar();

        fijarCorte('2026-09-30');
        elegir('dg-iv-anio', '2026');
        expect($('dg-iv-vs').disabled).toBe(false);
        expect(opcionesDe('dg-iv-vs')).toEqual(['Sin comparar', '2025', '2024', '2023', '2022']);
        elegir('dg-iv-vs', '2025');

        $('dg-iv-descargar').click();
        $('dg-iv-descargar').click(); // doble clic: un solo PDF
        await esperar(); await esperar();
        expect(descargarPdf).toHaveBeenCalledTimes(1);
        expect(descargarPdf.mock.calls[0][1]).toEqual({ corteIso: '2026-09-30', anios: [2026, 2025] });
        expect(ventanaAbierta()).toBe(false);
        expect($('dg-barra-estado').textContent).toBe('Informe oficial descargado en PDF con corte al 30/09/2026 (2026 vs 2025).');

        // La siguiente vez abre con lo último elegido.
        document.querySelector('[data-dg-informe]').click();
        await esperar(); await esperar();
        expect([$('dg-iv-corte').value, $('dg-iv-anio').value, $('dg-iv-vs').value]).toEqual(['2026-09-30', '2026', '2025']);
    });

    test('con "Todos los años" manda sólo el corte, y no deja un corte fuera de rango', async () => {
        montar('director_general');
        const descargarPdf = jest.fn().mockResolvedValue({ corteIso: '2026-10-12' });
        conInforme(descargarPdf);
        document.querySelector('[data-dg-informe]').click();
        await esperar(); await esperar();

        fijarCorte('2026-10-13'); // hoy: el corte llega a ayer
        expect($('dg-iv-descargar').disabled).toBe(true);
        expect($('dg-iv-ayuda').textContent).toContain('debe estar entre el 21 de marzo de 2022 y el 12 de octubre de 2026');

        // Un corte en 2024 no ofrece años posteriores.
        fijarCorte('2024-06-30');
        expect(opcionesDe('dg-iv-anio')).toEqual(['Todos los años', '2024', '2023', '2022']);

        fijarCorte('2026-10-12');
        $('dg-iv-descargar').click();
        await esperar(); await esperar();
        expect(descargarPdf.mock.calls[0][1]).toEqual({ corteIso: '2026-10-12', anios: null });
    });

    test('si el PDF falla, el aviso sale en la ventana y ésta sigue abierta', async () => {
        montar('director_general');
        conInforme(jest.fn().mockRejectedValue(new Error('No se pudo cargar el generador de PDF.')));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        document.querySelector('[data-dg-informe]').click();
        await esperar(); await esperar();
        $('dg-iv-descargar').click();
        await esperar(); await esperar();
        expect($('dg-iv-error').textContent).toContain('No se pudo cargar el generador de PDF.');
        expect($('dg-iv-error').classList.contains('d-none')).toBe(false);
        expect(ventanaAbierta()).toBe(true);
        expect($('dg-iv-descargar').disabled).toBe(false);
        console.error.mockRestore();
    });

    test('SWEAR abre la ventana del botón SWEAR de Manifiestos', () => {
        montar('director_general');
        const abrir = jest.fn().mockResolvedValue(undefined);
        window.conciMensajeEnvio = { abrir };
        document.querySelector('[data-dg-swear]').click();
        expect(abrir).toHaveBeenCalledTimes(1);
    });

    test('el Informe expone el PDF con el mismo armado de "Dar visto bueno", sin subir ni aprobar', () => {
        const cuerpo = informe.slice(informe.indexOf('async function descargarPdf('), informe.indexOf('window.InformeEstadistico = { opcionesPdf, descargarPdf };'));
        expect(cuerpo).toContain('await load();');
        expect(cuerpo).toContain("construirPdfDesdeHtml(buildReportHtml(), PDF_PAGINA, '.informe-hoja'");
        expect(cuerpo).toContain('downloadBlob(pdfBlob, fileName);');
        expect(cuerpo).not.toMatch(/storage|upload|informe_estadistico_aprobaciones|upsert/);
        // El corte elegido sale de la capa de totales hasta ese día, y al final se
        // regresa lo que tenía la pestaña.
        expect(cuerpo).toContain("await datosAlCorte(await getClient(), corteIso);");
        const alCorte = informe.slice(informe.indexOf('async function datosAlCorte('), informe.indexOf('async function descargarPdf('));
        expect(alCorte).toContain("getTotales({ desde: '2022-01-01', hasta: corteIso, granularidad: 'mes' })");
        expect(alCorte).toContain('await loadDetalle(client);');
        expect(cuerpo).toMatch(/finally \{\s*CLAVES_PERIODO\.forEach\(\(k\) => \{ state\[k\] = previo\[k\]; \}\);/);
        // El botón original sigue igual: una sola función de visto bueno.
        expect(informe.match(/async function darVistoBueno\(/g)).toHaveLength(1);
    });
});

describe('qué queda fuera y qué se agrega a la pantalla', () => {
    test('Subdirecciones y las opciones de menú que no usa se ocultan solo con la clase del rol', () => {
        ['#sidebar-nav > .si-sep', '#sidebar-nav > .si-section-lbl', '#sidebar-nav > .si-group',
            '#admin-users-menu', '#data-management-menu'].forEach((sel) => {
            expect(css).toContain(`:root body.rol-director-general ${sel}`);
        });
        // Fuera de la vista, las piezas nuevas no se ven.
        expect(css).toMatch(/\.dg-barra\[hidden\],[\s\S]*?\.ndw-card-cat,[\s\S]*?\.ndw-resumen-cabeza,[\s\S]*?display: none !important;/);
    });

    test('las tarjetas traen categoría y unidad, y el banner su encabezado "Resumen operativo"', () => {
        expect(script).toContain('<span class="ndw-card-cat">');
        expect(script).toContain('<span class="ndw-card-unidad">');
        expect(script).toContain('<div class="ndw-resumen-cabeza"><span class="ndw-resumen-titulo">Resumen operativo</span>');
    });

    test('index.html carga la hoja y el script de la vista, y el rol está en el selector', () => {
        expect(html).toMatch(/<link rel="stylesheet" href="director-general\.css\?v=[^"]+">/);
        expect(html).toMatch(/<script src="js\/vista-director-general\.js\?v=[^"]+" defer><\/script>/);
        expect(html).toContain('<option value="director_general">');
    });
});
