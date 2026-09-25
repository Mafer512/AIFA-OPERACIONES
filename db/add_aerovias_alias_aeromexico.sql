-- =============================================================================
-- AEROVÍAS es Aeroméxico: darla de alta como alias en el catálogo
--
-- En los manifiestos el capturista escribe lo que dice el documento, y lo que
-- dice es la razón social. Los vuelos de Aeroméxico entran de tres formas:
--
--     AEROVÍAS            → Aerovías de México, S.A. de C.V.
--     AEROLITORAL         → Aeroméxico Connect
--     AEROMEXICO          → la marca
--
-- El catálogo (tabla airlines, que se administra en Gestión de Datos →
-- Aerolíneas) ya resuelve aerolitoral y los "connect" por sus alias, pero no
-- aerovias. Sin este renglón, la aerolínea más grande del aeropuerto sale
-- partida en dos en cada tablero que agrupe por aerolínea.
--
-- Esto homologa AEROVÍAS en TODO el sistema —impactos de fauna, conciliación,
-- resumen estadístico, manifiestos—, porque todos preguntan por el nombre
-- bueno al mismo catálogo (js/airline-catalog.js).
--
-- El módulo de Manifiestos ya agrupa AEROVÍAS por su cuenta aunque esto no se
-- corra (ver AEROLINEAS_MISMA_EMPRESA en js/manifiestos-analisis.js, que es su
-- respaldo mientras el catálogo carga). Correr esto es lo que lo arregla en las
-- demás pantallas.
--
-- Proyecto: AIFA-OPERACIONES (fgstncvuuhpgyzmjceyr).
-- IDEMPOTENTE: correrlo dos veces no duplica alias.
-- =============================================================================

begin;

update public.airlines
   set aliases = (
         select array_agg(distinct a order by a)
           from unnest(
                  coalesce(aliases, array[]::text[])
                  || array['aerovias', 'aerovías', 'aerovias de mexico', 'aerovías de méxico']
                ) as a
       )
 where lower(btrim(name)) in ('aeroméxico', 'aeromexico')
    or upper(btrim(coalesce(iata, ''))) = 'AM';

commit;

-- =============================================================================
-- VERIFICACIÓN — deben aparecer las cuatro variantes en el renglón de Aeroméxico
-- =============================================================================
-- select name, iata, aliases
--   from public.airlines
--  where upper(btrim(coalesce(iata, ''))) = 'AM';
