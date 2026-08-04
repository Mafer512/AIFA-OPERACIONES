/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { PDFDocument } = require('pdf-lib');

const ROOT = path.resolve(__dirname, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aifa-colab-print-'));
const BROWSERS = [
    { name: 'chrome', executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'edge', executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }
].filter(browser => fs.existsSync(browser.executable));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs, label) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeoutMs) {
        try {
            const value = await fn();
            if (value) return value;
        } catch (error) {
            lastError = error;
        }
        await sleep(150);
    }
    throw new Error(`${label} excedió ${timeoutMs} ms${lastError ? `: ${lastError.message}` : ''}`);
}

function createCdp(wsUrl) {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const events = new Map();
    let sequence = 0;

    const ready = new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        if (message.id) {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result || {});
            return;
        }
        const listeners = events.get(message.method) || [];
        listeners.forEach(listener => listener(message.params || {}));
    });

    return {
        ready,
        on(method, listener) {
            const listeners = events.get(method) || [];
            listeners.push(listener);
            events.set(method, listeners);
        },
        async send(method, params = {}) {
            await ready;
            const id = ++sequence;
            const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
            socket.send(JSON.stringify({ id, method, params }));
            return result;
        },
        close() {
            socket.close();
        }
    };
}

async function readDevToolsPort(profileDir) {
    const activePort = path.join(profileDir, 'DevToolsActivePort');
    return waitFor(() => {
        if (!fs.existsSync(activePort)) return null;
        const [port] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
        return Number(port) || null;
    }, 10000, 'Inicio de DevTools');
}

async function jsonApi(port, pathname, options) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
    if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
    return response.json();
}

async function connectTarget(port, targetId) {
    const targets = await jsonApi(port, '/json/list');
    const target = targets.find(item => item.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new Error(`Target ${targetId} no disponible`);
    const cdp = createCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Log.enable')]);
    return cdp;
}

async function evaluate(cdp, expression, options = {}) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: options.awaitPromise !== false,
        returnByValue: true,
        userGesture: !!options.userGesture
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Error evaluando JavaScript');
    }
    return result.result?.value;
}

function scenarioScript(kind) {
    const long = kind === 'long';
    const amonestaciones = Array.from({ length: long ? 9 : 1 }, (_, index) =>
        `<li class="ca-item"><span class="ca-text">Amonestación ${index + 1}: seguimiento administrativo con descripción completa.</span><div class="ca-actions"><button>Adjuntar</button></div></li>`
    ).join('');
    const comentarios = Array.from({ length: long ? 22 : 1 }, (_, index) =>
        `<li class="ca-item"><span class="ca-text">Comentario ${index + 1}: ${'Información extensa para validar saltos de página y legibilidad. '.repeat(long ? 3 : 1)}</span><div class="ca-actions"><button>Adjuntar</button></div></li>`
    ).join('');
    const cursos = Array.from({ length: long ? 24 : 1 }, (_, index) =>
        `<div class="colab-curso-item${index % 5 === 0 ? ' warning' : ''}"><div class="colab-curso-icon ok">✓</div><div class="colab-curso-body"><div class="colab-curso-name">Curso ${index + 1}</div><div class="colab-curso-desc">Capacitación institucional con nombre suficientemente largo para validar ajuste de texto.</div><div class="colab-curso-meta"><span>04/08/2026</span><span class="colab-curso-badge ok">Vigente</span></div></div><div class="colab-curso-actions"><button class="cc-btn">Ver PDF</button></div></div>`
    ).join('');
    const vacations = Array.from({ length: long ? 8 : 1 }, (_, index) =>
        `<div class="vac-period-card estado-programado"><div class="vac-per-num">Período ${index + 1}</div><div class="vac-per-dates">${index + 1}/08/2026 → ${index + 2}/08/2026</div><div class="vac-per-dias">2 días naturales${index === (long ? 7 : 0) ? ' · FIN DE FICHA' : ''}</div><button class="vac-per-delete">Eliminar</button></div>`
    ).join('');

    return `(() => {
        const setHtml = (id, value) => { const el = document.getElementById(id); if (el) el.innerHTML = value; };
        const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        setText('colab-h-numero', '${long ? '9999' : '1001'}');
        setText('colab-h-nombre', '${long ? 'Colaborador con expediente completo' : 'Colaborador con información mínima'}');
        setText('colab-h-puesto', 'Especialista de Operaciones');
        setHtml('cf-amonestaciones-list', '<ul class="ca-list">${amonestaciones}</ul>');
        setHtml('cf-comentarios-list', '<ul class="ca-list">${comentarios}</ul>');
        setHtml('colab-contacts-list', '<div class="colab-contact-row"><div class="colab-contact-name">Contacto principal</div><div class="colab-contact-rel">Familiar</div><div class="colab-contact-tel">55 1234 5678</div></div>${long ? '<div class="colab-contact-row"><div class="colab-contact-name">Contacto alterno</div><div class="colab-contact-rel">Cónyuge</div><div class="colab-contact-tel">55 8765 4321</div></div>' : ''}');
        setText('cf-sangre', 'O+'); setText('cf-alerg-med', 'No'); setText('cf-alerg-ali', 'No'); setText('cf-nss', '12345678901');
        setText('colab-cv-nombre', '${long ? 'CV_9999.pdf' : 'Sin CV cargado'}');
        setHtml('colab-cursos-alert-banner', '${long ? '<div class="colab-cursos-banner warn">2 cursos próximos a vencer</div>' : ''}');
        setHtml('colab-cursos-list', '<div class="colab-cursos-folder"><div class="colab-cursos-folder-header collapsed">Cursos institucionales</div><div class="colab-cursos-folder-body collapsed">${cursos}</div></div>');
        const vacationsPanel = document.getElementById('colab-vac-panel'); if (vacationsPanel) vacationsPanel.classList.remove('d-none');
        setHtml('vac-period-grid', '${vacations}');
        ['colab-foto-ine','colab-foto-ine-rev','colab-foto-cred'].forEach(id => { const img = document.getElementById(id); if (img) { img.src = 'images/aifa-logo.png'; img.style.display = 'block'; } });
        const avatar = document.getElementById('colab-avatar-img'); if (avatar) { avatar.src = 'images/aifa-logo.png'; avatar.style.display = 'block'; }
        return { ready: typeof window.colabImprimirFicha === 'function', rootHeight: document.getElementById('colab-ficha-content')?.scrollHeight || 0 };
    })()`;
}

async function runScenario(port, browserName, kind) {
    const before = await jsonApi(port, '/json/list');
    const beforeIds = new Set(before.map(target => target.id));
    const sourceTarget = before.find(target => target.type === 'page');
    const source = await connectTarget(port, sourceTarget.id);
    await source.send('Page.navigate', { url: INDEX_URL });
    await waitFor(async () => {
        try {
            return await evaluate(source, "document.readyState === 'complete' && typeof window.colabImprimirFicha === 'function'", { awaitPromise: false });
        } catch (_) {
            return false;
        }
    }, 30000, 'Carga de index.html');
    const prepared = await evaluate(source, scenarioScript(kind));
    if (!prepared?.ready) throw new Error('La función de impresión no está disponible');
    await evaluate(source, 'window.colabImprimirFicha()', { userGesture: true, awaitPromise: false });

    const printTarget = await waitFor(async () => {
        const targets = await jsonApi(port, '/json/list');
        return targets.find(target => target.type === 'page' && !beforeIds.has(target.id));
    }, 10000, 'Apertura de ventana de impresión');
    const print = await connectTarget(port, printTarget.id);
    const printErrors = [];
    print.on('Runtime.exceptionThrown', event => printErrors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Runtime error'));
    print.on('Log.entryAdded', event => {
        if (event.entry?.level === 'error') printErrors.push(event.entry.text || 'Log error');
    });
    await waitFor(async () => {
        try {
            return await evaluate(print, "document.title === 'Ficha del Colaborador' && document.querySelectorAll('.colab-curso-item').length > 0", { awaitPromise: false });
        } catch (_) {
            return false;
        }
    }, 25000, 'Preparación de la ficha impresa');
    await print.send('Emulation.setEmulatedMedia', { media: 'print' });
    const layout = await evaluate(print, `(() => {
        const display = selector => { const el = document.querySelector(selector); return el ? getComputedStyle(el).display : null; };
        const visibility = selector => { const el = document.querySelector(selector); return el ? getComputedStyle(el).visibility : null; };
        const root = document.getElementById('colab-ficha-content');
        return {
            rootPosition: root ? getComputedStyle(root).position : null,
            rootOverflow: root ? getComputedStyle(root).overflow : null,
            rootHeight: root?.scrollHeight || 0,
            bodyHeight: document.body.scrollHeight,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            emergency: [display('.colab-emergency-panel'), visibility('.colab-emergency-panel')],
            civil: [display('.colab-datos-civiles'), visibility('.colab-datos-civiles')],
            cv: [display('.colab-cv-panel'), visibility('.colab-cv-panel')],
            courses: [display('#colab-cursos-list'), visibility('#colab-cursos-list')],
            vacations: [display('#colab-vac-panel'), visibility('#colab-vac-panel')],
            collapsedFolder: display('.colab-cursos-folder-body.collapsed'),
            comments: document.querySelectorAll('#cf-comentarios-list .ca-item').length,
            courseCount: document.querySelectorAll('#colab-cursos-list .colab-curso-item').length,
            vacationCount: document.querySelectorAll('#vac-period-grid .vac-period-card').length,
            hasTailMarker: document.body.textContent.includes('FIN DE FICHA'),
            commentsList: (() => {
                const list = document.querySelector('#cf-comentarios-list .ca-list');
                if (!list) return null;
                const style = getComputedStyle(list);
                return {
                    maxHeight: style.maxHeight,
                    overflow: style.overflow,
                    clientHeight: list.clientHeight,
                    scrollHeight: list.scrollHeight
                };
            })()
        };
    })()`);
    const metrics = await print.send('Page.getLayoutMetrics');
    const contentSize = metrics.cssContentSize || metrics.contentSize;
    const screenshot = await print.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true
    });
    const screenshotPath = path.join(OUTPUT_DIR, `${browserName}-${kind}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    const tailHeight = Math.min(1100, Math.ceil(contentSize.height));
    const tail = await print.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
            x: 0,
            y: Math.max(0, Math.ceil(contentSize.height) - tailHeight),
            width: Math.ceil(contentSize.width),
            height: tailHeight,
            scale: 1
        }
    });
    const tailScreenshotPath = path.join(OUTPUT_DIR, `${browserName}-${kind}-tail.png`);
    fs.writeFileSync(tailScreenshotPath, Buffer.from(tail.data, 'base64'));
    const pdf = await print.send('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        paperWidth: 8.2677,
        paperHeight: 11.6929,
        marginTop: 0.3937,
        marginBottom: 0.3937,
        marginLeft: 0.3937,
        marginRight: 0.3937
    });
    const pdfBuffer = Buffer.from(pdf.data, 'base64');
    const outputPath = path.join(OUTPUT_DIR, `${browserName}-${kind}.pdf`);
    fs.writeFileSync(outputPath, pdfBuffer);
    const document = await PDFDocument.load(pdfBuffer);
    const result = {
        browser: browserName,
        scenario: kind,
        pages: document.getPageCount(),
        bytes: pdfBuffer.length,
        outputPath,
        screenshotPath,
        tailScreenshotPath,
        layout,
        printErrors
    };
    const expectedComments = kind === 'long' ? 22 : 1;
    const expectedCourses = kind === 'long' ? 24 : 1;
    const sectionsVisible = [layout.emergency, layout.civil, layout.cv, layout.courses, layout.vacations]
        .every(([, visibility]) => visibility === 'visible');
    const commentsExpanded = layout.commentsList
        && layout.commentsList.maxHeight === 'none'
        && layout.commentsList.overflow === 'visible'
        && layout.commentsList.scrollHeight <= layout.commentsList.clientHeight + 1;
    if (
        layout.rootPosition !== 'static'
        || layout.rootOverflow !== 'visible'
        || layout.horizontalOverflow
        || !sectionsVisible
        || layout.collapsedFolder !== 'block'
        || layout.comments !== expectedComments
        || layout.courseCount !== expectedCourses
        || layout.vacationCount !== (kind === 'long' ? 8 : 1)
        || !layout.hasTailMarker
        || !commentsExpanded
        || printErrors.length
        || (kind === 'long' && document.getPageCount() < 2)
    ) {
        throw new Error(`Validación de impresión fallida en ${browserName}/${kind}: ${JSON.stringify(result)}`);
    }
    print.close();
    source.close();
    return result;
}

async function runBrowser(browser) {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `aifa-${browser.name}-profile-`));
    const process = spawn(browser.executable, [
        '--headless=new',
        '--disable-gpu',
        '--disable-popup-blocking',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank'
    ], { stdio: 'ignore', windowsHide: true });
    try {
        const port = await readDevToolsPort(profileDir);
        const short = await runScenario(port, browser.name, 'short');
        const long = await runScenario(port, browser.name, 'long');
        return [short, long];
    } finally {
        process.kill();
    }
}

(async () => {
    if (!BROWSERS.length) throw new Error('No se encontró Chrome ni Edge para ejecutar la prueba.');
    const results = [];
    for (const browser of BROWSERS) results.push(...await runBrowser(browser));
    console.log(JSON.stringify({ outputDir: OUTPUT_DIR, results }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
