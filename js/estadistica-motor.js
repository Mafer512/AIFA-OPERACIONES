/* Núcleo puro del módulo estadístico de operaciones.
 *
 * No toca el DOM, no habla con Supabase y no guarda estado global: recibe las
 * filas que devuelve el RPC public.estadistica_agregado (migración 038) y las
 * convierte en lo que las pantallas necesitan.
 *
 * REGLA DE ORO DE ESTE ARCHIVO
 *   Aquí NO se recalcula ninguna métrica que PostgreSQL ya calculó. Las
 *   operaciones, los pasajeros, la carga, el factor de ocupación y la
 *   puntualidad vienen sumados de la base, con la misma definición para todas
 *   las pantallas. Lo que sí vive aquí es lo que no tiene sentido pedirle al
 *   servidor: comparar dos agregados que ya se pidieron, dar formato, y avisar
 *   cuando las cifras no cuadran entre sí.
 *
 * Fuente de datos: public.vw_maestra_operaciones, vía
 * mv_estadistica_operaciones y las funciones estadistica_agregado /
 * estadistica_sin_clasificar / estadistica_detalle.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.EstadisticaMotor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MESES = Object.freeze([
        { numero: 1, corto: 'Ene', nombre: 'Enero' },
        { numero: 2, corto: 'Feb', nombre: 'Febrero' },
        { numero: 3, corto: 'Mar', nombre: 'Marzo' },
        { numero: 4, corto: 'Abr', nombre: 'Abril' },
        { numero: 5, corto: 'May', nombre: 'Mayo' },
        { numero: 6, corto: 'Jun', nombre: 'Junio' },
        { numero: 7, corto: 'Jul', nombre: 'Julio' },
        { numero: 8, corto: 'Ago', nombre: 'Agosto' },
        { numero: 9, corto: 'Sep', nombre: 'Septiembre' },
        { numero: 10, corto: 'Oct', nombre: 'Octubre' },
        { numero: 11, corto: 'Nov', nombre: 'Noviembre' },
        { numero: 12, corto: 'Dic', nombre: 'Diciembre' }
    ]);

    // Dimensiones que acepta estadistica_agregado. Es la MISMA lista blanca que
    // la función valida del lado del servidor; se repite aquí sólo para poder
    // armar los desplegables y avisar antes de hacer el viaje.
    const DIMENSIONES = Object.freeze({
        anio: 'Año',
        mes: 'Mes',
        anio_mes: 'Año-Mes',
        fecha: 'Fecha',
        semana: 'Semana ISO',
        dia_semana: 'Día de la semana',
        hora: 'Hora local',
        direccion: 'Llegada / Salida',
        tipo_movimiento: 'Tipo de movimiento',
        aerolinea: 'Aerolínea',
        matricula: 'Matrícula',
        tipo_aeronave: 'Tipo de aeronave',
        tipo_servicio: 'Tipo de servicio',
        segmento_aviacion: 'Segmento de aviación',
        naturaleza_operacion: 'Naturaleza de la operación',
        nacional_internacional: 'Nacional / Internacional',
        origen: 'Origen',
        destino: 'Destino',
        endpoint: 'Otro extremo',
        ciudad: 'Ciudad',
        ruta: 'Ruta',
        codigo_demora: 'Código de demora',
        causa_demora: 'Causa de demora'
    });

    const DIAS_SEMANA = Object.freeze(['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);

    // ── Números: NULL, 0 y "desconocido" NO son lo mismo ─────────────────────
    //
    // toNumero devuelve null cuando no hay dato, nunca 0. Convertir NULL en 0
    // es lo que hace que un indicador mienta: una capacidad desconocida no es
    // una capacidad de cero asientos.
    function toNumero(valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/[\s ,]/g, ''));
        return Number.isFinite(n) ? n : null;
    }

    // Para sumar: aquí sí conviene tratar la ausencia como cero, pero sólo
    // cuando ya se decidió que sumar tiene sentido.
    function suma(valor) {
        const n = toNumero(valor);
        return n === null ? 0 : n;
    }

    const nfEntero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
    const nfDecimal = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function fmtEntero(valor) {
        const n = toNumero(valor);
        return n === null ? '—' : nfEntero.format(Math.round(n));
    }

    function fmtDecimal(valor) {
        const n = toNumero(valor);
        return n === null ? '—' : nfDecimal.format(n);
    }

    function fmtPorcentaje(valor, decimales) {
        const n = toNumero(valor);
        if (n === null) return '—';
        return `${n.toFixed(decimales === undefined ? 1 : decimales)} %`;
    }

    // ── Unidades de carga ────────────────────────────────────────────────────
    // La unidad maestra es el KILOGRAMO: así se captura y así se guarda
    // (carga_total_kg y compañía). La tonelada es sólo presentación, y la
    // conversión se hace AL FINAL, después de sumar, nunca antes: redondear
    // cada renglón a toneladas y luego sumar arrastra el error.
    const KG_POR_TONELADA = 1000;

    function kgAToneladas(kg) {
        const n = toNumero(kg);
        return n === null ? null : n / KG_POR_TONELADA;
    }

    function fmtKg(kg) {
        const n = toNumero(kg);
        return n === null ? '—' : `${nfEntero.format(Math.round(n))} kg`;
    }

    function fmtToneladas(kg) {
        const t = kgAToneladas(kg);
        return t === null ? '—' : `${nfDecimal.format(t)} t`;
    }

    // Elige la unidad legible sin perder precisión en el cálculo.
    function fmtCarga(kg) {
        const n = toNumero(kg);
        if (n === null) return '—';
        return Math.abs(n) >= KG_POR_TONELADA ? fmtToneladas(n) : fmtKg(n);
    }

    // ── Variación entre dos periodos ─────────────────────────────────────────
    //
    //   ((B - A) / A) * 100
    //
    // Nunca devuelve Infinity, NaN ni undefined. Cuando la fórmula no aplica lo
    // dice con un estado, y la pantalla decide cómo escribirlo.
    //   sin_dato   → falta A o falta B
    //   nuevo      → A = 0 y B > 0: no hay porcentaje, hay estreno
    //   desaparece → A > 0 y B = 0: -100 %
    //   sin_base   → A = 0 y B = 0
    function variacion(a, b) {
        const va = toNumero(a);
        const vb = toNumero(b);

        if (va === null || vb === null) {
            return { a: va, b: vb, absoluta: null, porcentual: null, estado: 'sin_dato', texto: 'N/D' };
        }
        const absoluta = vb - va;
        if (va === 0 && vb === 0) {
            return { a: va, b: vb, absoluta: 0, porcentual: null, estado: 'sin_base', texto: 'Sin base comparativa' };
        }
        if (va === 0) {
            return { a: va, b: vb, absoluta, porcentual: null, estado: 'nuevo', texto: 'Nuevo' };
        }
        const porcentual = (absoluta / Math.abs(va)) * 100;
        if (!Number.isFinite(porcentual)) {
            return { a: va, b: vb, absoluta, porcentual: null, estado: 'sin_base', texto: 'Sin base comparativa' };
        }
        return {
            a: va,
            b: vb,
            absoluta,
            porcentual,
            estado: 'ok',
            texto: `${porcentual >= 0 ? '+' : ''}${porcentual.toFixed(1)} %`
        };
    }

    // ── Factor de ocupación ──────────────────────────────────────────────────
    //
    //   SUM(pax) / SUM(capacidad) * 100     — NO el promedio de pax/capacidad.
    //
    // El servidor ya lo entrega calculado sobre el mismo conjunto de filas para
    // numerador y denominador. Esta función existe para recomponerlo cuando se
    // suman varios renglones de agregado (por ejemplo, doce meses en un año):
    // sumar los doce porcentajes y dividir entre doce daría otro número.
    function factorOcupacion(paxBase, capacidadBase) {
        const pax = toNumero(paxBase);
        const cap = toNumero(capacidadBase);
        if (pax === null || cap === null || cap <= 0) return null;
        return (pax / cap) * 100;
    }

    // ── Cobertura de datos ───────────────────────────────────────────────────
    // "Este indicador se calculó con 1,245 de 1,310 operaciones (95.0 %)".
    function cobertura(consideradas, totales) {
        const c = toNumero(consideradas);
        const t = toNumero(totales);
        if (c === null || t === null || t <= 0) {
            return { consideradas: c, totales: t, porcentaje: null, texto: 'Sin base' };
        }
        const porcentaje = (c / t) * 100;
        return {
            consideradas: c,
            totales: t,
            porcentaje,
            texto: `${nfEntero.format(c)} de ${nfEntero.format(t)} · ${porcentaje.toFixed(1)} %`
        };
    }

    // ── Normalización de un renglón del RPC ──────────────────────────────────
    // Los nombres se conservan tal cual los devuelve estadistica_agregado, para
    // que no haya un segundo vocabulario que mantener sincronizado. Sólo se
    // agregan los derivados que ninguna suma puede dar por sí sola.
    // Es IDEMPOTENTE a propósito: recibir un renglón ya normalizado y volver a
    // normalizarlo dejaría casi todo en cero, porque los nombres de salida
    // (operacionesLlegada) no son los de entrada (operaciones_llegada) y sólo
    // 'operaciones' coincide en las dos formas — un error silencioso y difícil
    // de ver. combinar() recibe indistintamente renglones crudos del RPC o ya
    // normalizados, así que la marca evita ese caso.
    function normalizarFila(fila) {
        if (fila && fila._normalizada === true) return fila;
        const f = fila || {};
        const operaciones = suma(f.operaciones);
        const salida = {
            _normalizada: true,
            d1: f.d1 ?? null,
            d2: f.d2 ?? null,
            d3: f.d3 ?? null,
            d4: f.d4 ?? null,

            operaciones,
            operacionesLlegada: suma(f.operaciones_llegada),
            operacionesSalida: suma(f.operaciones_salida),
            operacionesCanceladas: suma(f.operaciones_canceladas),
            operacionesNacional: suma(f.operaciones_nacional),
            operacionesInternacional: suma(f.operaciones_internacional),

            // Pasajeros: se conserva null cuando la base no reportó nada, para
            // poder distinguirlo de un cero real en la tarjeta.
            paxTotal: toNumero(f.pax_total),
            paxLlegada: toNumero(f.pax_llegada),
            paxSalida: toNumero(f.pax_salida),
            paxNacional: toNumero(f.pax_nacional),
            paxInternacional: toNumero(f.pax_internacional),
            operacionesConPax: suma(f.operaciones_con_pax),

            cargaTotalKg: toNumero(f.carga_total_kg),
            cargaNacionalKg: toNumero(f.carga_nacional_kg),
            cargaInternacionalKg: toNumero(f.carga_internacional_kg),
            cargaDescargadaKg: toNumero(f.carga_descargada_kg),
            cargaEmbarcadaKg: toNumero(f.carga_embarcada_kg),
            cargaTransitoKg: toNumero(f.carga_transito_kg),
            correoKg: toNumero(f.correo_kg),
            operacionesConCarga: suma(f.operaciones_con_carga),
            operacionesConDesgloseCarga: suma(f.operaciones_con_desglose_carga),

            ocupacionPax: toNumero(f.ocupacion_pax),
            ocupacionCapacidad: toNumero(f.ocupacion_capacidad),
            factorOcupacion: toNumero(f.factor_ocupacion),
            operacionesConOcupacion: suma(f.operaciones_con_ocupacion),

            operacionesPuntuales: suma(f.operaciones_puntuales),
            operacionesDemoradas: suma(f.operaciones_demoradas),
            minutosDemoraTotal: toNumero(f.minutos_demora_total),
            demoraPromedio: toNumero(f.demora_promedio),
            demoraMaxima: toNumero(f.demora_maxima),
            demoraMinima: toNumero(f.demora_minima),
            operacionesEvaluablesPuntualidad: suma(f.operaciones_evaluables_puntualidad),

            operacionesClasificadas: suma(f.operaciones_clasificadas),
            operacionesSinClasificar: suma(f.operaciones_sin_clasificar),
            operacionesCapturadas: suma(f.operaciones_capturadas)
        };

        salida.puntualidadPorcentaje = salida.operacionesEvaluablesPuntualidad > 0
            ? (salida.operacionesPuntuales / salida.operacionesEvaluablesPuntualidad) * 100
            : null;
        salida.cargaTotalToneladas = kgAToneladas(salida.cargaTotalKg);

        return salida;
    }

    // Suma varios renglones en uno solo. Necesario para el resumen ejecutivo,
    // que pide el agregado desglosado y muestra el total.
    //
    // El factor de ocupación NO se promedia: se recalcula de las bases
    // acumuladas. Lo mismo la puntualidad.
    function combinar(filas) {
        const lista = (filas || []).map(normalizarFila);
        if (lista.length === 0) return normalizarFila({});

        const acumulables = [
            'operaciones', 'operacionesLlegada', 'operacionesSalida', 'operacionesCanceladas',
            'operacionesNacional', 'operacionesInternacional', 'operacionesConPax',
            'operacionesConCarga', 'operacionesConDesgloseCarga', 'operacionesConOcupacion',
            'operacionesPuntuales', 'operacionesDemoradas', 'operacionesEvaluablesPuntualidad',
            'operacionesClasificadas', 'operacionesSinClasificar', 'operacionesCapturadas'
        ];
        // Estos pueden ser null legítimamente: sólo se suman los que traen dato,
        // y si NINGUNO lo trae el total queda null, no 0.
        const acumulablesNulables = [
            'paxTotal', 'paxLlegada', 'paxSalida', 'paxNacional', 'paxInternacional',
            'cargaTotalKg', 'cargaNacionalKg', 'cargaInternacionalKg',
            'cargaDescargadaKg', 'cargaEmbarcadaKg', 'cargaTransitoKg', 'correoKg',
            'ocupacionPax', 'ocupacionCapacidad', 'minutosDemoraTotal'
        ];

        const total = normalizarFila({});
        acumulables.forEach((k) => { total[k] = lista.reduce((acc, f) => acc + suma(f[k]), 0); });
        acumulablesNulables.forEach((k) => {
            const conDato = lista.filter((f) => f[k] !== null);
            total[k] = conDato.length ? conDato.reduce((acc, f) => acc + f[k], 0) : null;
        });

        total.factorOcupacion = factorOcupacion(total.ocupacionPax, total.ocupacionCapacidad);
        total.puntualidadPorcentaje = total.operacionesEvaluablesPuntualidad > 0
            ? (total.operacionesPuntuales / total.operacionesEvaluablesPuntualidad) * 100
            : null;
        total.cargaTotalToneladas = kgAToneladas(total.cargaTotalKg);

        const demorasMax = lista.map((f) => f.demoraMaxima).filter((v) => v !== null);
        const demorasMin = lista.map((f) => f.demoraMinima).filter((v) => v !== null);
        total.demoraMaxima = demorasMax.length ? Math.max(...demorasMax) : null;
        total.demoraMinima = demorasMin.length ? Math.min(...demorasMin) : null;
        // El promedio se reconstruye de la base, no promediando promedios.
        total.demoraPromedio = total.operacionesEvaluablesPuntualidad > 0 && total.minutosDemoraTotal !== null
            ? total.minutosDemoraTotal / total.operacionesEvaluablesPuntualidad
            : null;

        total.d1 = null; total.d2 = null; total.d3 = null; total.d4 = null;
        return total;
    }

    // ── Indicadores de calidad del dato ──────────────────────────────────────
    function calidad(total) {
        const t = total || normalizarFila({});
        return [
            { clave: 'pasajeros', etiqueta: 'Cobertura de pasajeros', ...cobertura(t.operacionesConPax, t.operaciones) },
            { clave: 'capacidad', etiqueta: 'Cobertura de capacidad', ...cobertura(t.operacionesConOcupacion, t.operaciones) },
            { clave: 'clasificacion', etiqueta: 'Cobertura de clasificación', ...cobertura(t.operacionesClasificadas, t.operaciones) },
            { clave: 'puntualidad', etiqueta: 'Cobertura de puntualidad', ...cobertura(t.operacionesEvaluablesPuntualidad, t.operaciones) },
            { clave: 'conciliado', etiqueta: 'Operaciones ya conciliadas', ...cobertura(t.operacionesCapturadas, t.operaciones) },
            {
                clave: 'desglose_carga',
                etiqueta: 'Desglose de carga capturado',
                ...cobertura(t.operacionesConDesgloseCarga, t.operacionesConCarga)
            }
        ];
    }

    // ── Validaciones aritméticas ─────────────────────────────────────────────
    //
    // No se corrigen ni se esconden las inconsistencias: se señalan. Una tabla
    // que no cuadra y no lo dice es peor que una que no cuadra y lo dice.
    function validar(total) {
        const t = total || normalizarFila({});
        const avisos = [];

        if (t.operacionesLlegada + t.operacionesSalida !== t.operaciones) {
            avisos.push({
                nivel: 'error',
                clave: 'ops_direccion',
                mensaje: `Llegadas (${fmtEntero(t.operacionesLlegada)}) + salidas (${fmtEntero(t.operacionesSalida)}) `
                    + `no dan el total de operaciones (${fmtEntero(t.operaciones)}). `
                    + 'Hay movimientos sin dirección reconocible.'
            });
        }

        if (t.paxTotal !== null && t.paxLlegada !== null && t.paxSalida !== null) {
            const dif = Math.abs((t.paxLlegada + t.paxSalida) - t.paxTotal);
            if (dif > 0.5) {
                avisos.push({
                    nivel: 'error',
                    clave: 'pax_direccion',
                    mensaje: `Pasajeros de llegada + salida (${fmtEntero(t.paxLlegada + t.paxSalida)}) `
                        + `no coinciden con el total (${fmtEntero(t.paxTotal)}).`
                });
            }
        }

        if (t.cargaTotalKg !== null && (t.cargaNacionalKg !== null || t.cargaInternacionalKg !== null)) {
            const desglose = suma(t.cargaNacionalKg) + suma(t.cargaInternacionalKg);
            // Sólo se avisa si el desglose SUPERA al total. Que sea menor es
            // normal: hay manifiestos que reportan la carga total sin partirla
            // en nacional/internacional.
            if (desglose > t.cargaTotalKg + 1) {
                avisos.push({
                    nivel: 'error',
                    clave: 'carga_desglose',
                    mensaje: `Carga nacional + internacional (${fmtCarga(desglose)}) supera a la carga total `
                        + `(${fmtCarga(t.cargaTotalKg)}).`
                });
            } else if (desglose < t.cargaTotalKg - 1) {
                avisos.push({
                    nivel: 'aviso',
                    clave: 'carga_sin_desglosar',
                    mensaje: `${fmtCarga(t.cargaTotalKg - desglose)} de carga no tienen desglose nacional/internacional.`
                });
            }
        }

        if (t.factorOcupacion !== null && t.factorOcupacion > 100) {
            avisos.push({
                nivel: 'aviso',
                clave: 'ocupacion_alta',
                mensaje: `Factor de ocupación de ${fmtPorcentaje(t.factorOcupacion)}: hay operaciones con más `
                    + 'pasajeros que asientos. Suele ser una capacidad de matrícula desactualizada.'
            });
        }

        const cobOcupacion = cobertura(t.operacionesConOcupacion, t.operaciones);
        if (cobOcupacion.porcentaje !== null && cobOcupacion.porcentaje < 70 && t.operaciones > 0) {
            avisos.push({
                nivel: 'aviso',
                clave: 'ocupacion_cobertura',
                mensaje: `El factor de ocupación sólo pudo calcularse con ${cobOcupacion.texto} de las operaciones.`
            });
        }

        if (t.operacionesSinClasificar > 0) {
            avisos.push({
                nivel: 'aviso',
                clave: 'sin_clasificar',
                mensaje: `${fmtEntero(t.operacionesSinClasificar)} operaciones sin clasificar. `
                    + 'Los cortes por segmento y naturaleza no las incluyen.'
            });
        }

        if (t.operacionesCanceladas > 0) {
            avisos.push({
                nivel: 'info',
                clave: 'canceladas',
                mensaje: `${fmtEntero(t.operacionesCanceladas)} operaciones canceladas, excluidas de todos los cálculos.`
            });
        }

        return avisos;
    }

    // Las participaciones deben acercarse al 100 %. Se comprueba sobre la lista
    // ya calculada, no sobre el total, porque el desvío aparece al repartir.
    function participacion(filas, campo) {
        const lista = (filas || []).map(normalizarFila);
        const total = lista.reduce((acc, f) => acc + suma(f[campo]), 0);
        const conPct = lista.map((f) => ({
            ...f,
            valor: suma(f[campo]),
            participacion: total > 0 ? (suma(f[campo]) / total) * 100 : null
        }));
        const sumaPct = conPct.reduce((acc, f) => acc + (f.participacion || 0), 0);
        return {
            filas: conPct,
            total,
            sumaParticipacion: total > 0 ? sumaPct : null,
            cuadra: total === 0 || Math.abs(sumaPct - 100) < 0.5
        };
    }

    // ── Fechas ───────────────────────────────────────────────────────────────
    //
    // Todo el módulo trabaja con la FECHA OPERACIONAL (fecha_operacion es un
    // DATE en la base, no un timestamp), así que no hay conversión de zona
    // horaria que pueda mover una operación de día. Los rangos son INCLUSIVOS
    // en los dos extremos, igual que el WHERE del servidor: pedir un solo día
    // trae ese día completo.
    //
    // Las fechas se construyen y se parten como texto ISO, nunca con
    // new Date(iso) a secas — eso lo interpreta como UTC y en México puede
    // devolver el día anterior.
    function hoyIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function partesIso(iso) {
        const [anio, mes, dia] = String(iso || '').split('-').map(Number);
        return { anio, mes, dia };
    }

    function isoDesdePartes(anio, mes, dia) {
        return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }

    function sumarDias(iso, dias) {
        const d = new Date(`${iso}T12:00:00`); // mediodía: inmune al horario de verano
        d.setDate(d.getDate() + dias);
        return isoDesdePartes(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    function diasEnMes(anio, mes) {
        return new Date(anio, mes, 0).getDate();
    }

    function rangoMes(anio, mes) {
        return { desde: isoDesdePartes(anio, mes, 1), hasta: isoDesdePartes(anio, mes, diasEnMes(anio, mes)) };
    }

    function rangoAnio(anio) {
        return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
    }

    // Mismo periodo del año anterior, respetando el número de días: del 1 al 15
    // de marzo compara contra el 1 al 15 de marzo anterior, no contra 14 días.
    function mismoPeriodoAnioAnterior(desde, hasta) {
        const a = partesIso(desde);
        const b = partesIso(hasta);
        const ajusta = (p) => {
            const anio = p.anio - 1;
            const dia = Math.min(p.dia, diasEnMes(anio, p.mes));
            return isoDesdePartes(anio, p.mes, dia);
        };
        return { desde: ajusta(a), hasta: ajusta(b) };
    }

    // Periodo inmediatamente anterior, de la misma duración y pegado al inicio.
    function periodoAnterior(desde, hasta) {
        const d1 = new Date(`${desde}T12:00:00`);
        const d2 = new Date(`${hasta}T12:00:00`);
        const dias = Math.round((d2 - d1) / 86400000) + 1;
        return { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) };
    }

    function etiquetaRango(desde, hasta) {
        if (!desde || !hasta) return '—';
        if (desde === hasta) return desde;
        const a = partesIso(desde);
        const b = partesIso(hasta);
        if (a.anio === b.anio && a.mes === b.mes && a.dia === 1 && b.dia === diasEnMes(b.anio, b.mes)) {
            return `${MESES[a.mes - 1].nombre} ${a.anio}`;
        }
        if (a.anio === b.anio && a.mes === 1 && a.dia === 1 && b.mes === 12 && b.dia === 31) {
            return String(a.anio);
        }
        return `${desde} a ${hasta}`;
    }

    // ── Filtros ──────────────────────────────────────────────────────────────
    //
    // Un solo estado de filtros para todo el módulo. Cada sección lo lee, nadie
    // lo reinventa. Los nombres son los mismos que entiende el RPC, para que no
    // haya traducción intermedia que se pueda desincronizar.
    function filtrosVacios() {
        return {
            fecha_inicio: null,
            fecha_fin: null,
            aerolinea: [],
            matricula: [],
            tipo_aeronave: [],
            tipo_servicio: [],
            direccion: [],
            nacional_internacional: [],
            segmento_aviacion: [],
            naturaleza_operacion: [],
            origen: [],
            destino: [],
            endpoint: []
        };
    }

    // Convierte el estado a lo que espera p_filtros. Las listas vacías se
    // omiten: en el servidor "ausente" y "lista vacía" significan lo mismo (no
    // restringe), pero omitirlas deja el JSON legible en los registros.
    function filtrosAJson(estado) {
        const f = estado || {};
        const salida = {};
        Object.keys(filtrosVacios()).forEach((clave) => {
            if (clave === 'fecha_inicio' || clave === 'fecha_fin') return;
            const valor = f[clave];
            if (Array.isArray(valor) && valor.length > 0) salida[clave] = valor;
            else if (typeof valor === 'string' && valor) salida[clave] = [valor];
        });
        return salida;
    }

    function filtrosActivos(estado) {
        const json = filtrosAJson(estado);
        return Object.keys(json).length;
    }

    // "Pasajeros" incluye a las operaciones MIXTAS, porque una operación mixta
    // sí lleva pasajeros. Lo mismo del lado de carga. Son dimensiones
    // independientes, no un reparto excluyente.
    const NATURALEZA_PASAJEROS = Object.freeze(['PASAJEROS', 'MIXTA']);
    const NATURALEZA_CARGA = Object.freeze(['CARGA', 'MIXTA']);

    // ── Exportación ──────────────────────────────────────────────────────────
    function celdaCsv(valor) {
        if (valor === null || valor === undefined) return '';
        const texto = String(valor);
        return /[",;\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    }

    // Se exporta el RESULTADO COMPLETO de la consulta, no la página visible.
    // Los números van sin separador de miles y con punto decimal para que la
    // hoja de cálculo los reconozca como números; las fechas en ISO.
    function construirCsv(columnas, filas) {
        const encabezado = columnas.map((c) => celdaCsv(c.titulo)).join(',');
        const cuerpo = (filas || []).map((fila) => columnas.map((col) => {
            const valor = typeof col.valor === 'function' ? col.valor(fila) : fila[col.clave];
            if (valor === null || valor === undefined) return '';
            if (col.tipo === 'numero' || col.tipo === 'porcentaje') {
                const n = toNumero(valor);
                return n === null ? '' : String(n);
            }
            return celdaCsv(valor);
        }).join(',')).join('\r\n');
        return `${encabezado}\r\n${cuerpo}`;
    }

    function construirFilasTabla(columnas, filas) {
        return (filas || []).map((fila) => columnas.map((col) => {
            const valor = typeof col.valor === 'function' ? col.valor(fila) : fila[col.clave];
            if (col.tipo === 'numero') return fmtEntero(valor);
            if (col.tipo === 'decimal') return fmtDecimal(valor);
            if (col.tipo === 'porcentaje') return fmtPorcentaje(valor);
            if (col.tipo === 'carga') return fmtCarga(valor);
            return valor === null || valor === undefined || valor === '' ? '—' : String(valor);
        }));
    }

    // ── Comparador ───────────────────────────────────────────────────────────
    //
    // Recibe los DOS agregados ya pedidos al servidor (una llamada cada uno) y
    // arma el cuadro. Las diferencias se calculan aquí, no en SQL, a propósito:
    // son dos restas sobre dos renglones, y hacerlas del lado del cliente evita
    // una función más que mantener sincronizada con la definición de cada
    // métrica.
    const METRICAS_COMPARABLES = Object.freeze([
        { clave: 'operaciones', etiqueta: 'Operaciones', tipo: 'numero' },
        { clave: 'operacionesLlegada', etiqueta: 'Operaciones de llegada', tipo: 'numero' },
        { clave: 'operacionesSalida', etiqueta: 'Operaciones de salida', tipo: 'numero' },
        { clave: 'operacionesNacional', etiqueta: 'Operaciones nacionales', tipo: 'numero' },
        { clave: 'operacionesInternacional', etiqueta: 'Operaciones internacionales', tipo: 'numero' },
        { clave: 'paxTotal', etiqueta: 'Pasajeros totales', tipo: 'numero' },
        { clave: 'paxLlegada', etiqueta: 'Pasajeros de llegada', tipo: 'numero' },
        { clave: 'paxSalida', etiqueta: 'Pasajeros de salida', tipo: 'numero' },
        { clave: 'cargaTotalKg', etiqueta: 'Carga transportada', tipo: 'carga' },
        { clave: 'cargaNacionalKg', etiqueta: 'Carga nacional', tipo: 'carga' },
        { clave: 'cargaInternacionalKg', etiqueta: 'Carga internacional', tipo: 'carga' },
        { clave: 'cargaDescargadaKg', etiqueta: 'Carga descargada en AIFA', tipo: 'carga' },
        { clave: 'cargaEmbarcadaKg', etiqueta: 'Carga embarcada en AIFA', tipo: 'carga' },
        { clave: 'cargaTransitoKg', etiqueta: 'Carga en tránsito', tipo: 'carga' },
        { clave: 'factorOcupacion', etiqueta: 'Factor de ocupación', tipo: 'porcentaje' },
        { clave: 'puntualidadPorcentaje', etiqueta: 'Puntualidad', tipo: 'porcentaje' },
        { clave: 'demoraPromedio', etiqueta: 'Demora promedio (min)', tipo: 'decimal' }
    ]);

    function comparar(totalA, totalB, etiquetaA, etiquetaB) {
        const a = totalA || normalizarFila({});
        const b = totalB || normalizarFila({});
        return {
            etiquetaA: etiquetaA || 'Periodo A',
            etiquetaB: etiquetaB || 'Periodo B',
            metricas: METRICAS_COMPARABLES.map((m) => ({
                clave: m.clave,
                etiqueta: m.etiqueta,
                tipo: m.tipo,
                valorA: a[m.clave],
                valorB: b[m.clave],
                variacion: variacion(a[m.clave], b[m.clave])
            }))
        };
    }

    function formatearPorTipo(valor, tipo) {
        if (tipo === 'numero') return fmtEntero(valor);
        if (tipo === 'decimal') return fmtDecimal(valor);
        if (tipo === 'porcentaje') return fmtPorcentaje(valor);
        if (tipo === 'carga') return fmtCarga(valor);
        return valor === null || valor === undefined ? '—' : String(valor);
    }

    function etiquetaDimension(clave, valor) {
        if (valor === null || valor === undefined || valor === '') return '—';
        if (clave === 'direccion') return valor === 'A' ? 'Llegada' : (valor === 'D' ? 'Salida' : valor);
        if (clave === 'mes') {
            const n = Number(valor);
            return MESES[n - 1] ? MESES[n - 1].nombre : String(valor);
        }
        if (clave === 'dia_semana') return DIAS_SEMANA[Number(valor)] || String(valor);
        if (clave === 'hora') return `${valor}:00`;
        return String(valor);
    }

    return {
        MESES,
        DIAS_SEMANA,
        DIMENSIONES,
        METRICAS_COMPARABLES,
        NATURALEZA_PASAJEROS,
        NATURALEZA_CARGA,
        KG_POR_TONELADA,

        toNumero,
        suma,
        fmtEntero,
        fmtDecimal,
        fmtPorcentaje,
        fmtKg,
        fmtToneladas,
        fmtCarga,
        formatearPorTipo,
        etiquetaDimension,

        kgAToneladas,
        variacion,
        factorOcupacion,
        cobertura,

        normalizarFila,
        combinar,
        calidad,
        validar,
        participacion,
        comparar,

        hoyIso,
        partesIso,
        isoDesdePartes,
        sumarDias,
        diasEnMes,
        rangoMes,
        rangoAnio,
        mismoPeriodoAnioAnterior,
        periodoAnterior,
        etiquetaRango,

        filtrosVacios,
        filtrosAJson,
        filtrosActivos,

        celdaCsv,
        construirCsv,
        construirFilasTabla
    };
});
