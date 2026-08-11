# Asistente AIFA — puesta en marcha

El asistente ya funciona en la app. Sólo falta **conectarlo al modelo**, y eso
se hace una única vez.

## Por qué hace falta una función en Supabase

La API key del modelo no puede ir en el navegador: cualquiera con la app
abierta puede leerla desde las herramientas de desarrollo (F12) y usarla por su
cuenta. Por eso la key vive en Supabase, y el navegador nunca la ve.

Se eligió Supabase (y no el servidor web) porque **el hosting es Hostinger, que
sirve archivos estáticos**: no ejecuta código de servidor. Supabase sí, y la
plataforma ya lo usa para todo lo demás.

```
Navegador  ──►  Edge Function (Supabase)  ──►  Groq
                 [aquí vive la key]
```

Las consultas a la base de datos **no** pasan por aquí: se hacen desde el
navegador con la sesión del usuario, para que las políticas de seguridad por
fila (RLS) sigan aplicando y nadie vea datos que no le corresponden.

---

## Paso 1 · Obtener una API key de Groq

1. Entrar a [https://console.groq.com/keys](https://console.groq.com/keys) y crear una cuenta (el plan
   gratuito es suficiente para este uso).
2. Crear una API key y copiarla. Empieza con `gsk_`.

## Paso 2 · Desplegar la función

Con el [CLI de Supabase](https://supabase.com/docs/guides/cli) instalado, desde
la carpeta del proyecto:

```bash
supabase login
supabase link --project-ref fgstncvuuhpgyzmjceyr

# Guardar la key como secreto (NO se sube al repositorio)
supabase secrets set GROQ_API_KEY=gsk_tu_key_aqui

# Publicar la función
supabase functions deploy asistente-aifa
```

> **Alternativa sin CLI:** en el panel de Supabase → *Edge Functions* →
> *Deploy a new function*, pegar el contenido de `index.ts`. El secreto se
> agrega en *Edge Functions → Secrets*.

## Paso 3 · Restringir los orígenes (recomendado)

Para que sólo la app pueda usar la función:

```bash
supabase secrets set ORIGENES_PERMITIDOS=https://tu-dominio-en-hostinger.com
```

Mientras esta variable no exista, la función acepta cualquier origen para no
bloquear la puesta en marcha. **Conviene configurarla antes de publicar.**

---

## Verificar que quedó

Abrir la app, pulsar el botón del robot (esquina inferior derecha) y preguntar:

> ¿Cuántas rutas nacionales e internacionales hay?

Debe responder con cifras y mostrar debajo una etiqueta
*"Dato consultado en la base"*. Esa etiqueta es la señal de que el número salió
de una consulta real y no de una invención del modelo.

## Modo de prueba sin desplegar

Si se quiere probar antes de desplegar, se puede dejar una key en el navegador:

```js
localStorage.setItem('_aifa_groq_key', 'gsk_tu_key_aqui');
```

Sirve para desarrollo local. **No usar en producción**: la key queda expuesta.

---

## Límites del plan gratuito (probado)

Cada pregunta consume normalmente **dos o tres llamadas** al modelo: una para
decidir qué consultar, otra por cada herramienta usada, y la última para
redactar. Eso incluye enviar la definición de las herramientas cada vez.

En pruebas reales:

| Uso | Resultado |
|---|---|
| Una pregunta cada ~20 segundos (uso normal) | ✅ Sin problemas |
| Cuatro preguntas complejas seguidas en ~10 s | ⚠️ Se alcanza el límite por minuto |

Cuando se alcanza, el asistente **reintenta solo una vez** y, si persiste,
avisa con un mensaje claro ("el proveedor está limitando las consultas…").
No se rompe ni se queda inservible: a los pocos segundos vuelve a responder.

Si varias personas lo usaran al mismo tiempo de forma intensiva, conviene
pasar al plan de pago de Groq (es de costo bajo) o reducir el número de
herramientas declaradas en `js/asistente-aifa-datos.js`, que es lo que más
tokens consume por llamada.
