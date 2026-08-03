-- Verificación de solo lectura posterior a 011 y 012.
SELECT
  count(*) AS registros,
  coalesce(sum(cantidad),0) AS unidades,
  count(*) FILTER (WHERE tipo_registro='individual') AS individuales,
  count(*) FILTER (WHERE tipo_registro='lote') AS lotes,
  count(numero_serie) AS series,
  count(numero_serie)-count(DISTINCT numero_serie) AS series_duplicadas
FROM public.muebles_bienes;

SELECT id,name,public,file_size_limit,allowed_mime_types
FROM storage.buckets
WHERE id='muebles-bienes-documentos';

SELECT schemaname,tablename,policyname,cmd,roles
FROM pg_policies
WHERE tablename IN ('muebles_bienes','muebles_bienes_documentos','muebles_bienes_documentos_archivos','objects')
  AND (tablename<>'objects' OR policyname LIKE 'mb_storage_%')
ORDER BY tablename,policyname;

SELECT
  (SELECT count(*) FROM public.muebles_bienes_documentos_archivos) AS documentos,
  (SELECT count(*) FROM public.muebles_bienes_documentos) AS relaciones;
