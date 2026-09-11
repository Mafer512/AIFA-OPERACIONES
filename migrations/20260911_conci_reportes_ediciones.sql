-- ============================================================================
-- Reportes de Conciliación: versiones editadas (textos y marcatextos)
-- ----------------------------------------------------------------------------
-- En Reportes (Carga y Pasajeros) cualquier reporte se puede corregir a mano y
-- marcar con colores. Lo editado se guarda aquí como una versión del reporte
-- —por apartado, reporte y fecha— y NO toca "Conciliación Manifiestos".
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Mientras no exista la
-- tabla, la aplicación guarda las ediciones solo en el navegador de quien las
-- hizo y lo avisa en pantalla.
-- ============================================================================

create table if not exists public.conci_reportes_ediciones (
  id              bigint generated always as identity primary key,
  area            text        not null check (area in ('carga', 'pasajeros')),
  reporte         text        not null check (reporte ~ '^[a-z0-9]{1,40}$'),
  fecha           date        not null,
  html            text        not null check (length(html) <= 2000000),
  actualizado_por text,
  actualizado_en  timestamptz not null default now(),
  constraint conci_reportes_ediciones_uq unique (area, reporte, fecha)
);

comment on table public.conci_reportes_ediciones is
  'Versión editada (textos y marcatextos) de un reporte de Conciliación por área, reporte y fecha. No modifica los manifiestos.';

alter table public.conci_reportes_ediciones enable row level security;

-- Mismo alcance que el resto de Operaciones: si existe la guardia central
-- has_operaciones_access (migrations/20260717_operaciones_access.sql) se usa;
-- si no, basta con estar autenticado, como "Conciliación Manifiestos".
do $$
declare
  guardia text := case
    when to_regprocedure('public.has_operaciones_access(uuid)') is not null
      then 'public.has_operaciones_access()'
    else $g$auth.role() = 'authenticated'$g$
  end;
begin
  execute 'drop policy if exists cre_select on public.conci_reportes_ediciones';
  execute 'drop policy if exists cre_insert on public.conci_reportes_ediciones';
  execute 'drop policy if exists cre_update on public.conci_reportes_ediciones';
  execute 'drop policy if exists cre_delete on public.conci_reportes_ediciones';
  execute format('create policy cre_select on public.conci_reportes_ediciones for select to authenticated using (%s)', guardia);
  execute format('create policy cre_insert on public.conci_reportes_ediciones for insert to authenticated with check (%s)', guardia);
  execute format('create policy cre_update on public.conci_reportes_ediciones for update to authenticated using (%s) with check (%s)', guardia, guardia);
  execute format('create policy cre_delete on public.conci_reportes_ediciones for delete to authenticated using (%s)', guardia);
end $$;

revoke all on public.conci_reportes_ediciones from anon;
grant select, insert, update, delete on public.conci_reportes_ediciones to authenticated;

-- Que la API vea la tabla nueva sin esperar.
notify pgrst, 'reload schema';

-- VERIFICACIÓN
-- select area, reporte, fecha, actualizado_por, actualizado_en
--   from public.conci_reportes_ediciones order by actualizado_en desc limit 20;
