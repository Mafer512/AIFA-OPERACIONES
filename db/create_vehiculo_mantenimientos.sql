-- ============================================================
-- Historial de Mantenimientos por Vehículo
-- Coordinación de Auditoría · Dirección de Operación · AIFA
-- Ejecutar en Supabase SQL Editor
--
-- Tabla hija de public.catalogo_vehiculos (1 vehículo → N registros
-- de mantenimiento). Sigue el mismo patrón de permisos que la tabla
-- padre: lectura para quien tenga acceso a la sección
-- 'coord-auditoria', escritura solo para admin/superadmin.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vehiculo_mantenimientos (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehiculo_id             UUID NOT NULL REFERENCES public.catalogo_vehiculos(id) ON DELETE CASCADE,

    fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo                    TEXT NOT NULL CHECK (tipo IN ('Preventivo', 'Correctivo')),
    descripcion             TEXT NOT NULL,
    kilometraje             INTEGER CHECK (kilometraje IS NULL OR kilometraje >= 0),
    costo                   NUMERIC(12,2) CHECK (costo IS NULL OR costo >= 0),
    taller                  TEXT,                         -- taller / proveedor
    responsable             TEXT,                         -- quien autorizó o realizó el registro
    proximo_mantenimiento   DATE,                         -- opcional: fecha sugerida del siguiente servicio

    created_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at              TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── Índices para listar el historial de un vehículo ordenado por fecha ──
CREATE INDEX IF NOT EXISTS idx_veh_mant_vehiculo
    ON public.vehiculo_mantenimientos(vehiculo_id);

CREATE INDEX IF NOT EXISTS idx_veh_mant_vehiculo_fecha
    ON public.vehiculo_mantenimientos(vehiculo_id, fecha DESC);

-- ── updated_at automático (reutiliza la función genérica ya creada
--    en create_colab_cursos.sql; CREATE OR REPLACE la deja disponible
--    aunque ese script no se haya ejecutado en este entorno) ──
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_veh_mant_updated_at ON public.vehiculo_mantenimientos;
CREATE TRIGGER trg_veh_mant_updated_at
    BEFORE UPDATE ON public.vehiculo_mantenimientos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.vehiculo_mantenimientos ENABLE ROW LEVEL SECURITY;

-- Lectura: mismo criterio que catalogo_vehiculos (sección 'coord-auditoria')
DROP POLICY IF EXISTS "veh_mant_select" ON public.vehiculo_mantenimientos;
CREATE POLICY "veh_mant_select"
    ON public.vehiculo_mantenimientos FOR SELECT TO authenticated
    USING (public.user_can_access_section('coord-auditoria'));

-- Insertar: solo admins (igual que insertar/editar vehículos)
DROP POLICY IF EXISTS "veh_mant_insert" ON public.vehiculo_mantenimientos;
CREATE POLICY "veh_mant_insert"
    ON public.vehiculo_mantenimientos FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- Actualizar: solo admins
DROP POLICY IF EXISTS "veh_mant_update" ON public.vehiculo_mantenimientos;
CREATE POLICY "veh_mant_update"
    ON public.vehiculo_mantenimientos FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- Eliminar: solo admins
DROP POLICY IF EXISTS "veh_mant_delete" ON public.vehiculo_mantenimientos;
CREATE POLICY "veh_mant_delete"
    ON public.vehiculo_mantenimientos FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid() AND role IN ('admin', 'superadmin')
        )
    );

-- ── NOTAS DE USO ──────────────────────────────────────────────
-- 1. Un vehículo puede tener 0 o más registros de mantenimiento.
-- 2. Si se elimina el vehículo, sus mantenimientos se eliminan en
--    cascada (ON DELETE CASCADE).
-- 3. La UI (js/vehiculos.js) solo expone alta y listado; edición y
--    borrado de un registro individual quedan disponibles vía RLS
--    para admins pero no tienen botón en la interfaz por ahora.
