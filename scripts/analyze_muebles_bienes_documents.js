const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const pdfDir = path.join(root, 'carpeta pdfs');
const workbook = XLSX.readFile(path.join(root, '879F15DD-35D5-49FB-BE8C-8D45E7200D11INVENTARIO GENERAL EQPS. KW, RUGGEAR Y ICOM 2026.xlsx'), { raw: false });
const normalizeFolio = value => String(value ?? '').toUpperCase().replace(/-/g, '/').replace(/\s+/g, '');
const folios = new Map();
for (const [sheetName, column, start, end] of [
  ['422 EQUIPOS KW ', 'D', 7, 428],
  ['49 RUGGEAR', 'E', 8, 57],
  ['RESGUARDOS 70 RADIOS MOVILES 1', 'D', 3, 72]
]) {
  const sheet = workbook.Sheets[sheetName];
  for (let row=start; row<=end; row++) {
    const folio=normalizeFolio(sheet[`${column}${row}`]?.w ?? sheet[`${column}${row}`]?.v);
    if (/^(DO\/CA|CA\/EC)\/\d+$/.test(folio)) folios.set(folio,(folios.get(folio)||0)+1);
  }
}

const files = fs.readdirSync(pdfDir).filter(name => /\.pdf$/i.test(name));
const records = files.map(name => {
  const bytes=fs.readFileSync(path.join(pdfDir,name));
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const match=name.match(/(?:DO|CA)-CA-(\d{2,4})|CA-EC-(\d{2,4})/i);
  const folio=match?normalizeFolio(match[1]?`DO/CA/${match[1]}`:`CA/EC/${match[2]}`):null;
  const serial=(name.match(/\bC1[A-Z0-9]{6}\b/i)||[])[0]||null;
  const exactFolio=folio&&folios.has(folio);
  return {name,size:bytes.length,sha256:hash,folio,serial,association:exactFolio?'exact_folio':serial==='C1C13418'?'exact_serial':'pending',matchedGoods:exactFolio?folios.get(folio):serial?1:0};
});
const groups=new Map();records.forEach(r=>{if(!groups.has(r.sha256))groups.set(r.sha256,[]);groups.get(r.sha256).push(r.name)});
const unique=records.filter(r=>groups.get(r.sha256)[0]===r.name);
const report={physicalFiles:records.length,uniqueFiles:unique.length,exactDuplicates:[...groups.entries()].filter(([,names])=>names.length>1).map(([sha256,names])=>({sha256,names})),exactFolioFiles:unique.filter(r=>r.association==='exact_folio').length,exactSerialFiles:unique.filter(r=>r.association==='exact_serial').length,pendingFiles:unique.filter(r=>r.association==='pending').length,goodsCoveredByExactFolios:unique.filter(r=>r.association==='exact_folio').reduce((n,r)=>n+r.matchedGoods,0),files:unique};
fs.writeFileSync(path.join(root,'muebles_bienes_documentos_auditoria.json'),JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({physicalFiles:report.physicalFiles,uniqueFiles:report.uniqueFiles,duplicates:report.exactDuplicates.length,exactFolioFiles:report.exactFolioFiles,exactSerialFiles:report.exactSerialFiles,pendingFiles:report.pendingFiles,goodsCoveredByExactFolios:report.goodsCoveredByExactFolios},null,2));
