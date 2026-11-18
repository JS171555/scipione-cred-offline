// Exportação XLSX (tema 12 da auditoria): conteúdo real do arquivo, não só "rodou sem estourar".
//
// O teste legado tests/backup.test.mjs:26 chama buildXlsx e grava /tmp/amostra.xlsx "para validação
// externa", sem nenhuma asserção. Aqui o ZIP é desmontado e o Office Open XML conferido parte a parte,
// incluindo o caminho de relatórios (src/export/reports.js:14), que antes não era carregado por nada.
//
// Dados 100% fictícios. Nenhuma chamada de rede: fflate é a cópia vendorizada carregada em memória e
// globalThis.fflate é pré-instalado para que src/export/lib.js:4 resolva sem tocar no DOM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mod = { exports: {} };
new Function('module', 'exports', readFileSync(fileURLToPath(new URL('../../vendor/fflate.min.js', import.meta.url)), 'utf8'))(mod, mod.exports);
const F = mod.exports;
globalThis.fflate = F;

const { buildXlsx } = await import('../../src/export/xlsx.js');
const R = await import('../../src/export/reports.js');

const txt = (b) => new TextDecoder().decode(b);
const abrir = (b) => { const z = F.unzipSync(b), out = {}; for (const k of Object.keys(z)) out[k] = txt(z[k]); return out; };

const planilha = () => buildXlsx(F, [
  { name: 'Dívidas', widths: [30, 20, 12], rows: [
    ['Nome do cliente', 'Valor', 'Data'].map((v) => ({ v, s: 1 })),
    ['Maria Exemplo', { v: 5000, s: 2 }, '06/11/2026'],
    [{ v: 'TOTAL', s: 4 }, { v: 5000, s: 5 }, ''],
  ] },
  { name: 'Movimentações', widths: [20], rows: [[{ v: 'Data', s: 1 }]] },
]);

describe('src/export/xlsx.js — pasta de trabalho Office Open XML', () => {
  it('produz um ZIP válido com as partes mínimas que o Excel exige', () => {
    const bytes = planilha();
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'assinatura local de entrada ZIP');
    const z = abrir(bytes);
    for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
                         'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      assert.ok(parte in z, 'parte obrigatória ausente: ' + parte);
    }
  });

  it('declara uma sobrecarga por planilha e relaciona styles.xml (sem isso a pasta não abre)', () => {
    const z = abrir(planilha());
    assert.equal((z['[Content_Types].xml'].match(/xl\/worksheets\/sheet\d+\.xml/g) || []).length, 2);
    assert.match(z['xl/_rels/workbook.xml.rels'], /Target="worksheets\/sheet2\.xml"/);
    assert.match(z['xl/_rels/workbook.xml.rels'], /Target="styles\.xml"/);
  });

  it('grava os nomes das abas escapados e na sequência', () => {
    const wb = abrir(planilha())['xl/workbook.xml'];
    assert.match(wb, /<sheet name="Dívidas" sheetId="1" r:id="rId1"\/>/);
    assert.match(wb, /name="Movimentações" sheetId="2"/);
  });

  it('distingue célula numérica de texto inline e preserva o estilo', () => {
    const s1 = abrir(planilha())['xl/worksheets/sheet1.xml'];
    assert.match(s1, /<c r="B2" s="2"><v>5000<\/v><\/c>/, 'número vai em <v>');
    assert.match(s1, /<c r="A2" t="inlineStr"><is><t[^>]*>Maria Exemplo<\/t><\/is><\/c>/);
    assert.match(s1, /<c r="C3"\/>/, 'string vazia vira célula auto-fechada');
  });

  it('congela o cabeçalho e grava a largura de cada coluna', () => {
    const s1 = abrir(planilha())['xl/worksheets/sheet1.xml'];
    assert.match(s1, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(s1, /<col min="1" max="1" width="30" customWidth="1"\/>/);
    assert.match(s1, /<col min="3" max="3" width="12" customWidth="1"\/>/);
  });

  it('define os formatos monetário e percentual usados pelos estilos 2, 3 e 5', () => {
    const st = abrir(planilha())['xl/styles.xml'];
    assert.match(st, /numFmtId="164"/);
    assert.match(st, /numFmtId="165" formatCode="0\.00%"/);
    assert.equal((st.match(/<xf /g) || []).length, 7, '1 cellStyleXfs + 6 cellXfs');
  });

  it('escapa markup vindo de dado do usuário (nome de cliente é entrada externa)', () => {
    const sujo = '<img src=x onerror=alert(1)>';
    const z = abrir(buildXlsx(F, [{ name: 'A<B>&"', widths: [10], rows: [[sujo, 'a&b', 'c"d', null, '']] }]));
    const s1 = z['xl/worksheets/sheet1.xml'];
    assert.ok(!s1.includes('<img'), 'nenhuma tag crua dentro do XML');
    assert.ok(s1.includes('&lt;img src=x onerror=alert(1)&gt;'), 'o markup é neutralizado ao entrar na célula');
    assert.ok(s1.includes('a&amp;b'));
    assert.ok(s1.includes('c&quot;d'));
    assert.match(z['xl/workbook.xml'], /name="A&lt;B&gt;&amp;&quot;"/, 'o nome da aba também passa pelo escape');
  });

  it('remove caracteres de controle que quebrariam o parser XML', () => {
    const sujo = 'antes' + String.fromCharCode(0) + String.fromCharCode(7) + String.fromCharCode(11) + String.fromCharCode(27) + 'depois';
    const s1 = abrir(buildXlsx(F, [{ name: 'x', widths: [10], rows: [[sujo]] }]))['xl/worksheets/sheet1.xml'];
    assert.match(s1, /antesdepois/, 'os quatro caracteres proibidos no XML 1.0 somem');
  });

  it('limita a planilha a 26 colunas: a 27ª recebe a letra "[" (caracterização)', () => {
    // conhecido: ver docs/ROADMAP.md — o cabeçalho de coluna usa String.fromCharCode(65+i) em
    // src/export/xlsx.js:4, então a 27ª coluna sai como "[1" em vez de "AA1" e o Excel descarta a
    // célula. Os relatórios do app usam no máximo 6 colunas, então não há impacto hoje; a barreira
    // só cai se alguém ampliar o relatório para além de Z.
    const colunas = Array.from({ length: 27 }, (_, i) => i + 1);
    const s1 = abrir(buildXlsx(F, [{ name: 'x', widths: colunas, rows: [colunas] }]))['xl/worksheets/sheet1.xml'];
    assert.match(s1, /r="Z1"/, 'a 26ª coluna é Z');
    assert.match(s1, /r="\[1"/, 'e a 27ª sai com letra "["');
    assert.ok(!s1.includes('r="AA1"'), 'não existe transição para AA');
  });
});

describe('src/export/reports.js — exportação do relatório', () => {
  const divida = { id: 'd1', clientId: 'c1', client: 'Maria Exemplo', interest: 75000, principal: 500000, rate: 1500, due: '2026-12-06', notes: '', description: 'Emprestimo ficticio' };
  const mov = { id: 'h1', clientId: 'c1', client: 'Maria Exemplo', type: 'Cadastro de cliente', detail: '', createdAt: Date.parse('2026-11-06T10:00:00') };
  const d = { debts: [divida], moves: [mov], principal: 500000, interest: 75000 };

  it('xlsxBytes devolve duas abas com valores convertidos de centavos para reais', async () => {
    const z = abrir(await R.xlsxBytes(d));
    const s1 = z['xl/worksheets/sheet1.xml'];
    const s2 = z['xl/worksheets/sheet2.xml'];
    assert.match(z['xl/workbook.xml'], /name="Dívidas"[^>]*sheetId="1"/);
    assert.match(z['xl/workbook.xml'], /name="Movimentações"[^>]*sheetId="2"/);
    assert.ok(s1.includes('<c r="B2" s="2"><v>750</v></c>'), 'juros de 75000 centavos saem como 750 (reports.js:17)');
    assert.ok(s1.includes('<c r="C2" s="2"><v>5000</v></c>'), 'principal de 500000 centavos sai como 5000');
    assert.ok(s1.includes('<c r="D2" s="3"><v>0.15</v></c>'), 'taxa de 1500 centésimos sai como fração com estilo percentual');
    assert.ok(s1.includes('Maria Exemplo'), 'nome do cliente entra resolvido, não o id');
    assert.ok(s1.includes('Emprestimo ficticio'), 'notes vazio faz cair em description (reports.js:17)');
    assert.ok(s1.includes('06/12/2026'), 'vencimento formatado como dd/mm/aaaa');
    assert.ok(s1.includes('<c r="B3" s="5"><v>750</v></c>') && s1.includes('<c r="C3" s="5"><v>5000</v></c>'), 'linha TOTAL somada com estilo de destaque');
    assert.ok(s2.includes('Cadastro de cliente'), 'aba de movimentações traz o tipo do histórico');
  });

  it('dívida sem vencimento aparece com travessão em vez de estourar', async () => {
    const z = abrir(await R.xlsxBytes({ ...d, debts: [divida, { ...divida, id: 'd2', due: '' }] }));
    const s1 = z['xl/worksheets/sheet1.xml'];
    assert.equal((s1.match(/06\/12\/2026/g) || []).length, 1, 'só a dívida com due formata data');
    assert.ok(s1.includes('<t xml:space="preserve">—</t>') || s1.includes('—'), 'a marcada de ausente aparece');
  });

  it('relatório vazio gera cabeçalho e total zerado sem exceção', async () => {
    const z = abrir(await R.xlsxBytes({ debts: [], moves: [], principal: 0, interest: 0 }));
    assert.match(z['xl/worksheets/sheet1.xml'], /<row r="2">/, 'linha de total existe mesmo sem dívidas');
    assert.match(z['xl/worksheets/sheet2.xml'], /<row r="1">/, 'cabeçalho de movimentações existe');
    assert.ok(!z['xl/worksheets/sheet1.xml'].includes('Maria Exemplo'));
  });

  it('isoOf e label degeneram sem validação (caracterização)', () => {
    // conhecido: ver docs/ROADMAP.md — src/export/reports.js:5 não valida o timestamp e :6 não
    // valida p.value: um período malformado produz texto visível no relatório em vez de erro.
    assert.throws(() => R.isoOf('nao-e-data'), (e) => e instanceof RangeError && /Invalid time value/.test(e.message),
      'timestamp inválido derruba o relatório com RangeError (não devolve texto "NaN")');
    assert.throws(() => R.isoOf(undefined), RangeError);
    // `null` é coagido a 0 e produz uma data válida próxima da época; o dia exato depende do fuso
    // do processo, por isso a asserção é de faixa e não de valor (a suíte roda em dois fusos na CI).
    const epoca = R.isoOf(null);
    assert.match(epoca, /^\d{4}-\d{2}-\d{2}$/, 'null vira data ISO em vez de erro');
    assert.ok(Math.abs(Date.parse(epoca)) <= 86400000, 'a data fica a no máximo 1 dia da época');
    assert.equal(R.label({ mode: 'month', value: '2026-13' }), 'undefined/2026');
    assert.equal(R.label({ mode: 'day', value: '2026-11-06' }), 'Dia 06/11/2026');
    assert.equal(R.label({ mode: 'month', value: '2026-03' }), 'Março/2026');
  });

  it('inPeriod separa por mês e por dia conforme o modo', () => {
    assert.ok(R.inPeriod('2026-11-06', { mode: 'month', value: '2026-11' }));
    assert.ok(!R.inPeriod('2026-12-01', { mode: 'month', value: '2026-11' }));
    assert.ok(R.inPeriod('2026-11-06', { mode: 'day', value: '2026-11-06' }));
    assert.ok(!R.inPeriod('2026-11-07', { mode: 'day', value: '2026-11-06' }));
  });
});
