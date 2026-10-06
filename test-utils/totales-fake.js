// La capa REAL de totales (js/totales-service.js) con un cliente de Supabase
// simulado: así las pruebas de pantallas ejercitan la misma regla de fuentes
// que producción, sólo cambiando los datos.
//
//   oficial: [{ anio, mes, categoria, operaciones, pasajeros, toneladas }]
//            (lo que devuelve v_cifras_oficiales_vigentes)
//   detalle: [{ fecha, categoria, operaciones, pasajeros, toneladas }]
//            (lo que devuelve totales_detalle_por_dia)
const Totales = require('../js/totales-service.js');

function crearTotalesFake({ corte = '2025-01-31', corteMaestra, oficial = [], detalle = [], hoy } = {}) {
  const llamadas = [];
  const respuesta = (resultado) => {
    const p = Promise.resolve(resultado);
    p.range = (a, b) => Promise.resolve(Object.assign({}, resultado, {
      data: Array.isArray(resultado.data) ? resultado.data.slice(a, b + 1) : resultado.data
    }));
    return p;
  };
  const cliente = {
    rpc(nombre, args) {
      llamadas.push([nombre, args]);
      if (nombre === 'fn_fecha_corte_oficial') return respuesta({ data: corte, error: null });
      if (nombre === 'fn_fecha_corte_maestra') return respuesta({ data: corteMaestra || corte, error: null });
      if (nombre === 'totales_detalle_por_dia') {
        return respuesta({ data: detalle.filter((r) => r.fecha >= args.p_desde && r.fecha <= args.p_hasta), error: null });
      }
      return respuesta({ data: null, error: null });
    },
    from(tabla) {
      llamadas.push(['from', tabla]);
      const filas = tabla === 'v_cifras_oficiales_vigentes' ? oficial : [];
      const q = {
        select: () => q,
        order: () => q,
        range: (a, b) => Promise.resolve({ data: filas.slice(a, b + 1), error: null })
      };
      return q;
    }
  };
  const servicio = Totales.crear(Object.assign({ cliente: () => cliente }, hoy ? { hoy: () => hoy } : {}));
  servicio.llamadas = llamadas;
  return servicio;
}

module.exports = { crearTotalesFake };
