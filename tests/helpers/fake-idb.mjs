// IndexedDB falso, determinístico e sem dependências, cobrindo exatamente a superfície que o SCIPIONE CRED usa.
//
// Superfície medida na auditoria (7-testes-infra.md §4.4): open · createObjectStore · createIndex · transaction ·
// objectStore · get · getAll · put · delete · count · clear · onupgradeneeded/onsuccess/onerror ·
// oncomplete/onabort/onversionchange · abort · objectStoreNames.
//
// NÃO SIMULADO (deliberado; nada em src/ usa e nenhum teste deve usar):
//  - cursores (openCursor/openKeyCursor) e IDBKeyRange — o app lê com getAll e filtra em JS (src/services/records.js:5);
//  - consultas por índice: createIndex é aceito e o nome apenas registrado; .index(nome) lança;
//  - multi-aba, locks entre transações concorrentes e o objeto IDBVersionChangeEvent real;
//  - durabilidade em disco: a opção {durability:'strict'} (src/db/idb.js:20 e :28) é ACEITA E IGNORADA.
//    Este harness portanto NÃO prova garantia de escrita em disco — isso é camada (c), em navegador real;
//  - assincronia de I/O: os callbacks são agendados em microtarefa (determinismo), não na thread de I/O do browser.
//
// Semântica preservada (é o que impede o fake de virar teatro):
//  1. a Promise do open() só resolve depois de onupgradeneeded → onsuccess, com migrations em cascata de
//     oldVersion até version — exatamente o laço de src/db/idb.js:14;
//  2. uma transação não tem efeito visível antes de oncomplete: as escritas ficam no buffer da transação;
//  3. abort() (ou falha injetada) descarta TODAS as escritas e dispara onerror/onabort com `error`;
//  4. put() grava por valor com structuredClone — o que sai do banco não é o objeto do teste;
//  5. um request só ganha `result` quando a transação completa, nunca antes;
//  6. conexão fechada (close() ou versionchange) faz transaction() lançar InvalidStateError;
//  7. versionchange chama o handler da conexão ANTES de fechá-la, para que src/db/idb.js:15 limpe o singleton `p`.
//
// Hooks de defeito: failNext('put'), failNext('get'), blockedOnce(), triggerVersionchange(), failVersionchange().
//
// O helper também publica o EventTarget global compartilhado (__scGlobalEvents): é onde src/core/live.js:2
// registra 'data-changed' e de onde src/db/idb.js:30 faz dispatch.

const target = globalThis.__scGlobalEvents ?? (globalThis.__scGlobalEvents = new EventTarget());
if (!globalThis.dispatchEvent) globalThis.dispatchEvent = (e) => target.dispatchEvent(e);
if (!globalThis.addEventListener) globalThis.addEventListener = (...a) => target.addEventListener(...a);
if (!globalThis.removeEventListener) globalThis.removeEventListener = (...a) => target.removeEventListener(...a);
export const globalEvents = () => target;

const Databases = new Map();
const Defects = { fail: new Map(), blocked: false, stubbornVersionchange: false };
const live = new Set();          // conexões abertas
const pendingOpens = new Set();  // requisições de open ainda não confirmadas

const tick = (fn) => queueMicrotask(fn);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const idbErr = (name, msg) => Object.assign(new Error(msg), { name });

// keyPath do createObjectStore define DE ONDE sai a chave: 'meta'/'settings' usam keyPath 'key' e o app grava
// put({key:'vault',...}) sem chave separada; as stores de negócio usam keyPath 'id' (src/db/idb.js:3-8).
const keyOf = (keyPath, value) => {
  if (keyPath == null) throw idbErr('DataError', 'fake-idb: put(valor) exige keyPath na store (ou chave explícita)');
  const k = Array.isArray(keyPath) ? keyPath.map((p) => value[p]) : value[keyPath];
  if (k === undefined || k === null) throw idbErr('DataError', `fake-idb: chave "${[].concat(keyPath)}" ausente/NULL no registro gravado`);
  return k;
};

class Request {
  constructor() { this.result = undefined; this.error = null; this.readyState = 'pending'; this.onsuccess = null; this.onerror = null; }
  _ok(v) { this.readyState = 'done'; this.result = v; this.onsuccess?.call(this, { type: 'success', target: this }); }
  _ko(e) { this.readyState = 'done'; this.error = e ?? null; this.onerror?.call(this, { type: 'error', target: this }); }
}

class Tx {
  constructor(db, names, mode, opts) {
    this.db = db; this.mode = mode || 'readonly'; this.durability = opts?.durability; // lido e IGNORADO (ver cabeçalho)
    this.names = names; this.buffers = new Map(); this.requests = [];
    this.state = 'finished'; this.error = null;
    this.oncomplete = null; this.onerror = null; this.onabort = null;
  }
  objectStore(name) {
    if (this.state !== 'active') throw idbErr('InvalidStateError', `fake-idb: transação não está ativa (${this.state})`);
    if (!this.names.includes(name)) throw idbErr('NotFoundError', `fake-idb: "${name}" não está no escopo desta transação`);
    return new Store(this.db.stores[name], this, name);
  }
  _buffer(name) {
    let b = this.buffers.get(name);
    if (!b) { b = { puts: new Map(), dels: new Set(), cleared: false }; this.buffers.set(name, b); }
    return b;
  }
  _snapshot() { // estado efetivo no instante do commit: buffer aplicado sobre o que já estava gravado
    const snap = {};
    for (const [name, st] of Object.entries(this.db.stores)) {
      const rows = new Map(st.rows); const b = this.buffers.get(name);
      if (b) { if (b.cleared) rows.clear(); for (const k of b.dels) rows.delete(k); for (const [k, v] of b.puts) rows.set(k, v); }
      snap[name] = rows;
    }
    return snap;
  }
  _settle(reqs) {
    const failed = reqs.filter((r) => r.fault);
    this.state = 'finished';
    if (!this.error && failed.length) this.error = failed[0].fault;
    if (this.error) { // rollback: nenhum buffer chega ao banco
      for (const r of reqs) r._ko(this.error);
      this.onerror?.call(this, { type: 'error', target: this });
      this.onabort?.call(this, { type: 'abort', target: this });
      return;
    }
    for (const name of this.names) { // commit
      const b = this.buffers.get(name); if (!b) continue;
      const st = this.db.stores[name];
      if (b.cleared) st.rows.clear();
      for (const k of b.dels) st.rows.delete(k);
      for (const [k, v] of b.puts) st.rows.set(k, v);
    }
    const snap = this._snapshot();
    for (const r of reqs) {
      if (r.op === 'get') r._ok(clone(snap[r.store].get(r.key)));
      else if (r.op === 'getAll') r._ok(clone([...snap[r.store].values()]));
      else if (r.op === 'count') r._ok(snap[r.store].size);
      else if (r.op === 'put') r._ok(r.key);
      else r._ok(undefined);
    }
    this.oncomplete?.call(this, { type: 'complete', target: this });
  }
  complete() { if (this.state === 'active') this._settle(this.requests); }
  abort(error) {
    if (this.state !== 'active') return;
    this.error = error ?? idbErr('AbortError', 'fake-idb: transação cancelada por abort()');
    this._settle(this.requests);
  }
}

class Store {
  constructor(meta, tx, name) { this.tx = tx; this.name = name; this.meta = meta; this.keyPath = meta.keyPath; }
  createIndex(n) { this.meta.indexes.add(n); return { name: n, keyPath: n, multiEntry: false, unique: false }; }
  deleteIndex(n) { this.meta.indexes.delete(n); }
  index(n) { throw idbErr('NotSupportedError', `fake-idb: índices não são consultáveis neste harness (o app usa getAll) — "${n}"`); }
  openCursor() { throw idbErr('NotSupportedError', 'fake-idb: cursores não são simulados neste harness'); }
  _req(op, extra) {
    const r = new Request(); Object.assign(r, { tx: this.tx, store: this.name, op }, extra);
    const faults = Defects.fail.get(op);
    if (faults?.length) r.fault = faults.shift() ?? idbErr('ConstraintError', `fake-idb: "${op}" falhou (falha injetada pelo teste)`);
    this.tx.requests.push(r);
    tick(() => this.tx.complete()); // uma microtarefa depois do bloco síncrono que emite os requests
    return r;
  }
  get(key) { return this._req('get', { key: clone(key) }); }
  getAll(query) { if (query !== undefined) throw idbErr('NotSupportedError', 'fake-idb: getAll(query) não é simulado'); return this._req('getAll'); }
  count(key) { if (key !== undefined) throw idbErr('NotSupportedError', 'fake-idb: count(key) não é simulado'); return this._req('count'); }
  put(value, key) {
    const k = key === undefined ? clone(keyOf(this.keyPath, value)) : clone(key);
    const r = this._req('put', { key: k });
    if (!r.fault) this.tx._buffer(this.name).puts.set(k, clone(value));
    return r;
  }
  add(value, key) { return this.put(value, key); } // o app não usa add; mapeado para put por compatibilidade
  delete(key) {
    const r = this._req('delete', { key: clone(key) });
    if (!r.fault) { const b = this.tx._buffer(this.name); b.puts.delete(r.key); b.dels.add(r.key); }
    return r;
  }
  clear() {
    const r = this._req('clear');
    if (!r.fault) { const b = this.tx._buffer(this.name); b.puts.clear(); b.dels.clear(); b.cleared = true; }
    return r;
  }
}

class Connection {
  constructor(db, name) { this.db = db; this.name = name; this.version = db.version; this.onversionchange = null; this._closed = false; this._upgradeTx = null }
  // No IndexedDB real createObjectStore/deleteObjectStore são métodos DA CONEXÃO e só valem dentro de
  // onupgradeneeded — é assim que src/db/idb.js:3-8 chama (r.result.createObjectStore).
  createObjectStore(name, opts = {}) {
    if (!this._upgradeTx) throw idbErr('InvalidStateError', `fake-idb: createObjectStore("${name}") só é permitido em onupgradeneeded`);
    if (this.db.stores[name]) throw idbErr('ConstraintError', `fake-idb: a store "${name}" já existe`);
    this.db.stores[name] = { keyPath: opts.keyPath ?? null, indexes: new Set(), rows: new Map(), autoIncrement: !!opts.autoIncrement };
    return new Store(this.db.stores[name], this._upgradeTx, name);
  }
  deleteObjectStore(name) {
    if (!this._upgradeTx) throw idbErr('InvalidStateError', `fake-idb: deleteObjectStore("${name}") só é permitido em onupgradeneeded`);
    delete this.db.stores[name];
  }
  transaction(names, mode, opts) {
    if (this._closed) throw idbErr('InvalidStateError', 'fake-idb: conexão fechada (close/versionchange)');
    const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
    for (const n of list) if (!this.db.stores[n]) throw idbErr('NotFoundError', `fake-idb: a store "${n}" não existe`);
    const tx = new Tx(this.db, list, mode, opts);
    tx.state = 'active';
    tick(() => tx.complete()); // transação sem request também chega ao fim
    return tx;
  }
  close() { this._closed = true; live.delete(this); }
  get objectStoreNames() {
    const names = Object.keys(this.db.stores);
    return { contains: (n) => names.includes(n), length: names.length, item: (i) => names[i] ?? null, *[Symbol.iterator]() { yield* names } };
  }
}

class FakeIDBFactory {
  open(name, version) {
    const req = new Request();
    req.transaction = null; req.onupgradeneeded = null; req.onblocked = null;
    pendingOpens.add(req);
    tick(() => {
      if (!pendingOpens.has(req)) return;         // cancelada por resetFakeIndexedDB()
      pendingOpens.delete(req);
      if (Defects.blocked) { Defects.blocked = false; req.onblocked?.call(req, { type: 'blocked' }); return; }
      const existing = Databases.get(name);
      const oldVersion = existing ? existing.version : 0;
      const next = version == null ? Math.max(oldVersion, 1) : version;
      if (next < oldVersion) { req._ko(idbErr('VersionError', `fake-idb: versão ${next} é mais antiga que ${oldVersion}`)); return; }
      const db = existing ?? { name, version: 0, stores: {} };
      Databases.set(name, db);
      req.result = new Connection(db, name);
      req.result.version = next;
      if (next > oldVersion) {
        const vtx = new Tx(db, [], 'versionchange');
        vtx.state = 'active';
        req.result._upgradeTx = vtx;
        req.transaction = vtx;
        try { req.onupgradeneeded?.call(req, { type: 'upgradeneeded', oldVersion, newVersion: next, target: req }) }
        finally { vtx.complete(); req.result._upgradeTx = null }
      }
      db.version = next;
      live.add(req.result);
      req._ok(req.result);
    });
    return req;
  }
  deleteDatabase(name) { const req = new Request(); tick(() => { Databases.delete(name); req._ok(undefined) }); return req; }
  databases() { const req = new Request(); tick(() => req._ok([...Databases].map(([n, d]) => ({ name: n, version: d.version })))); return req; }
}

export function installFakeIndexedDB() {
  if (!(globalThis.indexedDB instanceof FakeIDBFactory)) globalThis.indexedDB = new FakeIDBFactory();
  return globalThis.indexedDB;
}

// Esvazia as stores, zera os defeitos e derruba as conexões abertas — disparando onversionchange nelas para que
// src/db/idb.js:15 limpe o singleton `p` e a próxima chamada abra uma conexão nova sobre o banco vazio.
export function resetFakeIndexedDB() {
  for (const req of [...pendingOpens]) { try { req._ko(idbErr('AbortError', 'fake-idb: resetFakeIndexedDB() durante o open()')) } catch { } }
  pendingOpens.clear();
  for (const conn of [...live]) { try { conn.onversionchange?.({ type: 'versionchange', target: conn }) } catch { }; conn._closed = true }
  live.clear();
  for (const db of Databases.values()) for (const st of Object.values(db.stores)) st.rows.clear();
  Defects.fail = new Map(); Defects.blocked = false; Defects.stubbornVersionchange = false;
}

export function openDatabase({ name = 'scipione-cred', version = 1, upgrade } = {}) {
  return new Promise((resolve, reject) => {
    const req = installFakeIndexedDB().open(name, version);
    req.onupgradeneeded = (e) => { try { upgrade?.(req.result, e.oldVersion, req.transaction, e) } catch (err) { reject(err) } };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('fake-idb: open() falhou sem Error definido'));
    req.onblocked = () => reject(idbErr('BlockedError', 'fake-idb: open() bloqueado por outra conexão'));
  });
}

export function failNext(op, error) {
  installFakeIndexedDB();
  if (!Defects.fail.has(op)) Defects.fail.set(op, []);
  Defects.fail.get(op).push(error ?? null);
  return op;
}
export function blockedOnce() { Defects.blocked = true }
export function failVersionchange(on = true) { Defects.stubbornVersionchange = on; return on }
export function triggerVersionchange({ name = 'scipione-cred' } = {}) {
  const conn = [...live].find((c) => c.name === name);
  if (!conn) return false;
  if (Defects.stubbornVersionchange) return false;      // aba teimosa: ignora o pedido e continua segurando a versão
  conn.onversionchange?.({ type: 'versionchange', target: conn });
  conn.close();
  return true;
}
export function fakeStats() {
  return [...Databases].map(([name, db]) => ({ name, version: db.version, stores: Object.fromEntries(Object.entries(db.stores).map(([s, m]) => [s, m.rows.size])) }));
}
export function dumpStore(store, { name = 'scipione-cred' } = {}) {
  const db = Databases.get(name);
  if (!db) throw new Error(`fake-idb: o banco "${name}" ainda não foi criado`);
  if (!db.stores[store]) throw new Error(`fake-idb: a store "${store}" não existe`);
  return clone([...db.stores[store].rows.values()]);
}
export function isFakeIndexedDB() { return globalThis.indexedDB instanceof FakeIDBFactory }

installFakeIndexedDB();
