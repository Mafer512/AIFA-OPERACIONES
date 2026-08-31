/**
 * La agenda de cursos (modal oscuro) y la ficha de Colaboradores comparten los
 * nombres de clase .ca-list / .ca-item. Como las reglas oscuras de la agenda
 * van despues en la hoja, pintaban de negro los comentarios y amonestaciones de
 * la ficha y el texto quedaba ilegible. Las reglas oscuras deben quedar
 * acotadas a #ca-list (el contenedor de la agenda).
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// Selector -> cuerpo de la regla, buscando solo la definicion pedida.
function ruleBody(selector) {
    const marker = `\n${selector} {`;
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const from = start + marker.length;
    return html.slice(from, html.indexOf('}', from));
}

describe('comentarios y amonestaciones de la ficha de colaboradores', () => {
    test('el fondo oscuro de la agenda de cursos vive acotado a #ca-list', () => {
        expect(html).toContain('#ca-list .ca-item { background:#0b1324;');
        expect(html).toContain('#ca-list { max-height:305px; overflow:auto; }');
    });

    test('ninguna regla global de .ca-item o .ca-list se les impone encima', () => {
        // Sin nada antes del punto: seria un selector global, no el acotado.
        expect(html).not.toMatch(/\n[ \t]*\.ca-item\s*\{[ \t]*background:#0b1324/);
        expect(html).not.toMatch(/\n[ \t]*\.ca-list\s*\{[ \t]*max-height:305px/);
        expect(html).not.toMatch(/\n[ \t]*\.ca-item:last-child/);
    });

    test('la ficha conserva su tarjeta clara con texto legible', () => {
        const fichaItem = ruleBody('                        .ca-item');
        expect(fichaItem).toContain('background: #fafbfd');
        expect(fichaItem).toContain('color: var(--col-text)');
    });
});
