/**
 * @jest-environment jsdom
 */
/* Sin sesión no se consultan totales_detalle_por_dia ni
 * manifiestos_avisos_periodo: sólo los lee 'authenticated', así que la
 * consulta viajaría como anon, la base la rechazaría (42501 permission denied)
 * y dejaría el error en el log de Postgres. Al iniciar sesión se vuelve a pedir.
 */
const Totales = require('../js/totales-service.js');

const auth = (estado) => ({ getSession: async () => ({ data: { session: estado.session } }) });

describe('TotalesService.getDetalleDiario sin sesión', () => {
  test('no llama a la RPC, falla sin quedar en caché y consulta al haber sesión', async () => {
    const estado = { session: null };
    const cliente = {
      auth: auth(estado),
      rpc: jest.fn(() => ({ range: async () => ({ data: [{ fecha: '2026-10-06', categoria: 'comercial', operaciones: 150, pasajeros: 20000 }], error: null }) }))
    };
    const service = Totales.crear({ cliente: () => cliente });

    await expect(service.getDetalleDiario('2026-10-06', '2026-10-06')).rejects.toThrow('Sin sesión');
    expect(cliente.rpc).not.toHaveBeenCalled();

    estado.session = { user: { id: 'u1' } };
    const mapa = await service.getDetalleDiario('2026-10-06', '2026-10-06');
    expect(cliente.rpc).toHaveBeenCalledTimes(1);
    expect(mapa.get('2026-10-06').comercial).toEqual({ operaciones: 150, pasajeros: 20000 });
  });
});

describe('ManifiestosAvisos.cargar sin sesión', () => {
  const AVISO = { clave: 'a', texto: 'Aviso', desde: '2026-01-01', hasta: '2026-12-31', ambitos: ['inicio'], activo: true };

  function preparar(estado, respuesta) {
    const consulta = { select: () => consulta, eq: jest.fn(async () => respuesta()) };
    const client = { auth: auth(estado), from: jest.fn(() => consulta) };
    window.supabaseClient = client;
    let api;
    jest.isolateModules(() => { api = require('../js/manifiestos-avisos.js'); });
    return { api, client };
  }

  afterEach(() => { delete window.supabaseClient; });

  test('no consulta sin sesión y, al haberla, la siguiente llamada sí trae los avisos', async () => {
    const estado = { session: null };
    const { api, client } = preparar(estado, () => ({ data: [AVISO], error: null }));

    expect(await api.cargar()).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();

    estado.session = { user: { id: 'u1' } };
    expect(await api.cargar()).toEqual([AVISO]);
    expect(client.from).toHaveBeenCalledTimes(1);
    // Ya cargados: no se vuelven a pedir.
    await api.cargar();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  test('si la consulta falla, no se queda con la lista vacía: la siguiente llamada reintenta', async () => {
    const estado = { session: { user: { id: 'u1' } } };
    let falla = true;
    const { api, client } = preparar(estado, () => (falla
      ? { data: null, error: { message: 'permission denied for table manifiestos_avisos_periodo' } }
      : { data: [AVISO], error: null }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    expect(await api.cargar()).toEqual([]);
    falla = false;
    expect(await api.cargar()).toEqual([AVISO]);
    expect(client.from).toHaveBeenCalledTimes(2);
    info.mockRestore();
  });
});

describe('script.js al iniciar sesión', () => {
  test('vuelve a pedir los avisos del Inicio', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'script.js'), 'utf8');
    const bloque = src.slice(src.indexOf("if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')"));
    expect(bloque.slice(0, 600)).toMatch(/window\._ndwAvisosPedidos = false;/);
  });
});
