/* =============================================================================
   AIFONSO · Asistente de AIFA — Interfaz de chat y conversación por voz
   js/asistente-aifa-ui.js

   Dos formas de usarlo:
     · Escribiendo, como un chat normal.
     · Modo conversación: manos libres. Se habla y él contesta en voz alta,
       y vuelve a escuchar solo, como una llamada.

   Depende de:
     · asistente-aifa-datos.js  → herramientas de consulta
     · asistente-aifa.js        → motor de tool calling, voz y conversación
   ============================================================================= */

(function () {
    'use strict';

    const SUGERENCIAS = [
        '¿Cuántas rutas nacionales hay?',
        '¿Qué aerolínea vuela más?',
        '¿Cuántos vuelos hay a Cancún?',
        '¿Cómo vamos este año?',
    ];

    /* Etiquetas legibles: el usuario ve de dónde sale la respuesta, en vez de
       un "pensando…" opaco. */
    const ETIQUETAS = {
        contar_rutas       : 'Revisando rutas y destinos',
        listar_destinos    : 'Consultando destinos',
        frecuencias_destino: 'Viendo frecuencias del destino',
        operaciones_periodo: 'Sumando el parte de operaciones',
        operaciones_anuales: 'Consultando cifras anuales',
        listar_aerolineas  : 'Revisando aerolíneas',
        consultar_vuelos   : 'Buscando vuelos en el itinerario',
        agenda_sesiones    : 'Consultando la agenda de comités',
        buscar_aeropuerto  : 'Buscando el aeropuerto',
    };

    /* Identidad de AIFONSO. Se deja en un solo lugar para que sea fácil
       ajustarla sin tocar el resto del código. La firma es a propósito
       visible: deja constancia de dónde nació el asistente. */
    const MARCA = {
        logo   : 'images/aifa-logo.png',
        etapa  : 'BETA',
        lema   : 'Asistente operativo del Aeropuerto Internacional Felipe Ángeles',
        firma  : 'Creado en el AIFA, para el AIFA',
        detalle: '',   // vacío: no se dibuja el renglón
    };

    const CSS = `
#aifa-bot-fab{position:fixed;bottom:6.2rem;right:1.6rem;width:56px;height:56px;border:none;
  border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#6366f1);color:#fff;font-size:1.4rem;
  cursor:pointer;z-index:1500;box-shadow:0 6px 20px rgba(29,78,216,.45);display:flex;
  align-items:center;justify-content:center;transition:transform .18s,box-shadow .18s}
#aifa-bot-fab:hover{transform:scale(1.08);box-shadow:0 8px 26px rgba(29,78,216,.6)}
#aifa-bot-fab:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}
#aifa-bot-fab .aifa-bot-ping{position:absolute;inset:0;border-radius:50%;
  border:2px solid rgba(99,102,241,.55);animation:aifa-ping 2.6s ease-out infinite}
@keyframes aifa-ping{0%{transform:scale(1);opacity:.7}70%{transform:scale(1.5);opacity:0}100%{opacity:0}}

#aifa-bot-panel{position:fixed;bottom:6.2rem;right:1.6rem;width:min(430px,calc(100vw - 2rem));
  height:min(640px,calc(100vh - 9rem));background:#fff;border-radius:20px;z-index:1501;
  box-shadow:0 24px 60px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden;
  opacity:0;visibility:hidden;transform:translateY(14px) scale(.97);
  transition:opacity .2s,transform .2s,visibility .2s;border:1px solid #e2e8f0}
#aifa-bot-panel.abierto{opacity:1;visibility:visible;transform:none}

.aifa-bot-head{background:linear-gradient(120deg,#1d4ed8,#6366f1);color:#fff;padding:13px 16px;
  display:flex;align-items:center;gap:11px;flex-shrink:0}
.aifa-bot-head h6{margin:0;font-size:1rem;font-weight:800;line-height:1.2;letter-spacing:.02em}
.aifa-bot-head small{display:block;font-size:.66rem;opacity:.85;font-weight:500}
.aifa-bot-head-acciones{margin-left:auto;display:flex;gap:4px}
.aifa-bot-avatar{width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.2);
  display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;position:relative}
.aifa-bot-avatar.activo::after{content:'';position:absolute;inset:-3px;border-radius:14px;
  border:2px solid rgba(255,255,255,.65);animation:aifa-ping 1.6s ease-out infinite}
.aifa-bot-btn-head{background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;
  border-radius:8px;cursor:pointer;font-size:.78rem;display:flex;align-items:center;
  justify-content:center;transition:background .15s}
.aifa-bot-btn-head:hover{background:rgba(255,255,255,.32)}
.aifa-bot-btn-head.activo{background:#22c55e}

/* Distintivo de etapa: el asistente sigue en pruebas y debe notarse. */
.aifa-bot-etapa{font-size:.54rem;font-weight:800;letter-spacing:.12em;padding:2px 7px;
  border-radius:999px;background:linear-gradient(120deg,#facc15,#f59e0b);color:#422006;
  vertical-align:middle;margin-left:7px;box-shadow:0 1px 4px rgba(245,158,11,.45)}
#aifa-bot-fab .aifa-bot-etapa-fab{position:absolute;bottom:-3px;right:-6px;font-size:.48rem;
  padding:1px 5px;letter-spacing:.08em;border:1.5px solid #fff}

/* Tarjeta de presentación con la identidad del aeropuerto */
.aifa-bot-marca{align-self:stretch;background:linear-gradient(150deg,#0f172a,#1e3a8a 55%,#4338ca);
  color:#fff;border-radius:16px;padding:16px 16px 14px;text-align:center;
  box-shadow:0 8px 22px rgba(30,58,138,.28);position:relative;overflow:hidden}
.aifa-bot-marca::after{content:'';position:absolute;width:150px;height:150px;border-radius:50%;
  right:-52px;top:-62px;background:rgba(255,255,255,.07)}
/* El logo del AIFA es a color, así que va sobre una placa clara en lugar de
   blanquearlo con un filtro: así conserva su identidad y se lee sobre el
   fondo oscuro. */
.aifa-bot-marca-logo{display:inline-flex;align-items:center;justify-content:center;
  background:#fff;border-radius:12px;padding:9px 14px;margin-bottom:10px;position:relative;
  box-shadow:0 4px 14px rgba(0,0,0,.22)}
.aifa-bot-marca-logo img{height:38px;width:auto;display:block}
.aifa-bot-marca-nombre{font-size:1.45rem;font-weight:900;letter-spacing:.13em;line-height:1;
  margin-bottom:6px;position:relative}
.aifa-bot-marca-lema{font-size:.68rem;opacity:.85;line-height:1.45;position:relative}
.aifa-bot-marca-firma{margin-top:11px;padding-top:9px;border-top:1px solid rgba(255,255,255,.18);
  font-size:.6rem;opacity:.72;line-height:1.5;position:relative}
.aifa-bot-marca-firma strong{font-weight:700;letter-spacing:.02em}

.aifa-bot-msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;
  flex-direction:column;gap:10px}
.aifa-bot-msg{max-width:88%;padding:10px 13px;border-radius:15px;font-size:.84rem;line-height:1.55;
  white-space:pre-wrap;word-wrap:break-word;animation:aifa-in .18s ease}
@keyframes aifa-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.aifa-bot-msg.usuario{align-self:flex-end;background:#1d4ed8;color:#fff;border-bottom-right-radius:5px}
.aifa-bot-msg.bot{align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;
  border-bottom-left-radius:5px}
.aifa-bot-msg.error{align-self:flex-start;background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.aifa-bot-msg.provisional{opacity:.62;font-style:italic}
.aifa-bot-msg strong{font-weight:700}
.aifa-bot-msg ul{margin:6px 0 0;padding-left:18px}
.aifa-bot-msg li{margin-bottom:3px}

.aifa-bot-fuente{align-self:flex-start;font-size:.65rem;color:#64748b;background:#eef2ff;
  border:1px solid #e0e7ff;border-radius:999px;padding:2px 9px;display:inline-flex;
  align-items:center;gap:5px}
.aifa-bot-fuente i{font-size:.6rem;color:#4f46e5}

.aifa-bot-cargando{align-self:flex-start;display:flex;align-items:center;gap:8px;font-size:.75rem;
  color:#475569;background:#fff;border:1px solid #e2e8f0;border-radius:15px;padding:8px 13px}
.aifa-bot-cargando i{color:#6366f1}

/* Barra del modo conversación */
.aifa-bot-live{display:none;align-items:center;gap:10px;padding:10px 14px;
  background:linear-gradient(120deg,#0f172a,#312e81);color:#fff;flex-shrink:0}
.aifa-bot-live.on{display:flex}
.aifa-bot-live-txt{font-size:.75rem;font-weight:600;flex:1;line-height:1.3}
.aifa-bot-live-txt small{display:block;opacity:.7;font-weight:400;font-size:.66rem}
.aifa-bot-onda{display:flex;align-items:center;gap:3px;height:22px}
.aifa-bot-onda span{width:3px;height:6px;background:#a5b4fc;border-radius:2px}
.aifa-bot-live.escuchando .aifa-bot-onda span{animation:aifa-onda .9s ease-in-out infinite}
.aifa-bot-live.hablando .aifa-bot-onda span{animation:aifa-onda .55s ease-in-out infinite;background:#6ee7b7}
.aifa-bot-onda span:nth-child(2){animation-delay:.1s}
.aifa-bot-onda span:nth-child(3){animation-delay:.2s}
.aifa-bot-onda span:nth-child(4){animation-delay:.3s}
@keyframes aifa-onda{0%,100%{height:6px}50%{height:20px}}
.aifa-bot-colgar{background:#dc2626;border:none;color:#fff;border-radius:9px;padding:6px 12px;
  font-size:.72rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px}
.aifa-bot-colgar:hover{filter:brightness(1.1)}

/* Panel de ajustes */
.aifa-bot-ajustes{display:none;padding:12px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;
  font-size:.75rem;flex-shrink:0;max-height:250px;overflow-y:auto}
.aifa-bot-ajustes.on{display:block}
.aifa-bot-ajustes label{display:block;font-weight:700;color:#334155;margin:8px 0 3px;font-size:.7rem}
.aifa-bot-ajustes label:first-child{margin-top:0}
.aifa-bot-ajustes select,.aifa-bot-ajustes input{width:100%;border:1px solid #cbd5e1;border-radius:8px;
  padding:6px 9px;font-size:.75rem;font-family:inherit;background:#fff;color:#1e293b}
.aifa-bot-estado{margin-top:10px;padding:8px 10px;border-radius:8px;font-size:.7rem;line-height:1.45}
.aifa-bot-estado.bien{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.aifa-bot-estado.mal{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.aifa-bot-probar{margin-top:8px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;
  padding:6px 12px;font-size:.72rem;font-weight:600;cursor:pointer}
.aifa-bot-aviso-voz{margin-top:8px;background:#fffbeb;border:1px solid #fde68a;color:#854d0e;
  border-radius:8px;padding:8px 10px;font-size:.68rem;line-height:1.5}
.aifa-bot-aviso-voz em{color:#92400e;font-style:normal;font-weight:600}

.aifa-bot-chips{padding:0 14px 10px;display:flex;flex-wrap:wrap;gap:6px;background:#f8fafc}
.aifa-bot-chip{background:#fff;border:1px solid #c7d2fe;color:#3730a3;border-radius:999px;
  padding:5px 11px;font-size:.7rem;cursor:pointer;transition:background .15s,transform .15s}
.aifa-bot-chip:hover{background:#eef2ff;transform:translateY(-1px)}

.aifa-bot-pie{padding:10px;border-top:1px solid #e2e8f0;background:#fff;display:flex;gap:7px;
  align-items:flex-end;flex-shrink:0}
.aifa-bot-input{flex:1;border:1px solid #cbd5e1;border-radius:12px;padding:9px 12px;font-size:.83rem;
  resize:none;max-height:90px;font-family:inherit;line-height:1.45}
.aifa-bot-input:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.14)}
.aifa-bot-enviar,.aifa-bot-mic,.aifa-bot-conv{border:none;border-radius:12px;width:40px;height:40px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem;
  transition:filter .15s;flex-shrink:0}
.aifa-bot-enviar{background:#1d4ed8;color:#fff}
.aifa-bot-mic{background:#eef2ff;color:#4338ca}
.aifa-bot-conv{background:#059669;color:#fff}
.aifa-bot-enviar:hover,.aifa-bot-mic:hover,.aifa-bot-conv:hover{filter:brightness(1.1)}
.aifa-bot-enviar:disabled{opacity:.5;cursor:not-allowed}
.aifa-bot-mic.grabando{background:#dc2626;color:#fff;animation:aifa-pulso 1.1s ease-in-out infinite}
@keyframes aifa-pulso{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 0 0 9px rgba(220,38,38,0)}}

body.dark-mode #aifa-bot-panel{background:#0f172a;border-color:#1e293b}
body.dark-mode .aifa-bot-msgs,body.dark-mode .aifa-bot-chips{background:#0b1220}
body.dark-mode .aifa-bot-msg.bot{background:#1e293b;color:#e2e8f0;border-color:#334155}
body.dark-mode .aifa-bot-pie{background:#0f172a;border-color:#1e293b}
body.dark-mode .aifa-bot-input{background:#1e293b;border-color:#334155;color:#e2e8f0}
body.dark-mode .aifa-bot-chip{background:#1e293b;border-color:#3730a3;color:#c7d2fe}
body.dark-mode .aifa-bot-cargando{background:#1e293b;border-color:#334155;color:#cbd5e1}

@media(max-width:576px){
  #aifa-bot-fab{bottom:5.4rem;right:1rem;width:52px;height:52px}
  #aifa-bot-panel{bottom:0;right:0;left:0;width:100%;height:90vh;border-radius:20px 20px 0 0}
}`;

    let _panel, _msgs, _input, _chips, _btnEnviar, _btnMic, _btnVoz, _btnConv;
    let _live, _liveTxt, _avatar, _msgProvisional, _ajustes;

    function _API() { return window.AsistenteAifa; }
    function _saludoCordial() { return _API().saludoCordial(); }

    /* Markdown mínimo. Se escapa el HTML primero: ninguna respuesta del modelo
       debe poder inyectar marcado en la página. */
    function _formato(texto) {
        const esc = String(texto || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return esc
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Cursivas con _guiones bajos_, que el modelo también usa.
            .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:!?)]|$)/g, '$1<em>$2</em>')
            // Enlaces en formato markdown [texto](url) y direcciones sueltas.
            // El texto queda igual al copiarlo, para que al pegarlo en WhatsApp
            // la dirección viaje completa.
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
                '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
            .replace(/^\s*[-•]\s+(.*)$/gm, '<li>$1</li>')
            .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
            .replace(/<\/ul>\s*<ul>/g, '');
    }

    function _agregar(rol, texto, clases = '') {
        const div = document.createElement('div');
        div.className = `aifa-bot-msg ${rol} ${clases}`.trim();
        div.innerHTML = _formato(texto);
        _msgs.appendChild(div);
        _msgs.scrollTop = _msgs.scrollHeight;
        return div;
    }

    function _agregarFuente(herramientas) {
        if (!herramientas?.length) return;
        const unicas = [...new Set(herramientas)];
        const div = document.createElement('div');
        div.className = 'aifa-bot-fuente';
        div.innerHTML = `<i class="fas fa-database"></i> Consultado en la plataforma · ${
            unicas.map(h => ETIQUETAS[h] || h).join(' · ')}`;
        _msgs.appendChild(div);
        _msgs.scrollTop = _msgs.scrollHeight;
    }

    function _cargando(etiqueta) {
        let el = _msgs.querySelector('.aifa-bot-cargando');
        if (!el) {
            el = document.createElement('div');
            el.className = 'aifa-bot-cargando';
            _msgs.appendChild(el);
        }
        el.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> ${etiqueta}…`;
        _msgs.scrollTop = _msgs.scrollHeight;
        return el;
    }
    function _quitarCargando() { _msgs.querySelector('.aifa-bot-cargando')?.remove(); }

    function _pintarChips() {
        _chips.innerHTML = '';
        SUGERENCIAS.forEach(s => {
            const b = document.createElement('button');
            b.className = 'aifa-bot-chip';
            b.type = 'button';
            b.textContent = s;
            b.addEventListener('click', () => { _input.value = s; _enviar(); });
            _chips.appendChild(b);
        });
    }

    /* ── Chat escrito ──────────────────────────────────────────────────── */
    async function _enviar() {
        const texto = _input.value.trim();
        const API = _API();
        if (!texto || !API || API.ocupado) return;

        _input.value = '';
        _input.style.height = 'auto';
        _chips.innerHTML = '';
        _agregar('usuario', texto);

        API.ocupado = true;
        _btnEnviar.disabled = true;
        _cargando('Consultando');

        try {
            const { texto: respuesta, herramientas } = await API.preguntar(
                texto,
                (nombre) => _cargando(ETIQUETAS[nombre] || 'Consultando datos'),
            );
            _quitarCargando();
            _agregarFuente(herramientas);
            _agregar('bot', respuesta);
            API.hablar(respuesta);
        } catch (err) {
            _quitarCargando();
            _agregar('error', err?.message || 'No se pudo completar la consulta.');
        } finally {
            API.ocupado = false;
            _btnEnviar.disabled = false;
            _input.focus();
        }
    }

    /* ── Dictado suelto (una sola frase) ───────────────────────────────── */
    function _micro() {
        const API = _API();
        if (!API.vozDisponible()) {
            _agregar('error', 'Este navegador no permite dictado por voz. Funciona en Chrome o Edge.');
            return;
        }
        API.escuchar({
            alParcial: (t) => { _input.value = t; },
            alTexto  : (t) => { _input.value = t; _enviar(); },
            alEstado : (e) => {
                _btnMic.classList.toggle('grabando', e === 'escuchando');
                if (e === 'sin-permiso') {
                    _agregar('error', 'No pude usar el micrófono: hay que autorizarlo en el navegador.');
                }
            },
        });
    }

    /* ── Modo conversación (manos libres) ──────────────────────────────── */
    function _pintarEstado(estado) {
        _live.classList.remove('escuchando', 'hablando');
        _avatar.classList.toggle('activo', estado === 'escuchando' || estado === 'hablando');
        const textos = {
            escuchando: ['Te escucho…', 'Habla normal; cuando termines, contesto.'],
            procesando: ['Déjame ver…', 'Consultando la información.'],
            hablando  : ['Respondiendo…', 'Puedes interrumpirme cuando quieras.'],
            inactivo  : ['Conversación terminada', ''],
        };
        const [titulo, sub] = textos[estado] || ['', ''];
        _liveTxt.innerHTML = `${titulo}${sub ? `<small>${sub}</small>` : ''}`;
        if (estado === 'escuchando' || estado === 'hablando') _live.classList.add(estado);
    }

    function _mostrarProvisional(texto, info) {
        if (!texto) return;
        if (info?.definitivo) {
            if (_msgProvisional) {
                _msgProvisional.classList.remove('provisional');
                _msgProvisional.textContent = texto;
                _msgProvisional = null;
            } else {
                _agregar('usuario', texto);
            }
            return;
        }
        if (!_msgProvisional) _msgProvisional = _agregar('usuario', texto, 'provisional');
        else _msgProvisional.textContent = texto;
        _msgs.scrollTop = _msgs.scrollHeight;
    }

    function _alternarConversacion() {
        const API = _API();
        if (API.conversacionActiva()) { _terminarConversacion(); return; }

        if (!API.vozDisponible()) {
            _agregar('error', 'Este navegador no permite conversación por voz. Funciona en Chrome o Edge.');
            return;
        }

        _chips.innerHTML = '';
        _live.classList.add('on');
        _btnConv.style.display = 'none';
        _pintarEstado('escuchando');

        API.iniciarConversacion({
            alEstado : _pintarEstado,
            alTexto  : _mostrarProvisional,
            alRespuesta: (texto, herramientas, info) => {
                _quitarCargando();
                if (!info?.saludo) _agregarFuente(herramientas);
                _agregar(info?.error ? 'error' : 'bot', texto);
            },
            alError  : (m) => { _agregar('error', m); _terminarConversacion(); },
        });
    }

    function _terminarConversacion() {
        _API().terminarConversacion();
        _live.classList.remove('on', 'escuchando', 'hablando');
        _avatar.classList.remove('activo');
        _btnConv.style.display = '';
        _msgProvisional?.remove();
        _msgProvisional = null;
        _pintarChips();
    }

    /* ── Ajustes: dónde piensa AIFONSO y con qué voz ───────────────────── */
    async function _pintarAjustes() {
        const API = _API();
        const cfg = API.config;
        const voces = API.vocesDisponibles();
        const vozGuardada = localStorage.getItem('_aifa_voz_nombre') || '';

        _ajustes.innerHTML = `
          <label>¿Dónde piensa AIFONSO?</label>
          <select data-cfg="donde">
            <option value="local">En esta computadora (Ollama) · privado y sin costo</option>
            <option value="auto">Local, y si no está disponible, la nube</option>
            <option value="nube">En la nube (Groq)</option>
          </select>
          <label>Dirección de Ollama</label>
          <input data-cfg="url" value="${cfg.url}" placeholder="http://localhost:11434">
          <label>Modelo</label>
          <select data-cfg="modelo"><option value="${cfg.modelo}">${cfg.modelo}</option></select>
          <label>Voz de AIFONSO</label>
          <select data-cfg="vozNombre">
            <option value="">Automática (busca voz de hombre)</option>
            ${voces.map(v => `<option value="${v.nombre}"${v.nombre === vozGuardada ? ' selected' : ''}>${
                v.nombre} ${v.hombre ? '· hombre' : '· mujer'}</option>`).join('')}
          </select>
          ${API.hayVozDeHombre() ? '' : `
          <div class="aifa-bot-aviso-voz">
            <strong>No hay voz de hombre en español instalada.</strong>
            AIFONSO va a sonar a mujer con el tono forzado hacia abajo, porque no
            existe otra voz que elegir. Para arreglarlo de raíz, en Windows:
            <em>Configuración → Hora e idioma → Voz → Agregar voces</em>, e instalar
            un paquete de español que incluya voz masculina (Raúl, Pablo o Jorge).
            Al recargar la plataforma, AIFONSO la toma solo.
          </div>`}
          <button class="aifa-bot-probar" type="button">Probar conexión y voz</button>
          <div class="aifa-bot-estado" style="display:none"></div>`;

        _ajustes.querySelector('[data-cfg="donde"]').value = cfg.donde;

        _ajustes.querySelectorAll('[data-cfg]').forEach(el => {
            el.addEventListener('change', () => {
                const clave = el.dataset.cfg;
                if (clave === 'vozNombre') { API.fijarVoz(el.value); return; }
                API.configurar({ [clave]: el.value });
                if (clave === 'url' || clave === 'donde') _revisarOllama();
            });
        });
        _ajustes.querySelector('.aifa-bot-probar').addEventListener('click', async () => {
            await _revisarOllama();
            API.hablar('Hola, soy AIFONSO. Así me voy a escuchar.', { forzar: true });
        });

        _revisarOllama();
    }

    async function _revisarOllama() {
        const caja = _ajustes.querySelector('.aifa-bot-estado');
        const selModelo = _ajustes.querySelector('[data-cfg="modelo"]');
        if (!caja) return;
        caja.style.display = 'block';
        caja.className = 'aifa-bot-estado';
        caja.textContent = 'Revisando…';

        const est = await _API().estadoOllama();
        if (est.ok) {
            const conHerramientas = est.modelos.filter(m => m.herramientas);
            caja.className = 'aifa-bot-estado bien';
            caja.innerHTML = `<strong>Ollama funcionando.</strong> ${est.modelos.length} modelo(s), ` +
                `${conHerramientas.length} pueden consultar datos.` +
                (conHerramientas.length ? '' : ' <br>Ninguno soporta herramientas: AIFONSO no podrá consultar cifras.');
            if (selModelo && est.modelos.length) {
                const actual = _API().config.modelo;
                selModelo.innerHTML = est.modelos.map(m =>
                    `<option value="${m.nombre}"${m.nombre === actual ? ' selected' : ''}>${
                        m.nombre}${m.herramientas ? ' · consulta datos' : ' · sin herramientas'}</option>`).join('');
            }
        } else {
            caja.className = 'aifa-bot-estado mal';
            caja.innerHTML = `<strong>No se pudo conectar con Ollama.</strong><br>${est.motivo}`;
        }
    }

    /* ── Construcción ──────────────────────────────────────────────────── */
    function _construir() {
        if (document.getElementById('aifa-bot-fab')) return;

        const estilo = document.createElement('style');
        estilo.textContent = CSS;
        document.head.appendChild(estilo);

        const fab = document.createElement('button');
        fab.id = 'aifa-bot-fab';
        fab.type = 'button';
        fab.title = 'AIFONSO — pregúntale por voz o por escrito';
        fab.setAttribute('aria-label', 'Abrir a AIFONSO, el asistente de AIFA');
        fab.innerHTML = '<span class="aifa-bot-ping"></span><i class="fas fa-robot"></i>' +
                        `<span class="aifa-bot-etapa aifa-bot-etapa-fab">${MARCA.etapa}</span>`;
        document.body.appendChild(fab);

        _panel = document.createElement('div');
        _panel.id = 'aifa-bot-panel';
        _panel.setAttribute('role', 'dialog');
        _panel.setAttribute('aria-label', 'AIFONSO, asistente de AIFA');
        _panel.innerHTML = `
          <div class="aifa-bot-head">
            <div class="aifa-bot-avatar"><i class="fas fa-robot"></i></div>
            <div>
              <h6>AIFONSO<span class="aifa-bot-etapa">${MARCA.etapa}</span></h6>
              <small>Tu compañero de operaciones en AIFA</small>
            </div>
            <div class="aifa-bot-head-acciones">
              <button class="aifa-bot-btn-head" data-accion="voz" title="Leer las respuestas en voz alta">
                <i class="fas fa-volume-up"></i></button>
              <button class="aifa-bot-btn-head" data-accion="ajustes" title="Ajustes de AIFONSO">
                <i class="fas fa-sliders-h"></i></button>
              <button class="aifa-bot-btn-head" data-accion="limpiar" title="Empezar de nuevo">
                <i class="fas fa-broom"></i></button>
              <button class="aifa-bot-btn-head" data-accion="cerrar" title="Cerrar">
                <i class="fas fa-times"></i></button>
            </div>
          </div>
          <div class="aifa-bot-ajustes"></div>
          <div class="aifa-bot-live">
            <div class="aifa-bot-onda"><span></span><span></span><span></span><span></span></div>
            <div class="aifa-bot-live-txt"></div>
            <button class="aifa-bot-colgar" type="button"><i class="fas fa-phone-slash"></i>Terminar</button>
          </div>
          <div class="aifa-bot-msgs"></div>
          <div class="aifa-bot-chips"></div>
          <div class="aifa-bot-pie">
            <button class="aifa-bot-conv" type="button" title="Conversar por voz (manos libres)">
              <i class="fas fa-headset"></i></button>
            <button class="aifa-bot-mic" type="button" title="Dictar una pregunta">
              <i class="fas fa-microphone"></i></button>
            <textarea class="aifa-bot-input" rows="1" placeholder="Pregúntale a AIFONSO…"></textarea>
            <button class="aifa-bot-enviar" type="button" title="Enviar">
              <i class="fas fa-paper-plane"></i></button>
          </div>`;
        document.body.appendChild(_panel);

        _msgs      = _panel.querySelector('.aifa-bot-msgs');
        _chips     = _panel.querySelector('.aifa-bot-chips');
        _input     = _panel.querySelector('.aifa-bot-input');
        _btnEnviar = _panel.querySelector('.aifa-bot-enviar');
        _btnMic    = _panel.querySelector('.aifa-bot-mic');
        _btnConv   = _panel.querySelector('.aifa-bot-conv');
        _btnVoz    = _panel.querySelector('[data-accion="voz"]');
        _live      = _panel.querySelector('.aifa-bot-live');
        _liveTxt   = _panel.querySelector('.aifa-bot-live-txt');
        _avatar    = _panel.querySelector('.aifa-bot-avatar');
        _ajustes   = _panel.querySelector('.aifa-bot-ajustes');

        const API = _API();
        _btnVoz.classList.toggle('activo', API.lecturaActiva);
        if (!API.vozDisponible()) {
            _btnMic.style.display = 'none';
            _btnConv.style.display = 'none';
        }

        fab.addEventListener('click', abrir);
        _btnEnviar.addEventListener('click', _enviar);
        _btnMic.addEventListener('click', _micro);
        _btnConv.addEventListener('click', _alternarConversacion);
        _panel.querySelector('.aifa-bot-colgar').addEventListener('click', _terminarConversacion);

        _panel.querySelector('[data-accion="cerrar"]').addEventListener('click', cerrar);
        _panel.querySelector('[data-accion="ajustes"]').addEventListener('click', (e) => {
            const abierto = _ajustes.classList.toggle('on');
            e.currentTarget.classList.toggle('activo', abierto);
            if (abierto) _pintarAjustes();
        });
        _btnVoz.addEventListener('click', () => {
            _btnVoz.classList.toggle('activo', API.alternarLectura());
        });
        _panel.querySelector('[data-accion="limpiar"]').addEventListener('click', () => {
            API.limpiarHistorial();
            API.detenerVoz();
            _msgs.innerHTML = '';
            _bienvenida();
            _pintarChips();
        });

        _input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _enviar(); }
        });
        _input.addEventListener('input', () => {
            _input.style.height = 'auto';
            _input.style.height = Math.min(_input.scrollHeight, 90) + 'px';
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _panel.classList.contains('abierto')) cerrar();
        });

        _bienvenida();
        _pintarChips();
    }

    function _bienvenida() {
        // Tarjeta de identidad: logo del aeropuerto, nombre, etapa y firma.
        const marca = document.createElement('div');
        marca.className = 'aifa-bot-marca';
        marca.innerHTML = `
          <span class="aifa-bot-marca-logo">
            <img src="${MARCA.logo}" alt="Aeropuerto Internacional Felipe Ángeles"
                 onerror="this.parentNode.style.display='none'">
          </span>
          <div class="aifa-bot-marca-nombre">AIFONSO<span class="aifa-bot-etapa">${MARCA.etapa}</span></div>
          <div class="aifa-bot-marca-lema">${MARCA.lema}</div>
          <div class="aifa-bot-marca-firma">
            <strong>${MARCA.firma}</strong>${MARCA.detalle ? `<br>${MARCA.detalle}` : ''}
          </div>`;
        _msgs.appendChild(marca);

        _agregar('bot',
            `${_saludoCordial()}\n\n` +
            'Conozco la operación del aeropuerto al día: rutas y destinos, frecuencias, ' +
            'vuelos, aerolíneas, operaciones y la agenda de comités.\n\n' +
            '¿En qué te puedo ayudar? Escríbeme, o toca el auricular y platicamos.');

        _agregar('bot',
            '_Estoy en versión de pruebas: si algo no te cuadra, dilo — así mejoro._');
    }

    let _yaSaludoEnVoz = false;

    function abrir() {
        _panel.classList.add('abierto');
        setTimeout(() => _input?.focus(), 180);

        // Se presenta en voz alta al abrir, pero sólo la primera vez de la
        // sesión: repetirlo cada vez que se abre y cierra el panel cansaría.
        if (!_yaSaludoEnVoz) {
            _yaSaludoEnVoz = true;
            const API = _API();
            const saludo = `${API.saludoCordial()} ¿En qué te puedo ayudar?`;
            // forzar: el saludo se escucha aunque la lectura automática de
            // respuestas esté apagada; es la presentación, no una respuesta.
            setTimeout(() => API.hablar(saludo, { forzar: true }), 260);
        }
    }
    function cerrar() {
        _panel.classList.remove('abierto');
        if (_API().conversacionActiva()) _terminarConversacion();
        _API().detenerVoz();
        _API().pararEscucha();
        _btnMic?.classList.remove('grabando');
    }

    window.asistenteAifaAbrir = abrir;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _construir);
    } else {
        _construir();
    }
})();
