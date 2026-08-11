/* =============================================================================
   AIFONSO · Asistente de AIFA
   js/asistente-aifa.js

   CÓMO FUNCIONA (tool calling)
   ----------------------------
   1. La persona pregunta (escribiendo o hablando).
   2. Se envía la conversación al modelo JUNTO CON la lista de herramientas
      disponibles (declaradas en asistente-aifa-datos.js).
   3. El modelo NO responde con datos: responde "llama a contar_rutas con
      tipo=internacional".
   4. Este código ejecuta esa consulta real contra Supabase y le devuelve el
      resultado exacto.
   5. El modelo redacta la respuesta final usando esos números.

   Así las cifras nunca se inventan: salen siempre de la base de datos.

   DÓNDE PIENSA AIFONSO
   --------------------
   Por defecto, en OLLAMA corriendo en la misma máquina: los datos del
   aeropuerto no salen a ningún proveedor externo y no hay costo por uso.
   Si Ollama no está disponible, puede caer a la nube (Edge Function de
   Supabase) si así se configura.

   Detalle que importa: los modelos Qwen "piensan" antes de responder, y eso
   tardaba más de 40 segundos por respuesta. Con think:false bajan a ~2 s sin
   perder la capacidad de elegir herramientas. Por eso se manda siempre.
   ============================================================================= */

(function () {
    'use strict';

    const NOMBRE_FUNCION = 'asistente-aifa';       // Edge Function (nube)
    const MODELO_NUBE    = 'llama-3.3-70b-versatile';
    const MAX_VUELTAS    = 5;   // tope de ciclos herramienta→modelo
    const MAX_HISTORIAL  = 16;  // mensajes conservados entre turnos

    /* ── Preferencias guardadas ─────────────────────────────────────────── */
    const PREF = {
        get url()    { return localStorage.getItem('_aifa_ollama_url')   || 'http://localhost:11434'; },
        set url(v)   { localStorage.setItem('_aifa_ollama_url', v); },
        get modelo() { return localStorage.getItem('_aifa_ollama_modelo') || 'qwen3.5:9b'; },
        set modelo(v){ localStorage.setItem('_aifa_ollama_modelo', v); },
        // 'nube' = Edge Function (Groq) · 'local' = sólo Ollama · 'auto' = local y si falla, nube
        // Por omisión la nube: el modelo grande redacta bastante mejor y no
        // depende de que cada equipo tenga Ollama instalado y encendido.
        get donde()  { return localStorage.getItem('_aifa_donde') || 'nube'; },
        set donde(v) { localStorage.setItem('_aifa_donde', v); },
    };

    const _historial = [];
    let   _ocupado   = false;
    let   _vozActiva = localStorage.getItem('_aifa_voz') === '1';

    function _sb() {
        return window.supabaseClient || window.dataManager?.client || null;
    }
    function _datos() {
        return window.AsistenteAifaDatos || null;
    }

    /* ═══════════════════════════════════════════════════════════════════
       OLLAMA — el cerebro local
       ═══════════════════════════════════════════════════════════════════ */

    /* Ollama y la nube hablan formatos parecidos pero no iguales:
         · La nube devuelve {choices:[{message}]}; Ollama devuelve {message}.
         · En la nube "arguments" es una CADENA JSON; en Ollama es un OBJETO.
         · La nube exige tool_call_id en la respuesta de la herramienta.
       Todo se normaliza aquí para que el ciclo de más abajo no tenga que
       saber con quién está hablando. */
    function _normalizarMensaje(crudo, esOllama) {
        const m = esOllama ? crudo?.message : crudo?.choices?.[0]?.message;
        if (!m) return null;
        const llamadas = (m.tool_calls || []).map((t, i) => {
            let args = t.function?.arguments;
            if (typeof args === 'string') {
                try { args = JSON.parse(args || '{}'); } catch (_) { args = {}; }
            }
            return {
                id    : t.id || `call_${i}`,
                nombre: t.function?.name,
                args  : args || {},
                crudo : t,
            };
        });
        return { contenido: (m.content || '').trim(), llamadas, original: m };
    }

    async function _pedirAOllama({ mensajes, herramientas, temperatura, maxTokens }) {
        const url = PREF.url.replace(/\/+$/, '') + '/api/chat';
        const cuerpo = {
            model   : PREF.modelo,
            messages: mensajes,
            stream  : false,
            // Sin esto, los modelos Qwen razonan en voz alta y tardan 40 s.
            think   : false,
            options : {
                temperature: temperatura,
                num_predict: maxTokens,
            },
        };
        if (herramientas?.length) cuerpo.tools = herramientas;

        let resp;
        try {
            resp = await fetch(url, {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify(cuerpo),
            });
        } catch (err) {
            // fetch sólo falla así cuando ni siquiera se pudo conectar.
            throw new ErrorDeConexion(url);
        }

        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            if (resp.status === 404 && /model/i.test(txt)) {
                throw new Error(
                    `El modelo "${PREF.modelo}" no está descargado en Ollama.\n\n` +
                    `Descárgalo con:  ollama pull ${PREF.modelo}`
                );
            }
            throw new Error(`Ollama respondió ${resp.status}. ${txt.slice(0, 200)}`);
        }
        return _normalizarMensaje(await resp.json(), true);
    }

    /* Error propio para poder distinguir "Ollama no está" de cualquier otro
       fallo, y así explicar bien qué hacer. */
    class ErrorDeConexion extends Error {
        constructor(url) {
            super(`No se pudo conectar con Ollama en ${url}`);
            this.name = 'ErrorDeConexion';
            this.url = url;
        }
    }

    /* Revisa si Ollama está vivo y qué modelos tiene. Se usa para el panel de
       configuración y para dar diagnósticos útiles. */
    async function estadoOllama() {
        const base = PREF.url.replace(/\/+$/, '');
        try {
            const r = await fetch(base + '/api/tags', { method: 'GET' });
            if (!r.ok) return { ok: false, motivo: `respondió ${r.status}`, modelos: [] };
            const j = await r.json();
            const modelos = (j.models || []).map(m => ({
                nombre: m.name,
                tamano: m.size,
                herramientas: (m.capabilities || []).includes('tools'),
            }));
            return { ok: true, modelos, url: base };
        } catch (_) {
            // Puede ser: Ollama apagado, o el navegador bloqueando por CORS /
            // por mezclar HTTPS con HTTP. El mensaje lo aclara abajo.
            const paginaSegura = location.protocol === 'https:';
            return {
                ok: false,
                modelos: [],
                url: base,
                motivo: paginaSegura
                    ? 'La página está en HTTPS y Ollama en HTTP; el navegador bloquea esa mezcla.'
                    : 'Ollama no responde. ¿Está abierto?',
                paginaSegura,
            };
        }
    }

    /* ═══════════════════════════════════════════════════════════════════
       NUBE — Edge Function (respaldo opcional)
       ═══════════════════════════════════════════════════════════════════ */

    function _obtenerKeyLocal() {
        // Respaldo para desarrollo: reutiliza la key del asistente anterior
        // si ya estaba configurada.
        return localStorage.getItem('_aifa_groq_key')
            || localStorage.getItem('_aga_groq_key')
            || '';
    }

    // Sólo se marca cuando la función REALMENTE no existe (404). Un error
    // pasajero —un límite de uso, un corte de red— no debe inhabilitar el
    // camino bueno para el resto de la sesión.
    let _funcionAusente = false;

    const _esperar = (ms) => new Promise(r => setTimeout(r, ms));

    /* Extrae estado y mensaje reales de un error de functions.invoke().
       Sin esto el error llega como "non-2xx status code", que no le dice
       nada a nadie. */
    async function _detalleDelError(error) {
        const salida = { estado: 0, mensaje: error?.message || 'Error desconocido' };
        const ctx = error?.context;
        if (ctx && typeof ctx.status === 'number') {
            salida.estado = ctx.status;
            try {
                const cuerpo = await ctx.clone().json();
                salida.mensaje = cuerpo?.error?.message || cuerpo?.error || cuerpo?.message || salida.mensaje;
            } catch (_) {
                try { salida.mensaje = (await ctx.clone().text()).slice(0, 300) || salida.mensaje; } catch (_) {}
            }
        }
        return salida;
    }

    function _mensajeUtil(estado, mensaje) {
        if (estado === 429 || /rate.?limit|too many requests/i.test(mensaje)) {
            return 'El proveedor está limitando las consultas por exceso de uso ' +
                   '(plan gratuito). Espera un momento y vuelve a preguntar.';
        }
        if (estado === 413 || /context length|too large|maximum context/i.test(mensaje)) {
            return 'La consulta pidió demasiada información de una vez. ' +
                   'Intenta acotarla (por ejemplo, un solo tipo de operación o un rango de fechas menor).';
        }
        if (/GROQ_API_KEY/i.test(mensaje)) {
            return 'La función está publicada pero le falta el secreto GROQ_API_KEY en Supabase.';
        }
        if (estado === 401 || estado === 403) {
            return 'La función rechazó la autorización. Revisa la sesión iniciada en la plataforma.';
        }
        return mensaje;
    }

    /* Punto único de entrada: decide dónde piensa AIFONSO y devuelve siempre
       el mismo formato normalizado, venga de donde venga. */
    async function _pensar({ mensajes, herramientas, temperatura, maxTokens }) {
        const donde = PREF.donde;

        if (donde === 'local' || donde === 'auto') {
            try {
                return await _pedirAOllama({ mensajes, herramientas, temperatura, maxTokens });
            } catch (err) {
                const esConexion = err instanceof ErrorDeConexion;
                if (donde === 'local' || !esConexion) {
                    if (esConexion) throw new Error(_diagnosticoOllama(err.url));
                    throw err;
                }
                // 'auto': Ollama no está disponible, se intenta la nube.
                console.warn('[AIFONSO] Ollama no disponible, usando la nube:', err.message);
            }
        }

        const crudo = await _pedirAlModelo({
            model      : MODELO_NUBE,
            messages   : mensajes,
            tools      : herramientas,
            tool_choice: herramientas?.length ? 'auto' : undefined,
            temperature: temperatura,
            max_tokens : maxTokens,
        });
        return _normalizarMensaje(crudo, false);
    }

    /* Explica en concreto por qué no se pudo hablar con Ollama, según el
       escenario. Un "failed to fetch" a secas no le sirve a nadie. */
    function _diagnosticoOllama(url) {
        const enHttps = location.protocol === 'https:';
        let msg = `No pude conectar con Ollama en ${url}.\n\n`;
        if (enHttps) {
            msg += 'La plataforma está abierta por HTTPS y Ollama trabaja por HTTP, ' +
                   'y el navegador no permite mezclar ambos.\n\n' +
                   'Opciones: abrir la plataforma desde la red interna por HTTP, ' +
                   'o poner Ollama detrás de HTTPS.';
        } else {
            msg += 'Revisa que:\n' +
                   '1. Ollama esté abierto (el ícono debe aparecer en la barra de tareas).\n' +
                   `2. Responda en ${url} — pruébalo en el navegador.\n` +
                   '3. Si la plataforma se abre desde otra computadora, Ollama debe ' +
                   'permitir ese origen con la variable OLLAMA_ORIGINS.';
        }
        return msg;
    }

    async function _pedirAlModelo(payload, _reintento = 0) {
        const sb = _sb();

        if (!_funcionAusente && sb?.functions?.invoke) {
            let error = null, data = null;
            try {
                ({ data, error } = await sb.functions.invoke(NOMBRE_FUNCION, { body: payload }));
            } catch (err) {
                error = err;
            }
            if (!error && data) return data;

            const { estado, mensaje } = await _detalleDelError(error);

            if (estado === 404) {
                // La función no está publicada: recién aquí tiene sentido el respaldo.
                console.warn('[Asistente] La función', NOMBRE_FUNCION, 'no está publicada; se usa key local si existe.');
                _funcionAusente = true;
            } else {
                // Un límite de uso suele resolverse solo: se reintenta una vez.
                if ((estado === 429 || estado === 503) && _reintento < 1) {
                    await _esperar(2500);
                    return _pedirAlModelo(payload, _reintento + 1);
                }
                throw new Error(_mensajeUtil(estado, mensaje));
            }
        }

        const key = _obtenerKeyLocal();
        if (!key) {
            throw new Error(
                'El asistente no está conectado.\n\n' +
                `No se encontró la función \`${NOMBRE_FUNCION}\` publicada en Supabase. ` +
                'Revisa que esté desplegada con ese nombre exacto.'
            );
        }

        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body   : JSON.stringify(payload),
        });
        if (!resp.ok) {
            const e = await resp.json().catch(() => ({}));
            if (resp.status === 401) throw new Error('La API Key local no es válida.');
            if ((resp.status === 429 || resp.status === 503) && _reintento < 1) {
                await _esperar(2500);
                return _pedirAlModelo(payload, _reintento + 1);
            }
            throw new Error(_mensajeUtil(resp.status, e?.error?.message || `Error ${resp.status} del proveedor.`));
        }
        return resp.json();
    }

    /* ═══════════════════════════════════════════════════════════════════
       INSTRUCCIONES DEL SISTEMA
       A diferencia del asistente anterior, aquí NO se inyectan datos: sólo
       se explica el contexto y cómo comportarse. Los datos llegan por
       herramientas, que es lo que garantiza que sean exactos.
       ═══════════════════════════════════════════════════════════════════ */
    function _instrucciones(modoVoz) {
        const hoy = new Date();
        const fechaLarga = hoy.toLocaleDateString('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        const iso = hoy.toISOString().slice(0, 10);

        let usuario = '';
        try {
            const u = JSON.parse(sessionStorage.getItem('user') || '{}');
            const nombre = u?.nombre || u?.name || u?.email;
            if (nombre) usuario = `\nEstás hablando con: ${nombre}. Puedes tutearle.`;
        } catch (_) { /* sin usuario identificado */ }

        // Escrito con economía: este texto viaja al modelo en CADA llamada, y
        // una pregunta hace dos o tres. Cada frase de más se paga varias veces.
        const base = `Eres AIFONSO, asistente del Aeropuerto Internacional Felipe Ángeles (AIFA), dentro de su plataforma interna de operaciones.
Hoy: ${fechaLarga} (${iso}).${usuario}

NUNCA inventes cifras. Todo dato del aeropuerto lo consultas antes de responder. Si algo falla, dilo; no lo estimes.

Eres un compañero de trabajo, no un buscador. Español de México, natural y directo. Comentas lo que llama la atención en un dato; si la pregunta es ambigua, preguntas en vez de adivinar. Mantienes el hilo: entiendes "¿y las internacionales?" por lo ya hablado.

Prohibido sonar a informe: nada de "es importante destacar", "cabe mencionar", "según los datos". Di "Son 7 internacionales", no "Actualmente se cuenta con un total de 7 rutas internacionales". Aquí al aeropuerto se le dice AIFA.

CIERRA SIEMPRE ABRIENDO CONVERSACIÓN. Termina cada respuesta con una línea breve que proponga el siguiente paso, relacionada con lo que se acaba de hablar: "¿Quieres que te diga los horarios de alguno?", "¿Te saco cómo va contra el año pasado?", "¿Reviso alguna aerolínea en particular?". Si no se te ocurre algo pertinente, pregunta simplemente si puedes ayudar en algo más. Nunca cierres en seco.

"Ruta" y "destino" son lo mismo: UN solo número, nunca dos cifras. Las "frecuencias" son los vuelos de la semana: otra cosa, sólo si las piden. Reporta lo que obtienes sin recalcular.

Escribe SIEMPRE las cifras con separador de miles: "52,597" y "7,058,219", nunca "52597" ni "7058219". Los datos ya te llegan formateados: cópialos tal cual.

Cuando hables de PROGRAMACIÓN DE VUELOS (rutas, destinos, horarios, aerolíneas que operan un destino):
1. Di a qué semana o fecha corresponden los datos.
2. Si preguntan por un destino, da los horarios por día (vuelo y hora) e incluye el enlace que viene en "enlace_frecuencias" para ver el detalle completo.
3. Cierra con la frase exacta del campo "nota_obligatoria", sin cambiarle nada.
Esa nota es SÓLO para programación de vuelos. No la pongas en cifras de operaciones, pasajeros o carga: ahí no viene al caso.
La respuesta puede reenviarse por WhatsApp, así que escribe el enlace completo y que se entienda por sí sola.

Fechas relativas ("ayer", "el mes pasado"): calcula tú las fechas AAAA-MM-DD.`;

        if (!modoVoz) {
            return base + `

Formato: viñetas para enumerar, negritas en las cifras.

ENUMERA COMPLETO: cuando recibas una lista de destinos, escríbelos TODOS, uno por uno. Si son cuarenta, van los cuarenta. Prohibido cortar con "entre otros" o "etcétera". La cantidad que enumeres debe coincidir con el número que reportaste.

CÓMO ESCRIBIR LOS DESTINOS
Sólo el nombre de la ciudad. Nunca escribas códigos de tres letras: se dice "Guadalajara", no "Guadalajara (GDL)" ni "GDL".
Si van en una sola frase, sepáralos con comas y usa "y" únicamente antes del último: "Guadalajara, Cancún, Monterrey y Tijuana". Está mal encadenarlos con "y" entre cada uno.
Si son muchos, mejor ponlos en lista con viñetas, una ciudad por renglón, sin "y".`;
        }

        // En voz la restricción va PRIMERO, no al final: puesta después de un
        // texto largo el modelo la ignoraba y seguía respondiendo con viñetas
        // y negritas, que al leerse en voz alta suenan fatal.
        return `ESTÁS EN UNA LLAMADA. Tu respuesta se ESCUCHA, no se lee.

Reglas que mandan sobre cualquier otra:
- Prohibido usar viñetas, guiones, asteriscos, negritas, emojis o cualquier símbolo. Sólo frases habladas.
- Máximo tres frases. Esto es un diálogo, no un informe: la persona puede repreguntar.
- Nunca recites listas largas. Si son muchos destinos, di cuántos son, menciona tres o cuatro y ofrece el resto: "si quieres te digo los demás".
- Las cifras se dicen como se pronuncian: "mil quinientas noventa y ocho", no "1,598".
- Los destinos se nombran por su ciudad, jamás por su código de tres letras.
- Al enumerar, separa con comas y di "y" sólo antes del último: "Guadalajara, Cancún, Monterrey y Tijuana". Nunca "Guadalajara y Cancún y Monterrey".

Ejemplo de cómo suena bien:
Pregunta: "¿cuántas rutas nacionales hay?"
Respuesta: "Ahorita son cuarenta rutas nacionales. Las más movidas son Guadalajara, Cancún y Monterrey. ¿Te interesa alguna en particular?"

Ejemplo de cómo suena MAL (no lo hagas):
"Tenemos **40 rutas nacionales**: - Guadalajara (GDL) - Cancún (CUN) - Monterrey (MTY)…"

` + base;
    }

    /* ═══════════════════════════════════════════════════════════════════
       CICLO DE HERRAMIENTAS
       ═══════════════════════════════════════════════════════════════════ */

    /* Un resultado con 60 destinos o 40 vuelos puede desbordar el límite de
       tokens del modelo y tumbar la consulta. Se recortan las listas largas
       conservando lo importante (totales y primeros elementos) y se avisa al
       modelo de que se recortó, para que no afirme tener la lista completa. */
    const MAX_CARACTERES_RESULTADO = 6000;

    function _recortar(resultado) {
        let texto = JSON.stringify(resultado);
        if (texto.length <= MAX_CARACTERES_RESULTADO) return texto;

        const copia = JSON.parse(texto);
        for (const clave of Object.keys(copia)) {
            if (!Array.isArray(copia[clave]) || copia[clave].length <= 3) continue;
            const original = copia[clave].length;
            let corte = copia[clave].length;
            while (corte > 3 && JSON.stringify(copia).length > MAX_CARACTERES_RESULTADO) {
                corte = Math.floor(corte * 0.6);
                copia[clave] = copia[clave].slice(0, corte);
            }
            copia[`_nota_${clave}`] =
                `Se muestran ${copia[clave].length} de ${original}. Menciona el total ` +
                `y ofrece detallar el resto si lo piden; no afirmes que es la lista completa.`;
        }
        texto = JSON.stringify(copia);
        if (texto.length <= MAX_CARACTERES_RESULTADO) return texto;

        // Último recurso. Nunca se corta la cadena a la brava: eso entregaba
        // un JSON partido a la mitad y el modelo respondía a medias, con la
        // frase cortada. Mejor devolver algo válido que diga qué pasó.
        return JSON.stringify({
            aviso: 'El resultado era demasiado grande para enviarlo completo.',
            resumen: Object.fromEntries(
                Object.entries(copia)
                    .filter(([, v]) => typeof v !== 'object' || v === null)
                    .slice(0, 20)
            ),
            que_hacer: 'Dile a la persona que acote la consulta (un solo día, ' +
                       'una sola aerolínea o un solo tipo de operación).',
        });
    }
    /* Quita el nombre cuando le hablan directo ("AIFONSO, ¿cuántas rutas hay?").
       Sin esto el modelo puede tratar su propio nombre como parte de la
       pregunta. Se aceptan variantes porque el dictado por voz no siempre
       escribe bien un nombre propio inventado. */
    const _NOMBRE_AL_INICIO = /^\s*(?:oye\s+|hey\s+|hola\s+)?(?:aifonso|alfonso|aifonzo|ai\s*fonso|aifons)\s*[,:.!¡¿?]*\s*/i;

    function _quitarNombre(texto) {
        const limpio = String(texto || '').replace(_NOMBRE_AL_INICIO, '').trim();
        // Si sólo dijeron su nombre, no se borra: es una llamada de atención.
        return limpio || String(texto || '').trim();
    }

    /* La leyenda de programación es obligatoria, así que no puede depender de
       que el modelo se acuerde: en respuestas largas se le olvidaba. Se añade
       por código cuando la respuesta salió de una consulta de programación y
       no la trae ya. En voz no se agrega: se escucha como letra chica y
       estorba en una conversación hablada. */
    const NOTA_PROGRAMACION =
        'Nota: Esta programación esta sujeta a cambios con base en las necesidades de las aerolíneas.';
    const HERRAMIENTAS_DE_PROGRAMACION = new Set([
        'contar_rutas', 'listar_destinos', 'frecuencias_destino', 'listar_aerolineas',
    ]);

    const RE_NOTA = /\n*\s*Nota:\s*Esta programaci[óo]n est[áa] sujeta a cambios con base en las necesidades de las aerol[íi]neas\.?\s*/gi;

    function _asegurarNota(texto, herramientasUsadas, modoVoz) {
        let limpio = String(texto || '').trim();
        const aplica = !modoVoz &&
            (herramientasUsadas || []).some(h => HERRAMIENTAS_DE_PROGRAMACION.has(h));

        // Se quita siempre primero: el modelo la agrega por su cuenta aunque
        // no venga al caso (llegó a ponerla en las cifras anuales de
        // operaciones, donde no aplica). Así el criterio lo pone el código y
        // no la memoria del modelo.
        limpio = limpio.replace(RE_NOTA, '\n').trim();

        return aplica ? `${limpio}\n\n${NOTA_PROGRAMACION}` : limpio;
    }

    const RECORDATORIO =
        'Recuerda: para cualquier cifra del aeropuerto DEBES consultarla con una ' +
        'herramienta antes de responder, aunque ya hayas contestado algo parecido ' +
        'antes en esta conversación. Nunca respondas de memoria ni reutilices cifras ' +
        'de mensajes anteriores.';

    async function preguntar(textoUsuario, alAvanzar, opciones = {}) {
        const datos = _datos();
        if (!datos) throw new Error('No se cargó la capa de datos del asistente.');

        const modoVoz = opciones.voz === true;
        const pregunta = _quitarNombre(textoUsuario);
        const historial = _historial.slice(-MAX_HISTORIAL);

        const mensajes = [
            { role: 'system', content: _instrucciones(modoVoz) },
            ...historial,
            // A partir del segundo turno hay que insistir. Medido: sin este
            // recordatorio, el modelo local deja de consultar en cuanto ve una
            // respuesta previa suya (0 de 6 intentos consultaron) y empieza a
            // contestar de memoria, inventando cifras. Con él: 6 de 6.
            // Va al final a propósito: lo último que se lee es lo que más pesa.
            ...(historial.length ? [{ role: 'system', content: RECORDATORIO }] : []),
            { role: 'user', content: pregunta },
        ];

        const usadas = [];

        for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
            const msg = await _pensar({
                mensajes,
                herramientas: datos.esquemas,
                // Un poco de soltura para que suene a persona y no a formulario,
                // sin comprometer la fidelidad: las cifras vienen de los datos.
                temperatura : modoVoz ? 0.6 : 0.35,
                // Enumerar 40 destinos con su código consume bastante; con un
                // tope corto la lista se cortaba a media frase.
                maxTokens   : modoVoz ? 320 : 2500,
            });
            if (!msg) throw new Error('El modelo no devolvió respuesta.');

            if (!msg.llamadas.length) {
                const texto = _asegurarNota(msg.contenido, usadas, modoVoz);
                // Se guarda la pregunta ya sin el nombre, para que el hilo de
                // la conversación quede limpio.
                _historial.push({ role: 'user', content: pregunta });
                _historial.push({ role: 'assistant', content: texto });
                if (_historial.length > MAX_HISTORIAL * 2) {
                    _historial.splice(0, _historial.length - MAX_HISTORIAL * 2);
                }
                return { texto, herramientas: usadas };
            }

            // El modelo pidió datos: se ejecutan de verdad contra Supabase.
            mensajes.push(msg.original);
            for (const llamada of msg.llamadas) {
                if (typeof alAvanzar === 'function') alAvanzar(llamada.nombre);
                usadas.push(llamada.nombre);

                const resultado = await datos.ejecutar(llamada.nombre, llamada.args);
                mensajes.push({
                    role        : 'tool',
                    // Ollama lo ignora; la nube lo exige. Mandarlo siempre es
                    // inofensivo y evita dos caminos distintos.
                    tool_call_id: llamada.id,
                    name        : llamada.nombre,
                    content     : _recortar(resultado),
                });
            }
        }
        throw new Error('La consulta resultó demasiado compleja. Intenta preguntarlo de forma más concreta.');
    }

    /* ═══════════════════════════════════════════════════════════════════
       VOZ — dictado (Web Speech API) y lectura (speechSynthesis)
       Ambas son nativas del navegador: no cuestan y no requieren key.
       ═══════════════════════════════════════════════════════════════════ */
    const _Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    let _reconocedor = null;
    let _escuchando  = false;

    function vozDisponible() { return !!_Reconocimiento; }

    function _limpiarParaVoz(texto) {
        return String(texto || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/[*_`#>]/g, '')
            .replace(/^\s*[-•]\s*/gm, ', ')
            // Quita emojis y símbolos decorativos para que no se lean.
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /* ── Elección de voz ─────────────────────────────────────────────────
       AIFONSO es hombre, así que se busca una voz masculina en español. El
       navegador no expone el género, así que se identifica por el nombre:
       éstas son las voces masculinas que traen Windows, macOS, Android y
       Chrome. Si no hay ninguna, se usa la mejor voz en español disponible
       y se le baja un poco el tono para que no suene femenina.            */
    const VOCES_HOMBRE = [
        'jorge', 'diego', 'juan', 'carlos', 'pablo', 'raul', 'raúl', 'miguel',
        'enrique', 'javier', 'alvaro', 'álvaro', 'lucero', 'gonzalo', 'roberto',
        'male', 'hombre',
    ];
    const VOCES_MUJER = [
        'sabina', 'helena', 'laura', 'paulina', 'monica', 'mónica', 'marisol',
        'esperanza', 'female', 'mujer', 'lupe', 'penelope', 'penélope', 'conchita',
    ];

    function _esVozDeHombre(v) {
        const n = String(v.name || '').toLowerCase();
        if (VOCES_MUJER.some(f => n.includes(f))) return false;
        return VOCES_HOMBRE.some(m => n.includes(m));
    }

    /* Chrome carga las voces de forma asíncrona: getVoices() devuelve una
       lista VACÍA en las primeras llamadas y sólo se llena cuando dispara
       'voiceschanged'. Si AIFONSO hablaba antes de ese momento no encontraba
       ninguna voz y el navegador usaba la predeterminada del sistema —que
       aquí es femenina—, por eso sonaba a mujer aunque sí hubiera una voz de
       hombre instalada. Se cachean en cuanto llegan. */
    let _vocesCache = [];

    function _refrescarVoces() {
        if (!window.speechSynthesis) return [];
        const v = window.speechSynthesis.getVoices() || [];
        if (v.length) _vocesCache = v;
        return _vocesCache;
    }

    if (window.speechSynthesis) {
        _refrescarVoces();
        try { window.speechSynthesis.addEventListener('voiceschanged', _refrescarVoces); }
        catch (_) { window.speechSynthesis.onvoiceschanged = _refrescarVoces; }
    }

    /* Espera (poco) a que el navegador termine de cargar las voces. */
    function _esperarVoces(msTope = 1200) {
        if (_refrescarVoces().length) return Promise.resolve(_vocesCache);
        return new Promise((resolver) => {
            const fin = Date.now() + msTope;
            const revisar = () => {
                if (_refrescarVoces().length || Date.now() > fin) resolver(_vocesCache);
                else setTimeout(revisar, 100);
            };
            revisar();
        });
    }

    function vocesDisponibles() {
        return _refrescarVoces()
            .filter(v => /^es/i.test(v.lang))
            .map(v => ({ nombre: v.name, idioma: v.lang, hombre: _esVozDeHombre(v) }));
    }

    /* ¿Hay al menos una voz de hombre en español? Si no, por más que AIFONSO
       sea hombre va a sonar a mujer: no es algo que se pueda arreglar desde
       el código, hay que instalar la voz en el sistema. */
    function hayVozDeHombre() {
        return vocesDisponibles().some(v => v.hombre);
    }

    function _elegirVoz() {
        if (!window.speechSynthesis) return null;
        const voces = _refrescarVoces().filter(v => /^es/i.test(v.lang));
        if (!voces.length) return null;

        // 1) La que el usuario haya elegido a mano.
        const guardada = localStorage.getItem('_aifa_voz_nombre');
        if (guardada) {
            const v = voces.find(x => x.name === guardada);
            if (v) return v;
        }
        // 2) Voz de hombre, de preferencia mexicana.
        const hombres = voces.filter(_esVozDeHombre);
        return hombres.find(v => /es[-_]MX/i.test(v.lang))
            || hombres.find(v => /es[-_](US|419)/i.test(v.lang))
            || hombres[0]
            // 3) Sin voz masculina: la mejor en español (se compensa el tono).
            || voces.find(v => /es[-_]MX/i.test(v.lang))
            || voces[0];
    }

    function fijarVoz(nombre) {
        if (nombre) localStorage.setItem('_aifa_voz_nombre', nombre);
        else localStorage.removeItem('_aifa_voz_nombre');
    }

    /* Devuelve una promesa que se resuelve cuando AIFONSO terminó de hablar.
       Es lo que permite encadenar: hablar → volver a escuchar, sin que se
       oiga a sí mismo y se responda solo. */
    async function hablar(texto, { forzar = false } = {}) {
        if ((!_vozActiva && !forzar) || !window.speechSynthesis) return;
        const limpio = _limpiarParaVoz(texto);
        if (!limpio) return;

        // Sin esta espera, la primera respuesta del día salía con la voz
        // predeterminada del sistema porque las voces aún no habían cargado.
        await _esperarVoces();

        return new Promise((resolver) => {
            try {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(limpio);
                const voz = _elegirVoz();
                if (voz) u.voice = voz;
                u.lang = voz?.lang || 'es-MX';
                // Ritmo ligeramente pausado: se entiende mejor y suena menos
                // atropellado que el valor por omisión.
                u.rate = 0.96;
                // Con voz de hombre basta un tono natural. Con voz femenina se
                // baja lo más posible para acercarla a una voz masculina; no
                // queda perfecto —el arreglo real es instalar una voz de
                // hombre— pero es mucho mejor que dejarla en su tono original.
                u.pitch = voz && _esVozDeHombre(voz) ? 1.0 : 0.4;
                u.onend = () => resolver();
                u.onerror = () => resolver();
                window.speechSynthesis.speak(u);
                // Salvavidas: si el navegador no dispara onend (ocurre en
                // algunas versiones), no dejar la conversación colgada.
                const msEstimados = Math.min(limpio.length * 90 + 2500, 45000);
                setTimeout(() => resolver(), msEstimados);
            } catch (_) {
                resolver();
            }
        });
    }

    function detenerVoz() {
        try { window.speechSynthesis?.cancel(); } catch (_) {}
    }

    function estaHablando() {
        try { return !!window.speechSynthesis?.speaking; } catch (_) { return false; }
    }

    function escuchar({ alTexto, alParcial, alEstado }) {
        if (!_Reconocimiento) {
            alEstado?.('no-soportado');
            return;
        }
        if (_escuchando) { pararEscucha(); return; }

        _reconocedor = new _Reconocimiento();
        _reconocedor.lang = 'es-MX';
        _reconocedor.continuous = false;
        _reconocedor.interimResults = true;
        _reconocedor.maxAlternatives = 1;

        let final = '';
        _reconocedor.onstart  = () => { _escuchando = true;  alEstado?.('escuchando'); };
        _reconocedor.onerror  = (e) => { _escuchando = false; alEstado?.(e.error === 'not-allowed' ? 'sin-permiso' : 'error'); };
        _reconocedor.onend    = () => {
            _escuchando = false;
            alEstado?.('fin');
            if (final.trim()) alTexto?.(final.trim());
        };
        _reconocedor.onresult = (ev) => {
            let parcial = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const t = ev.results[i][0].transcript;
                if (ev.results[i].isFinal) final += t;
                else parcial += t;
            }
            alParcial?.(final + parcial);
        };
        try { _reconocedor.start(); } catch (_) { alEstado?.('error'); }
    }

    function pararEscucha() {
        try { _reconocedor?.stop(); } catch (_) {}
        _escuchando = false;
    }

    /* Saludo de presentación. Se arma según la hora local y con un poco de
       variedad para que no suene a grabación: quien lo usa a diario acaba
       oyendo la misma frase muchas veces. */
    function _saludoCordial() {
        const h = new Date().getHours();
        const momento = h < 12 ? 'muy buen día' : h < 19 ? 'muy buena tarde' : 'muy buena noche';
        const cierres = [
            'Soy AIFONSO y estoy para ayudarte.',
            'Soy AIFONSO, con gusto te ayudo.',
            'Soy AIFONSO y aquí ando para lo que necesites.',
        ];
        return `Hola, ${momento}. ${cierres[Math.floor(Math.random() * cierres.length)]}`;
    }

    function alternarLectura() {
        _vozActiva = !_vozActiva;
        localStorage.setItem('_aifa_voz', _vozActiva ? '1' : '0');
        if (!_vozActiva) detenerVoz();
        return _vozActiva;
    }

    /* ═══════════════════════════════════════════════════════════════════
       MODO CONVERSACIÓN — manos libres
       Ciclo: escucha → entiende → responde → habla → vuelve a escuchar.
       El micrófono se apaga mientras AIFONSO habla; si no, se oiría a sí
       mismo y se contestaría solo.
       ═══════════════════════════════════════════════════════════════════ */

    // Frases con las que la persona da por terminada la charla.
    const _DESPEDIDAS = /^(gracias|muchas gracias|ya|listo|es todo|eso es todo|nada m[aá]s|adi[oó]s|hasta luego|bye|sale|ok gracias)\.?$/i;

    let _conversando = false;
    let _cicloActivo = null;

    function conversacionActiva() { return _conversando; }

    /* estados que se reportan a la interfaz:
       'escuchando' | 'procesando' | 'hablando' | 'inactivo' | error */
    async function iniciarConversacion({ alEstado, alTexto, alRespuesta, alError }) {
        if (!_Reconocimiento) { alEstado?.('no-soportado'); return; }
        if (_conversando) return;
        _conversando = true;

        const saludo = `${_saludoCordial()} ¿En qué te ayudo?`;
        alRespuesta?.(saludo, [], { saludo: true });
        await hablar(saludo, { forzar: true });

        const unTurno = () => new Promise((cerrar) => {
            if (!_conversando) { cerrar(); return; }

            const rec = new _Reconocimiento();
            _reconocedor = rec;
            rec.lang = 'es-MX';
            rec.continuous = false;
            rec.interimResults = true;
            rec.maxAlternatives = 1;

            let final = '';
            let atendido = false;

            rec.onstart = () => alEstado?.('escuchando');
            rec.onerror = (e) => {
                if (e.error === 'not-allowed') {
                    _conversando = false;
                    alError?.('No puedo usar el micrófono: hay que autorizarlo en el navegador.');
                }
                // 'no-speech' y 'aborted' son normales: simplemente no habló.
            };
            rec.onresult = (ev) => {
                let parcial = '';
                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                    const t = ev.results[i][0].transcript;
                    if (ev.results[i].isFinal) final += t;
                    else parcial += t;
                }
                alTexto?.((final + parcial).trim());
            };
            rec.onend = async () => {
                if (atendido) return;
                atendido = true;
                const dicho = final.trim();

                if (!_conversando) { alEstado?.('inactivo'); cerrar(); return; }
                if (!dicho) { cerrar(); return; }          // silencio: se reintenta
                alTexto?.(dicho, { definitivo: true });

                if (_DESPEDIDAS.test(dicho)) {
                    _conversando = false;
                    const cierre = 'Va, cualquier cosa aquí ando.';
                    alRespuesta?.(cierre, []);
                    await hablar(cierre, { forzar: true });
                    alEstado?.('inactivo');
                    cerrar();
                    return;
                }

                try {
                    alEstado?.('procesando');
                    const r = await preguntar(dicho, null, { voz: true });
                    if (!_conversando) { cerrar(); return; }
                    alRespuesta?.(r.texto, r.herramientas);
                    alEstado?.('hablando');
                    await hablar(r.texto, { forzar: true });
                } catch (err) {
                    const aviso = err?.message || 'Algo falló al consultar.';
                    alRespuesta?.(aviso, [], { error: true });
                    await hablar('Tuve un problema para consultarlo.', { forzar: true });
                }
                cerrar();
            };

            try { rec.start(); } catch (_) { cerrar(); }
        });

        _cicloActivo = (async () => {
            while (_conversando) {
                await unTurno();
                // Respiro breve entre turnos: evita que el reconocedor se
                // reinicie antes de que el navegador libere el micrófono.
                if (_conversando) await new Promise(r => setTimeout(r, 350));
            }
            alEstado?.('inactivo');
        })();
    }

    function terminarConversacion() {
        _conversando = false;
        detenerVoz();
        pararEscucha();
    }

    window.AsistenteAifa = {
        NOMBRE: 'AIFONSO',
        preguntar,
        hablar, detenerVoz, estaHablando, escuchar, pararEscucha,
        alternarLectura, vozDisponible, vocesDisponibles, fijarVoz, hayVozDeHombre,
        saludoCordial: _saludoCordial,
        iniciarConversacion, terminarConversacion, conversacionActiva,
        // Dónde piensa: Ollama local o la nube
        estadoOllama,
        get config() { return { url: PREF.url, modelo: PREF.modelo, donde: PREF.donde }; },
        configurar(c = {}) {
            if (c.url    !== undefined) PREF.url = c.url;
            if (c.modelo !== undefined) PREF.modelo = c.modelo;
            if (c.donde  !== undefined) PREF.donde = c.donde;
        },
        get lecturaActiva() { return _vozActiva; },
        get ocupado() { return _ocupado; },
        set ocupado(v) { _ocupado = !!v; },
        limpiarHistorial() { _historial.length = 0; },
        _historial,
    };
})();
