-- =====================================================================
-- 062c · Quitar el aviso "Carga ene–ago 2026 incompleta"
-- (selecciona todo y Run). Correr DESPUÉS de la 062b con "FIN: OK".
--
-- Desde la 062b los totales mensuales y anuales salen de las cifras
-- oficiales hasta fn_fecha_corte_oficial(), y la maestra trae la carga
-- de ene–jul 2026: el hueco ya no existe. No borra el renglón (se puede
-- volver a encender con activo = true).
-- =====================================================================
UPDATE public.manifiestos_avisos_periodo
   SET activo = false,
       actualizado_at = now()
 WHERE clave = 'carga_2026_ene_ago';

SELECT clave, texto, desde, hasta, activo, actualizado_at
  FROM public.manifiestos_avisos_periodo
 ORDER BY clave;
