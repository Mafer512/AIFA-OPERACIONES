-- =====================================================================
-- Actualizaci?n completa agenda_2026 desde Agenda 2026.xlsx
-- Generado: 2026-07-27
-- Alcance: agregar columna Estatus, sincronizar colaboradores y vacantes
-- Restricciones respetadas: sin DROP, DELETE, TRUNCATE ni cambios destructivos
-- Fuente primaria: hoja Activos
-- Filas de datos consideradas: 472
-- Colaboradores con No. Empleado: 459
-- Vacantes sin No. Empleado: 13
-- Estatus colaboradores: Activo=423, Baja=36
-- =====================================================================

BEGIN;

-- 1) Columna nueva solicitada
ALTER TABLE public.agenda_2026
  ADD COLUMN IF NOT EXISTS "Estatus" text DEFAULT 'Activo';

ALTER TABLE public.agenda_2026
  ALTER COLUMN "Estatus" SET DEFAULT 'Activo';

-- 2) Restricci?n no destructiva para mantener valores permitidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agenda_2026_estatus_valores_chk'
  ) THEN
    ALTER TABLE public.agenda_2026
      ADD CONSTRAINT agenda_2026_estatus_valores_chk
      CHECK ("Estatus" IS NULL OR "Estatus" IN ('Activo', 'Baja')) NOT VALID;
  END IF;
END $$;

-- 3) Columnas del Excel que deben existir en agenda_2026

ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "No. Empleado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Nombre" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fecha de alta" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Sueldo_Bruto" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Plaza" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Nivel" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Dir. Orgánica" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Subdir. Orgánica" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Gerencia Orgánica" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Coordinación Orgánica" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Puesto" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Personal Comisionado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Dirección Comisionado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Subdirección Comisionado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Gerencia Comisionado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Coordinación Comisionado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Comentarios" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Amonestaciones" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Rúbrica" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Anexo ""A"" Turno especial" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Anexo ""A"" Fecha de activación" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Anexo ""B"" Riesgos" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Anexo ""B"" Fecha de activación" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Antigüedad" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Días de vacaciones disponibles" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fecha de nacimiento" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Sexo" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "CURP" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "RFC" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "NSS" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Vigencia de INE" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fotografia de INE" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "No. telefónico" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Domicilio (calle, colonia, municipio, estado y código postal)" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Persona Civil o Militar" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Grado Militar" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Personal en activo o retirado" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Matrícula Militar" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Estado civil" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Dependientes (hijos)" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "RUSP" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Tipo de sangre" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Alérgico a algún medicamento Si ó No (Especificar)" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Alérgico a algún alimento. Si ó No (Especificar)" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Contacto de emergencia 1 Nombre completo" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Parentesco 1" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Teléfono de emergencia 1" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Contacto de emergencia 2 Nombre completo" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Parentesco 2" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Teléfono de emergencia 2" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Nivel de estudio" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Nombre de la Licenciatura y/o Maestria" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Grado Acad?mico" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Nombre de la Universidad" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Año de Titulación" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "No. Cédula Profesional" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fotografía (vest. Formal)" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Correo Personal" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Correo Institucional" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Extensión" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Vigencia de la TIA" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fotografía de la TIA" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Licencia de Manejo" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Tipo de licencia" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Licencia Vigencia" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Fotografia de licencia" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Edad" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Cumpleaños" text;
ALTER TABLE public.agenda_2026 ADD COLUMN IF NOT EXISTS "Doc. Para ingreso" text;


-- 4) ?ndice ?nico requerido para upsert por No. Empleado
CREATE UNIQUE INDEX IF NOT EXISTS agenda_2026_num_empleado_unique
  ON public.agenda_2026 ("No. Empleado");

-- 5) Marcar como Baja los registros existentes que ya no aparecen en el Excel vigente
UPDATE public.agenda_2026
SET "Estatus" = 'Baja'
WHERE "No. Empleado" IS NOT NULL
  AND btrim("No. Empleado"::text) <> ''
  AND "No. Empleado"::text NOT IN ('320', '1602', '1151', '754-2', '1020', '222', '990', '1686', '1305', '1537-2', '1224', '1064-2', '1135', '676', '1723', '95-2', '12-2´', '319-2', '1501', '654', '1369', '678', '52', '574', '1502', '713', '1477-2', '1468-2', '471', '206', '642', '18', '32', '1593', '1442', '1610', '245', '1559', '1067', '884', '1213', '847', '402', '525', '575', '48', '576', '1260', '655', '537', '1130', '23', '24', '1394-3', '26', '266', '1484', '543', '33', '944', '1043', '1411-2', '274', '1139', '674', '1466-3', '1551', '56-2', '1161', '669', '902', '1519', '1203', '31', '34', '35', '17', '1202', '1001', '538', '40', '41', '1254', '43', '289', '577', '927', '526', '1154', '204', '675', '579', '44', '1405', '46', '1600', '1639', '1503', '569', '51', '1467-3', '194', '565', '1486', '1304', '1320', '1504', '1677-2', '1606', '1289', '1724', '1443', '36', '1014', '916', '466', '1230', '261', '59', '663', '1255', '58', '1531', '1397-3', '61', '891', '20', '64', '946', '905', '1529', '1155', '1544-2', '1091', '1290', '1482', '62-2', '1558', '1679', '978', '1489-3', '22', '1015', '488', '57', '666', '1357', '1358', '1414-2', '49', '71', '72', '73', '582', '428', '521', '910', '1375-2', '429', '1370', '452', '493', '1157', '1081', '290', '1306', '504', '1460', '1376-2', '494', '1310', '688', '686', '1051', '1434', '1625', '257', '947', '197', '1588', '1229', '1123', '1698', '284', '207', '463', '764', '81', '510', '502', '1163', '724', '85', '755-2', '458', '477', '753', '250', '512', '932', '573', '751', '794', '1164', '487', '632', '408', '200-3', '677', '643', '1133', '1364', '953', '1106', '547', '1248', '1267', '1725', '513', '1603', '1444', '1612', '544', '1268', '249', '1092', '1398-2', '1441', '292', '1321', '1691', '1200', '583-2', '1615', '823', '1059', '1279', '744', '467', '1226', '363', '1322', '1237', '1147-2', '1227', '1057', '1685', '987', '1225', '1008', '461', '219', '1250', '991', '1204', '1607', '1483', '635', '255', '1118', '935', '660', '1292', '650', '943', '1044', '651', '518', '968', '1108', '1071', '1299-2', '359', '364', '1115-2', '963', '472', '1399-2', '976', '974', '801', '484', '710', '268', '302', '1435', '639', '609', '641', '1242', '659-3', '432-2', '1448', '491', '90', '1160', '456', '379', '1687', '1138', '873', '1635', '903', '942', '936', '696', '1378-2', '516', '819', '1295', '1452', '839', '1462', '478', '1712', '1011', '806', '804', '814', '1169', '959', '365', '247', '293', '1187', '515', '1617', '1506', '469', '728', '1211', '585', '809', '1522', '318', '1023', '1199', '539', '668', '981', '739', '1315', '1223', '94', '778', '1720', '55', '581', '1252', '1312', '54', '745', '1599', '1022', '1078', '1288', '227', '91-3', '1351-2', '1353-2', '1572-2', '1683', '1333-2', '1331-2', '1332-2', '1343-2', '1327-2', '1334-2', '1346-2', '1389-2', '1335-2', '1354-2', '1328-2', '1336-2', '1350-2', '1337-2', '1344-2', '1348-3', '1403-2', '1352-2', '1330-2', '1338-2', '1345-2', '1339-2', '1349-2', '1329-2', '1340-2', '1341-2', '1342-2', '60-2', '1665', '1553-2', '1457-2', '1459-2', '1660-2', '1541-2', '1542-2', '1526-2', '1417-2', '1413-2', '1440-2', '1670', '1647', '1699', '1701', '1706', '1666', '1697', '1451-2', '1630-2', '1415-2', '1525-2', '1648', '288-2', '1395-3', '1418-3', '1657', '1696', '703-3', '1212-2', '1649', '1621-2', '1563-2', '1564-2', '1565-2', '1695', '1377-2', '1730', '1667', '1732', '1469-2', '1470-2', '1661', '1580-2', '1652', '1731', '1439-2', '1715', '1618-2', '1643', '1663', '1614-2', '1436-2', '1458-2', '1555-2', '1510-2', '1543-2', '1664', '1400-2', '1396-3', '1708', '1719', '1727', '590', '1693', '1205', '1412-2', '1590-2', '986');
COMMIT;
