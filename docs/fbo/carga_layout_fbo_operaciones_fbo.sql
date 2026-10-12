-- =====================================================================
-- Carga del Layout (hoja "Global") del módulo FBO → public.operaciones_fbo
-- Solo datos estadísticos (no se cargan importes de cobro).
-- =====================================================================

-- 0) Tabla destino (schema original). Se crea solo si no existe.
create table if not exists public.operaciones_fbo (
  id                       bigint generated always as identity primary key,

  -- Aeronave / operador
  operador                 text,           -- Operador
  vuelo_operado_por        text,           -- Vuelo Operado Por
  matricula                text,           -- Matrícula
  tipo_aeronave            text,           -- Tipo De Aeronave
  tipo_ala                 text,           -- Tipo de Ala (FIJA / ROTATIVA)

  -- Llegada
  origen                   text,           -- Origen
  nac_int_llegada          text,           -- Nac./Int. (Llegada) (NAC / INT)
  fecha_aterrizaje         date,           -- Fecha de Aterrizaje
  hora_aterrizaje          time,           -- Hora de Aterrizaje
  hora_llegada_posicion    time,           -- Hora de llegada a posición
  hora_desembarque         time,           -- Hora de desembarque
  tiempo_desembarque       interval,       -- Tiempo De Desembarque
  pax_llegada_adultos      integer,        -- Pax De Llegada (Adultos)
  pax_llegada_infantes     integer,        -- Pax de llegada (Infantes)
  pax_llegada_totales      integer,        -- Pax Totales de Llegada

  -- Salida
  destino                  text,           -- Destino
  nac_int_salida           text,           -- Nac/Int (Salida) (NAC / INT)
  fecha_salida_posicion    date,           -- Fecha de salida de posición
  hora_embarque            time,           -- Hora de embarque
  hora_salida_posicion     time,           -- Hora de salida de posición
  hora_despegue            time,           -- Hora de Despegue
  pax_salida_adultos       integer,        -- Pax de Salida (Adultos)
  pax_salida_infantes      integer,        -- Pax de Salida (Infantes)
  pax_salida_totales       integer,        -- Pax Totales de Salida
  pax_pagan_tua            integer,        -- Pax Que Pagan TUA
  tiempo_embarque          interval,       -- Tiempo de Embarque

  -- Servicios
  tiempo_permanencia_min   integer,        -- Tiempo De Perm. Prol. O Pernocta (Min)
  uds_traslado_pax         integer,        -- Uds. De Traslado de Pax
  uds_acarreo_equipaje     integer,        -- Uds. De Acarreo de Equipaje

  -- Pesos (toneladas)
  mtow                     numeric(8,2),   -- MTOW
  mzfw                     numeric(8,2),   -- MZFW

  oficial_operaciones      text            -- Oficial de Operaciones
);

-- Folio del sistema ("Registro") para identificar cada operación al recargar.
-- Sin índices únicos, sin restricciones y sin RLS.
alter table public.operaciones_fbo
  add column if not exists registro text;
alter table public.operaciones_fbo disable row level security;

-- 1) Tabla staging: espejo exacto de los encabezados del layout (todo texto).
--    Exporta la hoja "Global" a CSV quitando las 3 primeras filas (título,
--    subtítulo y fila vacía) para que la fila 1 sean los encabezados, e
--    impórtalo aquí (Table Editor → Import CSV, o \copy desde psql).
drop table if exists public.stg_layout_fbo;
create table public.stg_layout_fbo (
  "Registro" text,
  "Matrícula" text,
  "Operador" text,
  "Prestador" text,
  "Aeronave" text,
  "Tipo de ala" text,
  "MTOW t" text,
  "MZFW t" text,
  "MLW t" text,
  "Ruta" text,
  "Llegada nacional/internacional" text,
  "Salida nacional/internacional" text,
  "Llegada estimada" text,
  "Salida estimada" text,
  "EOBT" text,
  "ELDT" text,
  "ETOT" text,
  "Aterrizaje" text,
  "Llegada a plataforma" text,
  "Fin desembarque" text,
  "Inicio embarque" text,
  "Salida posición" text,
  "Despegue" text,
  "Posición inicial" text,
  "Adultos llegada" text,
  "Menores llegada" text,
  "Infantes llegada" text,
  "Piloto" text,
  "Observaciones" text,
  "Estado operativo" text,
  "Registro creado" text,
  "Última actualización" text,
  "Fecha validación" text,
  "Observación validación" text,
  "Validación" text,
  "Validó" text,
  "Origen IATA" text,
  "Origen OACI" text,
  "Origen Local" text,
  "Origen Nombre" text,
  "Origen Ciudad" text,
  "Origen País" text,
  "Destino IATA" text,
  "Destino OACI" text,
  "Destino Local" text,
  "Destino Nombre" text,
  "Destino Ciudad" text,
  "Destino País" text,
  "Utilizó GPU" text,
  "Inicio GPU" text,
  "Fin GPU" text,
  "Unidades traslado pasajeros" text,
  "Unidades acarreo equipaje" text,
  "Observaciones servicios" text,
  "Salida nacional Pagan TUA" text,
  "Salida nacional Diplomáticos" text,
  "Salida nacional En comisión" text,
  "Salida nacional Infantes" text,
  "Salida nacional Tránsitos" text,
  "Salida nacional Conexiones" text,
  "Salida nacional Otros exentos" text,
  "Salida nacional Total salida" text,
  "Salida internacional Pagan TUA" text,
  "Salida internacional Diplomáticos" text,
  "Salida internacional En comisión" text,
  "Salida internacional Infantes" text,
  "Salida internacional Tránsitos" text,
  "Salida internacional Conexiones" text,
  "Salida internacional Otros exentos" text,
  "Salida internacional Total salida" text,
  "Mes del periodo" text,
  "Sin importe" text,
  "Aterrizaje MXN" text,
  "Plataforma MXN" text,
  "Pernocta MXN" text,
  "GPU MXN" text,
  "Traslado pasajeros MXN" text,
  "Acarreo equipaje MXN" text,
  "TUA MXN" text,
  "Subtotal MXN" text,
  "IVA MXN" text,
  "Total MXN" text,
  "Pagado MXN" text,
  "Pendiente MXN" text,
  "Estado cobranza" text,
  "Datos pendientes" text,
  "Folios cobro" text
);
alter table public.stg_layout_fbo disable row level security;

-- 2) Llenado de operaciones_fbo desde staging
--    Recarga sin restricciones: primero borra los folios que vienen en el
--    layout y luego los vuelve a insertar (evita duplicados sin índice único).
begin;

delete from public.operaciones_fbo o
using public.stg_layout_fbo t
where o.registro = nullif(trim(t."Registro"),'');

with s as (
  select
    nullif(trim("Registro"),'')                          as registro,
    nullif(trim("Matrícula"),'')                         as matricula,
    nullif(trim("Operador"),'')                          as operador,
    nullif(trim("Prestador"),'')                         as prestador,
    nullif(trim("Aeronave"),'')                          as aeronave,
    upper(trim("Tipo de ala"))                           as tipo_ala,
    nullif(trim("MTOW t"),'')::numeric                   as mtow,
    nullif(trim("MZFW t"),'')::numeric                   as mzfw,
    upper(trim("Llegada nacional/internacional"))        as nac_int_lleg,
    upper(trim("Salida nacional/internacional"))         as nac_int_sal,
    nullif(trim("Aterrizaje"),'')::timestamp             as ts_aterrizaje,
    nullif(trim("Llegada a plataforma"),'')::timestamp   as ts_llegada_pos,
    nullif(trim("Fin desembarque"),'')::timestamp        as ts_desembarque,
    nullif(trim("Inicio embarque"),'')::timestamp        as ts_embarque,
    nullif(trim("Salida posición"),'')::timestamp        as ts_salida_pos,
    nullif(trim("Despegue"),'')::timestamp               as ts_despegue,
    coalesce(nullif(trim("Adultos llegada"),''),'0')::int  as adultos_lleg,
    coalesce(nullif(trim("Menores llegada"),''),'0')::int  as menores_lleg,
    coalesce(nullif(trim("Infantes llegada"),''),'0')::int as infantes_lleg,
    coalesce(nullif(trim("Origen OACI"),''),  nullif(trim("Origen Local"),''),  nullif(trim("Origen IATA"),''))  as origen,
    coalesce(nullif(trim("Destino OACI"),''), nullif(trim("Destino Local"),''), nullif(trim("Destino IATA"),'')) as destino,
    coalesce(nullif(trim("Unidades traslado pasajeros"),''),'0')::int as uds_traslado,
    coalesce(nullif(trim("Unidades acarreo equipaje"),''),'0')::int   as uds_acarreo,
    coalesce(nullif(trim("Salida nacional Pagan TUA"),''),'0')::int
      + coalesce(nullif(trim("Salida internacional Pagan TUA"),''),'0')::int    as pax_tua,
    coalesce(nullif(trim("Salida nacional Infantes"),''),'0')::int
      + coalesce(nullif(trim("Salida internacional Infantes"),''),'0')::int     as infantes_sal,
    coalesce(nullif(trim("Salida nacional Total salida"),''),'0')::int
      + coalesce(nullif(trim("Salida internacional Total salida"),''),'0')::int as total_sal,
    nullif(trim("Validó"),'')                            as valido
  from public.stg_layout_fbo
  where nullif(trim("Registro"),'') is not null
)
insert into public.operaciones_fbo (
  registro, operador, vuelo_operado_por, matricula, tipo_aeronave, tipo_ala,
  origen, nac_int_llegada, fecha_aterrizaje, hora_aterrizaje, hora_llegada_posicion,
  hora_desembarque, tiempo_desembarque,
  pax_llegada_adultos, pax_llegada_infantes, pax_llegada_totales,
  destino, nac_int_salida, fecha_salida_posicion, hora_embarque, hora_salida_posicion,
  hora_despegue, pax_salida_adultos, pax_salida_infantes, pax_salida_totales,
  pax_pagan_tua, tiempo_embarque, tiempo_permanencia_min,
  uds_traslado_pax, uds_acarreo_equipaje, mtow, mzfw, oficial_operaciones
)
select
  registro,
  operador,
  prestador,                                             -- FBO / AIFA / COMMANDER
  matricula,
  aeronave,
  case tipo_ala when 'FIXED_WING'  then 'FIJA'
                when 'ROTARY_WING' then 'ROTATIVA' else tipo_ala end,
  origen,
  case nac_int_lleg when 'NATIONAL' then 'NAC' when 'INTERNATIONAL' then 'INT' else nac_int_lleg end,
  ts_aterrizaje::date,
  ts_aterrizaje::time,
  ts_llegada_pos::time,
  ts_desembarque::time,
  ts_desembarque - ts_llegada_pos,                       -- igual que en la Base histórica
  adultos_lleg + menores_lleg,                           -- la Base no separa "menores"
  infantes_lleg,
  adultos_lleg + menores_lleg + infantes_lleg,
  destino,
  case nac_int_sal when 'NATIONAL' then 'NAC' when 'INTERNATIONAL' then 'INT' else nac_int_sal end,
  ts_salida_pos::date,
  ts_embarque::time,
  ts_salida_pos::time,
  ts_despegue::time,
  greatest(total_sal - infantes_sal, 0),
  infantes_sal,
  total_sal,
  pax_tua,
  ts_salida_pos - ts_embarque,                           -- igual que en la Base histórica
  (extract(epoch from ts_salida_pos - ts_llegada_pos) / 60)::int,  -- minutos en posición (sin lógica de cobro)
  uds_traslado,
  uds_acarreo,
  round(mtow, 2),
  round(mzfw, 2),
  valido                                                 -- ver nota: el layout no trae "Oficial de Operaciones"
from s;

commit;

-- 3) (Opcional) limpiar staging
-- truncate public.stg_layout_fbo;
