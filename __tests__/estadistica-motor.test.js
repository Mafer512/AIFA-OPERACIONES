const Motor = require('../js/estadistica-motor');

// Renglón como lo devuelve public.estadistica_agregado (migración 038).
// Los nombres son los de la función, no una traducción: si cambian allá, estos
// objetos dejan de coincidir y la prueba lo dice.
function filaRpc(extra) {
  return Object.assign({
    d1: null, d2: null, d3: null, d4: null,
    operaciones: 0, operaciones_llegada: 0, operaciones_salida: 0,
    operaciones_canceladas: 0, operaciones_nacional: 0, operaciones_internacional: 0,
    pax_total: null, pax_llegada: null, pax_salida: null,
    pax_nacional: null, pax_internacional: null, operaciones_con_pax: 0,
    carga_total_kg: null, carga_nacional_kg: null, carga_internacional_kg: null,
    carga_descargada_kg: null, carga_embarcada_kg: null, carga_transito_kg: null,
    correo_kg: null, operaciones_con_carga: 0, operaciones_con_desglose_carga: 0,
    ocupacion_pax: null, ocupacion_capacidad: null, factor_ocupacion: null,
    operaciones_con_ocupacion: 0,
    operaciones_puntuales: 0, operaciones_demoradas: 0, minutos_demora_total: null,
    demora_promedio: null, demora_maxima: null, demora_minima: null,
    operaciones_evaluables_puntualidad: 0,
    operaciones_clasificadas: 0, operaciones_sin_clasificar: 0, operaciones_capturadas: 0
  }, extra || {});
}

describe('EstadisticaMotor · números y unidades', () => {
  test('NULL, 0 y "sin dato" se distinguen: toNumero nunca inventa un cero', () => {
    expect(Motor.toNumero(null)).toBeNull();
    expect(Motor.toNumero(undefined)).toBeNull();
    expect(Motor.toNumero('')).toBeNull();
    expect(Motor.toNumero('no es número')).toBeNull();
    expect(Motor.toNumero(0)).toBe(0);
    expect(Motor.toNumero('1,234')).toBe(1234);
  });

  test('la carga se convierte a toneladas al final, sin redondear antes de sumar', () => {
    // Tres renglones que en toneladas redondeadas darían 0.33 + 0.33 + 0.33 = 0.99
    const kg = 333.4 + 333.3 + 333.3;
    expect(Motor.kgAToneladas(kg)).toBeCloseTo(1.0, 6);
    expect(Motor.fmtToneladas(kg)).toBe('1.00 t');
    expect(Motor.fmtKg(1500)).toBe('1,500 kg');
    // Por debajo de una tonelada se muestra en kg: es más legible y no pierde
    // precisión en el cálculo, que siempre va en kg.
    expect(Motor.fmtCarga(850)).toBe('850 kg');
    expect(Motor.fmtCarga(1500)).toBe('1.50 t');
    expect(Motor.fmtCarga(null)).toBe('—');
  });

  test('un valor ausente se pinta como raya, nunca como cero', () => {
    expect(Motor.fmtEntero(null)).toBe('—');
    expect(Motor.fmtPorcentaje(null)).toBe('—');
    expect(Motor.fmtEntero(0)).toBe('0');
  });
});

describe('EstadisticaMotor · factor de ocupación', () => {
  test('es SUM(pax)/SUM(capacidad), no el promedio de los cocientes', () => {
    // Dos vuelos: 180/180 (100 %) y 20/200 (10 %).
    // El promedio de cocientes daría 55 %. La definición correcta da 52.63 %.
    expect(Motor.factorOcupacion(200, 380)).toBeCloseTo(52.63, 2);
    expect((100 + 10) / 2).toBe(55); // así NO se calcula
  });

  test('capacidad NULL, 0 o negativa no produce un porcentaje inventado', () => {
    expect(Motor.factorOcupacion(150, null)).toBeNull();
    expect(Motor.factorOcupacion(150, 0)).toBeNull();
    expect(Motor.factorOcupacion(150, -10)).toBeNull();
    expect(Motor.factorOcupacion(null, 180)).toBeNull();
  });

  test('al combinar periodos el factor se recalcula de las bases, no se promedia', () => {
    const enero = filaRpc({ operaciones: 2, ocupacion_pax: 180, ocupacion_capacidad: 180, factor_ocupacion: 100, operaciones_con_ocupacion: 2 });
    const febrero = filaRpc({ operaciones: 2, ocupacion_pax: 20, ocupacion_capacidad: 200, factor_ocupacion: 10, operaciones_con_ocupacion: 2 });
    const total = Motor.combinar([enero, febrero]);
    expect(total.ocupacionPax).toBe(200);
    expect(total.ocupacionCapacidad).toBe(380);
    expect(total.factorOcupacion).toBeCloseTo(52.63, 2);
  });

  test('la cobertura dice con cuántas operaciones se calculó el indicador', () => {
    const c = Motor.cobertura(1245, 1310);
    expect(c.porcentaje).toBeCloseTo(95.04, 2);
    expect(c.texto).toBe('1,245 de 1,310 · 95.0 %');
    expect(Motor.cobertura(5, 0).texto).toBe('Sin base');
  });
});

describe('EstadisticaMotor · pasajeros', () => {
  test('PAX TOTAL = pasajeros de llegada + pasajeros de salida', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 10, operaciones_llegada: 5, operaciones_salida: 5,
      pax_total: 1400, pax_llegada: 750, pax_salida: 650, operaciones_con_pax: 10
    }));
    expect(fila.paxLlegada + fila.paxSalida).toBe(fila.paxTotal);
    expect(Motor.validar(fila).find((a) => a.clave === 'pax_direccion')).toBeUndefined();
  });

  test('si llegada + salida no da el total, se señala en vez de esconderlo', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 10, operaciones_llegada: 5, operaciones_salida: 5,
      pax_total: 1500, pax_llegada: 750, pax_salida: 650
    }));
    const aviso = Motor.validar(fila).find((a) => a.clave === 'pax_direccion');
    expect(aviso).toBeDefined();
    expect(aviso.nivel).toBe('error');
  });

  test('sumar periodos conserva NULL cuando ninguno trae dato de pasajeros', () => {
    const total = Motor.combinar([filaRpc({ operaciones: 3 }), filaRpc({ operaciones: 4 })]);
    expect(total.operaciones).toBe(7);
    expect(total.paxTotal).toBeNull(); // no 0: nadie reportó pasajeros
  });
});

describe('EstadisticaMotor · operaciones y cancelaciones', () => {
  test('llegadas + salidas = operaciones totales', () => {
    const fila = Motor.normalizarFila(filaRpc({ operaciones: 12, operaciones_llegada: 7, operaciones_salida: 5 }));
    expect(Motor.validar(fila).find((a) => a.clave === 'ops_direccion')).toBeUndefined();
  });

  test('las canceladas viajan aparte y no entran en el conteo de operaciones', () => {
    // El RPC ya excluye las canceladas de "operaciones" (FILTER WHERE NOT
    // es_cancelada) y las reporta en su propia columna. El núcleo respeta esa
    // separación: nunca las vuelve a sumar.
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 100, operaciones_llegada: 50, operaciones_salida: 50, operaciones_canceladas: 7
    }));
    expect(fila.operaciones).toBe(100);
    expect(fila.operacionesCanceladas).toBe(7);
    expect(fila.operacionesLlegada + fila.operacionesSalida).toBe(fila.operaciones);

    const aviso = Motor.validar(fila).find((a) => a.clave === 'canceladas');
    expect(aviso).toBeDefined();
    expect(aviso.mensaje).toMatch(/excluidas/);
  });
});

describe('EstadisticaMotor · clasificación', () => {
  test('MIXTA participa en las dos estadísticas: no son valores excluyentes', () => {
    expect(Motor.NATURALEZA_PASAJEROS).toContain('MIXTA');
    expect(Motor.NATURALEZA_CARGA).toContain('MIXTA');
    expect(Motor.NATURALEZA_PASAJEROS).toContain('PASAJEROS');
    expect(Motor.NATURALEZA_CARGA).toContain('CARGA');
  });

  test('las operaciones sin clasificar se señalan y no se reparten a la fuerza', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 1000, operaciones_llegada: 500, operaciones_salida: 500,
      operaciones_clasificadas: 973, operaciones_sin_clasificar: 27
    }));
    const aviso = Motor.validar(fila).find((a) => a.clave === 'sin_clasificar');
    expect(aviso).toBeDefined();
    expect(aviso.mensaje).toMatch(/27/);
    expect(Motor.calidad(fila).find((c) => c.clave === 'clasificacion').porcentaje).toBeCloseTo(97.3, 1);
  });
});

describe('EstadisticaMotor · comparaciones', () => {
  test('((B - A) / A) * 100 en el caso normal', () => {
    const v = Motor.variacion(200, 250);
    expect(v.estado).toBe('ok');
    expect(v.porcentual).toBeCloseTo(25, 6);
    expect(v.absoluta).toBe(50);
    expect(v.texto).toBe('+25.0 %');
  });

  test('base 0 con valor nuevo: "Nuevo", nunca Infinity', () => {
    const v = Motor.variacion(0, 120);
    expect(v.estado).toBe('nuevo');
    expect(v.porcentual).toBeNull();
    expect(v.texto).toBe('Nuevo');
    expect(String(v.texto)).not.toMatch(/Infinity|NaN|undefined/);
  });

  test('base 0 y valor 0: sin base comparativa', () => {
    const v = Motor.variacion(0, 0);
    expect(v.estado).toBe('sin_base');
    expect(v.absoluta).toBe(0);
    expect(v.porcentual).toBeNull();
  });

  test('falta de dato en cualquiera de los dos lados: N/D', () => {
    expect(Motor.variacion(null, 100).texto).toBe('N/D');
    expect(Motor.variacion(100, null).texto).toBe('N/D');
    expect(Motor.variacion(null, null).estado).toBe('sin_dato');
  });

  test('desaparecer es -100 %, no un error', () => {
    const v = Motor.variacion(80, 0);
    expect(v.estado).toBe('ok');
    expect(v.porcentual).toBeCloseTo(-100, 6);
  });

  test('el comparador arma las dos columnas y su variación sin producir NaN', () => {
    const a = Motor.normalizarFila(filaRpc({ operaciones: 100, pax_total: 10000 }));
    const b = Motor.normalizarFila(filaRpc({ operaciones: 150, pax_total: null }));
    const c = Motor.comparar(a, b, '2025', '2026');
    const ops = c.metricas.find((m) => m.clave === 'operaciones');
    expect(ops.variacion.porcentual).toBeCloseTo(50, 6);
    const pax = c.metricas.find((m) => m.clave === 'paxTotal');
    expect(pax.variacion.texto).toBe('N/D');
    c.metricas.forEach((m) => {
      expect(String(m.variacion.texto)).not.toMatch(/Infinity|NaN|undefined/);
    });
  });
});

describe('EstadisticaMotor · fechas', () => {
  test('un día completo entra al rango: los extremos son inclusivos', () => {
    const r = Motor.rangoMes(2026, 2);
    expect(r.desde).toBe('2026-02-01');
    expect(r.hasta).toBe('2026-02-28');
    expect(Motor.rangoMes(2024, 2).hasta).toBe('2024-02-29'); // bisiesto
  });

  test('sumarDias no se corre de día por zona horaria', () => {
    expect(Motor.sumarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(Motor.sumarDias('2026-03-31', 1)).toBe('2026-04-01');
    // Cambio de horario de verano en México (primer domingo de abril, años
    // anteriores a 2023) y en general cualquier salto: se ancla al mediodía.
    expect(Motor.sumarDias('2022-04-02', 1)).toBe('2022-04-03');
  });

  test('el mismo periodo del año anterior conserva los días, no la duración cruda', () => {
    const r = Motor.mismoPeriodoAnioAnterior('2026-03-01', '2026-03-15');
    expect(r).toEqual({ desde: '2025-03-01', hasta: '2025-03-15' });
    // 29 de febrero de un bisiesto contra un año que no lo es
    expect(Motor.mismoPeriodoAnioAnterior('2024-02-29', '2024-02-29'))
      .toEqual({ desde: '2023-02-28', hasta: '2023-02-28' });
  });

  test('el periodo inmediato anterior tiene la misma duración y termina el día antes', () => {
    expect(Motor.periodoAnterior('2026-03-01', '2026-03-10'))
      .toEqual({ desde: '2026-02-19', hasta: '2026-02-28' });
  });

  test('etiquetaRango reconoce mes y año completos', () => {
    expect(Motor.etiquetaRango('2026-02-01', '2026-02-28')).toBe('Febrero 2026');
    expect(Motor.etiquetaRango('2025-01-01', '2025-12-31')).toBe('2025');
    expect(Motor.etiquetaRango('2025-01-05', '2025-03-02')).toBe('2025-01-05 a 2025-03-02');
  });
});

describe('EstadisticaMotor · filtros', () => {
  test('el estado vacío no restringe nada', () => {
    expect(Motor.filtrosAJson(Motor.filtrosVacios())).toEqual({});
    expect(Motor.filtrosActivos(Motor.filtrosVacios())).toBe(0);
  });

  test('sólo viajan al servidor los filtros con contenido, y siempre como lista', () => {
    const estado = Object.assign(Motor.filtrosVacios(), {
      fecha_inicio: '2026-01-01',
      fecha_fin: '2026-12-31',
      aerolinea: ['VOLARIS'],
      direccion: [],
      segmento_aviacion: 'COMERCIAL'
    });
    const json = Motor.filtrosAJson(estado);
    expect(json).toEqual({ aerolinea: ['VOLARIS'], segmento_aviacion: ['COMERCIAL'] });
    // Las fechas van como parámetros propios del RPC, no dentro de p_filtros.
    expect(json.fecha_inicio).toBeUndefined();
    expect(Motor.filtrosActivos(estado)).toBe(2);
  });
});

describe('EstadisticaMotor · exportación', () => {
  const columnas = [
    { titulo: 'Aerolínea', clave: 'd1' },
    { titulo: 'Operaciones', clave: 'operaciones', tipo: 'numero' },
    { titulo: 'Carga (kg)', clave: 'cargaTotalKg', tipo: 'carga' },
    { titulo: 'Factor (%)', clave: 'factorOcupacion', tipo: 'porcentaje' }
  ];

  test('exporta el conjunto completo con encabezados legibles', () => {
    const filas = [
      Motor.normalizarFila(filaRpc({ d1: 'VOLARIS', operaciones: 120, carga_total_kg: 4500, factor_ocupacion: 88.4 })),
      Motor.normalizarFila(filaRpc({ d1: 'VIVA AEROBUS', operaciones: 90, carga_total_kg: null, factor_ocupacion: null }))
    ];
    const csv = Motor.construirCsv(columnas, filas);
    const lineas = csv.split('\r\n');
    expect(lineas[0]).toBe('Aerolínea,Operaciones,Carga (kg),Factor (%)');
    // Números sin separador de miles y con punto decimal: así los reconoce la
    // hoja de cálculo como números y no como texto.
    expect(lineas[1]).toBe('VOLARIS,120,4500,88.4');
    // Un valor ausente se exporta vacío, no como 0.
    expect(lineas[2]).toBe('VIVA AEROBUS,90,,');
    expect(lineas).toHaveLength(3);
  });

  test('las comas y comillas del texto no rompen el archivo', () => {
    const filas = [Motor.normalizarFila(filaRpc({ d1: 'AEROLÍNEA "X", S.A.', operaciones: 1 }))];
    const csv = Motor.construirCsv(columnas, filas);
    expect(csv.split('\r\n')[1]).toBe('"AEROLÍNEA ""X"", S.A.",1,,');
  });
});

describe('EstadisticaMotor · validaciones y calidad del dato', () => {
  test('la carga nacional + internacional no puede superar al total', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 10, operaciones_llegada: 5, operaciones_salida: 5,
      carga_total_kg: 1000, carga_nacional_kg: 700, carga_internacional_kg: 500
    }));
    const aviso = Motor.validar(fila).find((a) => a.clave === 'carga_desglose');
    expect(aviso).toBeDefined();
    expect(aviso.nivel).toBe('error');
  });

  test('carga sin desglosar se avisa, pero como aviso y no como error', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 10, operaciones_llegada: 5, operaciones_salida: 5,
      carga_total_kg: 1000, carga_nacional_kg: 400, carga_internacional_kg: 300
    }));
    const aviso = Motor.validar(fila).find((a) => a.clave === 'carga_sin_desglosar');
    expect(aviso).toBeDefined();
    expect(aviso.nivel).toBe('aviso');
  });

  test('un factor de ocupación imposible se señala pero no se recorta ni se oculta', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 10, operaciones_llegada: 5, operaciones_salida: 5,
      ocupacion_pax: 200, ocupacion_capacidad: 180, factor_ocupacion: 111.11,
      operaciones_con_ocupacion: 10
    }));
    const aviso = Motor.validar(fila).find((a) => a.clave === 'ocupacion_alta');
    expect(aviso).toBeDefined();
    expect(aviso.nivel).toBe('aviso');
    expect(fila.factorOcupacion).toBeCloseTo(111.11, 2); // el dato real se conserva
  });

  test('las participaciones deben acercarse al 100 % y se avisa si no', () => {
    const filas = [
      Motor.normalizarFila(filaRpc({ d1: 'A', operaciones: 60 })),
      Motor.normalizarFila(filaRpc({ d1: 'B', operaciones: 40 }))
    ];
    const r = Motor.participacion(filas, 'operaciones');
    expect(r.total).toBe(100);
    expect(r.filas[0].participacion).toBeCloseTo(60, 6);
    expect(r.sumaParticipacion).toBeCloseTo(100, 6);
    expect(r.cuadra).toBe(true);
  });

  test('los indicadores de calidad cubren pasajeros, capacidad y clasificación', () => {
    const fila = Motor.normalizarFila(filaRpc({
      operaciones: 1000, operaciones_llegada: 500, operaciones_salida: 500,
      operaciones_con_pax: 987, operaciones_con_ocupacion: 962,
      operaciones_clasificadas: 994, operaciones_sin_clasificar: 6
    }));
    const claves = Motor.calidad(fila).map((c) => c.clave);
    expect(claves).toEqual(expect.arrayContaining(['pasajeros', 'capacidad', 'clasificacion', 'puntualidad', 'desglose_carga']));
    expect(Motor.calidad(fila).find((c) => c.clave === 'pasajeros').porcentaje).toBeCloseTo(98.7, 1);
    expect(Motor.calidad(fila).find((c) => c.clave === 'capacidad').porcentaje).toBeCloseTo(96.2, 1);
  });
});
