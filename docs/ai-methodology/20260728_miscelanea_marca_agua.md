# OpenSpec — Miscelánea: Marca de agua verificable

Fecha: 2026-07-28  
Estado: implementación lista para despliegue de base de datos

## Alcance

- Acepta PDF y Word `.docx` de hasta 15 MB; un `.doc` legado se rechaza de forma explícita porque no es seguro modificarlo sin una conversión controlada.
- Inserta `AIFA - AIFA1.<token>` en todas las páginas de PDF o en la cabecera de cada sección DOCX.
- El token cifra con AES-256-GCM el nombre de documento, la fecha UTC, el nombre/ID del usuario y un UUID de registro.
- Registra el token, hash SHA-256 del original y auditoría de validaciones en Supabase.
- El validador descifra el token en backend y confirma que su UUID exista en `document_watermarks`.

## Contrato y seguridad

| Elemento | Decisión |
| --- | --- |
| Sección | `miscelanea`; misma regla `allowed_sections` que el menú |
| API | `POST /api/miscelanea/marca-agua/process`, `POST /api/miscelanea/marca-agua/validate` |
| Autenticación | JWT Supabase obligatorio; backend consulta `can_use_miscelanea()` |
| Cifrado | AES-256-GCM, nonce aleatorio de 96 bits; clave exclusivamente en `WATERMARK_ENCRYPTION_KEY` |
| Persistencia | `public.document_watermarks`; no se guardan documentos cargados |
| RLS | sólo inserción del propietario; validación mediante RPC `SECURITY DEFINER` limitada a usuarios con Miscelánea |

## Despliegue

1. Ejecutar [create_document_watermarks.sql](../../db/create_document_watermarks.sql) en Supabase SQL Editor.
2. Configurar en el servidor una clave estable de 32 bytes en Base64URL:
   `WATERMARK_ENCRYPTION_KEY=<valor generado con crypto.randomBytes(32).toString('base64url')>`.
3. Reiniciar el servidor Node. No poner esta variable en `index.html`, `APP_CONFIG` ni el repositorio.

## Pruebas y rollback

- Unitarias: `npm test -- watermark-service.test.js` verifica cifrado, alteración de token, PDF legible y estructura DOCX.
- Smoke: usuario con `miscelanea` carga un PDF, descarga la copia, pega el código y recibe validación positiva; usuario sin permiso recibe 403 de API.
- Rollback de aplicación: retirar las rutas y el script del cliente. No eliminar registros de auditoría. Si se revoca el módulo, revocar `EXECUTE` de las dos funciones para `authenticated`.
