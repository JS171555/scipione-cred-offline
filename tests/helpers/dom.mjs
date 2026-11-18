// Stub de ambiente de navegador MÍNIMO e honesto: só o que os módulos do app realmente tocam.
//
// Por que existe: src/core/live.js:2 e src/pwa.js:2 chamam addEventListener NO TOPO do módulo, então o stub
// precisa existir ANTES do import. Importar este arquivo já instala tudo (idempotente); installDom() existe para
// quem preferir a forma explícita. Medido na auditoria (7-testes-infra.md §4.2): com addEventListener /
// removeEventListener / navigator os módulos de src/ importáveis em Node puro sobem de 29/39 para 38/39; só
// src/main.js continua exigindo `document` (getElementById no topo, main.js:4) — por isso `document` também existe
// aqui, com createElement e getElementById.
//
// O QUE ESTA CAMADA **NÃO** COBRE (não declare cobertura além disto):
//  - layout, CSS, caixa de modelo, scroll, foco real e ordem de pintura;
//  - querySelector/querySelectorAll: retornam sempre null/[] — o app usa getElementById e referências diretas;
//  - propagação/captura entre elementos: dispatchEvent num elemento NÃO sobe para o pai;
//  - <dialog>.showModal: o método existe, mas nada é modal de verdade e não há evento 'close' automático;
//  - <canvas>.getContext('2d') e createImageBitmap: ausentes DE PROPÓSITO — é exatamente o ramo que
//    src/files/process.js:10-15 degrada com try/catch, e é o que o auditor marcou como camada (c);
//  - URL.createObjectURL/revokeObjectURL: devolvem strings sequenciais e registram as vivas (útil para asserir
//    vazamento), mas não servem bytes nem expiram nada;
//  - window.open / alert / confirm / prompt / print: apenas contabilizados, sem comportamento;
//  - sessionStorage/localStorage: Map em memória, sem cota, sem expiração, sem isolamento entre abas;
//  - service worker, caches, matchMedia (sempre matches:false), navigator.serviceWorker (ausente de propósito:
//    'serviceWorker' in navigator === false faz src/pwa.js:3 não tentar registrar nada);
//  - REDE: este arquivo não toca em fetch — use helpers/fetch-mock.mjs (lá o default é negar rede);
//  - DURABILIDADE em disco e atomicidade real de transação: camada (c), ver helpers/fake-idb.mjs.
//
// Origens falsas: toda URL deste arquivo usa o TLD reservado ".invalid" (não resolve) — ver tests/contracts/no-egress.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const events = globalThis.__scGlobalEvents ?? (globalThis.__scGlobalEvents = new EventTarget());
export const globalEvents = () => events;

const globalListeners = [];   // {type, listener} registrados no alvo global (para resetDom poder remover)
const elementListeners = new Map(); // "tag#tipo" -> contagem (prova de que bind()/on registrou)
const uiCalls = [];           // alert/print/window.open
let objectUrlSeq = 0;
const objectUrls = new Set();

const addGlobalListener = (type, listener) => { globalListeners.push({ type, listener }); };

const mkClassList = () => {
  const set = new Set();
  return {
    _set: set,
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v },
    contains: (c) => set.has(c),
    toString: () => [...set].join(' '),
  };
};
const setClasses = (el, v) => { el.classList._set.clear(); el.classList.add(...String(v ?? '').split(/\s+/).filter(Boolean)) };

export function mkElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), nodeType: 1, style: {}, dataset: {}, attrs: {}, children: [],
    id: '', value: '', checked: false, files: [], disabled: false, textContent_: '',
    classList: mkClassList(), _l: new Map(),
    addEventListener(t, fn) { elementListeners.set(`${tag}#${t}`, (elementListeners.get(`${tag}#${t}`) || 0) + 1); el._l.set(t, [...(el._l.get(t) || []), fn]) },
    removeEventListener(t, fn) { const m = el._l.get(t); if (m) el._l.set(t, m.filter((f) => f !== fn)) },
    dispatchEvent(e) { for (const fn of el._l.get(e?.type) || []) fn(e); return true },
    click() { return el.dispatchEvent({ type: 'click', target: el }) },
    focus() { globalThis.document.activeElement = el },
    blur() { }, remove() { }, scrollTo() { }, submit() { },
    setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); if (k === 'class') setClasses(el, v) },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null },
    removeAttribute(k) { delete el.attrs[k] }, hasAttribute(k) { return k in el.attrs },
    append(...n) { el.children.push(...n.flat().filter(Boolean)) },
    appendChild(n) { el.append(n); return n },
    replaceChildren(...n) { el.children = n.flat().filter(Boolean) },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    showModal() { el.open = true }, show() { el.open = true },
    close() { el.open = false; el.dispatchEvent({ type: 'close', target: el }) },
  };
  Object.defineProperty(el, 'className', { get: () => el.classList.toString(), set: (v) => setClasses(el, v) });
  Object.defineProperty(el, 'textContent', { get: () => el.textContent_, set: (v) => { el.textContent_ = String(v ?? ''); el.children = [] } });
  Object.defineProperty(el, 'innerHTML', { get: () => el._html ?? '', set: (v) => { el._html = String(v ?? ''); el.children = [] } });
  return el;
}

const mkStorage = () => {
  const data = new Map();
  return {
    _data: data,
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => { data.set(String(k), String(v)) },
    removeItem: (k) => { data.delete(String(k)) },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size },
  };
};

export function installDom() {
  if (!globalThis.dispatchEvent) globalThis.dispatchEvent = (e) => events.dispatchEvent(e);
  if (!globalThis.addEventListener) globalThis.addEventListener = (type, listener, opts) => { addGlobalListener(type, listener); return events.addEventListener(type, listener, opts) };
  if (!globalThis.removeEventListener) globalThis.removeEventListener = (type, listener, opts) => events.removeEventListener(type, listener, opts);

  // Node 22 ja expoe um `navigator` nativo (getter apenas leitura) sem onLine/storage -> redefinimos o descritor.
  // O marcador __harness impede que uma reinstalacao apague mudancas do teste (ex.: setOnline(false)).
  if (!globalThis.navigator?.__harness) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, writable: true,
      value: {
        __harness: true, onLine: true, userAgent: 'Mozilla/5.0 (harness de testes) SCIPIONE-CRED', language: 'pt-BR', languages: ['pt-BR'],
        platform: 'Linux x86_64', maxTouchPoints: 0, standalone: false, clipboard: { writeText: async () => { } },
        storage: { persist: async () => true, persisted: async () => true, estimate: async () => ({ usage: 0, quota: 10 * 1048576 }) },
        // serviceWorker de propósito ausente: 'serviceWorker' in navigator === false → src/pwa.js:3 não registra.
      },
    });
  }
  if (!globalThis.sessionStorage) globalThis.sessionStorage = mkStorage();
  if (!globalThis.localStorage) globalThis.localStorage = mkStorage();
  if (!globalThis.matchMedia) globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
  if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  if (!globalThis.location) Object.defineProperty(globalThis, 'location', {
    configurable: true, writable: true,
    value: { origin: 'https://scipione.invalid', href: 'https://scipione.invalid/index.html', protocol: 'https:', host: 'scipione.invalid', hostname: 'scipione.invalid', pathname: '/index.html', search: '', hash: '', assign() { }, replace() { } },
  });
  if (!globalThis.alert) globalThis.alert = (m) => uiCalls.push(['alert', String(m)]);
  if (!globalThis.confirm) globalThis.confirm = () => true;  // a UI pede confirmação antes de ação destrutiva
  if (!globalThis.prompt) globalThis.prompt = () => null;
  if (!globalThis.print) globalThis.print = () => uiCalls.push(['print', '']);
  if (!globalThis.open) globalThis.open = (url) => { uiCalls.push(['open', String(url)]); return { closed: false, location: { href: url }, focus() { }, close() { this.closed = true } } };
  if (!globalThis.window) Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis });

  if (!globalThis.document) {
    const byId = new Map();
    const doc = {
      title: 'SCIPIONE CRED', visibilityState: 'visible', hidden: false, referrer: '', activeElement: null, _byId: byId,
      addEventListener: (type, listener, opts) => { addGlobalListener(type, listener); return events.addEventListener(type, listener, opts) },
      removeEventListener: (type, listener, opts) => events.removeEventListener(type, listener, opts),
      createElement: (t) => mkElement(t),
      createElementNS: (_ns, t) => mkElement(t),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
      createDocumentFragment: () => mkElement('#fragment'),
      querySelector: () => null, querySelectorAll: () => [],
      // getElementById devolve um elemento estavel (memoizado): main.js:4 pega #app no import e depois só replaceChildren.
      getElementById: (id) => { if (!byId.has(id)) byId.set(id, Object.assign(mkElement('div'), { id: String(id) })); return byId.get(id) },
    };
    doc.documentElement = mkElement('html');
    doc.head = mkElement('head');
    doc.body = mkElement('body');
    globalThis.document = doc;
  }

  if (!URL.createObjectURL) URL.createObjectURL = () => { const u = `blob:https://scipione.invalid/${++objectUrlSeq}`; objectUrls.add(u); return u };
  if (!URL.revokeObjectURL) URL.revokeObjectURL = (u) => objectUrls.delete(u);
  return globalThis.document;
}

// Limpa o estado de UI/armazenamento entre testes. NÃO fecha o cofre nem limpa o IndexedDB:
// para isso use resetFakeIndexedDB() (helpers/fake-idb.mjs) e lockNow() (helpers/vault.mjs).
export function resetDom() {
  globalThis.sessionStorage?.clear?.();
  globalThis.localStorage?.clear?.();
  while (globalListeners.length) { const { type, listener } = globalListeners.pop(); events.removeEventListener(type, listener) }
  elementListeners.clear(); uiCalls.length = 0; objectUrls.clear(); objectUrlSeq = 0;
  if (globalThis.document) { globalThis.document.body = mkElement('body'); globalThis.document.head = mkElement('head'); globalThis.document._byId?.clear?.() }
}

// Contador de eventos globais (ex.: 'data-changed' emitido por src/db/idb.js:30).
export function watchGlobalEvent(type) {
  const box = { n: 0, last: null };
  const listener = (e) => { box.n++; box.last = e };
  events.addEventListener(type, listener);
  addGlobalListener(type, listener);
  return { stop: () => events.removeEventListener(type, listener), get count() { return box.n }, get fired() { return box.n > 0 }, get last() { return box.last } };
}

export const liveObjectUrls = () => new Set(objectUrls);
export const uiCallsList = () => [...uiCalls];
export const elementListenerCount = (key) => elementListeners.get(key) ?? 0;
export function setOnline(on) { installDom(); const prev = globalThis.navigator.onLine; globalThis.navigator.onLine = !!on; return prev }

// src/export/lib.js:2 resolve fflate por globalThis.fflate (no browser, via <script>). O vendor é UMD, então é
// avaliado dentro de um wrapper CommonJS falso — a mesma técnica que vivia em tests/backup.test.mjs:2, agora
// centralizada: infraestrutura de harness não deve morar dentro de arquivo de teste (auditoria §6.2).
export function installFFlate() {
  if (globalThis.fflate) return globalThis.fflate;
  const mod = { exports: {} };
  new Function('module', 'exports', readFileSync(ROOT + 'vendor/fflate.min.js', 'utf8'))(mod, mod.exports);
  globalThis.fflate = mod.exports;
  return globalThis.fflate;
}

installDom();
