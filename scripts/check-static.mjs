#!/usr/bin/env node
/**
 * scripts/check-static.mjs — fonte única das checagens estáticas do SCIPIONE CRED.
 *
 * Node puro, zero dependências. As checagens vivem aqui, e não em bash dentro do workflow,
 * por um motivo: se o critério existisse só na CI, ninguém o rodaria antes de abrir o PR,
 * e no dia em que os dois textos divergissem a CI começaria a mentir. O workflow chama
 * este script grupo por grupo apenas para que a UI do Actions aponte QUAL checagem caiu.
 *
 *   node scripts/check-static.mjs                    # todas
 *   node scripts/check-static.mjs --only=sintaxe,sw  # subconjunto (é o que a CI faz)
 *   node scripts/check-static.mjs --root=/dir        # raiz alternativa (auto-teste)
 *
 * exit 0 = verde · 1 = falha · 2 = uso/ambiente errado. Sem `|| true`, sem `exit 0` oculto.
 * Grupos: essenciais · sintaxe · sw · json · deps · segredos · docs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const GROUPS = ['essenciais', 'sintaxe', 'sw', 'json', 'deps', 'segredos', 'docs'];
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let only = null;

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--root=')) root = path.resolve(arg.slice(7));
  else if (arg.startsWith('--only=')) only = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
  else {
    console.error('uso: node scripts/check-static.mjs [--root=DIR] [--only=' + GROUPS.join(',') + ']');
    process.exit(2);
  }
}
if (only) {
  const bad = only.filter((g) => !GROUPS.includes(g));
  if (bad.length) {
    console.error('grupo desconhecido: ' + bad.join(', ') + ' (válidos: ' + GROUPS.join(', ') + ')');
    process.exit(2);
  }
} else only = GROUPS;
const active = new Set(only);
if (!existsSync(root)) {
  console.error('raiz inexistente: ' + root);
  process.exit(2);
}

const state = new Map(GROUPS.map((g) => [g, { ok: [], fail: [], info: [] }]));
const say = (g, k, m) => active.has(g) && state.get(g)[k].push(m);
const ok = (g, m) => say(g, 'ok', m);
const fail = (g, m) => say(g, 'fail', m);
const info = (g, m) => say(g, 'info', m);

function readFile(g, rel) {
  try {
    return readFileSync(path.join(root, rel), 'utf8');
  } catch (e) {
    fail(g, 'não consegui ler ' + rel + ': ' + e.message);
    return null;
  }
}

/* ------------------------------------------------- enumeração: commitado ∪ disco */
const IGNORED = new Set(['.git', 'node_modules', '.vercel', 'artifacts', 'scratch-qa', 'dist']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.gz', '.br', '.mp4']);

function walk(dir, prefix, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!IGNORED.has(ent.name)) walk(path.join(dir, ent.name), prefix + ent.name + '/', out);
    } else if (ent.isFile()) out.push(prefix + ent.name);
  }
  return out;
}

// `git ls-files` é a definição exata de "commitado" — é assim que ".env commitado" é
// respondido com honestidade, e não com "existe no meu disco". A união com o disco pega o
// arquivo ainda não commitado, que é o momento em que uma credencial colada no editor
// ainda pode ser barrada. Fora de um git (cópia, tarball) o varredor degrada para disco.
const git = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
const found = new Set(git.status === 0 ? git.stdout.split('\0').filter(Boolean) : []);
const trackedCount = found.size;
const disk = walk(root, '', []);
for (const f of disk) found.add(f);
const ALL = [...found].sort();
const LIST_NOTE = (git.status === 0 ? 'git=' + trackedCount + ' · ' : 'git indisponível · ') + 'disco=' + disk.length;
const hasFile = (rel) => ALL.includes(rel) || existsSync(path.join(root, rel));

/* ===================================================================== essenciais */
const REQUIRED = ['index.html', 'manifest.json', 'sw.js', 'src/main.js', 'package.json', 'vercel.json', 'api/cpf.js', 'vendor/fflate.min.js'];

function checkEssenciais() {
  for (const rel of REQUIRED) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) fail('essenciais', 'arquivo essencial ausente: ' + rel);
    else if (statSync(abs).size === 0) fail('essenciais', 'arquivo essencial vazio: ' + rel);
    else ok('essenciais', rel + ' (' + statSync(abs).size + ' bytes)');
  }
  // vendor/fflate.min.js é carregado por injeção de <script> em src/export/lib.js: sumiu,
  // backup e relatórios quebram em runtime e nenhum teste de Node daria por isso.
  const cssDir = path.join(root, 'css');
  const css = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort() : [];
  if (!css.length) fail('essenciais', 'nenhum css/*.css em css/');
  for (const f of css) ok('essenciais', 'css/' + f + ' (' + statSync(path.join(cssDir, f)).size + ' bytes)');

  // index.html é o único elo entre o documento e o boot. Sem skeleton nem <noscript>, se a
  // tag de módulo sumir a página fica branca e nada dentro do JS pode avisar.
  const html = readFile('essenciais', 'index.html');
  if (html === null) return;
  for (const [re, label] of [
    [/src\/main\.js/, 'index.html referencia src/main.js'],
    [/rel="manifest"/, 'index.html referencia o manifest.json'],
    [/lang="pt-BR"/, 'index.html declara lang="pt-BR"'],
    [/Content-Security-Policy/, 'index.html declara a CSP por meta http-equiv'],
  ]) {
    if (re.test(html)) ok('essenciais', label);
    else fail('essenciais', label + ' — NÃO encontrado');
  }
  if (/http:\/\//.test(html)) fail('essenciais', 'index.html contém URL http:// (conteúdo misto)');
}

/* ========================================================================= sintaxe */
function checkSintaxe() {
  const targets = ALL.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  // Zero arquivos verificados é FALHA: um diretório renomeado produz o mesmo "nada a fazer"
  // de uma suíte verde, e é assim que CI vira teatro.
  if (!targets.length) return fail('sintaxe', 'nenhum .js/.mjs encontrado — a checagem não verificou nada');
  const broken = [];
  for (const rel of targets) {
    // `node --check` valida sem executar. Nos .js ele só entende ESM porque o package.json
    // declara "type":"module" — de quebra este grupo também guarda aquele campo.
    const r = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
    if (r.status !== 0) broken.push(rel + ': ' + (r.stderr || r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' | '));
  }
  if (broken.length) for (const b of broken) fail('sintaxe', 'sintaxe inválida — ' + b);
  else ok('sintaxe', 'node --check OK em ' + targets.length + ' arquivos .js/.mjs (sw.js, api/, vendor/, tests/ incluídos)');
}

/* ============================================================================== sw */
/**
 * sw.js declara `const V='sc-vNN',FILES=[...]` numa linha densa mantida à mão, e o contrato
 * é frágil por construção: `caches.addAll(FILES)` é atômico — UMA entrada errada aborta a
 * instalação inteira do service worker em silêncio. E como a estratégia é cache-first puro,
 * sem escrita em runtime, o que não está em FILES simplesmente não abre offline.
 */
function extractArray(src, name) {
  const head = src.match(new RegExp('\\b' + name + '\\s*=\\s*\\['));
  if (!head) return null;
  // Exigir "const FILES=[" não casa com a declaração combinada `const V=…,FILES=[…]`.
  // Então localizamos o `[` e balanceamos até o `]`. Limite consciente: um `]` dentro de
  // uma string quebraria isto — e quebraria devolvendo null (falha visível), não com a
  // contagem errada (falha muda).
  let depth = 1;
  let i = head.index + head[0].length;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
  }
  if (depth !== 0) return null;
  return [...src.slice(head.index + head[0].length, i - 1).matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
}
const parseSw = (src) => ({
  version: (src.match(/\bV\s*=\s*(['"`])([^'"`]*)\1/) || [])[2] ?? null,
  entries: extractArray(src, 'FILES'),
});
const norm = (e) => e.replace(/^\.\//, '');

function checkSw() {
  const src = readFile('sw', 'sw.js');
  if (src === null) return;
  const { version, entries } = parseSw(src);
  if (version === null) fail('sw', 'const V não encontrada em sw.js');
  else if (!/^sc-v\d+$/.test(version)) fail('sw', 'V="' + version + '" fora do formato sc-vN');
  else ok('sw', 'V="' + version + '"');
  if (!entries || !entries.length) return fail('sw', 'const FILES não encontrada ou vazia em sw.js');
  ok('sw', 'FILES: ' + entries.length + ' entradas');

  const dupes = entries.filter((e, i) => entries.indexOf(e) !== i);
  if (dupes.length) fail('sw', 'entradas duplicadas em FILES: ' + [...new Set(dupes)].join(', '));

  // (1) toda entrada precisa existir no disco ('./' é o marcador de raiz → index.html)
  const missing = entries.filter((e) => (norm(e) === '' ? !hasFile('index.html') : !hasFile(norm(e))));
  if (missing.length) fail('sw', 'entradas de FILES ausentes do disco (addAll → 404 → instalação abortada): ' + missing.join(', '));
  else ok('sw', 'as ' + entries.length + ' entradas existem no disco');

  const inFiles = new Set(entries.map(norm));
  // (2) cobertura: nenhum módulo ou folha de estilo pode ficar fora do pre-cache
  for (const [kind, list] of [
    ['src/**.js', ALL.filter((f) => f.startsWith('src/') && f.endsWith('.js'))],
    ['css/*.css', ALL.filter((f) => f.startsWith('css/') && f.endsWith('.css'))],
    ['essenciais', ['index.html', 'manifest.json', 'vendor/fflate.min.js']],
  ]) {
    const out = list.filter((f) => !inFiles.has(f));
    if (out.length) fail('sw', kind + ' fora do pre-cache (app quebra offline): ' + out.join(', '));
    else ok('sw', kind + ' coberto em FILES (' + list.length + ')');
  }
  // (3) o inverso também é contrato: pré-cachear o próprio sw.js impediria detectar a
  //     própria atualização; api/ é função serverless; docs/tests/scripts não são app.
  const banned = ALL.filter((f) => (f.startsWith('api/') || f.startsWith('tests/') || f.startsWith('scripts/') || f.startsWith('docs/') || f === 'sw.js' || f === 'vercel.json' || f === 'package.json') && inFiles.has(f));
  if (banned.length) fail('sw', 'itens que não podem estar no pre-cache mas estão em FILES: ' + banned.join(', '));
  else ok('sw', 'sw.js, api/, tests/, scripts/, docs/ e deploy corretamente fora de FILES');

  checkSwBump(entries, version);
}

/**
 * (4) O cache é NOMEADO por V e sw.js só expurga o cache velho quando o nome muda. Mexer
 * num arquivo pré-cacheado sem mudar V faz o app já instalado servir o bundle antigo para
 * sempre — na história do repo isso aconteceu em 4 commits e nada impedia. A base vem do CI
 * via CHECK_SW_BASE; sem base a subchecagem é pulada COM aviso (nunca em silêncio).
 * CHECK_SW_HEAD existe para validar a regra contra pares de commits reais da história.
 */
function checkSwBump(entries, headVersion) {
  const base = (process.env.CHECK_SW_BASE || '').trim();
  if (!base || /^0+$/.test(base)) return info('sw', 'bump de V não verificável: sem base de comparação (execução manual ou branch novo)');
  const head = (process.env.CHECK_SW_HEAD || 'HEAD').trim() || 'HEAD';
  const diff = spawnSync('git', ['-C', root, 'diff', '--name-only', base + '...' + head], { encoding: 'utf8' });
  if (diff.status !== 0) {
    // Clone raso ou base reescrita não deve bloquear, mas tem de gritar: "não verificável"
    // silencioso é indistinguível da ausência do check.
    return info('sw', 'AVISO: bump NÃO VERIFICÁVEL (git diff ' + base.slice(0, 7) + '..' + head.slice(0, 7) + ': ' + ((diff.stderr || '').split('\n')[0] || 'falhou') + ') — o checkout precisa de fetch-depth: 0');
  }
  const changed = diff.stdout.split('\n').filter(Boolean);
  const cached = new Set(entries.map(norm));
  const touched = changed.filter((f) => cached.has(f) || (f.startsWith('src/') && f.endsWith('.js')) || (f.startsWith('css/') && f.endsWith('.css')));
  if (!touched.length) return ok('sw', 'nenhum arquivo pré-cacheado mudou desde ' + base.slice(0, 7) + ' — V não precisou ser incrementado');
  const baseSw = spawnSync('git', ['-C', root, 'show', base + ':sw.js'], { encoding: 'utf8' });
  const baseVersion = baseSw.status === 0 ? parseSw(baseSw.stdout).version : null;

  if (!changed.includes('sw.js')) {
    fail('sw', touched.length + ' arquivo(s) pré-cacheado(s) mudaram desde ' + base.slice(0, 7) + ' sem tocar sw.js (' + touched.slice(0, 8).join(', ') + '): o app instalado segue servindo o bundle do cache ' + (baseVersion || 'anterior'));
  } else if (baseVersion !== null && baseVersion === headVersion) {
    fail('sw', 'sw.js alterado mas V continua "' + headVersion + '": incremente V para que a rotina activate expurgue o cache antigo');
  } else if (baseVersion === null) {
    info('sw', 'V da base ilegível; sw.js alterado, HEAD=' + headVersion + ' — bump não verificável');
  } else {
    ok('sw', 'bump correto: ' + touched.length + ' arquivo(s) pré-cacheado(s) alterados, V ' + baseVersion + ' -> ' + headVersion);
  }
}

/* ============================================================================= json */
function parseJson(g, rel) {
  const text = readFile(g, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(g, rel + ' não é JSON válido: ' + e.message);
    return null;
  }
}

function checkJson() {
  const pkg = parseJson('json', 'package.json');
  if (pkg) {
    // "type":"module" é o que faz os .js do src/ serem ESM; sem isso o app inteiro para de
    // carregar no navegador com "Cannot use import statement outside a module".
    if (pkg.type === 'module') ok('json', 'package.json type=module');
    else fail('json', 'package.json: "type" deve ser "module", está ' + JSON.stringify(pkg.type));
    if (pkg.private === true) ok('json', 'package.json private=true');
    else fail('json', 'package.json: "private":true ausente');
  }
  const man = parseJson('json', 'manifest.json');
  if (man) {
    const absent = ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color'].filter((f) => man[f] === undefined || man[f] === '');
    if (absent.length) fail('json', 'manifest.json sem campos obrigatórios: ' + absent.join(', '));
    else ok('json', 'manifest.json com identidade, escopo e cores');
    if (!Array.isArray(man.icons) || !man.icons.length) fail('json', 'manifest.json: icons ausente ou vazio (instalação sem ícone)');
    else {
      const gone = man.icons.filter((i) => typeof i.src === 'string' && !hasFile(norm(i.src))).map((i) => i.src);
      if (gone.length) fail('json', 'manifest.json aponta ícone inexistente: ' + gone.join(', '));
      else ok('json', 'manifest.json: ' + man.icons.length + ' ícones presentes no disco');
    }
    // start_url/scope relativos são o que permite o mesmo bundle em subdiretório (Pages).
    for (const f of ['start_url', 'scope']) if (typeof man[f] === 'string' && /^https?:\/\//.test(man[f])) fail('json', 'manifest.json: ' + f + ' absoluto quebraria deploy em subdiretório');
  }
  const vercel = parseJson('json', 'vercel.json');
  if (vercel) {
    if (vercel.outputDirectory === '.') ok('json', 'vercel.json outputDirectory="."');
    else fail('json', 'vercel.json: outputDirectory deve ser ".", está ' + JSON.stringify(vercel.outputDirectory));
    const headers = Array.isArray(vercel.headers) ? vercel.headers : [];
    const valueOf = (source, key) => ((headers.find((h) => h.source === source) || {}).headers || []).find((x) => x.key === key)?.value || '';
    // Sem no-store no sw.js o navegador não revalida o service worker a cada carga e o
    // skipWaiting() nunca tem efeito: o deploy novo fica invisível para quem instalou o app.
    if (/no-store/.test(valueOf('/sw.js', 'Cache-Control'))) ok('json', 'vercel.json: /sw.js com no-store');
    else fail('json', 'vercel.json: /sw.js sem Cache-Control no-store — atualizações do SW deixariam de ser detectadas');
    if (/no-cache/.test(valueOf('/index.html', 'Cache-Control'))) ok('json', 'vercel.json: /index.html com no-cache');
    else fail('json', 'vercel.json: /index.html sem no-cache — o cache pode prender o app numa versão velha');
    if (valueOf('/sw.js', 'Service-Worker-Allowed')) ok('json', 'vercel.json: Service-Worker-Allowed em /sw.js');
  }
}

/* ============================================================================= deps */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'overrides', 'resolutions'];
const LOCKS = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json'];

function checkDeps() {
  const pkg = parseJson('deps', 'package.json');
  if (pkg) {
    const present = DEP_FIELDS.filter((f) => pkg[f] && Object.keys(pkg[f]).length);
    if (present.length) fail('deps', 'package.json voltou a declarar dependências em ' + present.join(', ') + ' — "sem build, sem dependências" é decisão registrada do projeto');
    else ok('deps', 'package.json sem dependencies/devDependencies/overrides');
  }
  const locks = LOCKS.filter((f) => hasFile(f));
  if (locks.length) fail('deps', 'lockfile commitado: ' + locks.join(', ') + ' (supply chain num repo que não tem nenhuma)');
  else ok('deps', 'nenhum lockfile');
  if (existsSync(path.join(root, 'node_modules'))) fail('deps', 'node_modules/ presente na raiz — nada deveria ser instalado');
  else ok('deps', 'node_modules/ ausente');
}

/* ========================================================================= segredos */
// Padrões montados por concatenação: se o literal aparecesse inteiro aqui, o varredor casaria
// consigo mesmo. Assim este arquivo continua sendo varrido (como deve ser) sem falso positivo.
const F = { ai: 'AI' + 'za', gocsp: 'GOCSPX' + '-', begin: '-----' + 'BEGIN', dashes: '-----', akia: 'AKI' + 'A', ghp: 'ghp' + '_', pat: 'github_pat' + '_', slack: 'xox' + '[baprs]', ya29: 'ya29' + '.' };
const PATTERNS = [
  ['chave de API do Google', new RegExp(F.ai + '[0-9A-Za-z_-]{30,}')],
  ['client secret do Google OAuth', new RegExp(F.gocsp + '[0-9A-Za-z_-]{20,}')],
  ['chave privada em PEM', new RegExp(F.begin + ' [A-Z0-9 ]*PRIVATE KEY' + F.dashes)],
  ['Access Key ID da AWS', new RegExp(F.akia + '[0-9A-Z]{16}')],
  ['token do GitHub', new RegExp('(?:' + F.ghp + '[0-9A-Za-z]{30,}|' + F.pat + '[0-9A-Za-z_]{30,})')],
  ['token do Slack', new RegExp(F.slack + '-[0-9A-Za-z-]{10,}')],
  ['access token OAuth (ya29)', new RegExp(F.ya29 + '[0-9A-Za-z_.-]{20,}')],
  // O app aceita upload de JSON de credencial do Google Cloud pela UI: o vetor mais
  // provável de vazamento aqui é alguém salvar esse arquivo no diretório "para testar".
  ['client_secret com valor em JSON', /"client_secret"\s*:\s*"[^"]{8,}"/],
];
// Atribuição de campo de segredo a literal longo. O `(?:^|[^-\w])` é obrigatório: sem ele,
// `setup?'new-password':'current-password'` (o autocomplete do campo de senha em src/main.js)
// casa como credencial. O filtro de placeholder é o que mantém legítimo o `APICPF_API_KEY=`
// vazio do .env.example e o clientId público do src/config/google.js.
const ASSIGN_RE = /(?:^|[^\w-])(secret|api[_-]?key|access[_-]?token|auth[_-]?token|passw(?:or)?d|private[_-]?key)[\s"']*\s*[:=]\s*['"]?([^\s'",;)]{16,})/gi;
const PLACEHOLDER = /(?:<[^>\s]+>|x{4,}|process\.env|import\.meta|\{\{|your[_-]|example|placeholder|change[_-]?me|dummy|sample|redacted|\*{3,}|_{4,}|senha|chave|(?:new|current)-password)/i;
const BANNED_NAMES = [/^\.env$/, /^\.env\.[^.]+$/, /^client_secret.*\.json$/i, /\.pem$/, /^id_(?:rsa|ed25519|dsa)$/, /\.pfx$/, /\.p12$/];
const ALLOWED_NAMES = [/^\.env\.example$/];
const nameAllowed = (rel) => ALLOWED_NAMES.some((re) => re.test(path.basename(rel)));

function shannon(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
// O valor sai mascarado: log de Actions fica retido e é legível por qualquer membro da
// organização — não se ecoa a credencial que se acabou de detectar.
const redact = (line) => {
  const t = line.trim().replace(/[A-Za-z0-9_-]{8,}/g, (m) => m.slice(0, 4) + '****');
  return t.length > 88 ? t.slice(0, 88) + '…' : t;
};

function checkSecrets() {
  const badNames = ALL.filter((f) => !nameAllowed(f) && BANNED_NAMES.some((re) => re.test(path.basename(f))));
  if (badNames.length) fail('segredos', 'arquivo(s) que jamais deveriam estar versionados: ' + badNames.join(', '));
  else ok('segredos', 'nenhum .env / client_secret*.json / chave privada versionada');

  const findings = [];
  const seen = new Map();
  const record = (file, n, label, line) => {
    const key = file + ' ' + label;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) <= 3) findings.push(file + ':' + n + ' [' + label + '] ' + redact(line));
  };
  let scanned = 0;
  for (const rel of ALL) {
    if (BINARY.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs) || statSync(abs).size > 2 * 1024 * 1024) continue;
    let text;
    try {
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) continue; // binário sem extensão conhecida
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    scanned++;
    const isTemplate = nameAllowed(rel);
    text.split('\n').forEach((line, i) => {
      for (const [label, re] of PATTERNS) if (re.test(line)) record(rel, i + 1, label, line);
      for (const m of line.matchAll(ASSIGN_RE)) {
        const v = m[2];
        // Comprido E alta entropia: é o que separa a fixture 'chave-falsa-de-teste' de um
        // token de verdade.
        if (!PLACEHOLDER.test(v) && v.length >= 16 && shannon(v) >= 3) record(rel, i + 1, 'atribuição de segredo em literal', line);
      }
      // Template de ambiente: existir é certo; estar PREENCHIDO é que é o vazamento.
      if (isTemplate) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
        if (m && !PLACEHOLDER.test(m[2])) record(rel, i + 1, 'template de ambiente com valor real', line);
      }
    });
  }
  if (findings.length) for (const f of findings) fail('segredos', f);
  else ok('segredos', 'nenhum padrão de segredo em ' + scanned + ' arquivos de texto');
  info('segredos', 'clientId de OAuth e nomes de variáveis são públicos por especificação e não contam como segredo');
}


/* ============================================================================ docs */
// Toda afirmação da documentação é citada como `arquivo:linha`. Se o arquivo não está no
// repositório ou a linha não existe, o documento está mentindo para quem lê — e isso já
// aconteceu: 13 referências apontavam para relatórios de auditoria que ficaram fora do
// repo, e o validador ad hoc não as via porque só reconhecia caminhos com prefixo
// conhecido. A checagem mora aqui (e não num script python de um agente) para que o
// critério seja do projeto, não da ferramenta que produziu o texto.
function checkDocs() {
  // docs/auditoria/ é a evidência bruta coletada no commit de referência e congelada como
  // texto histórico: ela cita linhas tais como eram em e78d776. Reescrevê-la a cada mudança
  // destrói justamente o valor probatório, então ela é declarada isenta da checagem de
  // faixa — os documentos canônicos (todos os outros) NÃO estão isentos.
  const isento = (f) => f.startsWith('docs/auditoria/');
  const docs = ALL.filter((f) => !isento(f) && (f === 'README.md' || f === 'AGENTS.md' || (f.startsWith('docs/') && f.endsWith('.md'))));
  if (!docs.length) return fail('docs', 'nenhum documento encontrado — a checagem não verificou nada');

  const known = new Set(ALL);
  const byName = new Map();
  for (const f of ALL) {
    const b = path.basename(f);
    byName.set(b, (byName.get(b) || 0) + 1);
    const relDir = path.posix.dirname(f);
    if (relDir !== '.') byName.set(relDir + '/' + b, (byName.get(relDir + '/' + b) || 0) + 1);
  }
  const lineCount = new Map();
  const count = (rel) => {
    if (!lineCount.has(rel)) {
      try {
        lineCount.set(rel, readFileSync(path.join(root, rel), 'utf8').split('\n').length);
      } catch {
        lineCount.set(rel, 0);
      }
    }
    return lineCount.get(rel);
  };

  // caminho com ao menos um '/' : audit/x.md:592 · src/services/debts.js:20 · docs/API.md:70
  const PATHED = /([\w.@+-]+(?:\/[\w.@+-]+)+\.(?:js|mjs|css|html|json|md|ts|py|yml|yaml))(?::(\d{1,4})(?:-(\d{1,4}))?)/g;
  // só o nome: debts.js:14 · sw.js:2  (resolvido quando o nome é único no repositório)
  const BARE = /(?<![\w./-])([\w][\w.-]*\.(?:js|mjs|css|html|json|md))(?::(\d{1,4})(?:-(\d{1,4}))?)/g;
  const ABSOLUTO = /(\/home\/[\w./-]*|\/Users\/[\w./-]*|C:\\[\\\w.-]*)/g;

  const unresolved = new Map(), outOfRange = new Map(), absolute = new Map(), ambiguous = new Set();
  let resolved = 0;

  const register = (map, key, where) => {
    const list = map.get(key) || [];
    if (list.length < 3) list.push(where);
    if (list.length === 3 && !map.has(key + '#more')) map.set(key + '#more', true);
    map.set(key, list);
  };

  for (const rel of docs) {
    const text = readFile('docs', rel);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      const where = rel + ':' + (i + 1);
      for (const m of line.matchAll(ABSOLUTO)) {
        if (m[1].replace(/\/+$/, '').endsWith('/scipione-cred-offline')) continue; // raiz do projeto é citável
        const list = absolute.get(m[1]) || [];
        if (list.length < 4) list.push(where);
        absolute.set(m[1], list);
      }
      for (const rx of [PATHED, BARE]) {
        rx.lastIndex = 0;
        for (const m of line.matchAll(rx)) {
          const target = m[1], from = Number(m[2]), to = Number(m[3] || m[2] || 0);
          if (!from) continue;
          let hit = null;
          const suffix = (t) => ALL.filter((f) => f === t || f.endsWith('/' + t));
          if (known.has(target)) hit = target;
          else if (target.includes('/') && known.has(target.replace(/^\.\//, ''))) hit = target.replace(/^\.\//, '');
          else if (target.includes('/')) {
            // forma abreviada de tabela ("ui/shell.js" quer dizer src/ui/shell.js): vale
            // quando um único arquivo do repositório termina por aquele caminho.
            const c = suffix(target);
            if (c.length === 1) hit = c[0];
            else if (c.length > 1) { ambiguous.add(target + ' [' + where + '] sufixo ambíguo: ' + c.join(', ')); continue; }
            else { register(unresolved, target, where); continue; }
          } else if (!target.includes('/')) {
            const n = byName.get(target) || 0;
            if (n === 1) hit = ALL.find((f) => path.basename(f) === target || f === target);
            else if (n > 1) {
              const cands = ALL.filter((f) => f === target || path.basename(f) === target);
              if (cands.some((c) => count(c) >= to)) { resolved++; continue; }
              ambiguous.add(target + ' (' + where + ')');
              continue;
            } else { register(unresolved, target, where); continue; }
          } else { register(unresolved, target, where); continue; }
          if (!hit) { register(unresolved, target, where); continue; }
          const total = count(hit);
          if (to > total) register(outOfRange, hit + ':' + m[2] + (m[3] ? '-' + m[3] : '') + ' (tem ' + total + ' linhas)', where);
          else resolved++;
        }
      }
    });
  }

  if (unresolved.size) {
    for (const [t, where] of unresolved) if (!t.endsWith('#more'))
      fail('docs', 'citação aponta para arquivo que não está no repositório: `' + t + '` em ' + where.join(', ') + (where.length >= 3 ? ' …' : ''));
  } else ok('docs', 'todas as citações apontam para arquivos versionados');

  if (outOfRange.size) {
    for (const [t, where] of outOfRange) if (!t.endsWith('#more'))
      fail('docs', 'linha citada fora da faixa: ' + t + ' em ' + where.join(', '));
  } else ok('docs', 'nenhuma linha citada fora da faixa do arquivo');

  if (absolute.size) {
    for (const [t, where] of absolute) fail('docs', 'caminho absoluto de uma máquina específica na documentação: ' + t + ' em ' + where.join(', '));
  } else ok('docs', 'nenhum caminho absoluto de máquina específica');

  (resolved ? ok : info)('docs', resolved + ' citações resolvidas em ' + docs.length + ' documentos');
  if (ambiguous.size) info('docs', ambiguous.size + ' citação(ões) por nome ambíguo: ' + [...ambiguous].slice(0, 4).join(', '));
}

/* ============================================================================ main */
const RUNNERS = { essenciais: checkEssenciais, sintaxe: checkSintaxe, sw: checkSw, json: checkJson, deps: checkDeps, segredos: checkSecrets, docs: checkDocs };
console.log('=== SCIPIONE CRED — checagens estáticas ===');
console.log('raiz: ' + root);
console.log('grupos: ' + [...active].join(', ') + ' · itens: ' + ALL.length + ' (' + LIST_NOTE + ')');
for (const g of GROUPS) {
  if (!active.has(g)) continue;
  try {
    RUNNERS[g]();
  } catch (e) {
    fail(g, 'a própria checagem ruiu: ' + e.message);
  }
  const s = state.get(g);
  console.log('\n--- ' + g + ' ---');
  for (const m of s.ok) console.log('  [ok]    ' + m);
  for (const m of s.info) console.log('  [info]  ' + m);
  for (const m of s.fail) console.log('  [FALHA] ' + m);
}
const totalFail = GROUPS.reduce((n, g) => n + state.get(g).fail.length, 0);
const totalOk = GROUPS.reduce((n, g) => n + state.get(g).ok.length, 0);
console.log('\n=== RESULTADO === ' + totalOk + ' verificações OK · ' + totalFail + ' falhas');
console.log(totalFail ? 'FALHOU' : 'APROVADO');
process.exit(totalFail ? 1 : 0);
