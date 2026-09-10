/* ==========================================================================
   Construye plantillas/presentacion-carga.pptx a partir de la baraja original
   --------------------------------------------------------------------------
   Uso:
       node scripts/construye-plantilla-carga.js "PRESENTACION CARGA 30 AGOSTO 2026.pptx"

   Deja el mismo diseño sin cifras: los números pasan a ser marcadores {{...}}
   que js/conci-presentacion-carga.js sustituye al descargar, y las tarjetas de
   las diapositivas 3 a 6 —en la original, una imagen EMF con las cifras de su
   fecha— se quitan, porque el generador las vuelve a dibujar con formas
   nativas y sus logotipos. Los metadatos quedan a nombre de AIFA: la baraja
   original traía nombres de personas y el repositorio es público.

   Hay que volver a correrlo solo si cambia el diseño de la baraja. Si cambia
   el orden de la tabla de la diapositiva 2, hay que actualizar HOJA1 aquí y
   AEROLINEAS en js/conci-carga-catalogo.js, que deben coincidir.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ORIGEN = process.argv[2];
const DESTINO = path.join(__dirname, '..', 'plantillas', 'presentacion-carga.pptx');

if (!ORIGEN || !fs.existsSync(ORIGEN)) {
  console.error('Uso: node scripts/construye-plantilla-carga.js <baraja original .pptx>');
  process.exit(1);
}

// Orden fijo de la tabla de la diapositiva 2 (la Hoja 1 del libro).
const HOJA1 = [
  'AERONAVES TSM', 'AEROUNIÓN', 'AIR CANADA', 'AIR FRANCE CARGO', 'AMERIJET', 'CARGOJET', 'CARGOLUX',
  'CATHAY PACIFIC', 'COPA CARGO', 'DHL GUATEMALA', 'EMIRATES', 'ESTAFETA', 'LUFTHANSA CARGO', 'MAS DE CARGA',
  'QATAR', 'TM AEROLINEAS', 'TURKISH CARGO', 'UPS',
  'AEROMÉXICO', 'CONVIASA', 'MEXICANA', 'VIVA AEROBUS', 'VOLARIS',
  'ABSA', 'ABX AIR', 'AERO SUCRE', 'AEROLINEAS ARGENTINAS CARGO', 'AIR CHINA CARGO', 'AIR EXPRESS',
  'ATLAS AIR INC', 'BERRY AVIATION INC', 'CHINA SOUTHERN CARGO', 'ETHIOPIAN CARGO', 'EVERST AIR CARGO', 'FEDEX',
  'GALISTAIR', 'GLOBAL CROSSING AIRLINES', 'IFL GROUP', 'KALITTA AIR', 'KALITTA CHARTERS', 'LAN CARGO',
  'LATAM CARGO', 'LYNDEN AIR CARGO', 'MCNEELY CHARTER', 'NATIONAL AIR CARGO GROUP', 'SAUDI CARGO', 'SILKWAY WEST',
  'SKY LEASE CARGO', 'SUPARNA AIRLINES', 'UKRAINE', 'UNIWORLD AIR CARGO', 'WESTERN GLOBAL', 'USAJET',
  'LEGENDS AIRWAYS', 'CAVOK AIR', 'CHINA CARGO AIRLINES', 'AIR ATLANTA EUROPE', 'AMERISTAR AIR CARGO'
];

const T = '<a:t(?: [^>]*)?>';
const escaparRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function reemplazarUnico(xml, viejo, nuevo) {
  const re = new RegExp(`${T}${escaparRe(viejo)}</a:t>`, 'g');
  const hallazgos = xml.match(re) || [];
  if (hallazgos.length !== 1) throw new Error(`"${viejo}" aparece ${hallazgos.length} veces`);
  return xml.replace(re, `<a:t>${nuevo}</a:t>`);
}

const textoDe = tc => [...tc.matchAll(new RegExp(`${T}([\\s\\S]*?)</a:t>`, 'g'))].map(m => m[1]).join('').trim();

/** Deja el texto de la celda en un solo tramo: el primero lleva el valor. */
function fijarTexto(tc, texto) {
  let primero = true;
  const nuevo = tc.replace(new RegExp(`${T}[\\s\\S]*?</a:t>`, 'g'), () => {
    if (primero) { primero = false; return `<a:t>${texto}</a:t>`; }
    return '<a:t></a:t>';
  });
  if (primero) throw new Error(`celda sin tramo de texto para ${texto}`);
  return nuevo;
}

/** Aplica fn(fila, columna, celda) a la tabla de nombre dado. */
function editarTabla(xml, nombre, fn) {
  let hallada = false;
  const salida = xml.replace(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g, marco => {
    if (!marco.includes(`name="${nombre}"`)) return marco;
    hallada = true;
    let fila = -1;
    return marco.replace(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g, tr => {
      fila++;
      let col = -1;
      return tr.replace(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g, tc => { col++; return fn(fila, col, tc); });
    });
  });
  if (!hallada) throw new Error(`No se encontró la tabla ${nombre}`);
  return salida;
}

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(ORIGEN));
  const leer = p => zip.file(p).async('string');

  // Portada: el mes.
  let s1 = await leer('ppt/slides/slide1.xml');
  const MES_ANIO = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+20\d\d$/i;
  const mesPortada = [...s1.matchAll(new RegExp(`${T}([\\s\\S]*?)</a:t>`, 'g'))]
    .map(m => m[1]).find(t => MES_ANIO.test(t.trim()));
  if (!mesPortada) throw new Error('No se ubicó el mes de la portada');
  s1 = reemplazarUnico(s1, mesPortada, '{{MES_ANIO}}');
  zip.file('ppt/slides/slide1.xml', s1);

  // Resumen de la terminal: fecha del título, conteos, años, día, acumulado y la tabla de aerolíneas.
  let s2 = await leer('ppt/slides/slide2.xml');
  const titulo = [...s2.matchAll(new RegExp(`${T}([\\s\\S]*?)</a:t>`, 'g'))].map(m => m[1]);
  const iDia = titulo.findIndex((t, i) => /^\d{1,2}$/.test(t) && /al\s*$/.test(titulo[i - 1] || ''));
  if (iDia < 0) throw new Error('No se ubicó el día del título de la diapositiva 2');
  s2 = reemplazarUnico(s2, titulo[iDia], '{{DIA}}');
  s2 = reemplazarUnico(s2, titulo[iDia + 1], ' {{MES_CORTO_ANIO}}');
  s2 = editarTabla(s2, 'Tabla 1', (f, c, tc) =>
    (c === 0 && f >= 1 && f <= 3) ? fijarTexto(tc, ['', '{{N_REGULAR}}', '{{N_FLETAMENTO}}', '{{N_MIXTA}}'][f]) : tc);
  s2 = editarTabla(s2, 'Tabla 9', (f, c, tc) => {
    if (f >= 1 && f <= 4) {
      if (c === 0) return fijarTexto(tc, `{{ANIO_${f}_ETQ}}`);
      if (c === 2) return fijarTexto(tc, `{{ANIO_${f}_OPS}}`);
      if (c === 3) return fijarTexto(tc, `{{ANIO_${f}_TON}}`);
    }
    if (f === 5) {
      if (c === 1) return fijarTexto(tc, '{{DIA_FECHA}}');
      if (c === 2) return fijarTexto(tc, '{{DIA_OPS}}');
      if (c === 3) return fijarTexto(tc, '{{DIA_TON}}');
    }
    if (f === 6) {
      if (c === 2) return fijarTexto(tc, '{{ACUM_OPS}}');
      if (c === 3) return fijarTexto(tc, '{{ACUM_TON}}');
    }
    return tc;
  });
  const nombresTabla3 = [];
  s2 = editarTabla(s2, 'Tabla 3', (f, c, tc) => {
    if (f >= 1 && f <= HOJA1.length) {
      if (c === 0) { nombresTabla3.push(textoDe(tc)); return tc; }
      if (c === 1) return fijarTexto(tc, `{{H1_OPS_${f}}}`);
      if (c === 2) return fijarTexto(tc, `{{H1_TON_${f}}}`);
    }
    if (f === HOJA1.length + 1) {
      if (c === 1) return fijarTexto(tc, '{{H1_OPS_TOTAL}}');
      if (c === 2) return fijarTexto(tc, '{{H1_TON_TOTAL}}');
    }
    return tc;
  });
  const distintos = HOJA1.map((n, i) => [n, nombresTabla3[i]]).filter(([a, b]) => a !== b);
  if (nombresTabla3.length !== HOJA1.length || distintos.length) {
    throw new Error(`La tabla de la diapositiva 2 no trae el orden esperado: ${JSON.stringify(distintos)}`);
  }
  zip.file('ppt/slides/slide2.xml', s2);

  // Tarjetas: fuera la imagen EMF con las cifras de la fecha original.
  for (const n of [3, 4, 5, 6]) {
    const ruta = `ppt/slides/slide${n}.xml`;
    const rutaRels = `ppt/slides/_rels/slide${n}.xml.rels`;
    let xml = await leer(ruta);
    let rels = await leer(rutaRels);
    for (const rel of rels.match(/<Relationship\b[^>]*\/>/g) || []) {
      const destino = (rel.match(/Target="([^"]+)"/) || [])[1] || '';
      if (!/\.emf$/i.test(destino)) continue;
      const id = rel.match(/Id="([^"]+)"/)[1];
      const antes = xml.length;
      xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, pic => (pic.includes(`r:embed="${id}"`) ? '' : pic));
      if (xml.length === antes) throw new Error(`No se encontró la imagen ${id} en la diapositiva ${n}`);
      rels = rels.replace(rel, '');
      zip.remove('ppt/media/' + destino.replace('../media/', ''));
    }
    zip.file(ruta, xml);
    zip.file(rutaRels, rels);
  }

  // Totales: los dos números grandes, que son los únicos con cifras de miles.
  let s7 = await leer('ppt/slides/slide7.xml');
  const cifras = [...s7.matchAll(new RegExp(`${T}(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?)</a:t>`, 'g'))].map(m => m[1]);
  if (cifras.length !== 2) throw new Error(`La diapositiva 7 trae ${cifras.length} cifras en vez de 2`);
  s7 = reemplazarUnico(s7, cifras[0], '{{ACUM_OPS}}');
  s7 = reemplazarUnico(s7, cifras[1], '{{ACUM_TON}}');
  zip.file('ppt/slides/slide7.xml', s7);

  // Metadatos sin nombres de personas.
  zip.file('docProps/core.xml', (await leer('docProps/core.xml'))
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator>AIFA</dc:creator>')
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>AIFA</cp:lastModifiedBy>'));
  zip.file('docProps/app.xml', (await leer('docProps/app.xml'))
    .replace(/<Company>[\s\S]*?<\/Company>/, '<Company>AIFA</Company>')
    .replace(/<Manager>[\s\S]*?<\/Manager>/, '<Manager></Manager>'));

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  fs.writeFileSync(DESTINO, bytes);
  console.log(`plantilla: ${DESTINO} (${(bytes.length / 1048576).toFixed(2)} MB)`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
