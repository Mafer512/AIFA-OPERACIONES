const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const excelName = '879F15DD-35D5-49FB-BE8C-8D45E7200D11INVENTARIO GENERAL EQPS. KW, RUGGEAR Y ICOM 2026.xlsx';
const workbook = XLSX.readFile(path.join(root, excelName), { cellDates: true });
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cell = (sheet, address) => sheet[address]?.v ?? '';
const sql = value => value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
const date = value => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const months = { ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12 };
  const m = text(value).toUpperCase().match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚ]{3})\.?\s+(\d{4})$/);
  if (m && months[m[2]]) return `${m[3]}-${String(months[m[2]]).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const d = new Date(value); return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0,10);
};
const rows = [];
function add(r) { rows.push({ tipo_registro:'individual', cantidad:1, ...r }); }

let s = workbook.Sheets['422 EQUIPOS KW '];
for (let r=7;r<=428;r++) add({familia:'Equipo KW',descripcion:'Equipo de radiocomunicación KW',numero_serie:text(cell(s,`A${r}`)),numero_control:text(cell(s,`B${r}`)),area_responsable:text(cell(s,`C${r}`)),resguardo_folio:text(cell(s,`D${r}`)),fecha_resguardo:date(cell(s,`E${r}`)),responsable:text(cell(s,`F${r}`)),observaciones:text(cell(s,`G${r}`)),fuente_hoja:'422 EQUIPOS KW ',fuente_fila:r,fuente_indice:0});
s = workbook.Sheets['49 RUGGEAR'];
for (let r=8;r<=57;r++) add({familia:'Radio RugGear RG72S',descripcion:'Radio RugGear modelo RG72S',numero_serie:text(cell(s,`C${r}`)).replace(/\s+/g,''),numero_control:text(cell(s,`B${r}`)),area_responsable:text(cell(s,`D${r}`)),resguardo_folio:text(cell(s,`E${r}`)),fecha_resguardo:date(cell(s,`F${r}`)),responsable:text(cell(s,`G${r}`)),fuente_hoja:'49 RUGGEAR',fuente_fila:r,fuente_indice:0});
s = workbook.Sheets['RESGUARDOS 70 RADIOS MOVILES 1'];
for (let r=3;r<=72;r++) add({familia:'Radio móvil ICOM IC-F6123D',descripcion:'Radio móvil digital ICOM IC-F6123D NXDN',numero_serie:text(cell(s,`A${r}`)),area_responsable:text(cell(s,`B${r}`)),numero_economico:text(cell(s,`C${r}`)),resguardo_folio:text(cell(s,`D${r}`)),fecha_resguardo:date(cell(s,`E${r}`)),responsable:text(cell(s,`F${r}`)),vehiculo_ubicacion:text(cell(s,`G${r}`)),fuente_hoja:'RESGUARDOS 70 RADIOS MOVILES 1',fuente_fila:r,fuente_indice:0});
s = workbook.Sheets['11 RADIOS BASE DIGITAL NXDN'];
for (let r=6;r<=16;r++) add({familia:'Radio base ICOM IC-F6123D',descripcion:'Radio base digital ICOM IC-F6123D NXDN',numero_serie:text(cell(s,`C${r}`)),numero_control:text(cell(s,`B${r}`)),area_responsable:text(cell(s,`D${r}`)),numero_economico:text(cell(s,`F${r}`)),resguardo_folio:text(cell(s,`G${r}`)),responsable:text(cell(s,`H${r}`)),vehiculo_ubicacion:text(cell(s,`I${r}`)),fuente_hoja:'11 RADIOS BASE DIGITAL NXDN',fuente_fila:r,fuente_indice:0});
s = workbook.Sheets.TELECOM;
const telecomDesc = text(cell(s,'B4'));
text(cell(s,'C4')).replace(/\.$/,'').split(',').map(text).filter(Boolean).forEach((serie,i)=>add({familia:'Repetidor UHF',descripcion:telecomDesc,numero_serie:serie,observaciones:text(cell(s,'F4')),fuente_hoja:'TELECOM',fuente_fila:4,fuente_indice:i}));
for (const [r,amount] of [[5,4],[6,8],[7,8],[8,2],[9,2],[10,3],[11,20]]) add({tipo_registro:'lote',familia:'Equipo de telecomunicaciones',descripcion:text(cell(s,`B${r}`)),numero_serie:null,numero_control:text(cell(s,`A${r}`)),cantidad:amount,observaciones:text(cell(s,`F${r}`)),fuente_hoja:'TELECOM',fuente_fila:r,fuente_indice:0});
s = workbook.Sheets.AEREOS;
const aerialDesc=text(cell(s,'B4')), aerialObs=text(cell(s,'E4'));
['24002778','24002779','24002780'].forEach((serie,i)=>add({familia:'Radio aéreo ICOM IC-A120',descripcion:aerialDesc,numero_serie:serie,area_responsable:'Dirección de Operación',observaciones:aerialObs,fuente_hoja:'AEREOS',fuente_fila:4,fuente_indice:i}));

const serials = rows.map(r=>r.numero_serie).filter(Boolean);
const duplicates = [...new Set(serials.filter((v,i)=>serials.indexOf(v)!==i))];
if (duplicates.length) throw new Error(`Series duplicadas: ${duplicates.join(', ')}`);
if (rows.reduce((n,r)=>n+r.cantidad,0)!==613) throw new Error('El total físico no coincide con 613.');

const columns=['tipo_registro','familia','descripcion','numero_serie','numero_control','cantidad','area_responsable','numero_economico','resguardo_folio','fecha_resguardo','responsable','vehiculo_ubicacion','observaciones','fuente_hoja','fuente_fila','fuente_indice'];
const values=rows.map(r=>`(${columns.map(c=>['cantidad','fuente_fila','fuente_indice'].includes(c)?Number(r[c]??0):sql(r[c])).join(',')})`);
const seed=`-- Generado desde ${excelName}; no incluye documentos.\nINSERT INTO public.muebles_bienes (${columns.join(',')}) VALUES\n${values.join(',\n')}\nON CONFLICT (fuente_hoja,fuente_fila,fuente_indice) DO UPDATE SET\n${columns.slice(0,13).map(c=>`  ${c}=EXCLUDED.${c}`).join(',\n')};\n`;
fs.writeFileSync(path.join(root,'supabase','migrations','012_muebles_bienes_import.sql'),seed,'utf8');
fs.writeFileSync(path.join(root,'muebles_bienes_import_auditoria.json'),JSON.stringify({source:excelName,sheets:workbook.SheetNames,databaseRows:rows.length,physicalUnits:rows.reduce((n,r)=>n+r.cantidad,0),individualRows:rows.filter(r=>r.tipo_registro==='individual').length,lotRows:rows.filter(r=>r.tipo_registro==='lote').length,explicitSerials:serials.length,duplicateSerials:duplicates,rowsWithoutValidResguardo:rows.filter(r=>!/^((DO\/CA|CA\/EC)\/\d+)$/i.test(r.resguardo_folio||'')).length,byFamily:Object.entries(rows.reduce((a,r)=>(a[r.familia]=(a[r.familia]||0)+r.cantidad,a),{})).map(([family,units])=>({family,units}))},null,2),'utf8');
console.log(JSON.stringify({rows:rows.length,units:rows.reduce((n,r)=>n+r.cantidad,0),individual:rows.filter(r=>r.tipo_registro==='individual').length,lots:rows.filter(r=>r.tipo_registro==='lote').length,serials:serials.length},null,2));
