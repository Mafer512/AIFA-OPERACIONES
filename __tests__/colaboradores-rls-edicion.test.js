/**
 * Con RLS activo, un UPDATE que no pasa la política no falla: afecta cero filas
 * y PostgREST responde 200. Desde la ficha se ve como "capturé y no se guardó".
 *
 * El script de corrección tiene que arreglar las dos causas encontradas —el rol
 * normalizado a medias y la política de UPDATE ausente o vieja— sin tocar los
 * datos ni abrir la escritura a cualquiera.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(raiz, 'db/fix_rls_colaboradores_edicion.sql'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

describe('el script que corrige el permiso de edición', () => {
    test('no toca datos: solo función y políticas', () => {
        expect(sql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+public\.)/i);
        expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_colab_editor\(\)/);
    });

    test('reconoce el rol aunque venga con espacios, guiones o mayúsculas', () => {
        // 'Super Admin' se convertía en 'super_admin' y quedaba fuera de la lista.
        expect(sql).toMatch(/regexp_replace\(lower\(coalesce\(role, ''\)\), '\[\^a-z0-9\]', '', 'g'\)/);
        for (const rol of ['admin', 'superadmin', 'colabeditor']) {
            expect(sql).toContain(`'${rol}'`);
        }
    });

    test('basta con que una fila del usuario traiga un rol con permiso', () => {
        // Antes: LIMIT 1 sin ORDER BY sobre user_roles, que con varias filas
        // podía tomar justo la que no era.
        const cuerpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'), sql.indexOf('REVOKE EXECUTE'));
        expect(cuerpo).toMatch(/SELECT EXISTS \(/);
        expect(cuerpo).not.toMatch(/LIMIT 1/);
    });

    test('deja las cuatro políticas y no duplica las viejas', () => {
        for (const politica of [
            'agenda_2026_select_authenticated',
            'agenda_2026_insert_colab_editor',
            'agenda_2026_update_colab_editor',
            'agenda_2026_delete_colab_editor',
        ]) {
            expect(sql).toContain(`DROP POLICY IF EXISTS "${politica}"`);
            expect(sql).toContain(`CREATE POLICY "${politica}"`);
        }
        // La de UPDATE es la que faltaba, con su USING y su WITH CHECK.
        expect(sql).toMatch(/FOR UPDATE TO authenticated\s*\n\s*USING \(public\.is_colab_editor\(\)\)\s*\n\s*WITH CHECK \(public\.is_colab_editor\(\)\)/);
    });

    test('la lectura sigue siendo para cualquier autenticado', () => {
        expect(sql).toMatch(/FOR SELECT TO authenticated\s*\n\s*USING \(true\)/);
    });

    test('deja con qué comprobarlo', () => {
        expect(sql).toContain('SELECT public.is_colab_editor()');
        expect(sql).toMatch(/FROM pg_policies/);
        // Y avisa de las políticas RESTRICTIVE, que bloquean todo lo demás.
        // pg_policies.permissive es texto ('PERMISSIVE'/'RESTRICTIVE'): tratarlo
        // como booleano reventaba el script entero en el editor de Supabase.
        expect(sql).toContain("upper(permissive) <> 'PERMISSIVE'");
        expect(sql).not.toMatch(/\bNOT permissive\b/);
    });
});

describe('la aplicación', () => {
    test('cuando la base no guarda, apunta al permiso y al script', () => {
        expect(app).toContain('fix_rls_colaboradores_edicion.sql');
        expect(app).toMatch(/La base no guardó/);
    });
});
