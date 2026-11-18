// src/export/backup-format.js — envelope do backup (ZIP + manifest + SHA-256 por entrada) e a validação
// referencial. Cases cifrados usam a senha só por custo legítimo de PBKDF2 (600k) — por isso são poucos.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFFlate } from '../helpers/dom.mjs';
import { conjuntoBackup, bytesFicticios, SENHA_TESTE } from '../helpers/fixtures.mjs';

installFFlate();                                  // src/export/lib.js:2 resolve fflate por global (no browser, <script>)
const BF = await import('../../src/export/backup-format.js');
const F = globalThis.fflate;

const lerManifest = (zip) => JSON.parse(F.strFromU8(F.unzipSync(zip)['manifest.json']));

describe('backup-format: constantes do contrato', () => {
  it('FORMAT=1, ITER=600000 e LISTS fecha o envelope versionado', () => {
    assert.equal(BF.FORMAT, 1);
    assert.equal(BF.ITER, 600000);
    assert.deepEqual(BF.LISTS, ['clients', 'debts', 'documents', 'history']);
  });
});

describe('backup-format: envelope sem senha', () => {
  let zip, manifest, entradas, saida;
  before(async () => {
    zip = await BF.buildBackup(conjuntoBackup(), null);
    entradas = F.unzipSync(zip);
    manifest = lerManifest(zip);
    saida = await BF.readBackup(zip);
  });

  it('ZIP contém data/<lista>.json para cada LISTS + settings, e manifest.json por último', () => {
    assert.deepEqual(Object.keys(entradas), ['data/clients.json', 'data/debts.json', 'data/documents.json', 'data/history.json', 'data/settings.json', 'files/blb-1.bin', 'manifest.json'],
      'uma entrada files/<blobId>.bin por anexo e manifest.json por último');
  });
  it('manifest traz app, formatVersion, encrypted:false, dbVersion, counts e sha256', () => {
    assert.equal(manifest.app, 'SCIPIONE CRED');
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.encrypted, false);
    assert.equal(manifest.dbVersion, 1);
    assert.deepEqual(manifest.counts, { clients: 2, debts: 2, documents: 1, history: 2, files: 1 });
    assert.deepEqual(Object.keys(manifest.sha256).sort(), Object.keys(entradas).filter((k) => k !== 'manifest.json').sort());
    assert.match(manifest.sha256['data/clients.json'], /^[0-9a-f]{64}$/);
  });
  it('data/*.json são JSON em claro (o backup sem senha expõe PII por design)', () => {
    const clients = JSON.parse(F.strFromU8(entradas['data/clients.json']));
    assert.equal(clients[0].name, 'Maria Exemplo 01');
    assert.ok(F.strFromU8(entradas['data/clients.json']).includes('Maria Exemplo 01'), 'sem senha os nomes ficam legíveis no conteúdo da entrada');
  });
  it('round-trip preserva contagens, valores numéricos e bytes dos arquivos', () => {
    assert.equal(saida.manifest.counts.clients, 2);
    assert.deepEqual(saida.data.debts[0].principal, 500000);        // number, não string
    assert.deepEqual([...saida.data.files.get('blb-1')], [...bytesFicticios(100, 0)]);
  });
  it('readBackup devolve {manifest, data} com files como Map', () => {
    assert.deepEqual(Object.keys(saida), ['manifest', 'data']);
    assert.ok(saida.data.files instanceof Map);
    assert.deepEqual(saida.data.settings, { dueWindow: 7 });
  });
  it('datasets vazios (0 registros) passam', async () => {
    const vazio = await BF.buildBackup(conjuntoBackup({ clientes: 0, dividas: 0, documentos: 0, historicos: 0 }), null);
    assert.equal((await BF.readBackup(vazio)).manifest.counts.clients, 0);
  });
});

describe('backup-format: envelope com senha', () => {
  let cifrado, externo;
  before(async () => {
    cifrado = await BF.buildBackup(conjuntoBackup(), SENHA_TESTE);
    externo = F.unzipSync(cifrado);
  });
  it('ZIP externo tem só manifest.json + payload.enc e o manifest declara o KDF', () => {
    assert.deepEqual(Object.keys(externo), ['manifest.json', 'payload.enc']);
    const m = JSON.parse(F.strFromU8(externo['manifest.json']));
    assert.deepEqual({ app: m.app, formatVersion: m.formatVersion, encrypted: m.encrypted, kdf: m.kdf, iter: m.iter, cipher: m.cipher },
      { app: 'SCIPIONE CRED', formatVersion: 1, encrypted: true, kdf: 'PBKDF2-SHA256', iter: 600000, cipher: 'AES-GCM-256' });
    assert.match(m.salt, /^[0-9a-f]{32}$/, 'salt de 16 bytes em hex');
    assert.ok(!('counts' in m) && !('sha256' in m), 'nada de metadados de conteúdo no manifest externo');
  });
  it('payload = 12 bytes de IV + o ZIP interno inteiro + 16 bytes de tag GCM', async () => {
    const plano = await BF.buildBackup(conjuntoBackup(), null);   // o mesmo ZIP interno, sem cifra
    // createdAt difere entre as duas gerações (ISO com ms), então o deflate pode variar 1-2 bytes.
    const delta = externo['payload.enc'].length - (plano.length + 12 + 16);
    assert.ok(Math.abs(delta) <= 2, `esperado ~${plano.length + 28} bytes, veio ${externo['payload.enc'].length}`);
  });
  it('nenhum nome aparece em claro no arquivo cifrado', () => {
    assert.equal(Buffer.from(cifrado).includes(Buffer.from('Maria')), false, 'nomes não podem aparecer em claro no backup criptografado');
    assert.equal(Buffer.from(cifrado).includes(Buffer.from('111.444.777-35')), false);
  });
  it('sem senha é NEEDS_PASSWORD e senha errada é BAD_PASSWORD', async () => {
    await assert.rejects(BF.readBackup(cifrado), (e) => e.code === 'NEEDS_PASSWORD');
    await assert.rejects(BF.readBackup(cifrado, 'senha-errada-123'), (e) => e.code === 'BAD_PASSWORD');
  });
  it('com a senha certa abre e devolve o manifest INTERNO (a UI perde a marcação de "cifrado")', async () => {
    const r = await BF.readBackup(cifrado, SENHA_TESTE);
    assert.equal(r.data.clients.length, 2);
    // conhecido: ver docs/ROADMAP.md — readBackup recursa no ZIP interno, então manifest.encrypted volta false
    // mesmo para arquivo cifrado: depois de lido não há como a UI saber se era protegido.
    assert.equal(r.manifest.encrypted, false);
  });
  it('adulteração de 1 byte do payload é rejeitada', async () => {
    const payload = Uint8Array.from(externo['payload.enc']);
    payload[Math.floor(payload.length / 2)] ^= 1;          // fflate não confere CRC: corrompa a ENTRADA
    await assert.rejects(BF.readBackup(F.zipSync({ ...externo, 'payload.enc': payload }), SENHA_TESTE));
  });
});

describe('backup-format: o que readBackup recusa', () => {
  it('lixo de 3 bytes é INVALID (não explode)', async () => {
    await assert.rejects(BF.readBackup(new Uint8Array([1, 2, 3])), (e) => e.code === 'INVALID');
  });
  it('ZIP que não é do app é INVALID', async () => {
    const fake = F.zipSync({ 'manifest.json': F.strToU8('{"app":"OUTRO"}') });
    await assert.rejects(BF.readBackup(fake), (e) => e.code === 'INVALID');
  });
  it('ZIP truncado é INVALID', async () => {
    const zip = await BF.buildBackup(conjuntoBackup(), null);
    await assert.rejects(BF.readBackup(zip.slice(0, Math.floor(zip.length * 0.7))), (e) => e.code === 'INVALID');
  });
  it('manifest sem sha256 é INVALID', async () => {
    const zip = await BF.buildBackup(conjuntoBackup(), null);
    const z = F.unzipSync(zip);
    const m = JSON.parse(F.strFromU8(z['manifest.json'])); delete m.sha256;
    await assert.rejects(BF.readBackup(F.zipSync({ ...z, 'manifest.json': F.strToU8(JSON.stringify(m)) })),
      (e) => e.code === 'INVALID');
  });
  it('entrada não declarada no sha256 é INVALID', async () => {
    const zip = await BF.buildBackup(conjuntoBackup(), null);
    const z = F.unzipSync(zip);
    await assert.rejects(BF.readBackup(F.zipSync({ ...z, 'extras.txt': F.strToU8('oi') })), (e) => e.code === 'INVALID');
  });
  it('arquivo declarado mas ausente é INVALID', async () => {
    const zip = await BF.buildBackup(conjuntoBackup(), null);
    const z = F.unzipSync(zip); delete z['data/settings.json'];
    await assert.rejects(BF.readBackup(F.zipSync(z)), (e) => e.code === 'INVALID');
  });
  it('dívida sem cliente e blob ausente são INVALID (integridade referencial)', async () => {
    const orfa = conjuntoBackup(); orfa.debts[0].clientId = 'zzz';
    await assert.rejects(BF.readBackup(await BF.buildBackup(orfa, null)), (e) => e.code === 'INVALID');
    const semArquivo = conjuntoBackup(); semArquivo.files.delete('blb-1');
    await assert.rejects(BF.readBackup(await BF.buildBackup(semArquivo, null)), (e) => e.code === 'INVALID');
  });
  for (const v of [0, 2, 1.5, undefined]) {
    it(`formatVersion ${v === undefined ? 'ausente' : v} é rejeitado pela gate numérica`, async () => {
      const zip = await BF.buildBackup(conjuntoBackup(), null);
      const z = F.unzipSync(zip);
      const m = JSON.parse(F.strFromU8(z['manifest.json']));
      if (v === undefined) delete m.formatVersion; else m.formatVersion = v;
      await assert.rejects(BF.readBackup(F.zipSync({ ...z, 'manifest.json': F.strToU8(JSON.stringify(m)) })),
        (e) => e.code === 'INVALID');
    });
  }
});

describe('backup-format: o que validate() aceita (characterization)', () => {
  const base = () => {
    const d = conjuntoBackup({ dividas: 1, documentos: 0, historicos: 0 });
    d.debts = [{ id: 'd1', clientId: d.clients[0].id, principal: 500000, rate: 1500 }];
    d.history = []; d.documents = []; d.files = new Map();
    return d;
  };
  it('dívida com principal/rate como STRING passa (comparação numérica solta)', () => {
    // conhecido: ver docs/ROADMAP.md — backup-format.js:24 usa `x.principal>0 && x.rate>0`, que coage
    // '500000' para número; um backup com valores string passa na validação e chega ao restore.
    assert.deepEqual(BF.validate({ ...base(), debts: [{ id: 'd1', clientId: base().clients[0].id, principal: '500000', rate: '1500' }] }), []);
  });
  it('dois clientes com o MESMO id passam (unicidade não é verificada)', () => {
    // conhecido: ver docs/ROADMAP.md — validate monta o Set de ids sem contar duplicatas; no restore o
    // segundo registro sobrescreve o primeiro.
    const d = base(); d.clients = [{ id: 'cli-001', name: 'Maria Exemplo' }, { id: 'cli-001', name: 'João Teste' }];
    assert.deepEqual(BF.validate(d), []);
  });
  it('documento sem hash e histórico sem type passam', () => {
    // conhecido: ver docs/ROADMAP.md — o dedupe de merge usa clientId+hash (backup.js:26); hash ausente
    // transforma a chave em 'c1undefined' e ainda assim o backup é aceito.
    const d = base();
    d.documents = [{ id: 'x1', clientId: d.clients[0].id, blobId: 'b1', name: 'contrato.txt' }];
    d.history = [{ id: 'h1', clientId: d.clients[0].id }];
    d.files = new Map([['b1', bytesFicticios(4)]]);
    assert.deepEqual(BF.validate(d), []);
  });
  it('settings ausente passa (null viaja até o consumidor)', () => {
    // conhecido: ver docs/ROADMAP.md — validate() não olha `settings`; backup.js:8 faz ?? 7 no replace.
    const d = base(); d.settings = null;
    assert.deepEqual(BF.validate(d), []);
  });
  it('cliente sem doc (CPF/CNPJ) passa', () => {
    // conhecido: ver docs/ROADMAP.md — só id e name são obrigatórios; sem doc o dedupe de merge por
    // CPF/CNPJ (backup.js:22) compara a string vazia entre si.
    const d = base(); d.clients = [{ id: 'c1', name: 'Maria Exemplo' }]; d.debts = [];
    assert.deepEqual(BF.validate(d), []);
  });
  it('o que validate REJEITA: lista fora de formato, cliente sem id/nome, dívida com valor <= 0', () => {
    assert.match(BF.validate({ ...base(), clients: 'x' }).join(' '), /Lista clients inválida/);
    assert.match(BF.validate({ ...base(), clients: [{ name: 'sem id' }] }).join(' '), /Cliente sem id ou nome/);
    assert.match(BF.validate({ ...base(), debts: [{ id: 'd1', clientId: base().clients[0].id, principal: 0, rate: 1 }] }).join(' '), /Dívida inválida/);
  });
  it('dbVersion é gravado mas nunca verificado (manifest com dbVersion 99 abre)', async () => {
    // conhecido: ver docs/ROADMAP.md — R-04: restaurar um backup de schema futuro não é detectado.
    const zip = await BF.buildBackup({ ...base(), dbVersion: 99 }, null);
    assert.equal(lerManifest(zip).dbVersion, 99);
    assert.equal((await BF.readBackup(zip)).manifest.dbVersion, 99);
  });
  it('counts do manifest são declarativos: um valor mentiroso não é conferido', async () => {
    // conhecido: ver docs/ROADMAP.md — readBackup confere sha256 por entrada, não a consistência de counts.
    const zip = await BF.buildBackup(base(), null);
    const z = F.unzipSync(zip);
    const m = lerManifest(zip); m.counts.clients = 99;
    const Said = await BF.readBackup(F.zipSync({ ...z, 'manifest.json': F.strToU8(JSON.stringify(m)) }));
    assert.equal(Said.manifest.counts.clients, 99);
    assert.equal(Said.data.clients.length, 2, 'o disco diria 2; o manifest jurava 99');
  });
});
