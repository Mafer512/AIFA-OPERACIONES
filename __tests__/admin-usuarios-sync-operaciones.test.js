/**
 * El inicio de sesión toma rol y vistas de usuarios_aplicaciones (OPERACIONES)
 * y sólo cae a user_roles si esa fila no existe. El panel de usuarios guardaba
 * únicamente en user_roles, así que hacer admin a alguien o darle Colaboradores
 * no llegaba nunca a su sesión. Cada guardado del panel tiene que copiarse a
 * OPERACIONES.
 */

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');

function cuerpo(inicio) {
    const i = script.indexOf(inicio);
    if (i < 0) throw new Error('No se encontró: ' + inicio);
    const j = script.indexOf('\n    };', i);
    return script.slice(i, j);
}

describe('el panel de usuarios mantiene OPERACIONES al día', () => {
    test('la sincronización copia rol y permisos de user_roles a OPERACIONES', () => {
        const i = script.indexOf('async function auSincronizarOperaciones(userId)');
        expect(i).toBeGreaterThan(-1);
        const sync = script.slice(i, script.indexOf('window.auSaveViews', i));
        expect(sync).toContain(".from('user_roles').select('role, permissions')");
        expect(sync).toContain("rpc('admin_assign_operaciones_access'");
        expect(sync).toContain('p_role: ur.role');
        expect(sync).toContain('p_permissions: ur.permissions || {}');
    });

    test.each([
        ['vistas', 'window.auSaveViews = async function'],
        ['rol', 'window.auAssignRole = async function'],
        ['baja / reactivación', 'window.auToggleBaja = async function'],
    ])('al guardar %s se sincroniza', (_, inicio) => {
        expect(cuerpo(inicio)).toContain('await auSincronizarOperaciones(userId);');
    });

    test('el login sigue leyendo OPERACIONES primero', () => {
        const i = script.indexOf('async function getOperacionesAccess(user)');
        const login = script.slice(i, script.indexOf('\n}', i));
        expect(login.indexOf("from('usuarios_aplicaciones')")).toBeLessThan(login.indexOf("from('user_roles')"));
    });
});
