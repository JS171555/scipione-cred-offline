#!/usr/bin/env node
/**
 * scripts/run-tests.mjs — forma canônica de executar a suíte do SCIPIONE CRED.
 *
 * O comando canônico continua sendo `node --test` com o glob recursivo sobre tests/
 * (Aviso de manutenção: não escreva aqui o glob literal — dois asteriscos seguidos de
 *  barra fecham este comentário de bloco e o arquivo deixa de compilar. Já aconteceu.)
 * Este wrapper existe porque o comando cru tem três modos de ficar verde sem testar nada:
 *
 *  1. DESCOBERTA VAZIA. `node --test tests` (diretório) falha com MODULE_NOT_FOUND, e um
 *     glob que não casa roda ZERO arquivos com exit 0. Sem contar em voz alta quantos
 *     arquivos foram descobertos, "suíte verde" e "suíte inexistente" são indistinguíveis
 *     na UI do CI. Aqui a descoberta é varredura recursiva explícita de tests/ pelo sufixo
 *     `.test.mjs` — o mesmo conjunto que o glob canônico casa, inclusive os legados na raiz
 *     de tests/ e as camadas unit/, svc/, contracts/ conforme forem nascendo — e os caminhos
 *     são passados um a um ao runner.
 *  2. PIPE QUE ENGOLE O EXIT CODE. `node --test ... | tee results.tap` devolve o status do
 *     `tee`, que é 0 mesmo com a suíte vermelha. Aqui não há shell: spawnSync e leitura
 *     direta do exit code do runner.
 *  3. SUMÁRIO NÃO RELETO. Exit code é necessário mas não suficiente — processo cortado no
 *     meio deixa TAP truncado. Então o arquivo é relido e exige `# fail 0` E `# cancelled
 *     0`, além de `# tests >= nº de arquivos` (arquivo descoberto sem caso reportado é
 *     arquivo que não rodou).
 *
 *   node scripts/run-tests.mjs              # gate
 *   node scripts/run-tests.mjs --coverage   # gate + números de cobertura (sem threshold)
 *   node scripts/run-tests.mjs --list       # só a descoberta (debug de glob)
 *
 *   TEST_REPORTER   repórter de console: tap (padrão) | spec | junit | dot | lcov. TAP e
 *                   JUnit em arquivo são SEMPRE gravados: o gate lê o TAP, o JUnit é o
 *                   relatório que o Actions exibe.
 *   ARTIFACTS_DIR   destino dos relatórios (padrão <raiz>/artifacts, não versionável).
 *
 * exit 0 = verde · 1 = falha de teste/violação de gate · 2 = uso ou ambiente errado.
 * Nenhum `|| true`, nenhum `continue-on-error`, nenhuma saída engolida.
 *
 * Ruído conhecido: com três fluxos de repórter o runner Node emite
 * `MaxListenersExceededWarning: ... [TestsStream]`. É a plumbing dos repórteres, não um
 * vazamento do src/. Não filtramos a stderr para não esconder aviso verdadeiro.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const VALID = ['tap', 'spec', 'junit', 'dot', 'lcov'];

let coverage = false;
let listOnly = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--coverage') coverage = true;
  else if (arg === '--list') listOnly = true;
  else {
    console.error('uso: node scripts/run-tests.mjs [--coverage] [--list]  (TEST_REPORTER=' + VALID.join('|') + ', ARTIFACTS_DIR=<dir>)');
    process.exit(2);
  }
}
const die = (msg, code) => {
  console.error('[run-tests] ' + msg);
  process.exit(code);
};

function discover(dir, prefix, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    die('não consegui ler ' + (prefix || 'tests/') + ': ' + e.message, 2);
  }
  for (const ent of entries) {
    const rel = prefix ? prefix + '/' + ent.name : ent.name;
    if (ent.isDirectory()) discover(path.join(dir, ent.name), rel, out);
    else if (ent.isFile() && ent.name.endsWith('.test.mjs')) out.push(rel);
  }
  return out;
}

if (!existsSync(TESTS_DIR) || !statSync(TESTS_DIR).isDirectory()) die('tests/ não existe — nada a executar', 2);
const files = discover(TESTS_DIR, '', []).sort();

// Contagem por camada: é assim que se percebe a olho que unit/, svc/ ou contracts/ sumiram
// (glob errado, diretório renomeado, arquivo sem o sufixo .test.mjs).
const byDir = new Map();
for (const f of files) {
  const d = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '(raiz de tests/)';
  byDir.set(d, (byDir.get(d) || 0) + 1);
}

console.log('=== SCIPIONE CRED — suíte de testes ===');
console.log('runner: ' + process.execPath + ' (' + process.version + ')');
console.log('TZ:     ' + (process.env.TZ || '(herdado do host)'));
console.log('modo:   gate' + (coverage ? ' + cobertura (sem threshold)' : ''));
console.log('descobertos ' + files.length + ' arquivos de teste:');
for (const [d, n] of [...byDir.entries()].sort()) console.log('        ' + d + ' -> ' + n);
for (const f of files) console.log('  · ' + f);

// GATE DE DESCOBERTA: suíte vazia é FALHA, não sucesso.
if (!files.length) die('a descoberta retornou ZERO arquivos. Um CI que roda nenhum teste e fica verde é pior que nenhum CI: autoriza merge com segurança falsa.', 2);
if (listOnly) {
  console.log('\n(--list: nada executado)');
  process.exit(0);
}

const artifacts = path.resolve(process.env.ARTIFACTS_DIR || path.join(ROOT, 'artifacts'));
try {
  mkdirSync(artifacts, { recursive: true });
} catch (e) {
  die('não consegui criar ' + artifacts + ': ' + e.message, 2);
}
const TAP = path.join(artifacts, 'results.tap');
const XML = path.join(artifacts, 'results.xml');
const LOG = path.join(artifacts, 'run.log');
const LCOV = path.join(artifacts, 'coverage.lcov');
function showPath(f) {
  const rel = path.relative(ROOT, f);
  return rel.startsWith('..') ? f : rel; // absoluto quando ARTIFACTS_DIR está fora do repo
}

const streamReporter = (process.env.TEST_REPORTER || 'tap').trim().toLowerCase();
if (!VALID.includes(streamReporter)) die('TEST_REPORTER="' + streamReporter + '" inválido (válidos: ' + VALID.join(', ') + ')', 2);

const args = ['--test'];
// O Node pareia cada --test-reporter com o --test-reporter-destination seguinte. Três fluxos
// num ÚNICO processo de teste: TAP em arquivo (é o que o gate relê), JUnit em arquivo
// (relatório por máquina) e o repórter de console vindo de env. Nada passa por pipe de
// shell — é ali que o exit code costuma se perder.
args.push('--test-reporter', 'tap', '--test-reporter-destination', TAP);
args.push('--test-reporter', 'junit', '--test-reporter-destination', XML);
args.push('--test-reporter', streamReporter, '--test-reporter-destination', 'stdout');
if (coverage) {
  // Cobertura nativa do Node 22. vendor/ é minificado de terceiro e tests/|scripts/ é o
  // ferramental: contar os três como "não coberto" produz número que alguém lê errado.
  // Os números são IMPRESSOS sem threshold de propósito — uma porta que falha no primeiro
  // dia vira o botão que desliga o check. Threshold entra depois, com número defensável.
  args.push('--experimental-test-coverage', '--test-coverage-exclude=vendor/**', '--test-coverage-exclude=tests/**', '--test-coverage-exclude=scripts/**');
  args.push('--test-reporter', 'lcov', '--test-reporter-destination', LCOV);
}
args.push(...files.map((f) => path.join('tests', f)));

const started = Date.now();
const child = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
const elapsed = Date.now() - started;
if (child.error) die('não consegui iniciar o runner: ' + child.error.message, 2);

const stdout = child.stdout || '';
const stderr = child.stderr || '';
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
try {
  writeFileSync(LOG, ['# run-tests.mjs', '# node ' + process.version + ' · TZ=' + (process.env.TZ || '(host)') + ' · modo=' + (coverage ? 'coverage' : 'gate') + ' · exit=' + child.status + ' · ' + elapsed + ' ms', '# descobertos=' + files.length, '', '## stdout', stdout, '## stderr', stderr, ''].join('\n'));
} catch (e) {
  console.error('[run-tests] não consegui gravar ' + LOG + ': ' + e.message);
}

/* --------------------------------------------------------- releitura do sumário */
const problems = [];
let tap = null;
try {
  tap = readFileSync(TAP, 'utf8');
} catch (e) {
  problems.push('não consegui ler o TAP de ' + showPath(TAP) + ' (' + e.message + '): sem sumário não há como provar que a suíte passou');
}
const grab = (k) => {
  if (tap === null) return null;
  const m = tap.match(new RegExp('^# ' + k + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : null;
};
const sum = { tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), cancelled: grab('cancelled'), skipped: grab('skipped'), todo: grab('todo') };

console.log('\n--- verificação do gate ---');
const report = (cond, msg) => {
  console.log((cond ? '  [ok]    ' : '  [FALHA] ') + msg);
  if (!cond) problems.push(msg);
};

report(child.status === 0, 'exit code do runner = ' + child.status + (child.status === 0 ? '' : ' (esperado 0)'));
if (tap !== null) {
  const completo = sum.tests !== null && sum.fail !== null && sum.cancelled !== null;
  report(completo, completo ? 'sumário TAP presente e completo' : 'sumário TAP ausente/truncado — a saída foi cortada antes do fim');
  if (completo) {
    console.log('  contagens: ' + Object.entries(sum).map(([k, v]) => k + '=' + v).join(' · '));
    report(sum.tests > 0, '# tests = ' + sum.tests + (sum.tests > 0 ? '' : ' — a suíte rodou zero casos'));
    report(sum.tests >= files.length, '# tests (' + sum.tests + ') >= arquivos descobertos (' + files.length + ')');
    report(sum.fail === 0, '# fail = ' + sum.fail + ' (exigido 0)');
    report(sum.cancelled === 0, '# cancelled = ' + sum.cancelled + ' (exigido 0 — cancelado não é aprovado)');
    if (sum.skipped) console.log('  [aviso]   # skipped = ' + sum.skipped + ' (não bloqueia; precisa de justificativa no código)');
    if (sum.todo) console.log('  [aviso]   # todo = ' + sum.todo);
    if (sum.fail > 0) for (const l of tap.split('\n').filter((l) => /^not ok\b/.test(l)).slice(0, 20)) console.log('    ' + l);
  }
}
for (const f of [TAP, XML, LOG]) console.log('  artefato: ' + showPath(f));
if (coverage && existsSync(LCOV)) console.log('  artefato: ' + showPath(LCOV));

console.log('\n=== RESULTADO ===');
if (problems.length) {
  console.log('FALHOU — ' + problems.length + ' motivo(s):');
  for (const p of problems) console.log('  · ' + p);
  // Propaga o exit não-zero do runner quando existe; senão 1. Nunca 0.
  process.exit(child.status !== 0 && child.status !== null ? child.status : 1);
}
console.log('APROVADO — ' + files.length + ' arquivos, ' + sum.tests + ' casos, 0 falhas, 0 cancelados, ' + elapsed + ' ms (TZ=' + (process.env.TZ || 'host') + ')');
process.exit(0);
