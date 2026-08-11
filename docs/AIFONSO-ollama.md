# AIFONSO con Ollama (IA local)

AIFONSO piensa por defecto en **Ollama**, ejecutándose en la misma computadora.
Eso significa que **los datos del aeropuerto no salen a ningún proveedor
externo** y que no hay costo ni límite por consulta.

---

## Instalación

1. Descargar Ollama de <https://ollama.com/download> e instalarlo.
2. Descargar el modelo (una sola vez, ~6.6 GB):

```bash
ollama pull qwen3.5:9b
```

Listo. Ollama queda corriendo en segundo plano y AIFONSO lo encuentra solo.

### ¿Qué modelo conviene?

El modelo **debe soportar herramientas** (`tools`); si no, AIFONSO no puede
consultar cifras y se pondría a inventarlas. En el panel de ajustes de AIFONSO
cada modelo aparece marcado con "consulta datos" o "sin herramientas".

| Modelo | Tamaño | Comentario |
|---|---|---|
| `qwen3.5:9b` | ~6.6 GB | El recomendado: rápido (≈8 s por respuesta) y confiable eligiendo qué consultar. |
| `qwen3.6` | ~24 GB | Mejor redacción, pero bastante más lento y pide mucha memoria. |

---

## Ajustes dentro de la plataforma

Botón de AIFONSO → ícono de controles (arriba a la derecha):

- **¿Dónde piensa?** — local (Ollama), la nube, o local con respaldo en la nube.
- **Dirección de Ollama** — normalmente `http://localhost:11434`.
- **Modelo** — se llena solo con los que estén descargados.
- **Voz de AIFONSO** — AIFONSO es hombre, así que busca automáticamente una voz
  masculina en español. Si el sistema no tiene ninguna, usa la mejor voz en
  español y le baja el tono. También se puede elegir a mano.

El botón *"Probar conexión y voz"* confirma que todo funciona y reproduce un
saludo para escuchar cómo va a sonar.

### Sobre la voz masculina

AIFONSO es hombre, así que busca una voz masculina en español y la recuerda.

Un detalle que costó encontrar: Windows guarda las voces en **dos** registros
distintos. El clásico (`Speech\Voices`) suele traer sólo voces femeninas
—Helena, Zira—, mientras que el moderno (`Speech_OneCore\Voices`) trae también
masculinas, como **Microsoft Pablo**. El navegador ve las del segundo, así que
normalmente ya hay una voz de hombre disponible aunque el panel de Windows
parezca decir lo contrario.

Aparte, Chrome carga las voces de forma **asíncrona**: en los primeros
instantes `getVoices()` devuelve una lista vacía. Si se hablaba en ese momento,
el navegador usaba la voz predeterminada del sistema (femenina) aunque hubiera
una masculina instalada. AIFONSO ahora espera a que carguen antes de hablar.

Si aun así no aparece ninguna voz de hombre, el panel de ajustes lo avisa y se
puede instalar una desde *Configuración → Hora e idioma → Voz → Agregar voces*,
eligiendo un paquete de español con voz masculina (Pablo, Raúl o Jorge).

---

## Si se usa desde otras computadoras

Ollama sólo acepta conexiones del mismo equipo. Para que varias personas usen
un mismo servidor de IA hay dos requisitos:

**1. Permitir el origen de la plataforma**

```bash
# Windows (PowerShell, como administrador)
setx OLLAMA_ORIGINS "http://10.0.0.5:5500" /M
setx OLLAMA_HOST "0.0.0.0:11434" /M
```

Luego reiniciar Ollama. Sin esto, el navegador recibe un error 403.

**2. Cuidado con HTTPS**

Si la plataforma se abre por **HTTPS** (por ejemplo desde el dominio público) y
Ollama responde por **HTTP**, el navegador bloquea la conexión: no permite
mezclar ambos. Opciones:

- Abrir la plataforma desde la red interna por HTTP, o
- Poner Ollama detrás de un proxy con certificado HTTPS.

AIFONSO detecta este caso y lo explica en el panel de ajustes en lugar de
fallar en silencio.

---

## Detalles de implementación (por qué está hecho así)

**`think: false` siempre.** Los modelos Qwen razonan en voz alta antes de
responder. Con eso activo cada respuesta tardaba **más de 40 segundos**; al
desactivarlo baja a **~2 segundos por llamada** sin perder la capacidad de
elegir herramientas. Se manda en todas las peticiones.

**Recordatorio a partir del segundo turno.** Se midió que, en cuanto el modelo
local ve una respuesta suya anterior en el historial, deja de consultar y
empieza a contestar de memoria: **0 de 6 intentos** consultaron, e inventó
cifras ("25 rutas nacionales" cuando son 40). Se resuelve insertando un
recordatorio breve justo antes de cada pregunta nueva: **6 de 6** vuelven a
consultar. Está cubierto por una prueba automatizada.

**Instrucción de voz al principio.** Puesta al final de un prompt largo, el
modelo la ignoraba y respondía con viñetas y negritas, que suenan pésimo
leídas en voz alta. Al inicio, sí la respeta.

**Formatos distintos.** Ollama devuelve `arguments` como objeto y la nube como
cadena JSON; Ollama entrega `message` y la nube `choices[0].message`. Todo se
normaliza en `_normalizarMensaje()` para que el resto del código no tenga que
saber con quién habla.
