// src/services/google-drive.js — OAuth de navegador (Google Identity Services) + Drive API v3. Cobertura
// antes deste arquivo: 0% — o módulo não tinha teste nenhum.
//
// LACUNA DE CAMADA (c) — por que connect()/preload() NÃO são chamados aqui:
// `token` e `tokenExpires` (google-drive.js:14) são privados e só são escritos no callback de
// `google.accounts.oauth2.initTokenClient` dentro de connect() (:97-108); `loadGis()` (:51-72) injeta um
// <script> de verdade. Sem um GIS real (ou um falso, que deixaria de ser teste deste módulo) nada adiante
// da guarda de sessão é alcançável. Ficam FORA deste arquivo, e exigem navegador: a montagem do multipart
// (:184-196), o DELETE compensatório de :199-201 quando o `size` devolvido diverge (INTEGRITY), a leitura
// de bytes de downloadBackup (:211-217), responseError (:119-128), a paginação de listBackups (:163-171),
// authMessage (:75-83) e o próprio fluxo de autorização (:84-113).
// NÃO CONFIRMADO: o ramo de token VENCIDO de isConnected() (:30) — exige que alguém escreva `token`, e a
// única escrita é em connect(); sem hack de fonte não há como exercitar (mexer em Date.now não ajuda,
// porque `token` continua null). idem o `revoke` real de :116.
//
// O QUE ESTE ARQUIVO COBRE (camada alcançável sem navegador): parse/import/clear da configuração JSON, o
// override persistido em localStorage, defaultConfig/getConfig/configState/status/isReady/isConnected/
// disconnect, formatSize, sha256 (+ o ramo SECURE sem WebCrypto) e as GUARDAS que barram toda rede antes
// de existir sessão: uploadBackup/listBackups/downloadBackup falham em AUTH, INTEGRITY ou DRIVE com 0
// requisições — a asserção de fetchCalls().length === 0 é a prova comportamental (auditoria §2.7, D1).
//
// Zero rede: helpers/fetch-mock.mjs com default deny; nenhuma rota é registrada neste arquivo.
// Origens fictícias: tudo usa o TLD reservado ".invalid" (tests/contracts/no-egress.test.mjs).
import { resetDom, globalEvents } from '../helpers/dom.mjs';   // efeito de import: window/document/localStorage/navigator
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { installFetchMock, uninstallFetchMock, fetchCalls, deniedCalls } from '../helpers/fetch-mock.mjs';
import { bytesFicticios } from '../helpers/fixtures.mjs';
import * as G from '../../src/services/google-drive.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const CHAVE_STORE = 'scipione.google.oauth';                  // google-drive.js:11

// Clientes OAuth fictícios. O sufixo é citado sem esquema: uma URL de terceiro é proibida em tests/.
const SUFIXO = 'apps.googleusercontent.com';
const clientWeb = (n) => String(9000000000 + n) + '-fictclient' + String(n).padStart(3, '0') + '.' + SUFIXO;
const ORIGEM = 'https://scipione.invalid';                    // location.origin do harness (helpers/dom.mjs)

const jsonDeWeb = (over = {}) => JSON.stringify({
  web: {
    client_id: clientWeb(1),
    project_id: 'projeto-ficticio-invalid',
    auth_uri: ORIGEM + '/o/oauth2',
    javascript_origins: [ORIGEM],
    client_secret: 'segredo-ficticio-NAO-deve-ser-armazenado',
    ...over,
  },
});
const jsonDeInstalled = () => JSON.stringify({
  installed: { client_id: clientWeb(2), project_id: 'projeto-ficticio-invalid' },
});

describe('services/google-drive.js — camada sem navegador (config, hash, guardas de sessão)', () => {
  beforeEach(() => { resetDom(); installFetchMock({ routes: {} }) });
  afterEach(() => { uninstallFetchMock() });

  // ---------- parseClientJson ----------
  it('parseClientJson aceita um JSON de cliente do tipo Web e mapeia para o shape interno', () => {
    assert.deepEqual(G.parseClientJson(jsonDeWeb()), {
      clientId: clientWeb(1),
      projectId: 'projeto-ficticio-invalid',
      type: 'web',
      origins: [ORIGEM],
    });
  });

  it('parseClientJson tolera javascript_origins ausente ou não-array e project_id ausente', () => {
    const semOrigins = JSON.stringify({ web: { client_id: clientWeb(3), project_id: 'p' } });
    assert.deepEqual(G.parseClientJson(semOrigins).origins, []);
    const originsLixo = JSON.stringify({ web: { client_id: clientWeb(4), javascript_origins: 'https://x.invalid' } });
    assert.deepEqual(G.parseClientJson(originsLixo).origins, [], ':41 só aceita array');
    assert.equal(G.parseClientJson(originsLixo).projectId, '', ':41 project_id ausente vira string vazia');
  });

  it('parseClientJson rejeita um cliente "installed" com code INSTALLED', () => {
    assert.throws(() => G.parseClientJson(jsonDeInstalled()), (e) => e.code === 'INSTALLED');
    assert.throws(() => G.parseClientJson(jsonDeInstalled()), /Aplicativo da Web/, 'o texto orienta o operador');
  });

  it('conhecido: um client_id sem wrapper web/installed é recusado como INSTALLED', () => {
    // conhecido: ver docs/ROADMAP.md — :38 deriva `type` só da chave-mestre do JSON (web|installed|
    // unknown) e :39-40 recusa tudo que não for 'web' com a mensagem de "cliente instalado". Um JSON cru
    // de outro formato, portanto, recebe diagnóstico enganoso. Characterization do comportamento real.
    const cru = JSON.stringify({ client_id: clientWeb(5), project_id: 'p' });
    assert.throws(() => G.parseClientJson(cru), (e) => e.code === 'INSTALLED');
  });

  it('parseClientJson rejeita JSON malformado com code CONFIG', () => {
    for (const lixo of ['', '{', 'isso não é json', 'null', '[]', '{"web":']) {
      assert.throws(() => G.parseClientJson(lixo), (e) => e.code === 'CONFIG', 'aceitou ' + JSON.stringify(lixo));
    }
  });

  it('parseClientJson rejeita client_id ausente, numérico ou de outro provedor com code CONFIG', () => {
    const casos = [
      JSON.stringify({ web: { project_id: 'p' } }),
      JSON.stringify({ web: { client_id: 'nao-sou-cliente' } }),
      JSON.stringify({ web: { client_id: '123-abc.apps.example.invalid' } }),
      JSON.stringify({ web: { client_id: 9000 } }),
      JSON.stringify({ installed: { client_id: 'x@y.invalid' } }),
    ];
    for (const c of casos) assert.throws(() => G.parseClientJson(c), (e) => e.code === 'CONFIG', 'aceitou ' + c);
  });

  // ---------- importConfig / getConfig / clearConfig (localStorage) ----------
  it('importConfig persiste o override e getConfig passa a devolvê-lo', () => {
    const importado = G.importConfig(jsonDeWeb());
    assert.equal(importado.clientId, clientWeb(1));
    assert.equal(G.getConfig().clientId, clientWeb(1), 'o override vence o default de src/config/google.js');
    assert.equal(G.getConfig().type, 'web');
  });

  it('CARACTERIZAÇÃO: a config fica EM CLARO no localStorage, com client_secret descartado', () => {
    // conhecido: ver docs/ROADMAP.md:445 — :45 grava JSON cru na chave 'scipione.google.oauth' com
    // clientId e projectId legíveis. Um client_id de "Aplicativo da Web" é público por design (não há
    // segredo no navegador, como declara :3), mas a chave é lida por qualquer script do mesmo domínio e
    // o projectId revela o mapa da infraestrutura. Nenhum teste registrava isso antes.
    G.importConfig(jsonDeWeb());
    const crua = globalThis.localStorage.getItem(CHAVE_STORE);
    assert.ok(crua, 'a chave existe no storage do harness');
    assert.ok(crua.includes('"clientId"'), 'campo clientId em claro');
    assert.ok(crua.includes(clientWeb(1)), 'o client_id aparece literalmente');
    assert.ok(crua.includes('projeto-ficticio-invalid'), 'project_id em claro');
    assert.ok(!crua.includes('client_secret'), 'o segredo do JSON importado NÃO é persistido');
    assert.deepEqual(JSON.parse(crua).origins, [ORIGEM]);
  });

  it('um override salvo com type diferente de "web" é descartado e REMOVIDO do storage', () => {
    globalThis.localStorage.setItem(CHAVE_STORE, JSON.stringify({ clientId: clientWeb(6), type: 'installed' }));
    assert.equal(G.getConfig().clientId, G.defaultConfig().clientId, 'cai no default');
    assert.equal(globalThis.localStorage.getItem(CHAVE_STORE), null, ':18 limpa a sujeira');
  });

  it('um override corrompido (JSON inválido ou sem clientId) cai no default sem lançar', () => {
    for (const lixo of ['{quebrado', 'null', '{}', '{"clientId":""}', '[1,2]', '"texto"']) {
      globalThis.localStorage.setItem(CHAVE_STORE, lixo);
      assert.equal(G.getConfig().clientId, G.defaultConfig().clientId, 'lixo aceito: ' + lixo);
    }
  });

  it('clearConfig remove a chave, derruba o override e é idempotente', () => {
    G.importConfig(jsonDeWeb());
    G.clearConfig();
    assert.equal(globalThis.localStorage.getItem(CHAVE_STORE), null);
    assert.equal(G.getConfig().clientId, G.defaultConfig().clientId);
    assert.doesNotThrow(() => G.clearConfig(), 'limpar duas vezes não explode');
  });

  it('defaultConfig devolve cópia nova, sem segredo, com origins como array', () => {
    const a = G.defaultConfig();
    assert.equal(a.type, 'web');
    assert.match(a.clientId, /apps\.googleusercontent\.com$/);
    assert.ok(Array.isArray(a.origins), 'origins é sempre lista');
    assert.ok(!('client_secret' in a), 'client_secret nunca chega ao navegador');
    a.clientId = 'mutavel';
    assert.notEqual(G.defaultConfig().clientId, 'mutavel', 'o objeto de src/config/google.js não é exposto');
  });

  // ---------- configState / status ----------
  it('configState com o default: configurado, mas a origem do harness não está na lista', () => {
    const st = G.configState();
    assert.equal(st.configured, true, 'type web + clientId → :26 configured true');
    assert.equal(st.origin, ORIGEM);
    assert.equal(st.originListed, false, 'o cliente default não autoriza esta origem de teste');
    assert.equal(typeof st.clientId, 'string');
  });

  it('configState com override casa a origem por URL (caminho irrelevante) e tolera não-URL', () => {
    G.importConfig(jsonDeWeb({ javascript_origins: [ORIGEM + '/index.html'] }));
    assert.equal(G.configState().originListed, true, ':25 compara new URL(x).origin, não o caminho');

    G.importConfig(jsonDeWeb({ javascript_origins: ['scipione.invalid'] }));
    assert.equal(G.configState().originListed, false, 'ramo de catch: compara cru com location.origin');

    G.importConfig(jsonDeWeb({ javascript_origins: [ORIGEM] }));
    assert.equal(G.configState().originListed, true);
  });

  it('configState não explode com origins não-array e descarta override não-web', () => {
    globalThis.localStorage.setItem(CHAVE_STORE, JSON.stringify({ clientId: clientWeb(7), type: 'web', origins: 'https://x.invalid' }));
    const st = G.configState();
    assert.deepEqual(st.origins, [], ':25 normaliza para lista');
    assert.equal(st.configured, true);
    assert.equal(st.originListed, false);

    globalThis.localStorage.setItem(CHAVE_STORE, JSON.stringify({ clientId: clientWeb(8), type: 'installed', origins: [] }));
    assert.equal(G.configState().configured, true, ':18 descarta o override → volta o default, que é configurado');
    assert.equal(G.configState().clientId, G.defaultConfig().clientId);
  });

  it('status é configState + connected:false (nenhuma sessão existe sem connect)', () => {
    const st = G.status();
    assert.equal(st.connected, false);
    assert.equal(st.origin, ORIGEM);
    assert.equal(typeof st.configured, 'boolean');
    assert.ok(!('token' in st) && !('access_token' in st), 'status não vaza token');
  });

  // ---------- sessão / GIS ----------
  it('isConnected é falso sem token e disconnect é seguro sem Google no ambiente', () => {
    assert.equal(G.isConnected(), false);
    assert.doesNotThrow(() => G.disconnect());
    assert.equal(G.isConnected(), false, 'disconnect sem token não cria estado');
    assert.equal(G.isReady(), false, 'window.google.accounts.oauth2 ausente → :50 falso');
  });

  it('isReady vê um GIS presente sem nada ser chamado, e disconnect não revoga sem token', () => {
    let chamadasDeRevoke = 0;
    const real = globalThis.window.google;
    globalThis.window.google = {
      accounts: {
        oauth2: {
          revoke: () => { chamadasDeRevoke++ },
          initTokenClient: () => { throw new Error('GIS não deve ser usado por este teste') },
        },
      },
    };
    try {
      assert.equal(G.isReady(), true);
      G.disconnect();
      assert.equal(chamadasDeRevoke, 0, ':116 só revoga se havia token');
      assert.equal(G.isConnected(), false);
    } finally {
      if (real === undefined) delete globalThis.window.google; else globalThis.window.google = real;
    }
    assert.equal(G.isReady(), false, 'ambiente restaurado');
  });

  // ---------- formatSize ----------
  it('formatSize: ausente/negativo/0/B/KB/MB com vírgula decimal', () => {
    assert.equal(G.formatSize(undefined), '', 'ausente coage para NaN → vazio');
    assert.equal(G.formatSize(NaN), '');
    assert.equal(G.formatSize(Infinity), '');
    assert.equal(G.formatSize(-1), '');
    assert.equal(G.formatSize(-1024), '');
    assert.equal(G.formatSize(0), '0 B');
    assert.equal(G.formatSize(1), '1 B');
    assert.equal(G.formatSize(999), '999 B');
    assert.equal(G.formatSize(1023), '1023 B');
    assert.equal(G.formatSize(1024), '1,0 KB');
    assert.equal(G.formatSize(1536), '1,5 KB');
    assert.equal(G.formatSize(1048576), '1,0 MB');
    assert.equal(G.formatSize(2621440), '2,5 MB');
    assert.equal(G.formatSize('2048'), '2,0 KB', 'string numérica é coagida por Number');
  });

  it('conhecido: null vira "0 B" e 1048575 vira "1024,0 KB" (assimetrias de coerção/arredondamento)', () => {
    // conhecido: ver docs/ROADMAP.md — :221 faz Number(value): null coage para 0 e é exibido como
    // "0 B", enquanto undefined/NaN viram ''. Em :224 o toFixed(1) pode arredondar para a unidade
    // seguinte (1048575 B = 1023,999 KB é mostrado como "1024,0 KB"). Characterization.
    assert.equal(G.formatSize(null), '0 B');
    assert.notEqual(G.formatSize(null), G.formatSize(undefined));
    assert.equal(G.formatSize(1048575), '1024,0 KB');
  });

  // ---------- sha256 ----------
  it('sha256 é determinístico, hex-64 e bate com node:crypto nos mesmos bytes fictícios', async () => {
    const bytes = bytesFicticios(64, 3);
    const esperado = createHash('sha256').update(bytes).digest('hex');
    const obtido = await G.sha256(bytes);
    assert.equal(obtido, esperado, 'o digest WebCrypto coincide com o de node:crypto');
    assert.match(obtido, /^[a-f0-9]{64}$/);
    assert.equal(await G.sha256(bytes), obtido, 'mesma entrada, mesma saída');
    assert.notEqual(await G.sha256(bytesFicticios(64, 4)), obtido, 'mudar 1 byte muda o digest');
  });

  it('sha256 sem WebCrypto é SECURE (ramo de contexto não seguro)', async () => {
    const descr = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: { random: Math.random } });
    try {
      assert.ok(!globalThis.crypto.subtle, 'harness sem crypto.subtle');
      await assert.rejects(G.sha256(bytesFicticios(4)), (e) => e.code === 'SECURE');
      await assert.rejects(G.sha256(bytesFicticios(4)), /HTTPS/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', descr);
    }
    const vazio = new Uint8Array(0);
    assert.equal(await G.sha256(vazio), createHash('sha256').update(vazio).digest('hex'),
      'WebCrypto restaurada: o digest volta a funcionar');
  });

  // ---------- guardas que barram a rede ----------
  it('uploadBackup: bytes vazios ou de outro tipo são INTEGRITY antes de qualquer rede', async () => {
    await assert.rejects(G.uploadBackup(new Uint8Array(0)), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.uploadBackup(new Uint8Array(0), { name: 'vazio.zip' }), /vazio/);
    await assert.rejects(G.uploadBackup(null), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.uploadBackup('string'), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.uploadBackup([1, 2, 3]), (e) => e.code === 'INTEGRITY');
    assert.equal(fetchCalls().length, 0);
  });

  it('uploadBackup sem sessão é AUTH e não toca na rede (a guarda vem antes do multipart)', async () => {
    await assert.rejects(G.uploadBackup(bytesFicticios(16), { name: 'backup-ficticio.zip' }), (e) => e.code === 'AUTH');
    await assert.rejects(G.uploadBackup(bytesFicticios(16), { name: 'backup-ficticio.zip', encrypted: true }), (e) => e.code === 'AUTH');
    await assert.rejects(G.uploadBackup(bytesFicticios(16)), /Conecte novamente/);
    assert.equal(fetchCalls().length, 0, ':130 corta antes do fetch: nada é montado nem enviado');
    assert.deepEqual(deniedCalls(), []);
  });

  it('listBackups sem sessão é AUTH, com 0 chamadas', async () => {
    await assert.rejects(G.listBackups(), (e) => e.code === 'AUTH');
    await assert.rejects(G.listBackups(), /Conecte novamente/);
    assert.equal(fetchCalls().length, 0);
  });

  it('downloadBackup valida a entrada antes da sessão: DRIVE, INTEGRITY e por fim AUTH', async () => {
    await assert.rejects(G.downloadBackup(null), (e) => e.code === 'DRIVE');
    await assert.rejects(G.downloadBackup({}), (e) => e.code === 'DRIVE');
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-1' }), (e) => e.code === 'INTEGRITY', 'sem appProperties.sha256');
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-1', appProperties: { sha256: 'nao-hex' } }), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-1', appProperties: { sha256: 'a'.repeat(63) } }), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-1', appProperties: { sha256: 'a'.repeat(65) } }), (e) => e.code === 'INTEGRITY');
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-1', appProperties: { sha256: 'a'.repeat(64) } }), (e) => e.code === 'AUTH');
    assert.equal(fetchCalls().length, 0, 'a rota alt=media só seria pedida com sessão');
  });

  it('conhecido: o sha256 esperado é normalizado para minúsculas antes do teste de formato', async () => {
    // conhecido: ver docs/ROADMAP.md — :208 aplica toLowerCase() antes da guarda de formato (:209), então
    // um appProperties.sha256 MAIÚSCULO passa pela guarda e a comparação de :215 (que usa o hex minúsculo
    // de :174) só aconteceria com sessão. Sem sessão, o que se observa é a aceitação do formato.
    await assert.rejects(G.downloadBackup({ id: 'arquivo-ficticio-2', appProperties: { sha256: 'AB'.repeat(32) } }), (e) => e.code === 'AUTH');
    assert.equal(fetchCalls().length, 0);
  });

  it('estático: o contrato de integridade do upload (size divergente → DELETE → INTEGRITY) existe na ordem certa', () => {
    // Camada (c): esta ramificação só dispara com sessão real (ver header). Fixamos por inspeção de fonte a ordem
    // que o teste de navegador deveria provar: conferir size → apagar o arquivo → lançar INTEGRITY.
    // Estilo compartilhado com tests/contracts/imports.test.mjs (leitura de fonte, zero rede).
    const src = readFileSync(ROOT + 'src/services/google-drive.js', 'utf8');
    const iTamanho = src.indexOf('file.size!=null');
    const iDelete = src.indexOf("method:'DELETE'");
    const iIntegrity = src.indexOf('O envio foi cancelado');
    assert.ok(iTamanho > -1 && iDelete > iTamanho && iIntegrity > iDelete,
      'o DELETE compensatório tem de vir antes do throw de INTEGRITY');
    assert.ok(src.includes('appProperties:{app:APP,sha256:hash,encrypted:'), 'metadata do multipart leva app/sha256/encrypted');
    assert.ok(src.includes('uploadType=multipart'), 'o envio usa multipart com related boundary');
    assert.equal(src.indexOf('file.size!=null', iTamanho + 1) > iIntegrity, true, 'downloadBackup confere size de novo (:213)');
  });

  it('nenhuma requisição saiu do mock ao longo do arquivo (default deny intacto)', () => {
    assert.deepEqual(deniedCalls(), [], 'nada bateu em rota desconhecida');
    assert.equal(fetchCalls().length, 0);
    assert.ok(globalEvents(), 'o alvo global do harness segue vivo (este módulo não registra listeners)');
  });
});
