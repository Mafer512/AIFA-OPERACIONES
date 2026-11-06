-- ============================================================================
-- SETP · Supervisores de Edificio Terminal — script completo del módulo
-- Ruta: Sgd. Operacional -> Ops. Ed. Terminal -> SETP
--
-- Crea, desde cero:
--   1. setp_supervisores     No. de empleado, nombre y apellido, y cargo.
--                            Al elegir al supervisor en el filtro, estos
--                            datos aparecen solos en "Supervisor × turno".
--   2. setp_recorridos       Supervisor × turno: supervisor, área de
--                            recorrido, hora de inicio, hora de término y
--                            evidencia (foto o archivo), que se refleja en
--                            el formato final.
--   3. setp_hallazgos        Reporte de hallazgos del Edificio Terminal.
--   4. setp_oficios          Oficios generados con "Generar formato", y
--      setp_oficio_recorridos  los recorridos que salieron en cada uno.
--   5. setp_reportes         Registros importados desde Excel.
--   6. Bucket setp-evidencias para fotografías y archivos.
--
-- NO modifica tablas existentes del aplicativo.
-- Es idempotente: se puede correr más de una vez.
-- Cómo correrlo: Supabase → SQL Editor → pegar todo → Run.
-- ============================================================================


-- ── 1. Supervisores ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.setp_supervisores (
    no_empleado text PRIMARY KEY CHECK (length(trim(no_empleado)) > 0),
    nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
    cargo text
);


-- ── 2. Supervisor × turno (recorridos de supervisión) ───────────────────────
-- El nombre y el cargo no se repiten aquí: se toman del supervisor.
CREATE TABLE IF NOT EXISTS public.setp_recorridos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    no_empleado text NOT NULL
        REFERENCES public.setp_supervisores (no_empleado) ON UPDATE CASCADE ON DELETE RESTRICT,
    area_recorrido text NOT NULL CHECK (length(trim(area_recorrido)) > 0),
    hora_inicio time NOT NULL,
    -- Sin validar contra hora_inicio: el turno nocturno cruza la medianoche.
    hora_termino time,
    -- Evidencia: fotografía o archivo (PDF, Word, Excel) en setp-evidencias.
    -- En el formato final, FOTO se inserta como imagen y ARCHIVO aparece con
    -- su nombre y su liga de descarga.
    evidencia_url text,
    evidencia_nombre text,
    evidencia_tipo text CHECK (evidencia_tipo IS NULL OR evidencia_tipo IN ('FOTO', 'ARCHIVO')),
    CHECK (evidencia_url IS NULL OR (evidencia_nombre IS NOT NULL AND evidencia_tipo IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_setp_recorridos_empleado
    ON public.setp_recorridos (no_empleado);


-- ── 3. Hallazgos del Edificio Terminal ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.setp_hallazgos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha_reporte date NOT NULL,
    modulo text NOT NULL CHECK (length(trim(modulo)) > 0),
    nivel text,
    descripcion text NOT NULL CHECK (length(trim(descripcion)) > 0),
    evidencia_url text,
    evidencia_path text,
    estatus text NOT NULL DEFAULT 'PENDIENTE' CHECK (estatus IN ('PENDIENTE', 'SOLUCIONADO')),
    fecha_solucion date,
    evidencia_solucion_url text,
    evidencia_solucion_path text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text,
    CHECK (estatus = 'PENDIENTE' OR fecha_solucion IS NOT NULL),
    CHECK (fecha_solucion IS NULL OR fecha_solucion >= fecha_reporte)
);

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_fecha_reporte
    ON public.setp_hallazgos (fecha_reporte);

CREATE INDEX IF NOT EXISTS idx_setp_hallazgos_estatus
    ON public.setp_hallazgos (estatus, fecha_solucion);


-- ── 4. Oficios generados ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.setp_oficios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    numero text NOT NULL UNIQUE CHECK (length(trim(numero)) > 0),
    fecha_oficio date NOT NULL,
    periodo date NOT NULL,              -- primer día del mes reportado
    datos jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Copia fija de lo que salió en el formato: hallazgos por sección y los
    -- recorridos con su evidencia, tal como estaban al generarlo.
    secciones jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorridos jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text
);

CREATE INDEX IF NOT EXISTS idx_setp_oficios_created
    ON public.setp_oficios (created_at DESC);

-- Recorridos incluidos en cada formato. Un recorrido que ya salió en un
-- formato guardado no se puede borrar (ON DELETE RESTRICT), y su evidencia
-- tampoco (ver paso 7): así el formato emitido nunca pierde sus fotos.
CREATE TABLE IF NOT EXISTS public.setp_oficio_recorridos (
    oficio_id uuid NOT NULL REFERENCES public.setp_oficios (id) ON DELETE CASCADE,
    recorrido_id uuid NOT NULL REFERENCES public.setp_recorridos (id) ON DELETE RESTRICT,
    PRIMARY KEY (oficio_id, recorrido_id)
);

CREATE INDEX IF NOT EXISTS idx_setp_oficio_recorridos_recorrido
    ON public.setp_oficio_recorridos (recorrido_id);


-- ── 5. Registros importados desde Excel ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.setp_reportes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Huella de fecha+turno+supervisor+área+tipo+descripción: volver a
    -- importar el mismo Excel actualiza el estatus en lugar de duplicar.
    row_hash text NOT NULL UNIQUE,
    fecha date NOT NULL,
    turno text NOT NULL CHECK (turno IN ('MATUTINO', 'VESPERTINO', 'NOCTURNO')),
    supervisor text NOT NULL CHECK (length(trim(supervisor)) > 0),
    area text,
    tipo text,
    descripcion text,
    estatus text CHECK (estatus IS NULL OR estatus IN ('ABIERTO', 'EN PROCESO', 'CERRADO')),
    archivo_origen text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text,
    updated_by text
);

CREATE INDEX IF NOT EXISTS idx_setp_reportes_fecha
    ON public.setp_reportes (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_setp_reportes_supervisor_turno
    ON public.setp_reportes (supervisor, turno);


-- ── 6. Políticas de las tablas del módulo ───────────────────────────────────
-- Supervisores: se consultan desde el aplicativo, pero la lista sólo se
-- cambia desde el SQL Editor (paso 8).
ALTER TABLE public.setp_supervisores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS setp_supervisores_read ON public.setp_supervisores;
CREATE POLICY setp_supervisores_read
    ON public.setp_supervisores
    FOR SELECT TO authenticated
    USING (true);

-- Demás tablas: los usuarios con sesión consultan y capturan. Se quitan
-- también las políticas de los scripts anteriores de SETP
-- (create_setp_reportes.sql y create_setp_formatos.sql).
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['setp_recorridos', 'setp_hallazgos', 'setp_oficios', 'setp_oficio_recorridos', 'setp_reportes'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_read', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t || '_insert', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t || '_update', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', t || '_delete', t);

        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END;
$$;

GRANT SELECT ON public.setp_supervisores TO authenticated;


-- ── 7. Bucket de evidencias (fotografías y archivos) ────────────────────────
-- Este paso va protegido: si Supabase no permite tocar el almacenamiento
-- desde el SQL Editor, avisa con un NOTICE y el script sigue, en lugar de
-- deshacer las tablas de los pasos anteriores.

-- La evidencia de un recorrido que ya salió en un formato guardado no se
-- puede reemplazar ni borrar: el formato emitido la sigue mostrando.
CREATE OR REPLACE FUNCTION public.setp_evidencia_en_formato(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.setp_oficio_recorridos l
        JOIN public.setp_recorridos r ON r.id = l.recorrido_id
        WHERE r.evidencia_url LIKE '%/setp-evidencias/' || p_path
    );
$$;

REVOKE EXECUTE ON FUNCTION public.setp_evidencia_en_formato(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.setp_evidencia_en_formato(text) TO authenticated;

DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
        'setp-evidencias',
        'setp-evidencias',
        true,
        10485760,  -- 10 MB por archivo (las fotos se comprimen antes de subir)
        ARRAY[
            'image/jpeg', 'image/png', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
    )
    ON CONFLICT (id) DO UPDATE
        SET public = EXCLUDED.public,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SETP: no se pudo crear el bucket setp-evidencias (%). Créalo en Storage → New bucket, público.', SQLERRM;
END;
$$;

DO $$
BEGIN
    DROP POLICY IF EXISTS "setp_evidencias_public_read" ON storage.objects;
    CREATE POLICY "setp_evidencias_public_read"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'setp-evidencias');

    DROP POLICY IF EXISTS "setp_evidencias_auth_insert" ON storage.objects;
    CREATE POLICY "setp_evidencias_auth_insert"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'setp-evidencias');

    DROP POLICY IF EXISTS "setp_evidencias_auth_update" ON storage.objects;
    CREATE POLICY "setp_evidencias_auth_update"
        ON storage.objects FOR UPDATE TO authenticated
        USING (bucket_id = 'setp-evidencias' AND NOT public.setp_evidencia_en_formato(name));

    DROP POLICY IF EXISTS "setp_evidencias_auth_delete" ON storage.objects;
    CREATE POLICY "setp_evidencias_auth_delete"
        ON storage.objects FOR DELETE TO authenticated
        USING (bucket_id = 'setp-evidencias' AND NOT public.setp_evidencia_en_formato(name));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SETP: no se pudieron crear los permisos del bucket setp-evidencias (%). Las tablas sí quedaron creadas.', SQLERRM;
END;
$$;


-- ── 8. Alta de supervisores ─────────────────────────────────────────────────
-- Un renglón por supervisor. Para agregar otro, copia el renglón, cambia sus
-- datos y separa los renglones con coma. Volver a correrlo actualiza nombre
-- y cargo de quien ya exista.
INSERT INTO public.setp_supervisores (no_empleado, nombre, cargo)
VALUES
    --  No. empleado   Nombre y apellido          Cargo
    ('1790',           'Tania Vargas Gonzalez',   'Coord. Svs. Espzdo. Aerops.')
ON CONFLICT (no_empleado) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        cargo = EXCLUDED.cargo;


-- ── 9. Comprobación ─────────────────────────────────────────────────────────
-- Que el aplicativo vea las tablas nuevas de inmediato.
NOTIFY pgrst, 'reload schema';

-- (a) Supervisores registrados.
SELECT no_empleado, nombre, cargo
FROM public.setp_supervisores
ORDER BY nombre;

-- (b) Tablas del módulo: las 6 deben salir con su nombre (ninguna vacía).
SELECT to_regclass('public.setp_supervisores')      AS supervisores,
       to_regclass('public.setp_recorridos')        AS recorridos,
       to_regclass('public.setp_hallazgos')         AS hallazgos,
       to_regclass('public.setp_oficios')           AS oficios,
       to_regclass('public.setp_oficio_recorridos') AS oficio_recorridos,
       to_regclass('public.setp_reportes')          AS reportes;
