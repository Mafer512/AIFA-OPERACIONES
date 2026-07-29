# Despliegue — Marca de agua desde GitHub Pages

El sitio público se hospeda en GitHub Pages y el desarrollo visual local usa
Live Server (`127.0.0.1:5500`). Ambos son servidores estáticos: no ejecutan
`server.js`, no leen `.env` y no pueden conservar una clave de cifrado.

La implementación se procesa en la Edge Function:

`supabase/functions/watermark-documents/index.ts`

## Configuración en Supabase

1. Abrir el proyecto de Supabase `fgstncvuuhpgyzmjceyr`.
2. Ir a **Edge Functions → Secrets**.
3. Crear `WATERMARK_ENCRYPTION_KEY` con un valor nuevo de 32 bytes Base64URL.
   No reutilizar un valor compartido por chat, correo o GitHub.
4. Ir a **Edge Functions → Deploy a new function → Via Editor**, nombrarla
   `watermark-documents`, pegar el contenido de `index.ts` y desplegarla.
5. El SQL de `db/create_document_watermarks.sql` debe estar aplicado.

La función queda disponible en:

`https://fgstncvuuhpgyzmjceyr.supabase.co/functions/v1/watermark-documents`

## Flujo de publicación

- GitHub Pages publica HTML/JS/CSS al hacer push a la rama configurada.
- Supabase Edge Functions se despliegan por separado, usando Dashboard o
  `supabase functions deploy watermark-documents`.
- Los secretos se guardan solo en Supabase; nunca en GitHub Pages ni en
  `index.html`.
