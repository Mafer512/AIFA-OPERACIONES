-- ============================================================
-- Catálogo de Vehículos Terrestres — Número de Resguardo
-- Coordinación de Auditoría · Dirección de Operación · AIFA
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.catalogo_vehiculos
    ADD COLUMN IF NOT EXISTS numero_resguardo TEXT;

COMMENT ON COLUMN public.catalogo_vehiculos.numero_resguardo IS
    'Número de resguardo asignado al vehículo (captura libre, opcional).';

-- responsable_nombre ya existe en public.catalogo_vehiculos (create_catalogo_vehiculos.sql).
