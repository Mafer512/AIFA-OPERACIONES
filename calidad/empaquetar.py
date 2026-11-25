# -*- coding: utf-8 -*-
"""Genera el ZIP del módulo:  python empaquetar.py
Incluye solo lo necesario para integrarlo; todo queda dentro de la carpeta calidad/."""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
OUT = ROOT / 'paquete' / f'modulo-calidad-v{VERSION}.zip'
FILES = ['index.html', 'login.html', 'modulo.js', 'INTEGRACION.md']
DIRS = ['css', 'js', 'images', 'vendor']
UNUSED = {'images/torre.webp', 'images/pista-noche.webp'}  # no los usa ninguna pantalla

paths = [ROOT / f for f in FILES]
for d in DIRS:
    paths += sorted(p for p in (ROOT / d).rglob('*') if p.is_file())

OUT.parent.mkdir(exist_ok=True)
count = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in paths:
        rel = p.relative_to(ROOT).as_posix()
        if rel in UNUSED:
            continue
        z.write(p, 'calidad/' + rel)
        count += 1
print(f'{OUT}  ({count} archivos, {OUT.stat().st_size / 1024:.0f} KB)')
