-- ============================================================================
-- Pertenencia a la Direccion de Operacion (palomita por persona)
--
-- La columna "Direccion" dice donde esta adscrita la plaza, no quien integra
-- el area de verdad: hay gente que aparece con Direccion de Operacion y
-- organicamente no forma parte de ella. Contarla inflaba el total del Resumen
-- del Directorio y, con el, todas las tarjetas y graficas que se calculan
-- sobre ese mismo universo.
--
-- Por eso la pertenencia se captura a mano, con una palomita en la Tabla
-- Completa de Colaboradores, y es ese dato el que manda sobre el organigrama.
--
-- NACE EN true A PROPOSITO: el dia que se corre este script ningun numero se
-- mueve. A partir de ahi se va DESPALOMEANDO a quien no pertenece, y el total
-- va bajando solo. Lo contrario (nacer en false) dejaria el Resumen en cero
-- hasta terminar de palomear a las mas de 400 personas.
--
-- La aplicacion ya trata "sin dato" como que si pertenece, asi que mientras
-- este script no se corra todo sigue funcionando exactamente igual.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- Como correrlo: Supabase -> SQL Editor -> pegar -> Run.
-- ============================================================================

ALTER TABLE public.agenda_2026
  ADD COLUMN IF NOT EXISTS pertenece_direccion_operacion boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agenda_2026.pertenece_direccion_operacion IS
  'Palomita: la persona integra organicamente la Direccion de Operacion. Solo quien la tiene en true cuenta en el Resumen del Directorio, en los vencimientos de cursos, en la agenda de cursos y en el calendario de vacaciones. Se captura desde la Tabla Completa de Colaboradores.';

-- Las filas que ya existian quedan palomeadas. Este UPDATE solo hace falta si
-- alguien creo la columna antes sin DEFAULT y quedaron nulos sueltos.
UPDATE public.agenda_2026
   SET pertenece_direccion_operacion = true
 WHERE pertenece_direccion_operacion IS NULL;

-- ── Comprobacion: la columna debe existir, ser boolean y no admitir nulos ───
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'agenda_2026'
  AND column_name  = 'pertenece_direccion_operacion';

-- ── Como quedo el padron: palomeados contra despalomeados ──────────────────
SELECT pertenece_direccion_operacion AS pertenece,
       count(*) AS personas
FROM public.agenda_2026
GROUP BY 1
ORDER BY 1 DESC;

-- ── Quien quedo FUERA del conteo (al principio, nadie) ─────────────────────
SELECT "No. Empleado", "Nombre", "Estatus"
FROM public.agenda_2026
WHERE pertenece_direccion_operacion = false
ORDER BY "Nombre"
LIMIT 100;
