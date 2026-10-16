"""
Generador SQL: historial de vacaciones de la Agenda (hoja de vacaciones)
------------------------------------------------------------------------
Lee el CSV exportado de la hoja de vacaciones de la Agenda 2026 y produce:

  00_estructura.sql      Tabla public.colab_vacaciones_agenda (registro fiel,
                         una fila por renglón de la hoja) + RLS solo colab_editor.
  01..NN_datos.sql       INSERT ... ON CONFLICT (fila) DO UPDATE, en partes
                         pequeñas para el SQL Editor de Supabase.
  99_sincroniza.sql      Reconstruye agenda_2026.vacaciones (JSONB que usa el
                         módulo Colaboradores) a partir del registro, sin tocar
                         los períodos capturados a mano en la app.
  auditoria.csv          Renglones con correcciones o pendientes de revisión.

Los archivos de salida contienen datos personales: se escriben en privado/,
que está fuera de git. Este script no contiene datos.

Uso:
  python scripts/gen_vacaciones_agenda_sql.py "Agenda 2026(1).csv" [--out privado/vacaciones_agenda]
"""

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import unicodedata

# ── Lectura ──────────────────────────────────────────────────────────────

def leer_csv(path, encoding):
    raw = open(path, 'rb').read()
    texto = raw.decode(encoding)
    texto = texto.replace('\r\n', '\n').replace('\r', '\n')
    return list(csv.reader(io.StringIO(texto)))


COLS = [
    'num_empleado', 'nombre', 'puesto', 'turno', 'mil_activo', 'fecha_ingreso',
    'antiguedad', 'tipo_solicitud', 'fecha_solicitud', 'no_memorandum',
    'fecha_recepcion', 'dias', 'periodo', 'no_oficio', 'fecha_oficio', 'acuse',
    'nota', 'dias_disponibles', 'area',
]
AREAS = {'SSO', 'SI', 'GPyC', 'SGE', 'SSA', 'SSC', 'CA', 'GTS', 'DO', 'Archivo', 'CCSA'}

# ── Utilidades de texto y fechas ─────────────────────────────────────────

def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower().replace('\n', ' ')


MESES = {
    'ene': 1, 'enero': 1, 'feb': 2, 'febrero': 2, 'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4, 'may': 5, 'mayo': 5, 'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7, 'ago': 8, 'agosto': 8, 'sep': 9, 'sept': 9,
    'septiembre': 9, 'sptiembre': 9, 'septiemre': 9, 'setiembre': 9,
    'oct': 10, 'octubre': 10, 'nov': 11, 'noviembre': 11, 'dic': 12,
    'diciembre': 12,
}


def nth_weekday(y, m, weekday, n):
    d = dt.date(y, m, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def festivos(y):
    """Descanso obligatorio (LFT art. 74) que la Agenda no cuenta como día de vacaciones."""
    f = {
        dt.date(y, 1, 1), nth_weekday(y, 2, 0, 1), nth_weekday(y, 3, 0, 3),
        dt.date(y, 5, 1), dt.date(y, 9, 16), nth_weekday(y, 11, 0, 3),
        dt.date(y, 12, 25),
    }
    if y == 2024:
        f.add(dt.date(2024, 10, 1))  # Transmisión del Poder Ejecutivo Federal
    return f


def rango(ini, fin):
    d = ini
    while d <= fin:
        yield d
        d += dt.timedelta(days=1)


REGLAS = [
    ('L-V sin festivos', lambda d: d.weekday() < 5 and d not in festivos(d.year)),
    ('L-V', lambda d: d.weekday() < 5),
    ('L-S sin festivos', lambda d: d.weekday() < 6 and d not in festivos(d.year)),
    ('naturales', lambda d: True),
]


def parse_fecha_campo(s):
    """Fechas de solicitud/recepción/oficio en sus muchas variantes. None si no es legible."""
    t = norm(s).strip()
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})', t)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        y = 2000 + int(y) if len(y) == 2 else int(y)
        try:
            return dt.date(y, mo, d)
        except ValueError:
            return None
    toks = re.findall(r'\d+|[a-z]+', t)
    nums = [x for x in toks if x.isdigit()]
    mes = next((MESES[x] for x in toks if x in MESES), None)
    if mes and len(nums) >= 2:
        d, y = int(nums[0]), nums[-1]
        y = 2000 + int(y) if len(y) == 2 else int(y)
        try:
            return dt.date(y, mes, d)
        except ValueError:
            return None
    return None


def anio_valido(tok):
    v = int(tok)
    if 2015 <= v <= 2035 and len(tok) == 4:
        return v
    if len(tok) == 2:
        return 2000 + v
    return None


def dia_valido(tok, y, m, avisos):
    """Día del mes; corrige errores de captura de un dígito de más (198 → 18)."""
    v = int(tok)
    try:
        dt.date(y, m, v)
        return v
    except (ValueError, TypeError):
        pass
    if len(tok.lstrip('0')) >= 3:
        for i in range(len(tok)):
            cand = tok[:i] + tok[i + 1:]
            try:
                dt.date(y, m, int(cand))
                avisos.append(f'día "{tok}" leído como {int(cand)}')
                return int(cand)
            except ValueError:
                continue
    raise ValueError(f'día ilegible "{tok}"')

# ── Interpretación del texto "Periodo vacacional" ───────────────────────

def tokens(texto):
    return re.findall(r'\d+|[a-z]+', norm(texto))


def leer_lado(toks):
    """De un lado de un rango ('del 26 de diciembre de 2023') extrae día, mes, año."""
    dia = mes = anio = None
    anio_tok = None
    for t in toks:
        if t.isdigit():
            if mes is None and dia is None:
                dia = t
            elif mes is not None and anio_tok is None:
                anio_tok = t
        elif t in MESES and mes is None:
            mes = MESES[t]
    if anio_tok is not None:
        anio = anio_valido(anio_tok)
        if anio is None:
            anio = ('ilegible', anio_tok)
    return dia, mes, anio


def interpretar_periodo(texto, ref_anio, avisos):
    """
    Devuelve una lista de tramos. Cada tramo es ('lista', [fechas]) o
    ('rango', inicio, fin). ref_anio se usa cuando el texto no trae año.
    """
    t = norm(texto)
    partes = re.split(r'\by del\b', t)
    toks_all = tokens(t)
    if 'al' in toks_all:
        tramos = []
        lados = []
        for p in partes:
            tk = re.findall(r'\d+|[a-z]+', p)
            if 'al' not in tk:
                raise ValueError('rango sin "al"')
            k = tk.index('al')
            lados.append((leer_lado(tk[:k]), leer_lado(tk[k + 1:])))
        # mes/año del final se heredan hacia atrás
        ult_mes, ult_anio = None, None
        for (_, (d2, m2, y2)) in reversed(lados):
            ult_mes = ult_mes or m2
            ult_anio = ult_anio or y2
        for (d1, m1, y1), (d2, m2, y2) in lados:
            m2 = m2 or ult_mes
            y2 = y2 or ult_anio
            if isinstance(y2, tuple):
                avisos.append(f'año ilegible "{y2[1]}", se toma {ref_anio}')
                y2 = None
            if y2 is None:
                y2 = ref_anio
                avisos.append(f'año inferido {ref_anio}')
            if m2 is None:
                raise ValueError('rango sin mes')
            fin = dt.date(y2, m2, dia_valido(d2, y2, m2, avisos))
            if d1 is None:
                tramos.append(('rango_sin_inicio', None, fin))
                continue
            if m1 is None:
                m1 = m2 if int(d1) <= int(d2) else (m2 - 1 or 12)
            if isinstance(y1, tuple) or y1 is None:
                y1 = y2 if m1 <= m2 else y2 - 1
            ini = dt.date(y1, m1, dia_valido(d1, y1, m1, avisos))
            tramos.append(('rango', ini, fin))
        return tramos

    # Lista de días: "28,29,30 Abr., 02 y 05 May. 2025"
    grupos = []          # [(mes, [dias])]
    pendientes = []
    anio = None
    meses_restantes = sum(1 for x in toks_all if x in MESES)
    for i, tk in enumerate(toks_all):
        if tk in MESES:
            grupos.append((MESES[tk], pendientes))
            pendientes = []
            meses_restantes -= 1
        elif tk.isdigit():
            if grupos and meses_restantes == 0 and not pendientes and anio is None \
                    and (len(tk) >= 3 or i == len(toks_all) - 1 or len(tk) == 4):
                anio = anio_valido(tk)
                if anio is None:
                    avisos.append(f'año ilegible "{tk}", se toma {ref_anio}')
                    anio = -1
            else:
                pendientes.append(tk)
    if pendientes:
        # números después del último mes que no son año: errores de captura
        avisos.append('números sin mes ignorados: ' + ','.join(pendientes))
    if not grupos:
        raise ValueError('sin mes')
    if anio in (None, -1):
        if anio is None:
            avisos.append(f'año inferido {ref_anio}')
        anio = ref_anio
    # Si los meses retroceden (Dic → Ene), el primero es del año anterior.
    fechas = []
    y = anio
    anios = []
    for k in range(len(grupos) - 1, -1, -1):
        mes = grupos[k][0]
        if k < len(grupos) - 1 and mes > grupos[k + 1][0]:
            y -= 1
        anios.append(y)
    anios.reverse()
    for (mes, dias), y in zip(grupos, anios):
        if not dias:
            continue
        for d in dias:
            fechas.append(dt.date(y, mes, dia_valido(d, y, mes, avisos)))
    vistos = []
    for f in fechas:
        if f not in vistos:
            vistos.append(f)
    if len(vistos) != len(fechas):
        avisos.append('días repetidos en el texto, se cuentan una vez')
    if vistos != sorted(vistos):
        avisos.append('días fuera de orden en el texto')
    # "del 30 Oct. 06 Nov. 2024": dos fechas sueltas tras "del" = rango.
    if t.strip().startswith('del') and len(vistos) == 2 and len(grupos) == 2 \
            and ' y ' not in t and ',' not in t:
        avisos.append('"del X Y" sin "al" interpretado como rango')
        return [('rango', vistos[0], vistos[1])]
    return [('lista', sorted(vistos))]


def dias_de_rango(ini, fin, esperado, avisos):
    """Elige la regla de conteo que reproduce los días declarados en la Agenda."""
    if esperado is not None:
        for nombre, regla in REGLAS:
            lst = [d for d in rango(ini, fin) if regla(d)]
            if len(lst) == esperado:
                return lst
        return None
    return [d for d in rango(ini, fin) if REGLAS[0][1](d)]

# ── Clasificación del renglón ────────────────────────────────────────────

RE_CANCELA_DIAS = re.compile(r'cancel|reprogram|devoluc|eliminar|cambio|modific')
RE_CANCELA_NOTA = re.compile(r'reprogram|se cancela|regreso por oficio|solicitud de cancelacion de este periodo')
RE_MILITAR = re.compile(r'por (el )?medio +militar')


def clasificar(r):
    dias_n = norm(r['dias'])
    tipo_n = norm(r['tipo_solicitud'])
    nota_n = norm(r['nota'])
    cancelado = bool(RE_CANCELA_DIAS.search(dias_n)) or 'cancelacion' == tipo_n.strip()
    if not dias_n.strip() and RE_CANCELA_NOTA.search(nota_n):
        cancelado = True
    if 'solicitud de cancelacion de este periodo' in nota_n:
        cancelado = True
    if 'sin goce' in tipo_n or 'sin goce' in dias_n or 'sin sueldo' in dias_n \
            or (tipo_n.strip() in ('permiso', '') and 'permiso sin goce' in nota_n):
        tipo = 'permiso_sin_goce'
    elif 'mil' in dias_n or 'militar' in tipo_n or (RE_MILITAR.search(nota_n) and 'sugiero' not in nota_n):
        tipo = 'medio_militar'
    elif 'permiso a cuenta' in tipo_n:
        tipo = 'permiso_a_cuenta'
    else:
        tipo = 'vacaciones'
    m = re.search(r'\d+', dias_n)
    dias_num = int(m.group()) if m else None
    if cancelado and dias_num == 0:
        dias_num = None
    return tipo, cancelado, dias_num


def plausible(inicio, refs, tolerancia=(-75, 300)):
    return any(tolerancia[0] <= (inicio - ref).days <= tolerancia[1] for ref in refs)


def mover_anio(d, delta):
    try:
        return d.replace(year=d.year + delta)
    except ValueError:
        return d.replace(year=d.year + delta, day=28)


def procesar(fila_excel, r):
    avisos = []
    tipo, cancelado, dias_num = clasificar(r)
    refs = [f for f in (parse_fecha_campo(r['fecha_oficio']),
                        parse_fecha_campo(r['fecha_recepcion']),
                        parse_fecha_campo(r['fecha_solicitud'])) if f]
    refs = [f for f in refs if 2021 <= f.year <= 2027]
    ref_anio = refs[0].year if refs else None
    texto = r['periodo'].strip()
    if not texto or norm(texto).strip() in ('reprogramacion',):
        return dict(tipo=tipo, cancelado=cancelado, dias_totales=dias_num, inicio=None,
                    fin=None, fechas=None, avisos=['sin fechas en la Agenda'])
    tramos = interpretar_periodo(texto, ref_anio, avisos)

    # Año contra fechas de solicitud/oficio (antes de contar días: con otro
    # año cambia el día de la semana).
    def primera(trs):
        for tr in trs:
            if tr[0] == 'lista' and tr[1]:
                return tr[1][0]
            if tr[0] == 'rango':
                return tr[1]
            if tr[0] == 'rango_sin_inicio':
                return tr[2]
        return None

    def mover(trs, delta):
        out = []
        for tr in trs:
            if tr[0] == 'lista':
                out.append(('lista', [mover_anio(d, delta) for d in tr[1]]))
            else:
                out.append((tr[0], tr[1] and mover_anio(tr[1], delta), mover_anio(tr[2], delta)))
        return out

    inicio0 = primera(tramos)
    if refs and inicio0 and not plausible(inicio0, refs):
        for delta in (1, -1):
            if plausible(mover_anio(inicio0, delta), refs):
                avisos.append(f'año corregido {inicio0.year} → {inicio0.year + delta} según fechas de solicitud/oficio')
                tramos = mover(tramos, delta)
                break
        else:
            avisos.append('fechas lejanas a la solicitud/oficio')

    fechas = []
    limites = []   # inicio y fin tal como los declara la Agenda
    exactas = True
    for tr in tramos:
        if tr[0] == 'lista':
            fechas.extend(tr[1])
        elif tr[0] == 'rango_sin_inicio':
            fin = tr[2]
            n = dias_num or 1
            lst = [d for d in rango(fin - dt.timedelta(days=60), fin) if REGLAS[0][1](d)][-n:]
            avisos.append(f'fecha de inicio ausente: se toman {n} días hábiles hasta el fin')
            fechas.extend(lst)
        else:
            ini, fin = tr[1], tr[2]
            esperado = dias_num if len(tramos) == 1 else None
            lst = dias_de_rango(ini, fin, esperado, avisos)
            if lst is None:
                # Corrección de un dígito de más en el día final (22 Dic → 2 Dic).
                corregido = None
                s = str(fin.day)
                for i in range(len(s)):
                    cand = s[:i] + s[i + 1:]
                    if not cand or int(cand) == 0:
                        continue
                    for mes_delta in (0, -1):
                        mm = fin.month + mes_delta or 12
                        yy = fin.year if fin.month + mes_delta else fin.year - 1
                        try:
                            f2 = dt.date(yy, mm, int(cand))
                        except ValueError:
                            continue
                        if f2 < ini:
                            continue
                        l2 = dias_de_rango(ini, f2, esperado, [])
                        if l2 is not None:
                            corregido = (f2, l2)
                            break
                    if corregido:
                        break
                if corregido:
                    avisos.append(f'fin "{fin.isoformat()}" corregido a {corregido[0].isoformat()} para cuadrar {esperado} días')
                    lst = corregido[1]
                    fin = corregido[0]
                else:
                    avisos.append(f'el rango no cuadra con {esperado} días: se guarda el rango sin lista de días')
                    exactas = False
                    fechas.extend([ini, fin])
                    limites.extend([ini, fin])
                    continue
            fechas.extend(lst)
            limites.extend([ini, fin])
    fechas = sorted(set(fechas))
    limites = sorted(set(limites + fechas))
    if not fechas:
        raise ValueError('sin fechas')

    # Lista que incluye un día de descanso obligatorio y por eso excede lo
    # declarado: la Agenda no lo cuenta como vacaciones.
    if exactas and dias_num is not None and len(fechas) > dias_num:
        sin_festivos = [d for d in fechas if d not in festivos(d.year)]
        if len(sin_festivos) == dias_num:
            quitados = [d.isoformat() for d in fechas if d in festivos(d.year)]
            avisos.append('se excluye día de descanso obligatorio ' + ', '.join(quitados))
            fechas = sin_festivos

    listadas = len(fechas)
    if dias_num is not None and exactas and listadas != dias_num:
        avisos.append(f'la Agenda declara {dias_num} días y el periodo enumera {listadas}')
    dias_totales = dias_num if dias_num is not None else listadas
    return dict(tipo=tipo, cancelado=cancelado, dias_totales=dias_totales,
                inicio=limites[0], fin=limites[-1],
                fechas=fechas if exactas else None, avisos=avisos)

# ── SQL ──────────────────────────────────────────────────────────────────

def q(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, dt.date):
        return f"DATE '{v.isoformat()}'"
    s = str(v)
    if s == '':
        return 'NULL'
    return "'" + s.replace("'", "''") + "'"


def q_fechas(fechas):
    if fechas is None:
        return 'NULL'
    return "ARRAY[" + ','.join(f"'{d.isoformat()}'" for d in fechas) + "]::date[]"


ESTRUCTURA = r"""-- =====================================================================
-- Vacaciones · historial completo de la Agenda (hoja de vacaciones)
-- Paso 0 de N: estructura. Ejecutar primero, una sola vez (es idempotente).
--
-- public.colab_vacaciones_agenda guarda cada renglón de la hoja tal cual
-- (texto original de todas las columnas) y su interpretación (fechas,
-- días, tipo, cancelado). El módulo Colaboradores sigue leyendo
-- agenda_2026.vacaciones; el paso final (99_sincroniza.sql) lo reconstruye
-- a partir de esta tabla.
-- No contiene DROP TABLE, DELETE ni TRUNCATE sobre datos existentes.
-- =====================================================================

BEGIN;

ALTER TABLE public.agenda_2026
    ADD COLUMN IF NOT EXISTS vacaciones JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.colab_vacaciones_agenda (
    fila                 integer PRIMARY KEY,        -- renglón de la hoja
    num_empleado         text    NOT NULL,
    nombre               text,
    puesto               text,
    turno                text,
    mil_activo           text,
    fecha_ingreso        text,
    antiguedad           text,
    tipo_solicitud       text,
    fecha_solicitud      text,
    no_memorandum        text,
    fecha_recepcion      text,
    dias_texto           text,                       -- columna "Días de vacaciones" tal cual
    periodo_texto        text,                       -- columna "Periodo vacacional" tal cual
    no_oficio            text,
    fecha_oficio         text,
    acuse                text,
    nota                 text,
    dias_disponibles     text,
    area                 text,
    -- Interpretación
    tipo                 text    NOT NULL,           -- vacaciones | permiso_a_cuenta | permiso_sin_goce | medio_militar
    cancelado            boolean NOT NULL DEFAULT false,
    computa              boolean NOT NULL DEFAULT true,  -- descuenta de los 20 días
    fecha_inicio         date,
    fecha_fin            date,
    dias_totales         integer,
    dias                 date[],                     -- días exactos; NULL si la Agenda no permite saberlos
    revisar              boolean NOT NULL DEFAULT false,
    revision             text,                       -- correcciones aplicadas / dudas
    duplicado_de         integer,                    -- mismo período que otro renglón: no pasa a agenda_2026
    importado_en         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.colab_vacaciones_agenda ADD COLUMN IF NOT EXISTS duplicado_de integer;

CREATE INDEX IF NOT EXISTS idx_colab_vac_agenda_num
    ON public.colab_vacaciones_agenda (num_empleado);

ALTER TABLE public.colab_vacaciones_agenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "colab_vac_agenda_select_colab_editor" ON public.colab_vacaciones_agenda;
DROP POLICY IF EXISTS "colab_vac_agenda_write_colab_editor"  ON public.colab_vacaciones_agenda;

-- Solo Admin / Superadmin / Colab Editor (public.is_colab_editor()).
CREATE POLICY "colab_vac_agenda_select_colab_editor"
    ON public.colab_vacaciones_agenda FOR SELECT TO authenticated
    USING (public.is_colab_editor());
CREATE POLICY "colab_vac_agenda_write_colab_editor"
    ON public.colab_vacaciones_agenda FOR ALL TO authenticated
    USING (public.is_colab_editor()) WITH CHECK (public.is_colab_editor());

REVOKE ALL ON public.colab_vacaciones_agenda FROM anon;

COMMIT;
"""

SINCRONIZA = r"""-- =====================================================================
-- Vacaciones · paso final: sincroniza agenda_2026.vacaciones
-- Ejecutar después de TODAS las partes de datos. Se puede repetir.
--
-- • Conserva los períodos capturados a mano en la app (sin "fuente").
-- • Sustituye los importados antes (fuente = 'agenda_vacaciones').
-- • Si un período importado tiene las mismas fechas que uno capturado a
--   mano, se queda el capturado a mano (no se duplica).
-- • estado: cancelado | disfrutado (ya terminó) | programado.
-- =====================================================================

-- 1) Revisión previa (solo lectura): renglones sin colaborador en agenda_2026.
SELECT v.num_empleado, count(*) AS renglones, min(v.fecha_inicio) AS desde, max(v.fecha_fin) AS hasta
FROM public.colab_vacaciones_agenda v
LEFT JOIN public.agenda_2026 a ON btrim(a."No. Empleado"::text) = v.num_empleado
WHERE a."No. Empleado" IS NULL
GROUP BY v.num_empleado
ORDER BY v.num_empleado;

BEGIN;

WITH base AS (
    SELECT v.*,
           CASE WHEN v.cancelado THEN 'cancelado'
                WHEN v.fecha_fin < current_date THEN 'disfrutado'
                ELSE 'programado' END AS estado,
           EXTRACT(YEAR FROM v.fecha_inicio)::int AS anio
    FROM public.colab_vacaciones_agenda v
    WHERE v.fecha_inicio IS NOT NULL
      AND v.duplicado_de IS NULL
),
numerados AS (
    SELECT b.*,
           CASE WHEN NOT b.cancelado AND b.computa THEN
                row_number() OVER (
                    PARTITION BY b.num_empleado, b.anio, (NOT b.cancelado AND b.computa)
                    ORDER BY b.fecha_inicio, b.fila)
           END AS periodo_num
    FROM base b
),
objetos AS (
    SELECT n.num_empleado, n.fecha_inicio, n.fila,
           jsonb_strip_nulls(jsonb_build_object(
               'id',            'agenda-' || n.fila,
               'anio',          n.anio,
               'periodo_num',   n.periodo_num,
               'fecha_inicio',  to_char(n.fecha_inicio, 'YYYY-MM-DD'),
               'fecha_fin',     to_char(n.fecha_fin,    'YYYY-MM-DD'),
               'dias_totales',  n.dias_totales,
               'dias',          CASE WHEN n.dias IS NULL THEN NULL
                                     ELSE to_jsonb(ARRAY(SELECT to_char(d, 'YYYY-MM-DD') FROM unnest(n.dias) d ORDER BY d)) END,
               'estado',        n.estado,
               'tipo',          n.tipo,
               'computa',       n.computa,
               'observaciones', NULLIF(btrim(n.nota), ''),
               'fuente',        'agenda_vacaciones',
               'creado_por',    'Importación Agenda de vacaciones',
               'creado_en',     to_char(n.importado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'revisar',       CASE WHEN n.revisar THEN true END,
               'revision',      n.revision,
               'agenda',        jsonb_strip_nulls(jsonb_build_object(
                                    'fila',             n.fila,
                                    'tipo_solicitud',   NULLIF(btrim(n.tipo_solicitud), ''),
                                    'fecha_solicitud',  NULLIF(btrim(n.fecha_solicitud), ''),
                                    'no_memorandum',    NULLIF(btrim(n.no_memorandum), ''),
                                    'fecha_recepcion',  NULLIF(btrim(n.fecha_recepcion), ''),
                                    'dias',             NULLIF(btrim(n.dias_texto), ''),
                                    'periodo',          NULLIF(btrim(n.periodo_texto), ''),
                                    'no_oficio',        NULLIF(btrim(n.no_oficio), ''),
                                    'fecha_oficio',     NULLIF(btrim(n.fecha_oficio), ''),
                                    'acuse',            NULLIF(btrim(n.acuse), ''),
                                    'dias_disponibles', NULLIF(btrim(n.dias_disponibles), ''),
                                    'area',             NULLIF(btrim(n.area), '')
                                ))
           )) AS obj
    FROM numerados n
),
importados AS (
    SELECT num_empleado, jsonb_agg(obj ORDER BY fecha_inicio, fila) AS arr
    FROM objetos
    GROUP BY num_empleado
),
destino AS (
    SELECT a.ctid AS rid,
           COALESCE((
               SELECT jsonb_agg(e)
               FROM jsonb_array_elements(COALESCE(a.vacaciones, '[]'::jsonb)) e
               WHERE COALESCE(e->>'fuente', '') <> 'agenda_vacaciones'
           ), '[]'::jsonb) AS manuales,
           i.arr
    FROM public.agenda_2026 a
    JOIN importados i ON i.num_empleado = btrim(a."No. Empleado"::text)
)
UPDATE public.agenda_2026 a
SET vacaciones = d.manuales || COALESCE((
        SELECT jsonb_agg(x)
        FROM jsonb_array_elements(d.arr) x
        WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(d.manuales) m
            WHERE m->>'fecha_inicio' = x->>'fecha_inicio'
              AND m->>'fecha_fin'    = x->>'fecha_fin'
        )
    ), '[]'::jsonb)
FROM destino d
WHERE a.ctid = d.rid;

COMMIT;

-- 2) Verificación (solo lectura)
SELECT
    (SELECT count(*) FROM public.colab_vacaciones_agenda)                                   AS renglones_en_registro,
    (SELECT count(*) FROM public.colab_vacaciones_agenda WHERE fecha_inicio IS NULL)        AS renglones_sin_fechas,
    (SELECT count(*) FROM public.colab_vacaciones_agenda WHERE revisar)                     AS renglones_a_revisar,
    (SELECT count(*) FROM public.colab_vacaciones_agenda WHERE duplicado_de IS NOT NULL)    AS renglones_duplicados,
    (SELECT count(*) FROM public.agenda_2026 a, jsonb_array_elements(COALESCE(a.vacaciones,'[]')) e
       WHERE e->>'fuente' = 'agenda_vacaciones')                                            AS periodos_importados_en_agenda_2026,
    (SELECT count(DISTINCT a."No. Empleado") FROM public.agenda_2026 a, jsonb_array_elements(COALESCE(a.vacaciones,'[]')) e
       WHERE e->>'fuente' = 'agenda_vacaciones')                                            AS colaboradores_con_historial;
"""

INSERT_COLS = COLS[:12] + ['periodo', 'no_oficio', 'fecha_oficio', 'acuse', 'nota', 'dias_disponibles', 'area']
SQL_COLS = ['fila', 'num_empleado', 'nombre', 'puesto', 'turno', 'mil_activo', 'fecha_ingreso',
            'antiguedad', 'tipo_solicitud', 'fecha_solicitud', 'no_memorandum', 'fecha_recepcion',
            'dias_texto', 'periodo_texto', 'no_oficio', 'fecha_oficio', 'acuse', 'nota',
            'dias_disponibles', 'area', 'tipo', 'cancelado', 'computa', 'fecha_inicio',
            'fecha_fin', 'dias_totales', 'dias', 'revisar', 'revision', 'duplicado_de']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv')
    ap.add_argument('--out', default=os.path.join('privado', 'vacaciones_agenda'))
    ap.add_argument('--encoding', default='mac_roman')
    ap.add_argument('--por-parte', type=int, default=250)
    ap.add_argument('--correcciones', default=None,
                    help='JSON con correcciones manuales por renglón (vive en privado/, no en git)')
    args = ap.parse_args()

    correcciones = {}
    if args.correcciones and os.path.exists(args.correcciones):
        correcciones = {int(k): v for k, v in json.load(open(args.correcciones, encoding='utf-8')).items()}

    filas = leer_csv(args.csv, args.encoding)
    hdr = next(i for i, r in enumerate(filas) if len(r) > 1 and r[1].strip() == 'Nombre')
    registros = []
    for i in range(hdr + 1, len(filas)):
        cel = (filas[i] + [''] * 19)[:19]
        r = dict(zip(COLS, cel))
        r['num_empleado'] = r['num_empleado'].strip()
        if not r['num_empleado']:
            continue
        fila_excel = i + 1
        # Columna Área desplazada: un renglón trae ahí una nota.
        if r['area'].strip() and r['area'].strip() not in AREAS:
            r['nota'] = (r['nota'].rstrip() + '\n' + r['area'].strip()).strip()
            r['area'] = ''
        # Corrección manual: solo aplica si el renglón sigue siendo el mismo.
        corr = correcciones.get(fila_excel)
        if corr and (corr.get('num_empleado') != r['num_empleado'] or corr.get('periodo') != r['periodo'].strip()):
            raise SystemExit(f'La corrección del renglón {fila_excel} no coincide con el CSV; revísala.')
        r_proc = dict(r)
        if corr and corr.get('periodo_corregido'):
            r_proc['periodo'] = corr['periodo_corregido']
        try:
            p = procesar(fila_excel, r_proc)
        except Exception as e:  # noqa: BLE001 — se reporta y se conserva el renglón
            tipo, cancelado, dias_num = clasificar(r)
            p = dict(tipo=tipo, cancelado=cancelado, dias_totales=dias_num, inicio=None,
                     fin=None, fechas=None, avisos=[f'no se pudo leer el periodo: {e}'])
        if corr:
            if corr.get('cancelado'):
                p['cancelado'] = True
            p['avisos'].append('corrección manual: ' + corr['motivo'])
        computa = p['tipo'] in ('vacaciones', 'permiso_a_cuenta')
        avisos = [a for a in p['avisos'] if a]
        registros.append(dict(fila=fila_excel, r=r, p=p, computa=computa, avisos=avisos,
                              duplicado_de=None))

    # Mismo colaborador, mismas fechas, ninguno cancelado: es el mismo
    # período registrado dos veces (oficio duplicado o reprogramación que
    # repite las fechas). Se conserva el último renglón con oficio; los demás
    # quedan en el registro, marcados, y no pasan a agenda_2026.
    def dias_clave(reg):
        p = reg['p']
        return tuple(p['fechas']) if p['fechas'] else (p['inicio'], p['fin'])

    grupos = {}
    for reg in registros:
        if reg['p']['inicio'] and not reg['p']['cancelado']:
            grupos.setdefault((reg['r']['num_empleado'], dias_clave(reg)), []).append(reg)
    for regs in grupos.values():
        if len(regs) < 2:
            continue
        con_oficio = [x for x in regs if re.fullmatch(r'\d+', x['r']['no_oficio'].strip())]
        queda = (con_oficio or regs)[-1]
        for x in regs:
            if x is not queda:
                x['duplicado_de'] = queda['fila']
                x['avisos'].append(f'mismo período que el renglón {queda["fila"]}: no se suma dos veces')

    # Traslapes parciales del mismo colaborador: se señalan, no se modifican.
    por_num = {}
    for reg in registros:
        if reg['p']['inicio'] and not reg['p']['cancelado'] and reg['duplicado_de'] is None:
            por_num.setdefault(reg['r']['num_empleado'], []).append(reg)
    for regs in por_num.values():
        regs.sort(key=lambda x: (x['p']['inicio'], x['fila']))
        for a, b in zip(regs, regs[1:]):
            if b['p']['inicio'] <= a['p']['fin']:
                fa = set(a['p']['fechas'] or [])
                fb = set(b['p']['fechas'] or [])
                if fa and fb and not (fa & fb):
                    continue  # se intercalan sin compartir días
                a['avisos'].append(f'se traslapa con el renglón {b["fila"]}')
                b['avisos'].append(f'se traslapa con el renglón {a["fila"]}')

    os.makedirs(args.out, exist_ok=True)
    # newline='\n': los textos con salto de línea van tal cual dentro del SQL.
    with open(os.path.join(args.out, '00_estructura.sql'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(ESTRUCTURA)

    n_partes = 0
    for k in range(0, len(registros), args.por_parte):
        n_partes += 1
        bloque = registros[k:k + args.por_parte]
        lines = [
            f'-- Vacaciones · datos, parte {n_partes:02d} (renglones {bloque[0]["fila"]}–{bloque[-1]["fila"]}).',
            '-- Requiere 00_estructura.sql. Se puede repetir: actualiza por número de renglón.',
            'BEGIN;',
            f'INSERT INTO public.colab_vacaciones_agenda ({", ".join(SQL_COLS)}) VALUES',
        ]
        vals = []
        for reg in bloque:
            r, p = reg['r'], reg['p']
            v = [q(reg['fila'])] + [q(r[c].strip()) for c in INSERT_COLS]
            v += [q(p['tipo']), q(p['cancelado']), q(reg['computa']), q(p['inicio']), q(p['fin']),
                  q(p['dias_totales']), q_fechas(p['fechas']), q(bool(reg['avisos'])),
                  q('; '.join(reg['avisos']) or None), q(reg['duplicado_de'])]
            vals.append('  (' + ', '.join(v) + ')')
        lines.append(',\n'.join(vals))
        lines.append('ON CONFLICT (fila) DO UPDATE SET\n    ' + ',\n    '.join(
            f'{c} = EXCLUDED.{c}' for c in SQL_COLS[1:]) + ',\n    importado_en = now();')
        lines.append('COMMIT;\n')
        with open(os.path.join(args.out, f'{n_partes:02d}_datos.sql'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines))

    with open(os.path.join(args.out, '99_sincroniza.sql'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(SINCRONIZA)

    with open(os.path.join(args.out, 'auditoria.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['fila', 'num_empleado', 'dias', 'periodo', 'tipo', 'cancelado', 'inicio', 'fin',
                    'dias_totales', 'dias_exactos', 'revision'])
        for reg in registros:
            if reg['avisos']:
                p = reg['p']
                w.writerow([reg['fila'], reg['r']['num_empleado'], reg['r']['dias'], reg['r']['periodo'],
                            p['tipo'], p['cancelado'], p['inicio'], p['fin'], p['dias_totales'],
                            ' '.join(d.isoformat() for d in p['fechas']) if p['fechas'] else '',
                            '; '.join(reg['avisos'])])

    resumen = {
        'renglones': len(registros),
        'partes_de_datos': n_partes,
        'con_fechas': sum(1 for x in registros if x['p']['inicio']),
        'sin_fechas': sum(1 for x in registros if not x['p']['inicio']),
        'cancelados': sum(1 for x in registros if x['p']['cancelado']),
        'por_tipo': {t: sum(1 for x in registros if x['p']['tipo'] == t)
                     for t in ('vacaciones', 'permiso_a_cuenta', 'permiso_sin_goce', 'medio_militar')},
        'a_revisar': sum(1 for x in registros if x['avisos']),
        'duplicados': sum(1 for x in registros if x['duplicado_de']),
        'colaboradores': len({x['r']['num_empleado'] for x in registros}),
    }
    print(json.dumps(resumen, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
