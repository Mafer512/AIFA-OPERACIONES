# Contratos de Modulo

## Proposito

Cada modulo debe tener un contrato minimo para que humanos e IA puedan modificarlo sin romper navegacion, permisos o datos.

## Contrato recomendado

```md
## Modulo: Nombre

- Seccion: `clave`
- DOM host: `#clave-section`
- Menu: `.menu-item[data-section="clave"]`
- Archivos frontend:
- Inicializador:
- Funciones globales expuestas:
- Tablas Supabase:
- RPCs:
- Storage buckets:
- Realtime:
- Roles/permisos:
- Pruebas:
- Riesgos:
```

## Modulos iniciales a inventariar

### Operaciones Totales

- Seccion: `operaciones-totales`
- Riesgo: modulo central y pantalla inicial.
- Datos: operaciones historicas, `monthly_operations`, `annual_operations`, `daily_operations`.

### Inicio / Itinerario Diario

- Seccion: `inicio`
- Datos: `flights`, `vuelos_parte_operaciones`.
- Riesgo: filtros, resumen por aerolinea, graficas y tablas dependen de estado global.

### Parte de Operaciones

- Seccion: `parte-operaciones`
- Datos: `parte_operations`, `custom_parte_operaciones`, `vuelos_parte_operaciones`, `vuelos_parte_operaciones_csv`.
- Storage: PDFs de parte de operaciones.
- Riesgo: mezcla de cache local, API Express y Supabase.

### Conciliacion

- Seccion: `conciliacion`
- Datos: `Conciliacion Manifiestos`, manifiestos, vuelos.
- Riesgo: edicion inline y normalizacion de datos historicos.

### Manifiestos

- Secciones relacionadas: portal, pasajeros, carga, analisis.
- Datos: `manifiestos_pasajeros`, `manifiestos_pdfs`, tablas historicas de carga/pasajeros.
- Storage: PDFs y resguardos.
- Riesgo: OCR/PDF, campos con nombres historicos y formatos heterogeneos.

### Administracion de Usuarios

- Seccion: `admin-usuarios`
- Datos: `user_roles`, `usuarios_aplicaciones`, `areas`, `v_usuarios_roles`.
- RPCs: `admin_create_user_role`, `admin_update_user_role`, `admin_update_user_permissions`, `admin_delete_user`, `admin_assign_operaciones_access`.
- Riesgo: modulo de mayor sensibilidad.

### Agenda

- Seccion: `agenda`
- Datos: `agenda_comites`, `agenda_reuniones`, `agenda_acuerdos`, `agenda_temas`, `agenda_2026`.
- Integraciones: WhatsApp, push, Edge Functions.
- Riesgo: permisos por area y notificaciones.

### Miscelanea

- Seccion: `miscelanea`.
- DOM host: `#miscelanea-section`.
- Menu: `.menu-item[data-section="miscelanea"]`.
- Archivo frontend: `js/miscelanea.js`.
- Inicializador: `window.miscelaneaModule.init()` (idempotente).
- Modal: `#miscelanea-modal`, con accesos `directorio` y `marca-agua`.
- Datos, RPCs, Storage y Realtime: ninguno en la fase de shell.
- Permisos: `allowed_sections` y `section_levels`; admin/superadmin tienen acceso total.
- Pruebas: `__tests__/miscelanea.test.js`.
- Riesgos: Directorio puede contener datos personales y Marca de agua procesara
  archivos; ambos requieren una especificacion de seguridad independiente antes
  de implementar su funcionalidad.

## Regla para nuevos modulos

Ningun modulo nuevo debe agregarse sin:

- `data-section` definido.
- `content-section` correspondiente.
- permiso esperado.
- tablas/RPCs documentadas.
- inicializador idempotente.
- prueba o checklist de validacion.

