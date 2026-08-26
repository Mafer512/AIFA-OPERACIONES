/* Generador del documento "Requerimientos Funcionales y Tecnicos del Sistema
 * de la Direccion de Operacion" (.docx). Uso: node scripts/gen_requerimientos_docx.js
 * Requiere la libreria `docx` (npm install docx --no-save). */
const fs = require('fs');
const path = require('path');
const D = require('docx');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
    TableOfContents, PageBreak, Header, Footer, PageNumber, convertInchesToTwip
} = D;

/* ─────────────────────────── Estilo base ─────────────────────────── */
const AZUL = '1F3864';
const AZUL2 = '2E5496';
const GRIS = 'F2F4F8';
const FONT = 'Calibri';

const BODY = 20;   // 10 pt
const TBL = 15;    // 7.5 pt

const P = (text, opts = {}) => new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 55, line: 214 },
    indent: opts.indent,
    children: [new TextRun({ text, font: FONT, size: opts.size || BODY, bold: !!opts.bold, italics: !!opts.italics, color: opts.color })]
});

/* Parrafo con fragmentos en negrita marcados con **...** */
const PR = (text, opts = {}) => {
    const parts = String(text).split(/\*\*/);
    return new Paragraph({
        alignment: opts.align || AlignmentType.JUSTIFIED,
        spacing: { after: opts.after ?? 55, line: 214 },
        children: parts.map((t, i) => new TextRun({ text: t, font: FONT, size: opts.size || BODY, bold: i % 2 === 1 }))
    });
};

const LI = (text, level = 0) => {
    const parts = String(text).split(/\*\*/);
    return new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        bullet: { level },
        spacing: { after: 14, line: 206 },
        children: parts.map((t, i) => new TextRun({ text: t, font: FONT, size: BODY, bold: i % 2 === 1 }))
    });
};

const NUM = (text, n) => new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 14, line: 206 },
    indent: { left: convertInchesToTwip(0.32), hanging: convertInchesToTwip(0.22) },
    children: [
        new TextRun({ text: `${n}. `, font: FONT, size: BODY, bold: true }),
        ...String(text).split(/\*\*/).map((t, i) => new TextRun({ text: t, font: FONT, size: BODY, bold: i % 2 === 1 }))
    ]
});

const H = (text, level) => new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: level === 1 ? 165 : 105, after: level === 1 ? 70 : 40 },
    keepNext: true,
    children: [new TextRun({
        text, font: FONT, bold: true,
        size: level === 1 ? 24 : level === 2 ? 21 : 20,
        color: level === 1 ? AZUL : AZUL2
    })]
});

const H1 = t => H(t, 1), H2 = t => H(t, 2), H3 = t => H(t, 3);

const cellPar = (text, opts = {}) => new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: 15, after: 15, line: 180 },
    children: String(text).split(/\*\*/).map((t, i) => new TextRun({
        text: t, font: FONT, size: opts.size || TBL,
        bold: opts.bold || i % 2 === 1,
        color: opts.color
    }))
});

const TH_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BFC7D5' };
const BORDERS = { top: TH_BORDER, bottom: TH_BORDER, left: TH_BORDER, right: TH_BORDER, insideHorizontal: TH_BORDER, insideVertical: TH_BORDER };

/** T(headers, rows, widthsPct) — tabla profesional a ancho completo. */
const T = (headers, rows, widths) => {
    const w = widths || headers.map(() => Math.floor(100 / headers.length));
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: BORDERS,
        rows: [
            new TableRow({
                tableHeader: true,
                children: headers.map((h, i) => new TableCell({
                    width: { size: w[i], type: WidthType.PERCENTAGE },
                    shading: { type: ShadingType.CLEAR, fill: AZUL, color: 'auto' },
                    margins: { top: 20, bottom: 20, left: 60, right: 60 },
                    children: [cellPar(h, { bold: true, color: 'FFFFFF', align: AlignmentType.CENTER })]
                }))
            }),
            ...rows.map((r, ri) => new TableRow({
                children: r.map((c, i) => new TableCell({
                    width: { size: w[i], type: WidthType.PERCENTAGE },
                    shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: GRIS, color: 'auto' } : undefined,
                    margins: { top: 18, bottom: 18, left: 60, right: 60 },
                    children: [cellPar(c, { align: i === 0 && headers.length > 3 ? AlignmentType.LEFT : AlignmentType.LEFT })]
                }))
            }))
        ]
    });
};

const SPACER = (after = 70) => new Paragraph({ spacing: { after }, children: [] });

/* ─────────────────────── Bloque reutilizable de modulo ─────────────────────── */
function modulo({ titulo, objetivo, usuarios, funciones, informacion, resultados }) {
    const out = [H2(titulo)];
    out.push(PR(`**Objetivo.** ${objetivo}`));
    out.push(PR(`**Usuarios.** ${usuarios}`));
    out.push(PR('**Funciones requeridas.**', { after: 60 }));
    funciones.forEach(f => out.push(LI(f)));
    out.push(PR(`**Información administrada.** ${informacion}`, { after: 60 }));
    out.push(PR(`**Resultados esperados.** ${resultados}`));
    return out;
}

/* ══════════════════════════════ CONTENIDO ══════════════════════════════ */
const body = [];

/* ── Portada ── */
body.push(
    new Paragraph({ spacing: { before: 1800, after: 0 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'AEROPUERTO INTERNACIONAL FELIPE ÁNGELES', font: FONT, size: 24, bold: true, color: AZUL2 })
    ]}),
    new Paragraph({ spacing: { after: 700 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'DIRECCIÓN DE OPERACIÓN', font: FONT, size: 22, color: '595959' })
    ]}),
    new Paragraph({ spacing: { after: 240 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'REQUERIMIENTOS FUNCIONALES Y TÉCNICOS DEL SISTEMA DE LA DIRECCIÓN DE OPERACIÓN', font: FONT, size: 40, bold: true, color: AZUL })
    ]}),
    new Paragraph({ spacing: { after: 1400 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'Documento de especificación de requerimientos para la integración del Anexo Técnico del Sistema de Gestión de Recursos Gubernamentales (GRP)', font: FONT, size: 22, italics: true, color: '595959' })
    ]}),
    T(['Concepto', 'Descripción'],
      [
        ['Área solicitante', 'Dirección de Operación'],
        ['Destinatario', 'Tecnologías de la Información y Comunicaciones (TIC)'],
        ['Propósito', 'Insumo para la elaboración del Anexo Técnico del Sistema de Gestión de Recursos Gubernamentales (GRP)'],
        ['Tipo de documento', 'Especificación de requerimientos funcionales y técnicos'],
        ['Naturaleza del requerimiento', 'Sistema por desarrollar o contratar'],
        ['Versión', '1.0'],
      ], [28, 72]),
    new Paragraph({ children: [new PageBreak()] })
);

/* ── Índice ── */
body.push(H1('Índice'));
body.push(new TableOfContents('Tabla de contenido', { hyperlink: true, headingStyleRange: '1-3' }));
body.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 1. Objetivo ── */
body.push(H1('1. Objetivo'));
body.push(P('El presente documento tiene por objeto especificar los requerimientos funcionales y técnicos que deberá cumplir el sistema informático solicitado por la Dirección de Operación del Aeropuerto Internacional Felipe Ángeles, con el fin de que el área de Tecnologías de la Información y Comunicaciones cuente con los elementos necesarios para determinar el alcance del desarrollo, la contratación o la incorporación de dichas capacidades dentro del Sistema de Gestión de Recursos Gubernamentales.'));
body.push(P('Se requiere una plataforma institucional, de operación centralizada y acceso mediante navegador web, que concentre el registro, la validación, la consulta, el resguardo documental y la explotación estadística de la información generada por las gerencias adscritas a la Dirección de Operación, sustituyendo la captura dispersa en hojas de cálculo, formatos impresos y archivos locales.'));
body.push(P('La especificación describe los módulos requeridos, las funciones que cada uno deberá proporcionar, los perfiles de usuario y sus privilegios, los procesos y reglas de negocio que deberán aplicarse, la información que deberá administrarse, los reportes e indicadores que deberán obtenerse, así como los requerimientos técnicos generales que la solución deberá satisfacer.'));

/* ── 2. Alcance ── */
body.push(H1('2. Alcance'));
body.push(P('El alcance comprende la totalidad de los procesos operativos, de seguridad operacional, de servicios complementarios, de infraestructura aeroportuaria y de gestión administrativa que se ejecutan bajo la responsabilidad de la Dirección de Operación y de sus subdirecciones y gerencias adscritas.'));
body.push(PR('Quedan **incluidos** en el alcance:', { after: 60 }));
[
    'El registro y seguimiento de la operación aeronáutica diaria, mensual y anual del aeródromo, incluyendo operaciones, pasajeros y carga.',
    'La recepción, validación y conciliación de los manifiestos de vuelo entregados por las aerolíneas y prestadores de servicios, así como la emisión del informe estadístico oficial derivado de ellos.',
    'El registro de eventos y actividades de seguridad operacional, servicio de salvamento y extinción de incendios, control de fauna y servicio médico.',
    'El registro y control de la operación y el mantenimiento de la infraestructura aeroportuaria: instalaciones hidráulicas, climatización, ingeniería civil, generación y transformación de energía eléctrica.',
    'La administración del padrón de colaboradores del área, su capacitación, y el control de resguardos de vehículos, mobiliario y bienes informáticos.',
    'La programación y el seguimiento de comités, reuniones y acuerdos institucionales.',
    'La administración de usuarios, perfiles y privilegios, así como el resguardo de evidencias documentales y fotográficas asociadas a los registros.',
].forEach(t => body.push(LI(t)));
body.push(PR('Quedan **fuera** del alcance de esta especificación los procesos financieros, presupuestales, de adquisiciones y de recursos humanos que corresponden a otras direcciones, sin perjuicio de las integraciones que se señalan en el capítulo 11.'));

/* ── 3. Descripción general ── */
body.push(H1('3. Descripción general de la solución requerida'));
body.push(P('Se requiere una solución de tipo aplicación web, accesible desde equipos de escritorio y dispositivos móviles institucionales mediante navegador estándar, sin necesidad de instalación local, y con capacidad de operar de manera responsiva en las áreas operativas del aeródromo.'));
body.push(P('La solución deberá organizarse en módulos funcionales agrupados conforme a la estructura orgánica de la Dirección de Operación. Cada módulo deberá constituir un espacio de trabajo independiente, con sus propios formularios de captura, consultas, tableros de indicadores y reportes, pero deberá compartir con los demás módulos un mismo esquema de identidad, autenticación, perfiles, privilegios, catálogos institucionales y trazabilidad.'));
body.push(P('El acceso a cada módulo deberá quedar determinado por el perfil asignado al usuario. La navegación deberá presentar únicamente los módulos autorizados para el usuario que ha iniciado sesión, y el nivel de operación disponible dentro de cada módulo —consulta, captura, edición o administración— deberá derivarse del perfil y de la configuración institucional de permisos, sin que el usuario pueda modificarlos.'));
body.push(P('La información deberá residir en una base de datos centralizada y las evidencias documentales y fotográficas en un repositorio de archivos vinculado a los registros correspondientes. Toda operación de escritura deberá quedar registrada con identificación del usuario y marca de tiempo, de forma que sea posible reconstruir el historial de cada registro.'));

/* ── 4. Estructura de módulos ── */
body.push(H1('4. Estructura de módulos'));
body.push(P('Se requiere que la solución contemple los siguientes módulos, agrupados por el área responsable de la información que administran:'));
body.push(P('Se requiere que la solución contemple los siguientes módulos, agrupados por el área responsable de la información que administran. Los módulos deberán poder habilitarse por etapas, sin que la ausencia de uno impida la operación de los demás, y deberán compartir la misma base de usuarios, catálogos y mecanismos de trazabilidad.'));
body.push(T(
    ['Agrupación', 'Módulos requeridos (clave)'],
    [
        ['Operación de la Parte Aeronáutica', 'Operación aeronáutica e histórico comparativo (M-OPA); itinerario diario y parte de operaciones (M-ITI); conciliación de manifiestos e informe estadístico (M-CON); portal digital de manifiestos para prestadores (M-POR); destinos, rutas y frecuencias (M-FRE); puntualidad y demoras (M-PUN); servicios de aeropasillos y aerocares (M-ABO).'],
        ['Operación del Edificio Terminal', 'Sistema de manejo de equipaje (M-BHS).'],
        ['Seguridad Operacional', 'Control y peligro aviario (M-FAU); emergencias en pista y atención a derrames (M-SEI); personal capacitado de prestadores (M-PCP); valoraciones médicas del personal operativo (M-VAL); catálogo de vehículos y mantenimientos (M-VEH).'],
        ['Servicios Médicos', 'Servicio médico aeroportuario (M-MED).'],
        ['Servicios Complementarios', 'Aviación general y terminal FBO (M-FBO); terminal de carga y capacidad instalada (M-CAR); combustible de aviación (M-COM).'],
        ['Infraestructura Aeroportuaria', 'Aprovechamiento del agua y residuos (M-HID); reportes de climatización (M-HVA); ingeniería civil, vidrios y filtraciones del edificio terminal (M-CIV); energía, generación y transformación (M-ENE).'],
        ['Gestión de Personal y Contratos', 'Padrón de colaboradores y capacitación (M-COL); resguardos de vehículos, mobiliario y bienes informáticos (M-RES); agenda de comités, reuniones y acuerdos (M-AGE).'],
        ['Transversal', 'Administración de usuarios, perfiles y privilegios (M-ADM); gestión de datos, catálogos y cargas masivas (M-DAT); biblioteca documental y control de documentos (M-BIB); notificaciones y avisos institucionales (M-NOT).'],
    ], [24, 76]));
body.push(P('Los módulos deberán poder habilitarse por etapas, sin que la ausencia de uno impida la operación de los demás, y deberán compartir la misma base de usuarios, catálogos y mecanismos de trazabilidad.'));

/* ── 5. Requerimientos funcionales por módulo ── */
body.push(H1('5. Requerimientos funcionales por módulo'));
body.push(P('Para cada módulo se indica el objetivo que deberá atender, los usuarios que deberán utilizarlo, las funciones que deberá proporcionar, la información que deberá administrar y los resultados que deberá entregar.'));

modulo({
    titulo: '5.1 Operación aeronáutica e histórico comparativo (M-OPA)',
    objetivo: 'Se requiere un módulo que concentre la cifra oficial de operaciones, pasajeros y carga del aeródromo, con desagregación diaria, mensual y anual, y que permita su comparación entre periodos.',
    usuarios: 'Personal de captura y análisis de la Gerencia de Operación de la Parte Aeronáutica, titulares con perfil de consulta y perfiles administradores del área.',
    funciones: [
        'Registrar y actualizar las cifras diarias, mensuales y anuales de operaciones, pasajeros y carga, diferenciando **aviación comercial, general y de carga**, por **tipo de movimiento** (llegada y salida) y por **ámbito** (nacional e internacional).',
        'Marcar una cifra mensual como **oficial o ratificada**, de forma que prevalezca en todo reporte institucional, e impedir que exista más de una cifra oficial por periodo y tipo de aviación.',
        'Generar comparativos año contra año y mes contra mes, con cálculo automático de variaciones absolutas y porcentuales.',
        'Presentar tableros con indicadores acumulados del año en curso y gráficas de comportamiento por periodo, tipo de aviación y ámbito.',
        'Consultar el detalle por aerolínea y por ruta, y exportar las tablas e indicadores a hoja de cálculo y documento imprimible.',
    ],
    informacion: 'Cifras diarias, mensuales y anuales de operaciones, pasajeros y carga; clasificación por tipo de aviación, movimiento y ámbito; identificación del periodo; marca de cifra oficial; observaciones; y datos de auditoría de la captura.',
    resultados: 'Tablero de indicadores del periodo, tablas comparativas interanuales, gráficas de comportamiento, concentrados anuales por tipo de aviación y archivos exportables para informes institucionales.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.2 Itinerario diario y parte de operaciones (M-ITI)',
    objetivo: 'Se requiere un módulo que permita registrar y consultar el itinerario de vuelos del día y elaborar a partir de él el parte de operaciones que documenta formalmente la actividad diaria del aeródromo.',
    usuarios: 'Personal de turno con perfil de captura; supervisores operativos con perfil de edición y validación; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar cada vuelo con número de vuelo, aerolínea, matrícula, tipo de aeronave, origen o destino, tipo de movimiento, tipo de servicio, ámbito, posición asignada y horarios programados y reales.',
        'Permitir la captura individual y la **carga masiva** de vuelos a partir de los archivos entregados por control de tránsito aéreo o por las aerolíneas.',
        '**Impedir el registro duplicado** de un mismo movimiento, entendido como la combinación de fecha, número de vuelo, aerolínea y tipo de movimiento.',
        'Consultar el itinerario mediante filtros por fecha, aerolínea, tipo de movimiento, ámbito, tipo de servicio y estado del vuelo.',
        'Generar el parte de operaciones del día, de un rango de fechas o de una selección de vuelos, integrando el conteo de operaciones, pasajeros y carga; exportarlo en documento imprimible y resguardarlo.',
        'Presentar el itinerario en una vista de tablero de llegadas y salidas apta para pantallas de sala de operaciones.',
    ],
    informacion: 'Datos identificadores del vuelo, aerolínea, aeronave y matrícula; origen y destino; horarios programados y reales; posición y calzos; tipo de servicio y ámbito; cifras de pasajeros, equipaje, carga y correo; estado del vuelo; y datos del parte generado con su folio, responsable y archivo resguardado.',
    resultados: 'Itinerario diario consultable, tablero operativo de llegadas y salidas, parte de operaciones formal exportable, y alimentación de las cifras que consumen los módulos de operación aeronáutica y conciliación.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.3 Conciliación de manifiestos e informe estadístico (M-CON)',
    objetivo: 'Se requiere un módulo que permita contrastar la información declarada por las aerolíneas y prestadores en los manifiestos de vuelo contra el itinerario registrado por el aeródromo, resolver las diferencias detectadas y generar el informe estadístico oficial del aeropuerto.',
    usuarios: 'Personal de captura y conciliación; supervisores con facultad de validación; perfil administrador del módulo, único autorizado para ratificar el informe.',
    funciones: [
        'Presentar, por cada vuelo del periodo, la información del itinerario y la declarada en el manifiesto, señalando las diferencias en operaciones, pasajeros, equipaje, carga y correo.',
        'Permitir la **captura directa** de la información del manifiesto cuando el prestador no la haya entregado por el portal, y la **edición en línea** de los campos conciliables.',
        'Identificar vuelos declarados sin correspondencia en el itinerario y vuelos del itinerario sin manifiesto entregado, y llevar el control de las capturas pendientes.',
        'Corregir la asignación de aerolínea de un vuelo cuando el dato de origen sea erróneo, **conservando el valor original** y el registro de quién realizó la corrección.',
        'Mantener un **historial de conciliación** con el valor anterior, el valor nuevo, el usuario responsable y la fecha y hora de cada modificación.',
        'Generar el informe estadístico del periodo con el desglose mensual por tipo de aviación, la participación por aerolínea, el factor de ocupación y las cifras al día de corte, aplicando la **regla de precedencia** que hace prevalecer la cifra mensual ratificada.',
        'Permitir el **refresco controlado** de la información consolidada y registrar la **aprobación del informe**, identificando el periodo, el usuario y el momento de la operación.',
        'Exportar el informe estadístico y las tablas de conciliación en hoja de cálculo y documento imprimible.',
    ],
    informacion: 'Vuelos del periodo con sus cifras declaradas y registradas; diferencias detectadas y estado de conciliación; correcciones de aerolínea y su valor original; catálogos de aerolíneas y aeropuertos; matrículas asociadas; historial de cambios; y registros de refresco y aprobación del informe.',
    resultados: 'Tabla de conciliación con diferencias resaltadas, control de capturas pendientes, historial auditable de correcciones, informe estadístico mensual y acumulado, y archivos exportables para su remisión a las instancias correspondientes.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.4 Portal digital de manifiestos para prestadores (M-POR)',
    objetivo: 'Se requiere un módulo de acceso externo que permita a las aerolíneas y prestadores entregar de manera digital los manifiestos de vuelo, y al personal del aeropuerto revisarlos, aprobarlos o rechazarlos, eliminando la entrega en papel y la doble captura.',
    usuarios: 'Usuarios de aerolíneas y prestadores con perfil de captura restringido a su propia empresa; personal revisor del aeropuerto; personal de la autoridad aeronáutica con perfil de consulta; perfil administrador del portal.',
    funciones: [
        'Permitir el alta controlada de usuarios de empresa, asociando cada usuario a la empresa que representa.',
        'Presentar formularios diferenciados para **manifiesto de pasajeros** y **manifiesto de carga**, en sus variantes de llegada y de salida, validando los campos obligatorios y la congruencia aritmética de los totales antes del envío.',
        'Permitir adjuntar el manifiesto digitalizado y conservarlo asociado al registro; cada manifiesto deberá contar con **folio único** y con un **estado**: pendiente, en revisión, aprobado o rechazado.',
        'Restringir al usuario de la empresa la consulta a los manifiestos de su propia empresa y su seguimiento.',
        'Permitir al personal revisor consultar la totalidad de los manifiestos, filtrarlos por fecha, empresa, tipo, vuelo y estado, y **aprobar o rechazar** cada uno indicando el motivo cuando corresponda.',
        'Impedir la modificación de un manifiesto aprobado por parte del prestador; el rechazo deberá habilitar nuevamente su edición para corrección.',
        'Poner los manifiestos aprobados a disposición del módulo de conciliación sin captura adicional.',
    ],
    informacion: 'Identificación de la empresa y del usuario que captura; fecha del vuelo, folio, aerolínea, número de vuelo, aeronave, matrícula y aeropuerto de referencia; totales de pasajeros, equipaje, carga y correo; documento digitalizado; estado y motivo de rechazo; y datos de auditoría de la captura y la revisión.',
    resultados: 'Bandeja de manifiestos por empresa y bandeja de revisión para el aeropuerto, acuse del manifiesto entregado, expediente digital por periodo e insumo directo para la conciliación.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.5 Destinos, rutas y frecuencias (M-FRE)',
    objetivo: 'Se requiere un módulo que administre el catálogo de rutas y destinos servidos desde el aeródromo y determine las frecuencias semanales ofrecidas por cada aerolínea en los segmentos nacional, internacional y de carga.',
    usuarios: 'Personal de análisis y planeación de la operación con perfil de captura y edición; personal directivo con perfil de consulta.',
    funciones: [
        'Administrar un catálogo de rutas con ciudad, estado o país, código de aeropuerto, aerolínea operadora y fecha de inicio de operación.',
        '**Calcular las frecuencias semanales** por ruta y aerolínea a partir de la información de vuelos registrada, con desglose por día de la semana y total semanal, diferenciando los segmentos **nacional, internacional y de carga**.',
        'Conservar las frecuencias de semanas anteriores para permitir la comparación histórica y la identificación de altas y bajas de rutas.',
        'Presentar la red de destinos sobre una **representación cartográfica**, con consulta del detalle de cada destino.',
        'Programar el inicio de operación de nuevas rutas, emitir avisos previos a la fecha de arranque y exportar el cuadro de frecuencias del periodo.',
    ],
    informacion: 'Catálogo de rutas y destinos con sus datos geográficos y códigos; aerolínea operadora; frecuencias por día de la semana y total semanal; vigencia de la semana calculada; calendario de arranque de nuevas rutas; e histórico de semanas anteriores.',
    resultados: 'Cuadro semanal de frecuencias por segmento, mapa de destinos, comparativo histórico de la red de rutas y calendario de nuevas rutas con sus avisos.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.6 Puntualidad y demoras (M-PUN)',
    objetivo: 'Se requiere un módulo que permita medir la puntualidad de las operaciones y registrar, clasificar y analizar las demoras ocurridas, distinguiendo las imputables al aeropuerto de las imputables a terceros.',
    usuarios: 'Personal de análisis de la operación con perfil de captura y edición; supervisores operativos y personal directivo con perfil de consulta.',
    funciones: [
        'Permitir la carga masiva y la captura individual de los registros de demora, con número de vuelo, aerolínea, tipo de aeronave, matrícula, ruta, tipo de movimiento y ámbito.',
        'Registrar el **horario programado, el horario real y el tiempo de demora** resultante de cada operación.',
        'Administrar un **catálogo de códigos y motivos de demora** y clasificar cada evento conforme a él, identificando si la demora es **imputable al aeropuerto o a la compañía**.',
        'Calcular indicadores de puntualidad por periodo, aerolínea, tipo de movimiento y posición.',
        'Consultar los registros mediante filtros por año, mes, aerolínea, código de demora y estado.',
        'Reemplazar de manera controlada los registros previos de un periodo al efectuar una nueva carga masiva, sin afectar periodos distintos.',
    ],
    informacion: 'Identificación del vuelo y la aerolínea; horarios programados y reales; tiempo de demora; código y motivo; clasificación de imputabilidad; pasajeros afectados; posición; y periodo de referencia.',
    resultados: 'Indicadores de puntualidad general y por aerolínea, distribución de demoras por código y motivo, series históricas mensuales y tablas exportables para el informe de desempeño operativo.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.7 Servicios de aeropasillos y aerocares (M-ABO)',
    objetivo: 'Se requiere un módulo que documente la prestación de los servicios de aeropasillo y de transporte de pasajeros en plataforma, con el registro de tiempos, responsables y conformidad de la aerolínea atendida.',
    usuarios: 'Operadores y coordinadores del servicio con perfil de captura; supervisores con perfil de edición y consulta; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar la orden de servicio con folio, fecha, tipo de vuelo, tipo de operación, posición, número de vuelo, aerolínea, matrícula y aeronave.',
        'Registrar la **secuencia de tiempos** del servicio —hora programada, solicitud, calzos, autorización de acople, acople, cierre de puerta, desacople y entrega— y calcular el tiempo total de atención.',
        'Identificar al personal que ejecuta el acople y el desacople y al coordinador responsable, y registrar las observaciones de la aerolínea y del operador.',
        'Permitir la captura de **firmas digitales** de conformidad del representante de la aerolínea, del operador y del coordinador.',
        'Generar la boleta de servicio en documento imprimible, conservarla en el repositorio documental asociada al registro y permitir la consulta por fecha, posición, aerolínea y tipo de operación.',
    ],
    informacion: 'Folio y fecha del servicio; datos del vuelo y de la aerolínea atendida; posición y aeropasillo utilizado; secuencia completa de tiempos; personal operador y coordinador; firmas de conformidad; observaciones; y boleta generada.',
    resultados: 'Expediente digital de órdenes de servicio, boletas firmadas exportables e indicadores de tiempos de atención y volumen de servicios por periodo, posición y aerolínea.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.8 Sistema de manejo de equipaje (M-BHS)',
    objetivo: 'Se requiere un módulo que registre y analice el desempeño del sistema automatizado de manejo de equipaje, en los flujos de salida y de llegada, y su nivel de utilización respecto de la capacidad instalada.',
    usuarios: 'Personal de la Gerencia de Operación del Edificio Terminal con perfil de captura y edición; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar el volumen mensual de equipaje procesado, diferenciando **salidas y llegadas** y desagregando por aerolínea.',
        'Registrar la **capacidad instalada** del sistema y calcular el porcentaje de utilización del periodo.',
        'Registrar los equipajes procesados sin vuelo asociado, para su seguimiento.',
        'Permitir la carga masiva de la información mensual y su corrección posterior por perfiles autorizados.',
        'Generar series históricas mensuales y anuales con comparativos interanuales y gráficas por mes, aerolínea y tipo de operación.',
    ],
    informacion: 'Periodo de referencia; tipo de operación; volumen de equipaje por aerolínea y total del periodo; capacidad instalada; porcentaje de utilización; equipajes sin vuelo asociado; y datos de auditoría.',
    resultados: 'Tablero de utilización del sistema, series mensuales y anuales de equipaje procesado, participación por aerolínea y comparativos interanuales.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.9 Control y peligro aviario (M-FAU)',
    objetivo: 'Se requiere un módulo destinado al registro, seguimiento y análisis de los eventos relacionados con fauna dentro de las áreas operativas del aeródromo, tanto de los impactos con aeronaves como de las capturas y reubicaciones realizadas por el personal de control de fauna.',
    usuarios: 'Personal de control de fauna con perfil de captura y edición; personal de seguridad operacional con perfil de supervisión y validación; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar cada **impacto con fauna** indicando fecha, hora, ubicación dentro del aeródromo, zona de impacto, fase de la operación, aerolínea, tipo de aeronave y matrícula.',
        'Registrar la **identificación de la especie**, su nombre común y científico, el tamaño, la cantidad de restos localizados y su ubicación.',
        'Registrar las **medidas proactivas** aplicadas, las condiciones meteorológicas del evento, el resultado de las medidas y las observaciones del reportante.',
        'Registrar las **capturas y reubicaciones**, con número consecutivo, clase, especie, cantidad, método de captura, cuadrante y disposición final del ejemplar.',
        'Adjuntar **evidencias fotográficas** a cada registro y conservarlas asociadas a él.',
        'Consultar los registros mediante filtros por fecha, especie, zona, aerolínea, fase de operación y tipo de evento.',
        'Generar una **representación cartográfica de la incidencia**, incluyendo mapas de calor por cuadrante que faciliten la identificación de las zonas de mayor concentración, y estadísticas por especie, periodo, zona y fase de la operación.',
    ],
    informacion: 'Datos generales del evento, ubicación y cuadrante; fase de operación y zona de impacto; datos de la aeronave y la aerolínea; identificación de la especie y cantidad de ejemplares; método de captura y disposición final; medidas adoptadas y sus resultados; condiciones meteorológicas; evidencias fotográficas; y datos de auditoría.',
    resultados: 'Estadística de impactos y capturas por periodo y especie, mapa de calor de incidencia por cuadrante, indicadores de eficacia de las medidas proactivas y reportes exportables para las autoridades aeronáuticas.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.10 Emergencias en pista y atención a derrames (M-SEI)',
    objetivo: 'Se requiere un módulo que documente la actuación del Servicio de Salvamento y Extinción de Incendios ante emergencias ocurridas en el área de movimiento y ante derrames de sustancias en plataforma, con la medición de sus tiempos de respuesta.',
    usuarios: 'Personal del SSEI con perfil de captura; coordinadores de seguridad operacional con perfil de edición y validación; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar cada **emergencia en pista** con número consecutivo, fecha, pista involucrada, tipo de aeronave, operador y descripción del suceso.',
        '**Clasificar el evento** como accidente o incidente, restringiendo la clasificación a los valores institucionalmente definidos, y adjuntar **evidencias fotográficas**.',
        'Registrar cada **atención a derrame** indicando fecha, quién solicitó la activación, hora de activación, empresa responsable, sitio y hora de llegada del servicio.',
        '**Calcular el tiempo de respuesta** a partir de la hora de activación y la hora de llegada.',
        'Registrar la superficie afectada, el costo operativo de la atención y el cobro realizado a la empresa responsable.',
        'Consultar los registros por periodo, pista, operador, empresa y clasificación, y generar indicadores de frecuencia de eventos, tiempo promedio de respuesta y recuperación de costos.',
    ],
    informacion: 'Datos del evento, fecha, hora y ubicación; pista, aeronave y operador involucrados; descripción y clasificación; evidencias fotográficas; para derrames: empresa responsable, sitio, tiempos de activación y llegada, superficie afectada, costo operativo y cobro; y datos de auditoría.',
    resultados: 'Bitácora de emergencias y derrames, indicadores de tiempo de respuesta, estadística de eventos por pista y operador, concentrado de costos y cobros por empresa y expediente fotográfico de cada evento.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.11 Personal capacitado de prestadores de servicios (M-PCP)',
    objetivo: 'Se requiere un módulo que administre el padrón del personal de las empresas prestadoras que se encuentra capacitado y autorizado para conducir vehículos en el área de movimiento, conforme a las categorías de licencia aplicables.',
    usuarios: 'Personal de la coordinación de medidas de seguridad operacional con perfil de captura y edición; supervisores con perfil de validación; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar al personal capacitado indicando la empresa prestadora, el nombre, la categoría de licencia otorgada y su vigencia.',
        'Administrar el **catálogo de categorías de licencia** de conducción en el aeródromo, describiendo para cada categoría el área autorizada, el tipo de personal y los vehículos comprendidos.',
        'Permitir el registro, la consulta, la actualización y la baja de los registros por parte de los perfiles autorizados.',
        'Consultar el padrón mediante filtros por empresa, categoría, periodo y vigencia, y exportar los concentrados resultantes.',
        'Generar indicadores de personal capacitado por empresa, categoría y periodo, así como el comportamiento histórico de la capacitación impartida.',
    ],
    informacion: 'Identificación de la empresa prestadora; datos del personal capacitado; categoría de licencia y área autorizada; fecha de capacitación y vigencia; observaciones; y datos de auditoría.',
    resultados: 'Padrón consultable de personal autorizado, concentrados por empresa y categoría, series históricas de capacitación e indicadores de cumplimiento de los prestadores.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.12 Valoraciones médicas del personal operativo (M-VAL)',
    objetivo: 'Se requiere un módulo que registre las valoraciones médicas practicadas al personal operativo de las empresas que prestan servicios en el aeródromo, como medida preventiva de seguridad operacional.',
    usuarios: 'Personal de la coordinación de medidas de seguridad operacional con perfil de captura y edición; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar cada jornada de valoración con número de programa, fecha, hora, empresa evaluada y cantidad de personas valoradas.',
        'Señalar los **tipos de valoración practicada** de un catálogo predefinido, admitiendo la selección de varios tipos en un mismo registro.',
        'Registrar observaciones y hallazgos relevantes de la jornada.',
        'Permitir el registro, la consulta, la actualización y la eliminación por parte de los perfiles autorizados, con consulta filtrada por periodo, empresa y tipo de valoración.',
        'Generar indicadores de personal valorado por empresa, tipo de valoración y periodo.',
    ],
    informacion: 'Número de programa, fecha y hora de la jornada; empresa evaluada; cantidad de personas valoradas; tipos de valoración practicada; observaciones; y datos de auditoría.',
    resultados: 'Concentrados de valoraciones por empresa y periodo, gráficas de comportamiento mensual e indicadores de cobertura del programa preventivo.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.13 Catálogo de vehículos y mantenimientos (M-VEH)',
    objetivo: 'Se requiere un módulo que administre el parque vehicular asignado a la Dirección de Operación, su documentación, sus responsables y el seguimiento de sus mantenimientos.',
    usuarios: 'Personal responsable del parque vehicular con perfil de captura y edición; auditoría interna y coordinación administrativa con perfil de consulta; perfil administrador para la baja de unidades.',
    funciones: [
        'Registrar cada unidad con clave institucional única, tipo de vehículo, marca, submarca, año modelo, color, número de serie, número económico, placas, combustible, transmisión y capacidad de pasajeros.',
        'Administrar la **información de aseguramiento** —aseguradora, número de póliza, descripción y vigencia— y emitir avisos ante la proximidad del vencimiento.',
        'Registrar el **área responsable y el responsable asignado** de cada unidad.',
        'Controlar el **estado de la unidad**, restringido a activo, en mantenimiento o baja, e impedir la asignación de unidades dadas de baja.',
        'Adjuntar la **fotografía de la unidad** y registrar los **mantenimientos** realizados con su fecha, tipo, descripción y costo.',
        'Consultar el parque vehicular mediante filtros por tipo, estado, área responsable y vigencia de seguro.',
    ],
    informacion: 'Datos de identificación y características técnicas del vehículo; documentación de aseguramiento y su vigencia; área y responsable asignado; estado operativo; fotografía; historial de mantenimientos; notas; y datos de auditoría.',
    resultados: 'Inventario consultable del parque vehicular, avisos de vencimiento de pólizas, historial de mantenimiento por unidad y concentrados por tipo, estado y área responsable.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.14 Servicio médico aeroportuario (M-MED)',
    objetivo: 'Se requiere un módulo que registre las atenciones médicas prestadas en el aeródromo y conserve el historial correspondiente, diferenciando la población atendida.',
    usuarios: 'Personal del servicio médico con perfil especializado de captura y edición; personal directivo con perfil de consulta agregada; perfil administrador del módulo.',
    funciones: [
        'Registrar las atenciones del periodo diferenciando **personal del aeropuerto, personal de otras empresas, pasajeros y visitantes**, y calcular automáticamente el total.',
        'Registrar el historial de atención, el tipo de padecimiento atendido y las observaciones correspondientes.',
        'Resguardar los documentos clínicos asociados a la atención, con **acceso restringido exclusivamente al perfil de servicio médico y a los perfiles administradores**.',
        'Administrar el directorio de contactos y servicios médicos de referencia.',
        'Generar concentrados mensuales y anuales, con consulta filtrada por periodo y tipo de población, sin exponer información clínica individual a perfiles no autorizados.',
    ],
    informacion: 'Periodo de referencia; número de atenciones por tipo de población y total; historial y tipo de atención; documentos clínicos resguardados; directorio de servicios médicos; y datos de auditoría.',
    resultados: 'Concentrado mensual y anual de atenciones, gráficas por tipo de población y expediente documental restringido conforme a la normatividad aplicable en materia de datos personales.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.15 Servicios complementarios: aviación general, terminal de carga y combustible (M-FBO, M-CAR, M-COM)',
    objetivo: 'Se requiere disponer de módulos que documenten la operación de la terminal de aviación general, la capacidad instalada y los operadores de la terminal de carga, y el suministro de combustible de aviación.',
    usuarios: 'Personal de las gerencias de aviación general, carga y combustibles con perfil de captura y edición; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar y consultar las operaciones de la terminal de aviación general y los servicios prestados a las aeronaves atendidas, con su desglose por periodo.',
        'Administrar la información de la **capacidad instalada** de la terminal de carga y los padrones de **aerolíneas de carga**, **recintos fiscalizados** y **empresas de servicios en tierra** autorizadas, manteniéndolos actualizados.',
        'Registrar el **volumen mensual de combustible de aviación suministrado**, expresado en litros, con las observaciones que correspondan.',
        '**Impedir el registro de más de un valor por mes y año** para el mismo concepto, permitiendo su corrección por perfiles autorizados.',
        'Generar series históricas mensuales y anuales con comparativos interanuales y gráficas de comportamiento.',
    ],
    informacion: 'Operaciones y servicios de la terminal de aviación general; capacidad instalada de la terminal de carga y padrones de aerolíneas, recintos fiscalizados y prestadores de servicios en tierra; volumen mensual de combustible suministrado; observaciones y periodos de referencia.',
    resultados: 'Tableros de indicadores por gerencia, padrones consultables y exportables, y series históricas de suministro de combustible y de aprovechamiento de la capacidad de carga.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.16 Infraestructura aeroportuaria (M-HID, M-HVA, M-CIV, M-ENE)',
    objetivo: 'Se requiere disponer de módulos que registren y permitan analizar la operación y el mantenimiento de la infraestructura del aeródromo: instalaciones hidráulicas y manejo de residuos, sistemas de climatización, elementos constructivos del edificio terminal, y generación y transformación de energía eléctrica.',
    usuarios: 'Personal de las gerencias de instalaciones hidráulicas, ingeniería electromecánica, ingeniería civil, generación y transformación, con perfil de captura y edición; personal directivo con perfil de consulta.',
    funciones: [
        'Registrar el **suministro diario de agua potable** y el **tratamiento diario de aguas residuales**, así como el destino del agua tratada, con consulta por día, mes y año.',
        'Registrar el **manejo mensual de residuos** diferenciando inorgánicos, orgánicos, lodos, peligrosos y valorizables, en kilogramos, con identificación de la empresa responsable.',
        '**Impedir el registro duplicado** de un mismo mes y año en los conceptos de captura mensual, y distinguir el valor cero de la ausencia de dato.',
        'Registrar los **reportes de atención de climatización** con folio, fecha, personal que elabora, módulo, nivel, equipo, identificador, número de serie, área solicitante, motivo, revisión, mantenimiento realizado, estado, observaciones y firma del responsable.',
        'Registrar los **hallazgos de vidrios y filtraciones del edificio terminal** con número consecutivo, fecha, ubicación, módulo, nivel, elemento afectado, descripción, cantidad, entidad que reporta y meta de atención en días.',
        'Controlar el **estado de atención** de cada hallazgo, restringido a atendido o pendiente, calcular los días transcurridos hasta su atención y señalar los casos de reincidencia.',
        'Registrar el consumo mensual de **energía eléctrica generada y adquirida**, la **energía térmica** producida y el **consumo de gas**, con validación de unicidad por mes y año.',
        'Registrar los **mantenimientos preventivos programados y realizados** y los **correctivos de luminarias**, junto con la **meta anual**, y calcular el porcentaje de cumplimiento.',
        'Permitir la consulta histórica por año y mes, la comparación interanual y la exportación de los concentrados en todos los módulos de infraestructura.',
    ],
    informacion: 'Volúmenes diarios de suministro y tratamiento de agua y destino del agua tratada; volúmenes mensuales de residuos por tipo y empresa responsable; reportes de climatización con su equipo, área solicitante y estado; hallazgos constructivos con ubicación, estado y tiempos de atención; consumos mensuales de energía eléctrica, térmica y gas; mantenimientos programados, realizados y correctivos; metas anuales; observaciones y datos de auditoría.',
    resultados: 'Tableros mensuales y anuales por gerencia, indicadores de cumplimiento de programas de mantenimiento, seguimiento de hallazgos pendientes y reincidentes, series históricas de consumo y concentrados exportables para los informes institucionales.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.17 Padrón de colaboradores y capacitación (M-COL)',
    objetivo: 'Se requiere un módulo que administre el padrón del personal adscrito a la Dirección de Operación, su expediente documental, su capacitación y sus periodos vacacionales.',
    usuarios: 'Personal de la coordinación administrativa con perfil de edición; personal de consulta autorizado; perfil administrador para la gestión del expediente completo. El acceso deberá restringirse conforme a la naturaleza personal de la información.',
    funciones: [
        'Registrar y consultar al personal con número de empleado, nombre, área de adscripción, nivel, puesto y estatus.',
        'Resguardar la **fotografía** del colaborador y los **documentos** que integran su expediente, con control de acceso restringido.',
        'Registrar los **cursos** impartidos indicando nombre, descripción, fecha de realización, si el curso es recurrente y la periodicidad de su renovación, permitiendo adjuntar la constancia; **calcular la vigencia** y emitir avisos anticipados de vencimiento.',
        'Registrar y consultar los **periodos vacacionales** programados.',
        'Conservar un **historial de cambios** por colaborador con el campo modificado, el valor anterior, el valor nuevo, el responsable y la fecha.',
        'Permitir la **incorporación controlada de nuevos colaboradores** mediante un formulario de alta con validación previa a su incorporación al padrón.',
        'Consultar el padrón mediante filtros por área, estatus, nivel y vigencia de cursos, y exportar los concentrados resultantes.',
    ],
    informacion: 'Datos de identificación y adscripción del colaborador; fotografía y documentos del expediente; cursos impartidos, su vigencia y constancias; periodos vacacionales; historial de modificaciones; y datos de auditoría.',
    resultados: 'Padrón consultable del personal, expediente digital por colaborador, tablero de vigencia de capacitación con avisos de vencimiento, calendario de vacaciones y concentrados por área y nivel.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.18 Resguardos de vehículos, mobiliario y bienes informáticos (M-RES)',
    objetivo: 'Se requiere un módulo que administre el inventario de bienes muebles e informáticos asignados a la Dirección de Operación y los resguardos que los amparan, con la documentación de respaldo correspondiente.',
    usuarios: 'Personal de la coordinación de auditoría y control interno con perfil de captura y edición; responsables de área con perfil de consulta de sus propios resguardos; perfil administrador para la carga masiva y la administración de catálogos.',
    funciones: [
        'Registrar cada bien de manera **individual o por lote**, con familia, descripción, número de serie, número de control, cantidad y número económico.',
        'Registrar el **área responsable**, el **responsable asignado**, el **folio de resguardo** y la **fecha de resguardo** de cada bien.',
        'Resguardar los **documentos de resguardo digitalizados**, con **control de versiones** e identificación de la versión vigente.',
        'Permitir la **carga masiva** del inventario desde hojas de cálculo, conservando la referencia al origen de cada registro e **impidiendo la duplicación** de registros provenientes de una misma fuente y posición.',
        'Registrar el proceso de **verificación física** del inventario, con su resultado y la fecha en que se realizó, y conservar el **historial de las cargas** y modificaciones.',
        'Consultar el inventario mediante filtros por familia, área responsable, responsable, folio de resguardo y estado de verificación, y exportar los resultados.',
    ],
    informacion: 'Tipo de registro, familia, descripción y características del bien; números de serie, control y económico; cantidad; área y responsable asignado; folio y fecha de resguardo; ubicación o vehículo asociado; documentos digitalizados y sus versiones; resultado de verificación; referencia al origen de la carga; y datos de auditoría.',
    resultados: 'Inventario consultable de bienes por área y responsable, resguardos digitalizados con control de versiones, reportes de verificación física e histórico de cargas y modificaciones.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.19 Agenda de comités, reuniones y acuerdos (M-AGE)',
    objetivo: 'Se requiere un módulo que administre los comités institucionales en que participa el aeropuerto, la programación de sus sesiones, los temas tratados y el seguimiento de los acuerdos derivados hasta su cumplimiento.',
    usuarios: 'Secretarios técnicos y responsables de cada comité con perfil de captura y edición sobre los comités de su área; participantes con perfil de consulta; perfil administrador para la gestión del catálogo de comités.',
    funciones: [
        'Administrar el **catálogo de comités** con número, nombre, acrónimo, descripción, área o dirección responsable, frecuencia de sesión, horario habitual, presidente y participantes.',
        'Programar las **sesiones** de cada comité con número de sesión, fecha, hora de inicio y término, lugar, modalidad y convocatoria, controlando su **estado**: programada, celebrada, cancelada o pospuesta.',
        '**Impedir el registro de dos sesiones del mismo comité en la misma fecha.**',
        'Registrar los **temas** tratados y los **acuerdos** derivados, con número de acuerdo, descripción, responsable y fecha límite de cumplimiento.',
        'Controlar el **estado de cada acuerdo** —pendiente, en proceso, cumplido o cancelado— y permitir adjuntar la **evidencia de cumplimiento**.',
        'Presentar un **calendario** de sesiones programadas, consultable por comité, área y periodo, y registrar la **asistencia** y la confirmación previa de los participantes.',
        '**Notificar** a los participantes las sesiones próximas y los acuerdos con fecha límite por vencer, y generar indicadores de cumplimiento por comité, área y responsable.',
    ],
    informacion: 'Catálogo de comités con su área, frecuencia y participantes; sesiones programadas con fecha, lugar, modalidad y estado; temas tratados; acuerdos con responsable, fecha límite, estado y evidencia; asistencia y confirmaciones; y datos de auditoría.',
    resultados: 'Calendario institucional de sesiones, minuta estructurada por sesión, tablero de seguimiento de acuerdos con semáforo de vencimiento, listas de asistencia e indicadores de cumplimiento.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.20 Administración de usuarios, perfiles y privilegios (M-ADM)',
    objetivo: 'Se requiere un módulo que administre las cuentas de usuario de la solución, los perfiles asignados, los módulos visibles para cada perfil y el nivel de operación autorizado dentro de cada módulo.',
    usuarios: 'Exclusivamente perfiles administradores institucionales designados por la Dirección de Operación.',
    funciones: [
        'Crear, consultar, actualizar y desactivar cuentas de usuario, asociando cada cuenta a una persona identificable y a un área de adscripción.',
        '**Asignar un perfil** a cada usuario y **habilitar el acceso a la aplicación**, de forma que la ausencia de habilitación impida el ingreso.',
        'Definir, por usuario, la **relación de módulos visibles** y el **nivel de operación** autorizado en cada uno: consulta, captura, edición o administración.',
        'Permitir el **restablecimiento de contraseña** por parte del administrador y **forzar su cambio** en el primer ingreso del usuario o cuando el administrador lo determine.',
        'Administrar el catálogo de **áreas** y su relación con los usuarios y con los módulos.',
        'Impedir que un usuario modifique su propio perfil, sus módulos visibles o su nivel de operación.',
        'Conservar el registro de las operaciones administrativas realizadas sobre cada cuenta y permitir la consulta y exportación del padrón de usuarios con sus privilegios vigentes.',
    ],
    informacion: 'Datos de identificación del usuario y su área; perfil asignado; habilitación de acceso; módulos visibles; nivel de operación por módulo; indicador de cambio de contraseña obligatorio; y bitácora de las operaciones administrativas.',
    resultados: 'Padrón de usuarios y privilegios vigentes, matriz de acceso por módulo y perfil, y bitácora de administración de cuentas para efectos de control interno.'
}).forEach(x => body.push(x));

modulo({
    titulo: '5.21 Módulos transversales: gestión de datos, biblioteca documental y notificaciones (M-DAT, M-BIB, M-NOT)',
    objetivo: 'Se requiere disponer de capacidades transversales para la administración de catálogos y cargas masivas de información, el resguardo controlado de documentos institucionales y la emisión de avisos a los usuarios.',
    usuarios: 'Perfiles administradores para la gestión de datos y catálogos; personal autorizado para la publicación documental; la totalidad de los usuarios como destinatarios de las notificaciones.',
    funciones: [
        '**Consultar, corregir y depurar** los catálogos institucionales compartidos: aerolíneas, aeropuertos, rutas, tipos de servicio, códigos de demora, áreas y demás catálogos comunes.',
        'Permitir la **carga masiva de información** desde hojas de cálculo, con validación previa, informe de registros aceptados y rechazados, y constancia de la carga realizada.',
        '**Publicar, clasificar y consultar documentos institucionales** por categoría, con control del perfil autorizado para su consulta.',
        'Aplicar una **marca de agua verificable** a los documentos que se entreguen a terceros, de modo que sea posible identificar el documento entregado, la fecha de emisión y el usuario que lo emitió.',
        'Registrar cada emisión de documento marcado y permitir la **validación de su autenticidad** mediante el código asociado, así como el número de validaciones realizadas.',
        'Enviar avisos sobre sesiones próximas, vencimientos de capacitación, vencimientos de pólizas, acuerdos por vencer e inicio de operación de nuevas rutas, permitiendo a cada usuario administrar su suscripción.',
        'Disponer de un mecanismo para que los usuarios remitan **comentarios, sugerencias y solicitudes de apoyo**, con la posibilidad de adjuntar imágenes de referencia.',
    ],
    informacion: 'Catálogos institucionales compartidos; registro de cargas masivas y su resultado; documentos publicados con su categoría, versión y control de acceso; registros de emisión y validación de documentos marcados; suscripciones y avisos emitidos; y solicitudes de apoyo recibidas.',
    resultados: 'Catálogos consistentes compartidos por todos los módulos, repositorio documental institucional controlado, comprobación de autenticidad de los documentos entregados y avisos oportunos a los usuarios responsables.'
}).forEach(x => body.push(x));

body.push(H1('6. Perfiles de usuario y privilegios'));
body.push(P('El sistema deberá manejar perfiles de usuario con privilegios predefinidos. Los permisos asociados a cada perfil deberán permanecer definidos por configuración institucional y no deberán depender de decisiones individuales del usuario. Ningún usuario deberá poder ampliar su propio nivel de operación ni la relación de módulos a los que accede.'));
body.push(P('El control de acceso deberá operar en tres niveles complementarios: la identificación del usuario mediante autenticación individual; la habilitación de la cuenta para el uso de la solución; y la definición, por usuario, de los módulos visibles y del nivel de operación autorizado en cada uno de ellos.'));

body.push(H2('6.1 Perfiles requeridos'));
body.push(T(['Perfil', 'Descripción y ámbito'],
    [
        ['Administrador institucional', 'Acceso a la totalidad de los módulos y a la administración de cuentas, perfiles, privilegios y catálogos. Perfil de asignación restringida.'],
        ['Administrador de módulo', 'Acceso total dentro de los módulos que tiene asignados, incluyendo la administración de sus catálogos, la validación y las operaciones de cierre o ratificación.'],
        ['Editor', 'Registro y modificación de la información de los módulos asignados, sin facultades de administración de usuarios ni de catálogos institucionales.'],
        ['Capturista', 'Registro de información y consulta de sus propios registros en los módulos asignados, sin facultad de eliminación ni de modificación de registros validados.'],
        ['Consulta', 'Acceso de sólo lectura a los módulos asignados, incluyendo tableros, consultas históricas y exportación de reportes.'],
        ['Perfiles especializados', 'Perfiles con facultades de edición limitadas al ámbito de su especialidad: control de fauna, servicio médico y gestión de colaboradores. El acceso a información de carácter personal o clínico deberá restringirse a estos perfiles y a los administradores institucionales.'],
        ['Usuario externo (prestador)', 'Acceso exclusivo al portal digital de manifiestos, limitado a la captura, consulta y seguimiento de los registros de la empresa que representa.'],
    ], [26, 74]));
body.push(SPACER());

body.push(H2('6.2 Matriz de privilegios por perfil'));
body.push(T(['Perfil', 'Consulta', 'Registro', 'Modificación', 'Eliminación', 'Validación', 'Administración'],
    [
        ['Administrador institucional', 'Sí', 'Sí', 'Sí', 'Sí', 'Sí', 'Sí'],
        ['Administrador de módulo', 'Sí', 'Sí', 'Sí', 'Sí', 'Sí', 'Sólo en sus módulos'],
        ['Editor', 'Sí', 'Sí', 'Sí', 'No', 'No', 'No'],
        ['Capturista', 'Sólo sus registros', 'Sí', 'Sólo registros no validados', 'No', 'No', 'No'],
        ['Consulta', 'Sí', 'No', 'No', 'No', 'No', 'No'],
        ['Especializado', 'Sí, en su ámbito', 'Sí, en su ámbito', 'Sí, en su ámbito', 'No', 'No', 'No'],
        ['Usuario externo', 'Sólo su empresa', 'Sí', 'Mientras no esté aprobado', 'No', 'No', 'No'],
    ], [22, 13, 12, 17, 12, 12, 12]));
body.push(SPACER());
body.push(P('La matriz anterior deberá aplicarse por módulo. Un mismo usuario podrá tener nivel de administración en un módulo y nivel de consulta en otro, conforme a la asignación institucional. La solución deberá permitir que el nivel de operación se configure de manera independiente para cada módulo asignado.'));
body.push(P('El sistema deberá aplicar el criterio de denegación por omisión: la ausencia de una autorización expresa deberá interpretarse como falta de privilegio. La ocultación de opciones en la interfaz no deberá considerarse un mecanismo de seguridad; toda restricción deberá aplicarse también en la capa de datos, de modo que un usuario no pueda acceder a información no autorizada por vías distintas a la interfaz.'));

/* ── 7. Procesos y reglas de negocio ── */
body.push(H1('7. Procesos y reglas de negocio'));

body.push(H2('7.1 Proceso general de captura y validación'));
[
    'El usuario autorizado deberá autenticarse e ingresar al módulo correspondiente conforme a los privilegios que tenga asignados.',
    'Deberá seleccionar el tipo de registro requerido y el sistema deberá presentar los campos aplicables a ese tipo.',
    'El sistema deberá validar los campos obligatorios, los formatos, los rangos admisibles y los valores restringidos a catálogo antes de aceptar el registro.',
    'El sistema deberá verificar que el registro no duplique otro existente conforme a la regla de unicidad definida para cada módulo.',
    'El registro deberá almacenarse con un identificador único y con los datos de auditoría de la operación.',
    'Cuando corresponda, deberán asociarse al registro las evidencias fotográficas o documentales requeridas.',
    'El registro deberá continuar con el flujo de revisión, validación o cierre establecido para el módulo.',
    'La información deberá quedar disponible para su consulta histórica y su explotación estadística.',
].forEach((t, i) => body.push(NUM(t, i + 1)));

body.push(H2('7.2 Proceso de entrega y conciliación de manifiestos'));
[
    'El prestador de servicios deberá capturar el manifiesto en el portal digital y adjuntar el documento digitalizado correspondiente.',
    'El sistema deberá validar la integridad y la congruencia aritmética de los datos declarados antes de permitir el envío.',
    'El manifiesto deberá quedar en estado pendiente y ser turnado a revisión del personal del aeropuerto.',
    'El personal revisor deberá aprobar o rechazar el manifiesto; el rechazo deberá indicar el motivo y devolver el registro al prestador para su corrección.',
    'Los manifiestos aprobados deberán integrarse al proceso de conciliación y contrastarse contra el itinerario registrado por el aeródromo.',
    'El personal de conciliación deberá resolver las diferencias detectadas, registrando cada corrección en el historial del vuelo.',
    'Concluida la conciliación del periodo, el perfil autorizado deberá emitir y aprobar el informe estadístico correspondiente.',
    'La cifra aprobada deberá quedar como cifra oficial del periodo y prevalecer sobre cualquier cálculo preliminar.',
].forEach((t, i) => body.push(NUM(t, i + 1)));

body.push(H2('7.3 Proceso de seguimiento de hallazgos y acuerdos'));
[
    'El usuario autorizado deberá registrar el hallazgo, el evento o el acuerdo, con su descripción, ubicación o ámbito, responsable y fecha límite de atención cuando aplique.',
    'El registro deberá quedar en estado pendiente y ser visible en el tablero de seguimiento del módulo correspondiente.',
    'El responsable deberá actualizar el avance de la atención y adjuntar la evidencia que la acredite.',
    'El perfil autorizado deberá cambiar el estado a atendido o cumplido, quedando registrada la fecha de atención y el usuario responsable del cambio.',
    'El sistema deberá calcular los días transcurridos entre el reporte y la atención, y contrastarlos contra la meta de atención definida.',
    'Los registros no atendidos dentro del plazo deberán señalarse en el tablero de seguimiento y, cuando aplique, generar un aviso al responsable.',
].forEach((t, i) => body.push(NUM(t, i + 1)));

body.push(H2('7.4 Reglas de negocio requeridas'));
body.push(T(['ID', 'Regla de negocio'],
    [
        ['RN-01', 'Los registros de captura mensual por periodo deberán ser únicos por año y mes en cada concepto. El sistema deberá impedir la creación de un segundo registro para el mismo periodo y permitir únicamente su corrección por perfiles autorizados.'],
        ['RN-02', 'Un movimiento de vuelo deberá ser único para la combinación de fecha, número de vuelo, aerolínea y tipo de movimiento; el sistema deberá impedir el duplicado y advertir la coincidencia.'],
        ['RN-03', 'La cifra oficial aprobada de un periodo deberá prevalecer sobre cualquier cálculo preliminar. Su modificación quedará reservada a los perfiles expresamente autorizados y se registrará en el historial del periodo.'],
        ['RN-04', 'Los manifiestos en estado aprobado no deberán poder ser modificados por el prestador; su reapertura deberá derivar exclusivamente de un rechazo emitido por el personal revisor.'],
        ['RN-05', 'Los usuarios de empresas prestadoras deberán acceder únicamente a los registros de la empresa que representan, por cualquier vía de consulta.'],
        ['RN-06', 'Los valores de clasificación y de estado deberán restringirse a los catálogos institucionales definidos, impidiendo la captura de valores ajenos a ellos.'],
        ['RN-07', 'La ausencia de dato deberá distinguirse del valor cero: la falta de captura no deberá interpretarse como una medición de valor nulo.'],
        ['RN-08', 'Un bien dado de baja o un vehículo con estado de baja no deberá poder asignarse a un nuevo resguardo ni a un nuevo responsable.'],
        ['RN-09', 'No deberán registrarse dos sesiones del mismo comité en la misma fecha; el sistema deberá advertir el conflicto.'],
        ['RN-10', 'Toda modificación de un registro validado deberá conservar el valor anterior, el valor nuevo, el usuario responsable y la fecha y hora de la operación.'],
        ['RN-11', 'La corrección de un dato de origen —como la aerolínea asignada a un vuelo— deberá conservar el valor original y no deberá sobrescribirlo de manera irreversible.'],
        ['RN-12', 'La información de carácter personal, clínico o laboral deberá ser accesible únicamente a los perfiles expresamente autorizados. Los perfiles de consulta general deberán acceder exclusivamente a cifras agregadas.'],
        ['RN-13', 'La carga masiva de un periodo deberá reemplazar de forma controlada los registros de ese mismo periodo, sin afectar otros, y dejar constancia de la carga.'],
        ['RN-14', 'Los procesos de consolidación deberán registrar fecha, hora y usuario que los ejecutó, para determinar la vigencia de la información presentada.'],
    ], [10, 90]));

/* ── 8. Información a administrar ── */
/* ── 8. Información a administrar ── */
body.push(H1('8. Información a administrar'));
body.push(P('La solución deberá administrar de manera centralizada los conjuntos de información que se indican. Todos ellos deberán conservarse históricamente, sin depuración automática, y ser consultables por periodo. Además de los campos propios de cada módulo, todo registro deberá conservar su identificador único y sus datos de auditoría.'));
body.push(T(['Módulo', 'Información que deberá administrarse'],
    [
        ['M-OPA', 'Cifras diarias, mensuales y anuales de operaciones, pasajeros y carga por tipo de aviación, movimiento y ámbito; marca de cifra oficial por periodo.'],
        ['M-ITI', 'Vuelos con aerolínea, aeronave, matrícula, ruta, horarios, posición, tipo de servicio y ámbito; partes de operaciones generados y sus documentos.'],
        ['M-CON', 'Cifras declaradas y registradas por vuelo, diferencias, correcciones y su valor original; historial de conciliación; informes estadísticos y sus aprobaciones.'],
        ['M-POR', 'Manifiestos de pasajeros y carga con totales declarados, documento digitalizado, empresa, estado de revisión y motivo de rechazo.'],
        ['M-FRE', 'Catálogo de rutas y destinos; frecuencias semanales por aerolínea y segmento; calendario de nuevas rutas; histórico de semanas.'],
        ['M-PUN', 'Demoras con horarios programados y reales, código y motivo, imputabilidad, pasajeros afectados y posición.'],
        ['M-ABO', 'Órdenes de servicio con secuencia de tiempos, personal responsable, firmas de conformidad y boleta generada.'],
        ['M-BHS', 'Equipaje mensual por aerolínea y tipo de operación; capacidad instalada; utilización; equipajes sin vuelo asociado.'],
        ['M-FAU', 'Impactos con fauna y capturas, con especie, ubicación, cuadrante, medidas adoptadas, resultados y evidencias fotográficas.'],
        ['M-SEI', 'Emergencias en pista con clasificación y evidencias; derrames con tiempos de respuesta, superficie afectada, costos y cobros.'],
        ['M-PCP', 'Personal capacitado por empresa prestadora, categoría de licencia, área autorizada y vigencia.'],
        ['M-VAL', 'Jornadas de valoración con empresa evaluada, cantidad de personas, tipos de valoración y observaciones.'],
        ['M-VEH', 'Vehículos con características técnicas, aseguramiento y vigencia, responsable, estado, fotografía e historial de mantenimientos.'],
        ['M-MED', 'Atenciones por tipo de población, historial y documentos clínicos de acceso restringido; directorio de servicios médicos.'],
        ['M-FBO / M-CAR / M-COM', 'Operaciones de aviación general; capacidad instalada y padrones de la terminal de carga; volumen mensual de combustible suministrado.'],
        ['M-HID / M-HVA / M-CIV / M-ENE', 'Agua suministrada, tratada y su destino; residuos mensuales por tipo; reportes de climatización; hallazgos de vidrios y filtraciones con estado y tiempos; consumos de energía y gas; mantenimientos y metas anuales.'],
        ['M-COL', 'Colaboradores con adscripción y estatus; fotografía y expediente; cursos, vigencias y constancias; vacaciones; historial de cambios.'],
        ['M-RES', 'Bienes con folio y fecha de resguardo, responsable, documentos versionados, verificación física e historial de cargas.'],
        ['M-AGE', 'Comités; sesiones con fecha, lugar, modalidad y estado; temas y acuerdos con responsable, fecha límite, estado y evidencia; asistencia.'],
        ['M-ADM', 'Cuentas, perfiles, habilitación de acceso, módulos visibles, nivel de operación por módulo y bitácora de administración.'],
        ['M-DAT / M-BIB / M-NOT', 'Catálogos compartidos; registro de cargas masivas; documentos publicados y sus versiones; emisiones y validaciones de documentos marcados; avisos y suscripciones.'],
    ], [22, 78]));

/* ── 9. Reportes ── */
body.push(H1('9. Reportes, consultas e indicadores'));
body.push(P('La totalidad de las consultas y tableros generados deberán poder exportarse a hoja de cálculo y a documento imprimible, conservando los filtros aplicados y señalando el periodo y la fecha de generación.'));
body.push(T(['Módulo', 'Reporte o consulta requerida', 'Información presentada', 'Filtros requeridos'],
    [
        ['M-OPA', 'Comparativo histórico', 'Operaciones, pasajeros y carga por tipo de aviación con variación interanual', 'Año, mes, aviación, ámbito, movimiento'],
        ['M-OPA', 'Concentrado anual oficial', 'Cifras mensuales ratificadas y acumulado anual', 'Año, tipo de aviación'],
        ['M-ITI', 'Itinerario y tablero operativo', 'Vuelos de llegada y salida con horarios y posición', 'Fecha, aerolínea, movimiento, ámbito, servicio'],
        ['M-ITI', 'Parte de operaciones', 'Resumen del día con operaciones, pasajeros y carga', 'Fecha o rango, selección de vuelos'],
        ['M-CON', 'Tabla de conciliación', 'Cifras declaradas, registradas y diferencias por vuelo', 'Periodo, aerolínea, estado'],
        ['M-CON', 'Informe estadístico', 'Desglose mensual, participación por aerolínea y factor de ocupación', 'Año, mes, tipo de aviación'],
        ['M-POR', 'Bandeja de manifiestos', 'Folio, empresa, vuelo, totales y estado', 'Fecha, empresa, tipo, estado'],
        ['M-FRE', 'Cuadro semanal de frecuencias', 'Rutas por aerolínea con frecuencia diaria y total semanal', 'Semana, segmento, aerolínea, destino'],
        ['M-FRE', 'Mapa de destinos', 'Representación cartográfica de la red de rutas', 'Segmento, aerolínea'],
        ['M-PUN', 'Indicadores de puntualidad', 'Puntualidad general, por aerolínea e imputabilidad', 'Año, mes, aerolínea, movimiento'],
        ['M-PUN', 'Distribución de demoras', 'Eventos y minutos por código y motivo', 'Periodo, código, aerolínea'],
        ['M-ABO', 'Servicios prestados y tiempos', 'Órdenes con tiempo total de atención', 'Fecha, posición, aerolínea, operación'],
        ['M-BHS', 'Utilización del sistema de equipaje', 'Equipaje procesado y porcentaje de utilización', 'Año, mes, operación, aerolínea'],
        ['M-FAU', 'Estadística de incidencia', 'Impactos y capturas por especie, zona y fase', 'Periodo, especie, zona, aerolínea'],
        ['M-FAU', 'Mapa de calor de incidencia', 'Concentración de eventos por cuadrante', 'Periodo, tipo de evento, especie'],
        ['M-SEI', 'Bitácora de emergencias y derrames', 'Clasificación, tiempos de respuesta y costos', 'Periodo, pista, operador, empresa'],
        ['M-PCP', 'Padrón de personal capacitado', 'Personal por empresa y categoría de licencia', 'Empresa, categoría, periodo, vigencia'],
        ['M-VAL', 'Concentrado de valoraciones', 'Personas valoradas por empresa y tipo', 'Periodo, empresa, tipo'],
        ['M-VEH', 'Inventario vehicular y vencimientos', 'Unidades con estado, responsable y vigencia de póliza', 'Tipo, estado, área, vigencia'],
        ['M-MED', 'Concentrado de atenciones médicas', 'Atenciones por tipo de población y total', 'Año, mes, tipo de población'],
        ['M-CAR / M-COM', 'Capacidad de carga y combustible', 'Padrones de operadores y volumen mensual suministrado', 'Año, mes'],
        ['M-HID / M-ENE', 'Consumos y aprovechamiento', 'Agua, residuos, energía y gas por periodo', 'Año, mes, concepto'],
        ['M-HVA / M-CIV', 'Seguimiento de reportes y hallazgos', 'Estado, días de atención y reincidencia', 'Periodo, módulo, nivel, estado'],
        ['M-ENE', 'Cumplimiento de mantenimientos', 'Preventivos programados contra realizados y meta anual', 'Año, mes'],
        ['M-COL', 'Padrón y vigencia de capacitación', 'Colaboradores con cursos vigentes y por vencer', 'Área, estatus, curso, vigencia'],
        ['M-RES', 'Inventario de bienes y resguardos', 'Bienes por área y responsable con folio y verificación', 'Familia, área, responsable, folio'],
        ['M-AGE', 'Seguimiento de acuerdos', 'Acuerdos con responsable, fecha límite y estado', 'Comité, área, responsable, estado'],
        ['M-ADM', 'Padrón de usuarios y privilegios', 'Perfil, módulos visibles y nivel por módulo', 'Área, perfil, estado de la cuenta'],
    ], [13, 25, 34, 28]));

body.push(H1('10. Evidencias y trazabilidad'));
body.push(H2('10.1 Evidencias y documentos'));
body.push(P('La solución deberá contar con un repositorio de archivos que permita adjuntar evidencias a los registros y conservarlas de manera permanente y vinculada al registro que las origina. Deberá ser posible consultar la evidencia desde el registro y determinar quién la incorporó y cuándo.'));
body.push(T(['Módulo', 'Tipo de evidencia requerida'],
    [
        ['M-FAU', 'Fotografías del evento, del ejemplar y de la zona de impacto.'],
        ['M-SEI', 'Fotografías de la emergencia en pista y de la superficie afectada por el derrame.'],
        ['M-POR', 'Manifiesto de vuelo digitalizado entregado por el prestador.'],
        ['M-ITI', 'Parte de operaciones generado, en documento imprimible resguardado.'],
        ['M-ABO', 'Boleta de servicio con firmas digitales de conformidad.'],
        ['M-VEH', 'Fotografía de la unidad y documentación de la póliza de aseguramiento.'],
        ['M-RES', 'Documentos de resguardo digitalizados, con control de versiones.'],
        ['M-COL', 'Fotografía del colaborador, documentos del expediente y constancias de capacitación.'],
        ['M-MED', 'Documentos clínicos con acceso restringido al perfil de servicio médico.'],
        ['M-AGE', 'Convocatorias, minutas y evidencias de cumplimiento de acuerdos.'],
        ['M-BIB', 'Documentos institucionales publicados y documentos con marca de agua verificable emitidos a terceros.'],
    ], [16, 84]));
body.push(SPACER());
body.push(PR('El sistema deberá **validar el tipo y el tamaño** de los archivos admitidos, deberá **impedir el acceso a las evidencias por parte de usuarios no autorizados** para el módulo correspondiente, y deberá **conservarlas históricamente** aun cuando el registro asociado cambie de estado.'));

body.push(H2('10.2 Trazabilidad'));
body.push(P('El sistema deberá conservar la información suficiente para garantizar la trazabilidad de las operaciones realizadas sobre cada registro. Como mínimo, deberá registrarse:'));
[
    'El usuario que creó el registro y la fecha y hora de su creación.',
    'El usuario que realizó la última modificación y la fecha y hora correspondiente.',
    'El usuario que validó, aprobó, rechazó o cerró el registro, y el momento de la operación.',
    'Cada cambio de estado del registro, con el estado anterior y el estado resultante.',
    'En los módulos que lo requieran, el valor anterior y el valor nuevo de los campos modificados, conformando un historial consultable del registro.',
    'El usuario que ejecutó cada proceso de consolidación, carga masiva o refresco de información, y el momento de su ejecución.',
    'Las operaciones administrativas realizadas sobre las cuentas de usuario, sus perfiles y sus privilegios.',
].forEach(t => body.push(LI(t)));
body.push(P('La información de trazabilidad no deberá poder ser modificada ni eliminada por ningún perfil de usuario, y deberá ser consultable por los perfiles administradores y por las áreas de control interno para efectos de revisión y auditoría.'));

/* ── 11. Integraciones ── */
body.push(H1('11. Integraciones requeridas'));
body.push(P('La solución deberá evitar la duplicidad de captura mediante el intercambio de información entre sus propios módulos y, cuando corresponda, con servicios institucionales externos. Las integraciones se clasifican conforme a su exigibilidad:'));
body.push(T(['Integración requerida', 'Descripción', 'Carácter'],
    [
        ['Itinerario → Parte de operaciones', 'El parte de operaciones deberá construirse a partir de los vuelos registrados en el itinerario, sin recaptura de la información del vuelo.', 'Obligatoria'],
        ['Portal de manifiestos → Conciliación', 'Los manifiestos aprobados deberán quedar disponibles para el proceso de conciliación sin captura adicional.', 'Obligatoria'],
        ['Conciliación → Informe estadístico', 'El informe estadístico deberá construirse a partir de la información conciliada y de las cifras mensuales ratificadas, aplicando la regla de precedencia establecida.', 'Obligatoria'],
        ['Itinerario → Frecuencias y destinos', 'El cálculo de frecuencias semanales deberá derivarse de los vuelos registrados, sin captura manual de la frecuencia.', 'Obligatoria'],
        ['Catálogos institucionales → Todos los módulos', 'Los catálogos de aerolíneas, aeropuertos, rutas, áreas y tipos de servicio deberán ser únicos y compartidos por la totalidad de los módulos.', 'Obligatoria'],
        ['Administración de usuarios → Todos los módulos', 'La definición de perfiles, módulos visibles y niveles de operación deberá ser única y aplicarse de manera uniforme en todos los módulos.', 'Obligatoria'],
        ['Colaboradores → Agenda y resguardos', 'El padrón de colaboradores deberá servir como fuente para la asignación de responsables de acuerdos y de resguardos de bienes.', 'Deseable'],
        ['Notificaciones → Correo institucional', 'Los avisos de sesiones, vencimientos y acuerdos deberán poder remitirse por correo electrónico institucional.', 'Deseable'],
        ['Notificaciones → Mensajería y avisos móviles', 'Los avisos deberán poder remitirse a dispositivos móviles institucionales mediante los mecanismos de notificación disponibles.', 'Deseable'],
        ['Sistema → Servicios de información aeronáutica', 'La incorporación automática de información de vuelos proveniente de los servicios de control de tránsito aéreo o de las aerolíneas deberá evaluarse en función de la disponibilidad y las condiciones de acceso a dichos servicios.', 'Requiere análisis'],
        ['Sistema → Pantallas de información al público', 'La publicación de la información de vuelos en pantallas del edificio terminal deberá evaluarse conforme a la infraestructura de señalización disponible.', 'Requiere análisis'],
        ['Sistema → GRP institucional', 'El intercambio de información con los módulos administrativos, patrimoniales y de recursos humanos del GRP deberá definirse durante la fase de diseño, particularmente en materia de inventario de bienes y padrón de personal.', 'Requiere análisis'],
    ], [26, 58, 16]));

/* ── 12. Requerimientos técnicos ── */
body.push(H1('12. Requerimientos técnicos generales'));
body.push(P('Los siguientes requerimientos expresan necesidades técnicas de la solución. No condicionan la elección de una tecnología o proveedor determinado, salvo en aquello que resulte indispensable para satisfacer la necesidad descrita.'));
body.push(T(['ID', 'Requerimiento técnico'],
    [
        ['RT-01', 'La solución deberá operar mediante navegador web estándar, sin instalación de componentes adicionales, y presentarse adecuadamente en equipos de escritorio y dispositivos móviles institucionales.'],
        ['RT-02', 'La solución deberá utilizar un mecanismo de autenticación que permita identificar individualmente a cada usuario, con credenciales personales e intransferibles.'],
        ['RT-03', 'El sistema deberá administrar las sesiones y cerrarlas automáticamente tras un periodo de inactividad definido institucionalmente.'],
        ['RT-04', 'El sistema deberá exigir el cambio de contraseña en el primer ingreso y cuando el administrador lo determine, y deberá aplicar reglas mínimas de complejidad.'],
        ['RT-05', 'La información deberá almacenarse en una base de datos centralizada, con integridad referencial y restricciones que impidan el registro de información inconsistente.'],
        ['RT-06', 'El control de acceso deberá aplicarse en la capa de datos y no sólo en la interfaz, de modo que ningún usuario obtenga información no autorizada por vías alternas.'],
        ['RT-07', 'Los archivos y evidencias deberán almacenarse de manera relacionada con el registro al que correspondan, con control de acceso equivalente al del registro asociado.'],
        ['RT-08', 'El sistema deberá registrar la trazabilidad de las operaciones de escritura conforme a lo señalado en el capítulo 10, en un registro no modificable por los usuarios.'],
        ['RT-09', 'La solución deberá soportar el acceso concurrente sin degradación perceptible y resolver de manera controlada la edición simultánea de un mismo registro.'],
        ['RT-10', 'El sistema deberá contar con respaldos periódicos de la base de datos y del repositorio de archivos, con procedimiento de restauración verificable.'],
        ['RT-11', 'La solución deberá estar disponible durante el horario de operación del aeródromo, con ventanas de mantenimiento programadas y comunicadas previamente.'],
        ['RT-12', 'El sistema deberá permitir la exportación de la información a formatos de uso institucional —hoja de cálculo y documento imprimible— conservando los filtros aplicados.'],
        ['RT-13', 'La solución deberá permitir la carga masiva de información a partir de archivos de hoja de cálculo, con validación previa e informe de los registros aceptados y rechazados.'],
        ['RT-14', 'La información deberá conservarse de manera histórica, sin depuración automática, permitiendo la consulta de periodos anteriores.'],
        ['RT-15', 'El sistema deberá presentar la información mediante tableros, tablas consultables y gráficas, con representaciones cartográficas en los módulos que administren información geográfica.'],
        ['RT-16', 'La información de carácter personal deberá tratarse conforme a la normatividad aplicable, restringiendo su acceso a los perfiles autorizados y evitando su exposición en consultas generales.'],
        ['RT-17', 'El sistema deberá emitir avisos a los usuarios responsables ante vencimientos, sesiones próximas y compromisos por cumplir, a través de los medios institucionales disponibles.'],
        ['RT-18', 'Deberá permitirse la incorporación de nuevos módulos sin afectar los existentes, conservando el mismo esquema de identidad, perfiles, catálogos y trazabilidad.'],
        ['RT-19', 'El sistema deberá disponer de un ambiente de pruebas independiente del ambiente productivo, para la validación de cambios previa a su liberación.'],
        ['RT-20', 'La solución deberá entregarse con documentación técnica, manual de usuario por módulo y transferencia de conocimiento al personal designado por el área.'],
    ], [10, 90]));

/* ── 13. Matriz consolidada ── */
body.push(H1('13. Matriz consolidada de requerimientos'));
body.push(P('La siguiente matriz consolida los requerimientos funcionales de la solución. Cada requerimiento agrupa un conjunto de funciones relacionadas y se corresponde con lo descrito en el capítulo 5.'));
const RF = [
    ['RF-GEN-001', 'Transversal', 'Operar como solución web modular de acceso autenticado que concentre el registro, la consulta y la explotación de la información del área.'],
    ['RF-GEN-002', 'Transversal', 'Manejar perfiles con privilegios predefinidos por configuración institucional, asignables de forma independiente para cada módulo.'],
    ['RF-GEN-003', 'Transversal', 'Conservar la trazabilidad de creación, modificación, validación y cambio de estado de cada registro, en bitácora no modificable.'],
    ['RF-GEN-004', 'Transversal', 'Permitir adjuntar evidencias fotográficas y documentales a los registros, con acceso controlado y conservación histórica.'],
    ['RF-GEN-005', 'Transversal', 'Permitir la consulta histórica con filtros configurables y la exportación de resultados a hoja de cálculo y documento imprimible.'],
    ['RF-OPA-001', 'M-OPA', 'Registrar y consultar cifras diarias, mensuales y anuales de operaciones, pasajeros y carga por tipo de aviación, movimiento y ámbito.'],
    ['RF-OPA-002', 'M-OPA', 'Permitir la ratificación de la cifra mensual oficial y generar comparativos interanuales con variación absoluta y porcentual.'],
    ['RF-ITI-001', 'M-ITI', 'Permitir el registro individual y la carga masiva del itinerario diario, impidiendo el registro duplicado de un mismo movimiento.'],
    ['RF-ITI-002', 'M-ITI', 'Generar el parte de operaciones del día o periodo seleccionado, resguardarlo en formato imprimible y presentar el tablero de llegadas y salidas.'],
    ['RF-CON-001', 'M-CON', 'Contrastar la información declarada en los manifiestos contra el itinerario y señalar las diferencias detectadas.'],
    ['RF-CON-002', 'M-CON', 'Permitir la corrección de diferencias conservando el historial de cada modificación con su valor anterior y su responsable.'],
    ['RF-CON-003', 'M-CON', 'Generar el informe estadístico del periodo y registrar su refresco y su aprobación por el perfil autorizado.'],
    ['RF-POR-001', 'M-POR', 'Permitir a los prestadores capturar y adjuntar sus manifiestos, con validación de campos obligatorios y congruencia de totales.'],
    ['RF-POR-002', 'M-POR', 'Administrar el flujo de revisión en los estados pendiente, en revisión, aprobado y rechazado, restringiendo la edición conforme al estado.'],
    ['RF-POR-003', 'M-POR', 'Restringir el acceso de cada usuario externo a los registros de la empresa que representa.'],
    ['RF-FRE-001', 'M-FRE', 'Administrar el catálogo de rutas y calcular las frecuencias semanales por aerolínea en los segmentos nacional, internacional y de carga.'],
    ['RF-FRE-002', 'M-FRE', 'Presentar la red de destinos sobre representación cartográfica y administrar el calendario de arranque de nuevas rutas.'],
    ['RF-PUN-001', 'M-PUN', 'Registrar y clasificar las demoras conforme al catálogo de códigos y motivos, distinguiendo su imputabilidad.'],
    ['RF-PUN-002', 'M-PUN', 'Calcular los indicadores de puntualidad por periodo, aerolínea, movimiento y posición.'],
    ['RF-ABO-001', 'M-ABO', 'Registrar las órdenes de servicio de aeropasillos y aerocares con su secuencia de tiempos y calcular el tiempo total de atención.'],
    ['RF-ABO-002', 'M-ABO', 'Permitir la captura de firmas digitales de conformidad y la generación de la boleta de servicio.'],
    ['RF-BHS-001', 'M-BHS', 'Registrar el equipaje procesado por aerolínea y tipo de operación y calcular el porcentaje de utilización de la capacidad instalada.'],
    ['RF-FAU-001', 'M-FAU', 'Registrar impactos con fauna y capturas, con especie, ubicación, medidas adoptadas, resultados y evidencias fotográficas.'],
    ['RF-FAU-002', 'M-FAU', 'Generar estadísticas de incidencia y representaciones cartográficas, incluyendo mapas de calor por cuadrante.'],
    ['RF-SEI-001', 'M-SEI', 'Registrar las emergencias en pista con su clasificación institucional y sus evidencias fotográficas.'],
    ['RF-SEI-002', 'M-SEI', 'Registrar las atenciones a derrames, calcular el tiempo de respuesta y controlar el costo operativo y el cobro a la empresa responsable.'],
    ['RF-PCP-001', 'M-PCP', 'Administrar el padrón de personal capacitado de prestadores por empresa, categoría de licencia y vigencia.'],
    ['RF-VAL-001', 'M-VAL', 'Registrar las jornadas de valoración médica por empresa, con tipos de valoración practicada y cantidad de personas valoradas.'],
    ['RF-VEH-001', 'M-VEH', 'Administrar el parque vehicular con características, aseguramiento, responsable, estado, fotografía e historial de mantenimientos.'],
    ['RF-VEH-002', 'M-VEH', 'Emitir avisos ante la proximidad del vencimiento de las pólizas de aseguramiento e impedir asignar unidades dadas de baja.'],
    ['RF-MED-001', 'M-MED', 'Registrar las atenciones médicas por tipo de población, generar concentrados y restringir el acceso a la información clínica individual.'],
    ['RF-SCO-001', 'M-FBO / M-CAR / M-COM', 'Registrar la operación de aviación general, los padrones y la capacidad de la terminal de carga, y el volumen mensual de combustible suministrado.'],
    ['RF-INF-001', 'M-HID', 'Registrar el suministro y tratamiento diario de agua, su destino, y el manejo mensual de residuos por tipo.'],
    ['RF-INF-002', 'M-HVA', 'Registrar y dar seguimiento a los reportes de climatización, con equipo, área solicitante, estado y responsable.'],
    ['RF-INF-003', 'M-CIV', 'Registrar los hallazgos de vidrios y filtraciones, controlar su estado, calcular los días de atención y señalar la reincidencia.'],
    ['RF-INF-004', 'M-ENE', 'Registrar los consumos de energía eléctrica, térmica y gas, y el cumplimiento de los programas de mantenimiento contra la meta anual.'],
    ['RF-COL-001', 'M-COL', 'Administrar el padrón de colaboradores, su expediente documental y su historial de cambios, con acceso restringido.'],
    ['RF-COL-002', 'M-COL', 'Registrar los cursos impartidos, calcular su vigencia y emitir avisos anticipados de vencimiento.'],
    ['RF-RES-001', 'M-RES', 'Administrar el inventario de bienes y sus resguardos, con carga masiva trazable, control de duplicados y verificación física.'],
    ['RF-RES-002', 'M-RES', 'Resguardar los documentos de resguardo digitalizados con control de versiones e identificación de la versión vigente.'],
    ['RF-AGE-001', 'M-AGE', 'Administrar el catálogo de comités y la programación de sus sesiones, impidiendo la duplicidad de sesiones en una misma fecha.'],
    ['RF-AGE-002', 'M-AGE', 'Registrar temas y acuerdos con responsable, fecha límite, estado y evidencia, y generar indicadores de cumplimiento.'],
    ['RF-AGE-003', 'M-AGE', 'Notificar a los participantes las sesiones próximas y los acuerdos con fecha límite por vencer.'],
    ['RF-ADM-001', 'M-ADM', 'Permitir crear, actualizar y desactivar cuentas, asignar perfil y habilitar el acceso a la solución.'],
    ['RF-ADM-002', 'M-ADM', 'Permitir definir por usuario los módulos visibles y el nivel de operación en cada uno, e impedir que modifique sus propios privilegios.'],
    ['RF-ADM-003', 'M-ADM', 'Permitir el restablecimiento de contraseña y forzar su cambio en el primer ingreso.'],
    ['RF-DAT-001', 'M-DAT', 'Administrar catálogos institucionales compartidos y permitir la carga masiva validada, con informe de registros aceptados y rechazados.'],
    ['RF-BIB-001', 'M-BIB', 'Permitir la publicación y consulta controlada de documentos institucionales por categoría y perfil autorizado.'],
    ['RF-BIB-002', 'M-BIB', 'Permitir aplicar marca de agua verificable a los documentos entregados a terceros y validar posteriormente su autenticidad.'],
    ['RF-NOT-001', 'M-NOT', 'Emitir avisos ante vencimientos y compromisos por cumplir, y permitir a los usuarios administrar sus suscripciones.'],
];
body.push(T(['ID', 'Módulo', 'Requerimiento funcional'], RF, [12, 14, 74]));

/* ── 14. Conclusiones ── */
body.push(H1('14. Conclusiones'));
body.push(P('La Dirección de Operación requiere una solución informática institucional que concentre, en un mismo entorno de trabajo, los procesos de registro, validación, resguardo documental y explotación estadística de la información que generan sus gerencias. La dispersión actual de la información en formatos independientes limita la oportunidad de la consulta, dificulta la conciliación de cifras y no permite acreditar de manera suficiente la trazabilidad de las operaciones realizadas.'));
body.push(P('Los requerimientos descritos delimitan el alcance funcional de la solución en veintiocho módulos agrupados conforme a la estructura orgánica del área, con un esquema común de perfiles y privilegios, un repositorio centralizado de información y evidencias, y un conjunto de reportes e indicadores orientados a la toma de decisiones y al cumplimiento de las obligaciones de información del aeródromo.'));
body.push(P('Se considera indispensable preservar tres condiciones: que el control de acceso opere en la capa de datos y no únicamente en la interfaz; que toda operación de escritura quede documentada de manera no modificable; y que los catálogos institucionales sean únicos y compartidos por todos los módulos, a fin de evitar la duplicidad de captura y la divergencia de cifras entre áreas.'));
body.push(P('Los módulos podrán habilitarse por etapas conforme a la prioridad que determine el área, siempre que desde la primera se conserve el esquema común de identidad, perfiles, catálogos y trazabilidad aquí descrito. Se recomienda iniciar por los módulos de operación aeronáutica, conciliación de manifiestos y administración de usuarios, por constituir la base de la que dependen los indicadores institucionales del aeródromo.'));
body.push(P('El presente documento constituye el insumo del área usuaria para la elaboración del Anexo Técnico correspondiente. Los criterios de aceptación, los niveles de servicio, los plazos de implementación y las condiciones contractuales deberán definirse por el área de Tecnologías de la Información y Comunicaciones conforme a la normatividad aplicable.'));

/* ─────────────────────────── Documento ─────────────────────────── */
const doc = new Document({
    creator: 'Dirección de Operación · AIFA',
    title: 'Requerimientos Funcionales y Técnicos del Sistema de la Dirección de Operación',
    description: 'Insumo para el Anexo Técnico del Sistema de Gestión de Recursos Gubernamentales (GRP)',
    styles: {
        default: {
            document: { run: { font: FONT, size: BODY } },
            heading1: { run: { font: FONT, size: 26, bold: true, color: AZUL } },
            heading2: { run: { font: FONT, size: 22, bold: true, color: AZUL2 } },
            heading3: { run: { font: FONT, size: 20, bold: true, color: AZUL2 } },
        }
    },
    sections: [{
        properties: {
            page: {
                margin: {
                    top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.7),
                    left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8)
                }
            }
        },
        headers: {
            default: new Header({ children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 60 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFC7D5', space: 4 } },
                children: [new TextRun({ text: 'AIFA · Dirección de Operación — Requerimientos funcionales y técnicos', font: FONT, size: 16, color: '7F7F7F' })]
            })] })
        },
        footers: {
            default: new Footer({ children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({ text: 'Página ', font: FONT, size: 16, color: '7F7F7F' }),
                    new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '7F7F7F' }),
                    new TextRun({ text: ' de ', font: FONT, size: 16, color: '7F7F7F' }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '7F7F7F' }),
                ]
            })] })
        },
        children: body
    }]
});

const OUT = path.join(__dirname, '..', 'REQUERIMIENTOS_FUNCIONALES_Y_TECNICOS_DIRECCION_DE_OPERACION.docx');
Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(OUT, buf);
    console.log('Documento generado:', OUT, '(' + (buf.length / 1024).toFixed(1) + ' KB)');
});
