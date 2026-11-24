(function () {
  'use strict';
  /** catalogs.js — Catálogos del dominio (fuente única para filtros, formularios y datos). */

  const TIPOS_INCIDENCIA = [
    'Equipaje dañado',
    'Retraso en entrega',
    'Atoramiento de equipaje',
    'Pérdida de BSM',
    'Equipaje fuera de tiempo',
    'Equipaje en otro carrusel',
    'Sin identificador',
    'Otros',
  ];

  const AEROLINEAS = [
    { code: 'AMX', name: 'Aeroméxico' },
    { code: 'VIV', name: 'Viva Aerobus' },
    { code: 'VOI', name: 'Volaris' },
    { code: 'DWI', name: 'Arajet' },
    { code: 'CMP', name: 'Copa Airlines' },
    { code: 'VCV', name: 'Conviasa' },
  ];
  const aerolineaName = (code) => AEROLINEAS.find((a) => a.code === code)?.name ?? code;

  const NIVELES = [
    { code: 'PB', name: 'Planta baja' },
    { code: 'N1', name: 'Nivel 1' },
    { code: 'N2', name: 'Nivel 2' },
    { code: 'N3', name: 'Nivel 3' },
  ];

  const ESTADOS = [
    { code: 'Pendiente',  badge: 'warn', icon: 'bi-hourglass-split' },
    { code: 'En proceso', badge: 'info', icon: 'bi-arrow-repeat' },
    { code: 'Solucionada', badge: 'ok',  icon: 'bi-check-circle-fill' },
  ];

  /** Severidad: estado reservado (good → critical) + SLA de resolución en horas. */
  const SEVERIDADES = [
    { code: 'Baja',    badge: 'ok',      sw: 'sw-ok',      icon: 'bi-arrow-down-circle-fill',   slaHoras: 24 },
    { code: 'Media',   badge: 'warn',    sw: 'sw-warn',    icon: 'bi-dash-circle-fill',         slaHoras: 8 },
    { code: 'Alta',    badge: 'serious', sw: 'sw-serious', icon: 'bi-arrow-up-circle-fill',     slaHoras: 4 },
    { code: 'Crítica', badge: 'crit',    sw: 'sw-crit',    icon: 'bi-exclamation-octagon-fill', slaHoras: 2 },
  ];
  const slaDe = (sev) => SEVERIDADES.find((s) => s.code === sev)?.slaHoras ?? 24;

  const PERIODOS = [
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: '90', label: 'Últimos 90 días' },
    { value: 'custom', label: 'Personalizado' },
  ];

  const DOC_CATEGORIAS = [
    { id: 'formatos', label: 'Formatos y Reportes', icon: 'bi-file-earmark-text' },
    { id: 'instructivos', label: 'Instructivos', icon: 'bi-journal-text' },
    { id: 'procedimientos', label: 'Procedimientos', icon: 'bi-diagram-3' },
    { id: 'capacitacion', label: 'Material de Capacitación', icon: 'bi-mortarboard' },
  ];

  const DOC_TIPOS = {
    Formato: 'warn',
    Guía: 'info',
    Procedimiento: 'brand',
    Manual: 'accent',
    'Ficha técnica': 'neutral',
    Instructivo: 'info',
    Presentación: 'accent',
    Video: 'serious',
    Curso: 'brand',
  };

  const AREAS = [
    'Gerencia de Calidad',
    'Operaciones BHS',
    'Atención a Pasajeros',
    'Centro de Control Operativo',
    'Mantenimiento de Sistemas',
    'Enlace con Aerolíneas',
  ];

  /** Encuestas: de dónde llegó la respuesta del pasajero y qué área evaluó la aerolínea. */
  const CANALES_ENCUESTA = ['Formato impreso', 'QR en sala', 'Kiosco', 'Portal web'];
  const AREAS_EVALUADAS = ['Entrega de equipaje', 'Operación BHS', 'Atención de incidencias', 'Comunicación operativa'];

  const NOTIF_KEYS = [
    { id: 'criticas', title: 'Incidencias críticas y altas', desc: 'Incidencias abiertas de severidad alta o crítica.', def: true },
    { id: 'nuevas', title: 'Nuevas incidencias', desc: 'Incidencias registradas en las últimas 24 horas.', def: true },
    { id: 'sla', title: 'SLA por vencer', desc: 'Incidencias a menos de 30 minutos de exceder su tiempo objetivo.', def: true },
    { id: 'encuestas', title: 'Encuestas negativas', desc: 'Respuestas con calificación de 1 o 2 estrellas.', def: false },
    { id: 'documentos', title: 'Documentos actualizados', desc: 'Publicación de nuevas versiones de documentos controlados.', def: false },
  ];

  SIGEC.define('data/catalogs', { NOTIF_KEYS, TIPOS_INCIDENCIA, AEROLINEAS, aerolineaName, NIVELES, ESTADOS, SEVERIDADES, slaDe, PERIODOS, DOC_CATEGORIAS, DOC_TIPOS, AREAS, CANALES_ENCUESTA, AREAS_EVALUADAS });
})();
