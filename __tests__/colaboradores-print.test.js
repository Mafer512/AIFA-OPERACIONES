const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function between(start, end) {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error(`No se encontró el bloque: ${start}`);
    return html.slice(from, to);
}

describe('impresión completa de la ficha de colaboradores', () => {
    const printCss = between('@media print {\n                            /* Ocultar toda la app excepto la ficha */', '/* --- BOTÓN NUEVO COLABORADOR --- */');
    const printFunction = between('window.colabImprimirFicha = async function()', '/** Mostrar/ocultar botón "Nuevo Colaborador"');
    const fichaMarkup = between('<div class="colab-ficha" id="colab-ficha-content">', '</div><!-- /colab-ficha -->');
    const vacationMarkup = between('<div class="colab-vac-panel d-none" id="colab-vac-panel">', '</div><!-- /colab-card-wrapper -->');

    test('la ficha participa en el flujo normal y no usa una posición fija', () => {
        expect(printCss).toContain('position: static !important');
        expect(printCss).toContain('height: auto !important');
        expect(printCss).toContain('max-height: none !important');
        expect(printCss).toContain('overflow: visible !important');
        expect(printCss).not.toContain('position: fixed !important');
        expect(printCss).not.toMatch(/transform:\s*scale|\bzoom\s*:/i);
    });

    test('configura A4 vertical con márgenes legibles y saltos multipágina', () => {
        expect(printCss).toContain('@page { size: A4 portrait; margin: 10mm; }');
        expect(printCss).toContain('break-inside: avoid-page');
        expect(printCss).toContain('page-break-inside: avoid');
        expect(printCss).toContain('break-after: avoid-page');
        expect(printCss).toContain('break-inside: auto');
    });

    test('incluye todas las secciones posteriores a Amonestaciones', () => {
        for (const text of [
            'Comentarios',
            'Datos de Emergencia',
            'Datos Civiles',
            'Currículum Vitae',
            'Cursos y Capacitaciones'
        ]) {
            expect(fichaMarkup).toContain(text);
        }
        expect(printCss).toContain('.colab-emergency-panel, .colab-datos-civiles');
        expect(printCss).toContain('.colab-cv-panel, #colab-cursos-alert-banner');
        expect(printCss).toContain('#colab-cursos-list, .colab-cursos-folder');
        expect(printCss).not.toMatch(/\.colab-emergency-panel[^}]*display:\s*none/i);
        expect(printCss).not.toMatch(/#colab-cursos-list[^}]*display:\s*none/i);
        expect(vacationMarkup).toContain('Vacaciones');
        expect(printCss).toMatch(/\.colab-vac-panel[\s\S]*?display:\s*block\s*!important/);
    });

    test('expande las carpetas de cursos sin convertir toda la lista en un bloque indivisible', () => {
        expect(printCss).toContain('.colab-cursos-folder-body.collapsed');
        expect(printCss).toMatch(/\.colab-cursos-folder-body\.collapsed[\s\S]*?display:\s*block\s*!important/);
        expect(printCss).toMatch(/#colab-cursos-list,[\s\S]*?break-inside:\s*auto/);
    });

    test('comentarios y amonestaciones extensos no conservan scroll ni altura máxima', () => {
        expect(printCss).toMatch(/#cf-amonestaciones-list \.ca-list,[\s\S]*?#cf-comentarios-list \.ca-list[\s\S]*?max-height:\s*none\s*!important/);
        expect(printCss).toMatch(/#cf-amonestaciones-list \.ca-list,[\s\S]*?overflow:\s*visible\s*!important/);
        expect(printCss).toMatch(/#cf-comentarios-list \.ca-item[\s\S]*?background:\s*#fafbfd\s*!important/);
    });

    test('espera datos e imágenes antes de imprimir y elimina handlers de la copia', () => {
        expect(printFunction).toContain('await colabPrepareFichaForPrint()');
        expect(printFunction).toContain('await colabWaitForPrintAssets');
        expect(html).toContain('vacLoadForColab(numEmpl)');
        expect(printFunction).toContain("_ccSearchText = ''");
        expect(printFunction).toContain("printRoot.id = 'colab-print-document'");
        expect(printFunction).toContain("vacationClone.classList.remove('d-none')");
        expect(printFunction).toContain("if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name)");
        expect(printFunction).not.toContain('}, 1400)');
    });

    test('solo oculta controles, no los paneles con información', () => {
        expect(printFunction).toContain('.colab-cv-actions,#colab-cv-inline-preview,');
        expect(printFunction).toContain('#colab-cursos-toolbar,#colab-cursos-dropzone,');
        expect(printFunction).not.toContain('.colab-cv-panel,#colab-cv-inline-preview,');
        expect(printFunction).not.toContain('.colab-emergency-panel,.colab-datos-civiles,');
        expect(printFunction).not.toContain('#colab-cursos-list,#colab-cursos-dropzone,');
    });

    test('la ausencia de contactos de emergencia tiene un mensaje explícito', () => {
        expect(html).toContain('Sin contactos de emergencia registrados');
    });
});
