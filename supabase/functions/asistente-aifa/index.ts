// @ts-nocheck — Este archivo se ejecuta en Deno (Supabase Edge Functions), no
// en Node ni en el navegador. Sin esta línea, el editor lo revisa con la
// configuración del resto del proyecto y marca como error el objeto `Deno`,
// que en su entorno real sí existe. Para tener verificación de tipos de verdad
// aquí, instalar la extensión "Deno" de VS Code y activarla sólo para esta
// carpeta (deno.enablePaths: ["supabase/functions"]).
// =============================================================================
// AIFA OPERACIONES · Asistente — proxy seguro hacia Groq
//
// Por qué existe esta función:
//   La API key del modelo NUNCA debe viajar al navegador (cualquiera la lee
//   desde las herramientas de desarrollo). Esta función vive en Supabase — no
//   en el hosting web — así que funciona igual con Hostinger, Vercel o
//   cualquier otro servidor de archivos estáticos.
//
// Qué hace (y qué NO hace):
//   Es un proxy delgado: recibe la conversación + las herramientas declaradas,
//   se lo reenvía a Groq con la key secreta y devuelve la respuesta tal cual.
//   NO ejecuta las herramientas. Eso ocurre en el navegador, con la sesión de
//   Supabase del usuario que ya inició sesión, para que las políticas de
//   seguridad por fila (RLS) apliquen automáticamente: cada quien sólo puede
//   consultar los datos que le corresponden.
//
// Despliegue:
//   supabase secrets set GROQ_API_KEY=...
//   supabase functions deploy asistente-aifa
// =============================================================================

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO_POR_DEFECTO = 'llama-3.3-70b-versatile';

// Orígenes autorizados. Se puede ampliar con la variable ORIGENES_PERMITIDOS
// (separada por comas) sin volver a desplegar código.
const ORIGENES_BASE = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function origenesPermitidos(): string[] {
  const extra = (Deno.env.get('ORIGENES_PERMITIDOS') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...ORIGENES_BASE, ...extra];
}

function cabecerasCors(origin: string | null): Record<string, string> {
  const permitidos = origenesPermitidos();
  // Mientras no se configure ORIGENES_PERMITIDOS se acepta el origen que
  // llama, para no bloquear la puesta en marcha; en cuanto exista, manda ella.
  const abierto = !Deno.env.get('ORIGENES_PERMITIDOS');
  const ok = origin && (abierto || permitidos.includes(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : permitidos[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// La anon key es pública (viaja dentro del JavaScript de la app), así que por
// sí sola no prueba nada: cualquiera que la copie podría gastar la cuota del
// modelo. Con EXIGIR_USUARIO=1 sólo se atiende a quien inició sesión de
// verdad. No hace falta validar la firma del token: Supabase ya la verificó
// antes de que la petición llegue aquí, así que basta con leer el rol.
function haySesionDeUsuario(req: Request): boolean {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const parte = token.split('.')[1];
    if (!parte) return false;
    const claims = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')));
    return claims.role === 'authenticated' && !!claims.sub;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = cabecerasCors(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (Deno.env.get('EXIGIR_USUARIO') === '1' && !haySesionDeUsuario(req)) {
    return new Response(
      JSON.stringify({ error: 'Necesitas iniciar sesión en la plataforma para usar el asistente.' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Falta configurar GROQ_API_KEY como secret de la función.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const messages = cuerpo.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'Se requiere "messages"' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Sólo se reenvían campos conocidos: evita que desde el navegador se puedan
  // inyectar parámetros arbitrarios hacia el proveedor.
  const payload: Record<string, unknown> = {
    model: typeof cuerpo.model === 'string' ? cuerpo.model : MODELO_POR_DEFECTO,
    messages,
    temperature: typeof cuerpo.temperature === 'number' ? cuerpo.temperature : 0.3,
    max_tokens: typeof cuerpo.max_tokens === 'number' ? Math.min(cuerpo.max_tokens, 4096) : 1600,
  };
  if (Array.isArray(cuerpo.tools) && cuerpo.tools.length) {
    payload.tools = cuerpo.tools;
    payload.tool_choice = cuerpo.tool_choice ?? 'auto';
  }

  try {
    const respuesta = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    // Se devuelve el cuerpo tal cual (incluidos los errores del proveedor)
    // para que el navegador pueda explicar con precisión qué pasó.
    const texto = await respuesta.text();
    return new Response(texto, {
      status: respuesta.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `No se pudo contactar al proveedor: ${(err as Error).message}` }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
