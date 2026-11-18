# SCIPIONE CRED — Auditoria de Testes e Infraestrutura de Qualidade

> **Trilha de evidência congelada.** Este relatório é a fonte bruta da auditoria de
> 2026-11-18, escrita contra o commit de referência `e78d776`. Ele é mantido como está,
> inclusive nos números de linha que depois mudaram: o valor do documento é justamente
> mostrar o que foi observado naquele commit. Ao corrigir S-02 e D-01, `api/cpf.js`,
> `src/services/apicpf.js`, `src/services/debts.js` e `src/ui/debts.js` mudaram de forma —
> as linhas vigentes desses arquivos (e de qualquer outro) estão nos documentos canônicos
> (`docs/SECURITY.md`, `docs/API.md`, `docs/ROADMAP.md`, `docs/TESTING.md`,
> `docs/PROJECT_MAP.md`), não aqui. Por isso `docs/auditoria/**` é isento da checagem de
> faixa do grupo `docs` de `scripts/check-static.mjs`: reescrever evidência histórica a cada
> refatoração destruiria exatamente o que a torna prova.


**Área:** testes existentes e infraestrutura de qualidade
**Repositório:** `/home/ubuntu/scipione-cred-offline` · branch `main` · HEAD `e78d776`
**Modo:** READ-ONLY. Verificação ao final: `git status --porcelain` vazio, `git diff --stat` vazio, HEAD inalterado em `e78d776`. **Nenhum arquivo do repositório foi modificado e nenhuma dependência foi instalada.**
**Data:** 2026-11-17

> Todos os CPFs/CNPJs/nomes citados são os que já constam no repositório como fixtures de exemplo (`529.982.247-25`, `11.222.333/0001-81`, `11144477735`, "Ana", "Bia", "Manoel Junior", "João da Silva") ou são fictícios.

---

## 1. Estado real transcrito

### 1.1 `package.json` (conteúdo integral, linha 1)

```json
{"type":"module","private":true}
```

Consequências verificadas:

| Campo | Presente? | Evidência |
| --- | --- | --- |
| `scripts` (logo, **não existe `npm test`**) | NÃO | `grep -c scripts package.json` → `0`; `npm test` → `npm error Missing script: "test"` |
| `devDependencies` | NÃO | `grep -c devDependencies` → `0` |
| `engines` | NÃO | `grep -c engines` → `0` (README:210 diz apenas "Node.js 18+ apenas para executar os testes") |
| `dependencies` | NÃO | repo é "sem build", `vendor/fflate.min.js` é commitado (`vendor/`: 32.665 bytes) |

### 1.2 `ls tests/`

```
address.test.mjs   1259 B
apicpf.test.mjs    2071 B
backup.test.mjs    3094 B
crypto.test.mjs     681 B
money.test.mjs     1288 B
stage4.test.mjs     842 B
validators.test.mjs 643 B
```

7 arquivos, todos `.mjs`, total de 134 linhas. Não existe nenhum outro arquivo de teste no repo: `find . -name '*test*'` retorna apenas `./tests` e esses 7 arquivos.

### 1.3 `git log --oneline -- tests/ | head -20`

```
fd6bc3c Add APICPF validation and reorder client fields
3d374a1 Add address complement field in client form
8d57ccb Reorder client address fields and add street number
0939c91 Add ViaCEP address lookup to client forms
d58733d Add files via upload
```

5 commits tocaram `tests/`. O primeiro (`d58733d`, "Add files via upload") criou a suíte; os outros 4 só acrescentaram testes de endereço/APICPF. **Os 45 commits restantes da história (incluindo `google-drive.js` de 226 linhas, `ui/tools.js` de 208 e `ui/clients.js` de 186) nunca tocaram `tests/`** — a suíte não cresce junto com o código.

### 1.4 Execução — `cd /home/ubuntu/scipione-cred-offline && node --test tests/*.test.mjs 2>&1 | tail -20`

```
# etapa4: ok
# Subtest: tests/stage4.test.mjs
ok 6 - tests/stage4.test.mjs
  ---
  duration_ms: 52.499152
  type: 'test'
  ...
# validators: ok
# Subtest: tests/validators.test.mjs
ok 7 - tests/validators.test.mjs
  ---
  duration_ms: 54.56284
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2050.35788
```

### 1.5 `node --version`

```
v22.23.4
```

### 1.6 Registro interpretado da execução

| Métrica | Valor | Observação |
| --- | --- | --- |
| Arquivos executados | **7** | `1..7` |
| "testes" reportados | **7** | **1 por arquivo, não por caso.** Ver §1.7 |
| Suites | 0 | nenhum `describe()` |
| Pass / Fail | 7 / 0 | |
| Duração (`# duration_ms`) | 2050 ms numa corrida; **1810 ms** e **2500 ms** em duas corridas consecutivas | variância de ±20% |
| Chamadas `assert` no código | **94** | address 14, apicpf 15, backup 17, crypto 5, money 23, stage4 9, validators 11 |
| Execuções de assert em runtime | **≈116** | 94 + laços (`tests/stage4.test.mjs:5` ×9, `:6` ×3, `tests/apicpf.test.mjs:37-43` ×5) |
| Exit code com tudo verde | `0` | medido |
| Exit code com 1 assert quebrado | `1` | medido (§1.8) |

**NÃO CONFIRMADO:** não existe número confiável de "testes" no sentido usual. O runner reporta arquivos, então a frase "7 testes" é literal mas enganosa — são 7 arquivos com ~116 asserções.

### 1.7 Achado estrutural: os arquivos não usam `node:test`

`grep -rn "from 'node:test'\|describe(\|it(\|test(" tests/` → **(NONE)**.

Os 7 arquivos são **scripts ESM nus**: importam o módulo, empilham `assert`, e terminam com um `console.log('...: ok')`. O `node --test` só os trata como teste porque cada arquivo é uma unidade de execução — o veredicto é "o processo morreu em 0?".

Consequências concretas:

1. **Falha-rápida cega.** Um `assert` que quebra na linha 2 impede o teste de jamais chegar à linha 3. Em `tests/money.test.mjs` (23 asserts) uma regressão na linha 2 esconde as 21 verificações restantes.
2. **Relatório sem granularidade.** CI não consegue dizer *qual* comportamento quebrou nem quantos casos existem; `# tests 7` nunca muda, não importa quantos asserts sejam adicionados — dá uma falsa sensação de estabilidade da suíte.
3. **Passo vazio é possível.** Como o critério de aprovação é "não lançou exceção", um arquivo que apenas importe um módulo e faça `console.log('ok')` passa. Não é o caso hoje (todos têm asserts), mas a estrutura não impede.
4. **Sem isolamento de estado.** `globalThis.fetch`, `globalThis.fflate` e `process.env.APICPF_API_KEY` são mutados por arquivo (§2). O runner executa cada arquivo em processo separado, então hoje isso não colide — mas impede consolidar arquivos num mesmo processo para ganhar tempo.

### 1.8 Verificação de que falha realmente bloqueia

Copiei `tests/money.test.mjs` para `/tmp` (fora do repo), quebrei um esperado, e rodei:

```
not ok 1 - /tmp/probe/t/broken.mjs
# tests 1
# pass 0
# fail 1
EXIT on failing test: 1
```

Ou seja: **o exit code é correto** — o problema de "falha virar aprovação" não está no runner, está na *quantidade e na granularidade* do que é exercitado, e no comando documentado no README (ver §8, item D1).

---

## 2. Análise arquivo a arquivo

Legenda de stubs: **nenhum** dos 7 arquivos cria `globalThis.indexedDB`, `document`, `window`, `navigator`, `sessionStorage`, `localStorage`, `caches`, `createImageBitmap` ou `Blob`. A tabela completa de stubs está em §2.8.

---

### 2.1 `tests/money.test.mjs` — 12 linhas, 23 asserts

**Módulo exercitado:** `src/domain/money.js` (import integral, `tests/money.test.mjs:1`: `import*as M from '../src/domain/money.js'`). Zero stubs de browser — `money.js` é puro.

| Linha | Asserção real | O que protege |
| --- | --- | --- |
| `:2` | `M.interest(500000,1500)===75000`; `M.brl(75000)==='R$ 750,00'`; `M.brl(500000)==='R$ 5.000,00'` | juros básicos e formatação BRL |
| `:3` | `interest(333,1000)===33`; `interest(335,1000)===34`; `interest(1,1)===0` | arredondamento "meio para cima" ao centavo — casa com `money.js:9` `Number((BigInt(p)*BigInt(b)+5000n)/10000n)` |
| `:4` | `interest(1e13,100000)===1e14` | sem perda em ponto flutuante (via BigInt) |
| `:5` | `num(5)==='0,05'`; `num(123456789)==='1.234.567,89'`; `cents('R$ 5.000,00')===500000` | máscara pt-BR e parsing |
| `:6` | `parseRate('12,5')===1250`; `'0.29'→29`; `'15%'→1500`; `'1,234'→null`; `'x'→null` | 3 formatos aceitos + 2 rejeitados |
| `:7` | `rate(1500)==='15%'`; `rate(1250)==='12,5%'`; `rate(1205)==='12,05%'` | formatação de taxa (trim de zero à direita, `money.js:6`) |
| `:9` | `deepEqual(planRate(ds,'add',100).map(x=>x.nr),[1300,1300])`; `p[0].ni===13000` | modo "soma pontos percentuais" |
| `:10` | `planRate(ds,'sub',1200).every(x=>!x.ok)`; `planRate(ds,'set',1500).every(x=>x.ok&&x.nr===1500)` | modo "subtrai" gera taxa ≤0 inválida; modo "set" |
| `:11` | `!planRate(ds,'add',M.MAXR)[0].ok` | estouro do teto `MAXR=100000` |

**Ficou de fora:** `interest` com `principal` negativo (a função é usada com soma em `dashboard.js:4` `sum`); `num`/`brl` negativos (`money.js:3` trata `-`, nenhum teste); `cents('abc')` → `0` (`money.js:5` — comportamento silencioso arriscado, sem teste); `parseRate('')`, `parseRate('1.2345')`; `rate(0)`; `planRate` com lista vazia; `MAXR` como limite exato (só testa ultrapassagem); arredondamento em `interest` para taxas não inteiras. **Nenhum teste de propriedade/fuzz** para uma área (dinheiro) onde isso seria o maior ganho.

---

### 2.2 `tests/validators.test.mjs` — 6 linhas, 11 asserts

**Módulo:** `src/domain/validators.js` (`:1`). Puro, sem stubs.

Casos: `validCPF('529.982.247-25')` válido, `'...-26'` inválido, `'111.111.111-11'` inválido (rejeição de repetição, `validators.js:2`); `validCNPJ('11.222.333/0001-81')` válido, `'...-80'` inválido, `'00000000000000'` inválido; `mask.cpf`, `mask.cnpj`, `mask.phone` celular/fixo, `digits('(11) 9')==='119'` (`:2`–`:5`).

**Ficou de fora (relevante, pois o mesmo `validCPF` é a porta de entrada do proxy público `api/cpf.js:17`):** CPF/CNPJ com comprimento errado; entrada `null`/`undefined`/número; CPF sem máscara; o comportamento incremental das máscaras (ex.: `mask.cpf('')`, `mask.cpf('12')` — `validators.js:7` é uma cadeia de `replace` pensada para digitação parcial, e **só o caso completo é testado**); `mask.phone` com 7 dígitos (nenhum ramo de `validators.js:9` cobre DDD+4); o ramo `d.length>2` vs `>6` vs `>10`.

---

### 2.3 `tests/address.test.mjs` — 17 linhas, 14 asserts

**Módulos:** `src/domain/address.js` (`:2`), transitivamente `validators.js` (via `address.js:1`).

Melhor suíte em termos de proporção asserção/linha de produto. Cobre `onlyDigits` (`:3`), `maskCep` completo e **parcial** `'0100100'→'01001-00'` (`:4`–`:5`), `validCep` válido/curto/'00000000' (`:6`–`:8`), e 8 combinações de `composeAddress` (`:9`–`:16`): com/sem número, com/sem complemento, sem rua, só número, só complemento, só cidade+UF, objeto vazio → `''`. Isso casa bem com os ramos de `address.js:8`–`:11`.

**Ficou de fora:** `validCep` com 9+ dígitos (`address.js:4` usa `slice`? não — usa `digits(v).length===8`, logo `'010010009'` é inválido, não testado); `maskCep` com mais de 8 dígitos; `composeAddress` com `state` minúsculo só no caminho sem `city` (o `.toUpperCase()` de `address.js:7` só é exercitado em `:9`); campos com espaços nas pontas (`clean`, `address.js:5`); CEP `null`.

**Não exercita o serviço** `src/services/viacep.js` (34 linhas) que consome `maskCep`/`validCep` — ver §3.

---

### 2.4 `tests/crypto.test.mjs` — 9 linhas, 5 asserts (a suíte mais enxuta e a mais densa)

**Módulo:** `src/security/crypto.js` (`:2`: `createVault,openVault,sealJSON,openJSON`).

| Linha | Asserção | Valor |
| --- | --- | --- |
| `:3` | `const{meta}=await createVault('Senha-Forte-1'); const k=await openVault('Senha-Forte-1',meta)` | round-trip KEK→DEK |
| `:4` | `await assert.rejects(openVault('errada',meta))` | senha errada não abre (via tag GCM, como documenta `crypto.js:2`) |
| `:5` | `deepEqual(await openJSON(k,await sealJSON(k,{a:1})),{a:1})` | ida e volta de JSON |
| `:6` | inverte o último byte do cipher e `assert.rejects(openJSON(k,t))` — **adulteração detectada** | integridade AES-GCM |
| `:7` | `assert.notDeepEqual(s, await sealJSON(k,{a:1}))` — **IV único por gravação** | não-reuso de IV |
| `:8` | `await assert.rejects(crypto.subtle.exportKey('raw',k))` — **chave não extraível** | `extractable:false` de `crypto.js:15` |

Estas são exatamente as 3 propriedades de segurança que importam, e todas estão lá. Excelente núcleo.

**Problemas técnicos:**
- **`:8` usa o global `crypto` nu.** Funciona em Node 22 (verifiquei `typeof globalThis.crypto === 'object'`, `crypto.subtle` presente) e no browser (`window.crypto`) **por coincidência de nome**, não por contrato. Um harness que instale um `crypto` próprio pode torná-lo silenciosamente redundante.
- **Dependência implícita e não testada de custo:** `crypto.js:4` `ITER=600000` — o teste não verifica que `meta.iter === ITER` nem que `meta.kdf === 'PBKDF2-SHA256'` / `cipher === 'AES-GCM-256'` / `v === 1` (`crypto.js:11`). Se alguém baixar `ITER` para 10.000, **todos os testes passam**. Este é o teste de segurança mais valioso que falta e custa 4 linhas.
- **Nunca exercita a imigração de formato:** `openVault` lê `m.iter` (`crypto.js:14`) — ou seja, o iter é um dado de arquivo versionado, mas nenhum teste abre um `meta` com `iter` antigo, que é o caso real de upgrade de cofre.
- **Fora:** `rnd` (`crypto.js:5`), `sealBytes`/`openBytes` direto (`:17`–`:18`) — só testados indireamente pelo backup; `deriveAesKey` (`:22`, usado pelo backup); tamanho/estrutura do blob (`iv` de 12 bytes + ciphertext); senhas Unicode/vazias/`<8` chars (o mínimo de 8 chars é validado na **UI** em `src/main.js:19`, portanto **não há teste nenhum** da política de senha — ver §3 e §5 tema 1).

---

### 2.5 `tests/stage4.test.mjs` — 7 linhas, 9 asserts — **nome opaco**

**Módulos:** `src/domain/due.js` e `src/services/search.js` (`:1`). O `console.log` diz `'etapa4: ok'` — o arquivo é nomeado pela **numeração interna da missão**, não pelo que testa. Não existe nada no repo que documente o que é "etapa 4" (só README:128 menciona "etapa" casualmente).

| Linha | Asserção |
| --- | --- |
| `:2` | `daysUntil('2026-11-21','2026-11-14')===7`; `daysUntil('2027-01-01','2026-12-30')===2` — **virada de ano** |
| `:3` | `status` → `'overdue'` (ontem), `'soon'` (hoje), `'soon'` (hoje+janela), `'ok'` (janela+1), `'soon'` com janela 30 |
| `:4`-`:6` | `match(c,q)` do cliente fictício "João da Conceição": 9 consultas esperadas como **acerto** (`'joao'`, `'CONCEICAO'` acento+caixa, `'52998224725'`, `'529.982'`, `'987654321'`, `'joao@ex'`, `'12345678'`, `'33334444'`, `''`) e 3 como **erro** (`'maria'`,`'999'`,`'João 2'`) |

Bem desenhado: cobre os dois ramos de `search.js:3`–`:4` (texto normalizado e busca numérica por dígitos, condicionada ao `test(/^[\d\s.\-\/()+]+$/)`).

**Ficou de fora:**
- **Fuso/horário de verão:** `due.js:2` usa `Date.UTC` explícito (bom), mas `due.js:3` `todayISO()` depende de `getTimezoneOffset()` e **nenhum teste fixa o TZ**. Rodar a suíte com `TZ=America/Sao_Paulo` vs `TZ=UTC` vs `TZ=Pacific/Kiritimati` nunca foi verificado — e é a classe de bug clássica de "vencimento de ontem".
- `daysUntil` com `due` no passado, datas inválidas, `status` com janela 0.
- `search.match` com `c.email`/`rg` ausentes (o `norm(undefined)` de `search.js:3`); busca com caractere fora do whitelist (`'abc-def'`, que tem dígitos mas não passa no regex → o caminho numérico é ignorado silenciosamente); substring de CPF que colide entre clientes (`'529'` casa em dois clientes diferentes — falso positivo aceitável, mas não documentado por teste).
- **`dashboard.js` inteiro (7 linhas) e `services/settings.js` (3 linhas) sem teste** — é o `stats()` que consome `status()` com a janela real vinda do banco (`dashboard.js:4`–`:6`).

---

### 2.6 `tests/backup.test.mjs` — 28 linhas, 17 asserts — maior escopo, maior carga de stubs

**Módulos exercitados:** `src/export/backup-format.js` (`buildBackup`,`readBackup`), `src/export/xlsx.js` (`buildXlsx`), `src/export/reports.js` (`inPeriod`,`label`) — todos via **dynamic import** na `:3`.

**Setup não trivial (`:1`–`:2`):**

```js
const m={exports:{}};new Function('module','exports',readFileSync(new URL('../vendor/fflate.min.js',import.meta.url),'utf8'))(m,m.exports);globalThis.fflate=m.exports;
```

Como `fflate` é UMD e o código de produção o obtém por injeção de `<script>` (`src/export/lib.js:2`–`:4`), o teste precisa **avaliar o vendor dentro de um wrapper CommonJS falso** e publicar o resultado em `globalThis.fflate`. É uma solução correta e engenhosa, mas é código de infraestrutura de teste **dentro** do arquivo de teste, não reutilizável (ver §6).

**Fixtures (`:4`–`:7`):** 5000 bytes pseudo-aleatórios (`i%251`); 2 clientes ("Ana" CPF, "Bia" CNPJ) com `photoId`/`createdAt`; 1 dívida; 1 documento com `hash:'h'`; 1 item de histórico; `settings:{dueWindow:7}`; `files` como `Map`; `dbVersion:1`. Fabrica `mk()` reutilizada para mutações — bom padrão.

| Linha | Asserção | Propriedade |
| --- | --- | --- |
| `:9`-`:10` | round-trip sem senha: `manifest.counts.clients===2`, `debts[0].principal` preservado (`deepEqual` protege contra stringificação), bytes do arquivo idênticos (`deepEqual([...r.data.files.get('p1')],[...bytes])`) | fidelidade binária |
| `:12`-`:13` | `assert.rejects(readBackup(e),x=>x.code==='NEEDS_PASSWORD')` e `...('errada'),x=>x.code==='BAD_PASSWORD')` | criptografia + contratos de erro por código |
| `:14` | `readBackup(e,'senha-backup-1').data.clients.length===2` | abre com a senha certa |
| `:15` | `assert(!Buffer.from(e).includes(Buffer.from('Ana')),'nomes não podem aparecer em claro no backup criptografado')` | **teste de não-vazamento de dado sensível em texto claro** — o melhor teste de segurança da suíte |
| `:17` | dívida órfã (`clientId='zzz'`) → `code==='INVALID'` | integridade referencial |
| `:18` | blob referenciado ausente (`files.delete('b1')`) → `INVALID` | integridade de anexos |
| `:19` | byte no meio do arquivo corrompido → rejeita | detecção de corrupção |
| `:20` | `new Uint8Array([1,2,3])` → `INVALID` | lixo não explode |
| `:21` | ZIP válido mas com `manifest.json` `{app:'x'}` → `INVALID` | não aceita qualquer zip |
| `:23`-`:24` | `inPeriod` por dia/mês, virada de mês; `label` → `'Março/2026'`, `'Dia 06/11/2026'` | relatórios de período |

**Ficou de fora — e é a maior lacuna de valor/risco do repo:**
- **`src/export/backup.js` inteiro (30 linhas) NÃO é importado.** Ou seja, `createBackup()` (`backup.js:4`–`:10`, que lê o IndexedDB de verdade e falha se um anexo estiver ilegível) e **`restore(d,mode)` (`backup.js:12`–`:29`) não têm nenhum teste**. `restore` é a função mais perigosa do app: implementa `mode==='replace'` apagando **todas** as stores (`backup.js:15`) e o modo merge com dedupe por `id` **ou** CPF/CNPJ (`backup.js:22` `byDoc.get(digits(c.doc))`), remapeamento de `clientId` (`:24`,`:27`) e dedupe de documentos por `clientId+hash` (`:26`). **Zero asserções sobre nada disso.**
- **`buildXlsx` nunca é asserido.** `:26`–`:27` geram um `/tmp/amostra.xlsx` e escrevem no disco temporário **para validação manual externa** (o comentário `:25` diz "xlsx de amostra para validação externa"). O teste passa se o arquivo for um lixo binário, desde que `buildXlsx` não lance exceção. `reports.xlsxBytes` (`reports.js:14`–`:21`) nem é chamado.
- `reports.load()` (`reports.js:8`–`:13`, que junta dívidas + movimentações e soma) sem teste.
- `dbVersion` / política de compatibilidade de versão do backup: fixture declara `dbVersion:1` mas nenhuma asserção usa.

---

### 2.7 `tests/apicpf.test.mjs` — 55 linhas, 15 asserts — **contém o defeito mais grave da suíte**

**Módulo exercitado:** `api/cpf.js` (a função serverless Vercel), `:2`: `import handler from '../api/cpf.js'`.

**Apesar do nome, NÃO testa `src/services/apicpf.js`** (58 linhas, o cliente que roda no browser com cache de 30 min, dedupe de requisições concorrentes e timeout de 9 s — `apicpf.js:3`,`:20`). Esse arquivo é um `import` que nunca aparece em nenhum teste (§3).

**Harness (`:4`–`:11`):** mock de `res` de serverless (`statusCode`,`setHeader`,`end`,`json()`) e mock de `req` como `{method,url}`; helper `call(url,key,method)` que **escreve `process.env.APICPF_API_KEY`** (`:7`).

| Linha | Caso | Esperado |
| --- | --- | --- |
| `:15`-`:17` | sem chave (`key=undefined`) | `503`, `{ok:false}` |
| `:19`-`:21` | CPF inválido (`11111111111`, repetido) | `422`, `reason:'INVALID'` |
| `:23`-`:24` | ausente o param `cpf` | `422` |
| `:26`-`:30` | upstream 200 (fetch stubado) | `200`; mapeamento `{nome,genero,data_nascimento}` → `{name,gender,birth}` (`deepEqual`); header `Cache-Control: no-store` |
| `:32`-`:35` | upstream `code:404` | `422` / `INVALID` |
| `:37`-`:43` | laço por `401,402,403,429,500` | todos `503` + `UNAVAILABLE` **e** `assert.equal(JSON.stringify(r.body).includes('message'),false)` → **não vaza mensagem do upstream** (anti-enumeração — bom) |
| `:45`-`:47` | `fetch` lança | `503` |
| `:49`-`:50` | `POST` | `405` |
| `:52`-`:55` | `finally` restaura `globalThis.fetch` e apaga a env var | boa higiene |

Cobertura de casos de erro do handler é, em intenção, a melhor da suíte. **Mas o primeiro caso está errado.**

#### Defeito D1 (confirmado por execução): o teste faz uma requisição HTTPS real a `apicpf.com` e o `503` é obtido pela razão errada

`tests/apicpf.test.mjs:7` faz `process.env.APICPF_API_KEY=key` com `key===undefined`. Em Node, atribuir `undefined` a `process.env` **coerce para a string `"undefined"`**, que é truthy. Verifiquei:

```
typeof: string  value: "undefined"  truthy: true
```

Portanto a guarda `if(!key)return send(res,503,{ok:false,reason:'UNAVAILABLE'})` em `api/cpf.js:20` **não é tomada**. O handler cai no bloco `try` e executa `fetch(\`${ENDPOINT}?cpf=${cpf}\`...)` em `api/cpf.js:25` contra `https://apicpf.com/api/consulta` (`api/cpf.js:3`) — **usando o fetch real**, porque o stub só é instalado em `tests/apicpf.test.mjs:26`, três chamadas depois.

Evidência direta (spy envolvendo `globalThis.fetch` antes de importar o arquivo de teste real):

```
--- loading the REAL test module ---
apicpf: ok
attempt(s) to real apicpf.com during the test: 1
   -> https://apicpf.com/api/consulta?cpf=11144477735
elapsed 1858 ms
```

E isolando o passo (`process.env.APICPF_API_KEY=undefined` + fetch espião):

```
status: 503 body: {"ok":false,"reason":"UNAVAILABLE"}
fetch was called with: https://apicpf.com/api/consulta?cpf=11144477735
env value now: "undefined"
```

**A asserção `assert.equal(r.status,503)` (`:16`) passa por rede indisponível, não pela ausência de chave** — o fluxo do teste é: rede falha → `catch` em `api/cpf.js:43` → `503`. É por isso que este arquivo custa 1.385–5.821 ms contra 42–678 ms dos demais (§1.6, §4.4): o tempo é o timeout da pilha de rede do sandbox.

Impactos:
1. **A guarda "sem chave configurada" (`api/cpf.js:19`–`:20`) tem 0% de cobertura real.**
2. **O teste depende da ausência de internet.** Num GitHub Actions runner com egress liberado, a chamada real acontece de fato: envia um CPF a um terceiro, com header `X-API-KEY: undefined` (`api/cpf.js:26`). Se o upstream responder `200` com `data`, o teste **falha**; se responder `401`, ainda passa (`api/cpf.js:42`) — mas por acidente, pela segunda vez. **NÃO CONFIRMADO:** comportamento real de `apicpf.com` sem chave (o sandbox não tem egress para esse host; `curl` não retornou nada em 12 s).
3. **Vazamento de PII em CI/log:** a URL contém um CPF; em caso de falha o runner pode imprimir a URL.
4. É também um **falso-positivo de teste**: o comportamento que se queria travar não está travado.

Correção mínima (não aplicada, por ser auditoria read-only): stubar `globalThis.fetch` **antes** da linha 15 e/ou usar `delete process.env.APICPF_API_KEY` em vez de atribuir `undefined`, e ainda asserir que o `fetch` stub **não** foi chamado nesse caso.

---

### 2.8 Matriz de globals do navegador — o que os testes stubam

| Global | Criado/stubado por algum teste? | Evidência |
| --- | --- | --- |
| `globalThis.fetch` | **SIM** (só `apicpf`) | `tests/apicpf.test.mjs:26`,`:32`,`:38`,`:45`; restaurado em `:53` |
| `globalThis.fflate` | **SIM** (só `backup`) | `tests/backup.test.mjs:2` via `new Function` |
| `process.env.APICPF_API_KEY` | **SIM** (só `apicpf`) | `:7`, `:54` |
| `globalThis.crypto` / `crypto.subtle` | **NÃO** — usa o global nativo do Node 22 | `tests/crypto.test.mjs:8` referencia `crypto` nu; Node 22.23.4 expõe `crypto`+`subtle`+`randomUUID` (verificado) |
| `indexedDB` | **NÃO** | nenhum teste o cria; por isso `src/db/idb.js` é só *carregado*, nunca exercido |
| `document` | **NÃO** | `grep` casa `document` em `backup.test.mjs:6` apenas como **chave de fixture** (`documents:[...]`), não como DOM |
| `window` | **NÃO** | ausente dos testes |
| `navigator` | **NÃO** | ausente (por isso `src/services/apicpf.js:9` `navigator.onLine` é untestável hoje) |
| `sessionStorage` / `localStorage` | **NÃO** | ausente (bloqueia `src/security/auth.js:7`–`:9` e `google-drive.js:18`) |
| `caches` / `serviceWorker` / `matchMedia` | **NÃO** | ausente (bloqueia `sw.js:3`–`:5`, `src/pwa.js`) |
| `Blob`/`File`/`Response`/`URL`/`structuredClone` | **não precisam de stub** — nativos do Node 22 | verificado em §4.1 |
| `createImageBitmap` / canvas | **NÃO** e **não existem em Node** | bloqueia o ramo de imagem de `src/files/process.js:11`–`:14` |

---

## 3. Mapa de cobertura por módulo

Universo: **39 arquivos** `.js` (37 em `src/` + `api/cpf.js` + `sw.js`), 1.624 linhas em `src/`.
Classificação: **D** = tem teste direto (asserts sobre suas exportações) · **I** = só aparece no grafo de imports de algum teste (é carregado/avaliado no top-level, **nenhuma asserção sobre seu comportamento**) · **N** = nenhum teste o alcança.

### 3.1 `src/domain/` + `src/services/` + `src/core/` + `src/db/`

| Módulo | Linhas | Cob. | Por quê / o que falta |
| --- | ---: | :-: | --- |
| `src/domain/money.js` | 11 | **D** | `money.test.mjs` (23 asserts). Melhor coberto. |
| `src/domain/validators.js` | 9 | **D** | `validators.test.mjs`; só caso completo das máscaras. |
| `src/domain/address.js` | 12 | **D** | `address.test.mjs` (14). Bom. |
| `src/domain/due.js` | 5 | **D** | `stage4.test.mjs:2`-`:3`; **TZ nunca fixado**. |
| `src/services/search.js` | 4 | **D** | `stage4.test.mjs:5`-`:6`. |
| `src/services/records.js` | 10 | I | importado por `clients.js`/`debts.js` em `backup.test.mjs:3`; `enc/dec/blobOp/blobBytes/hist` **nunca chamados**. |
| `src/services/settings.js` | 3 | **N** | `getDueWindow`/`setDueWindow` (`settings.js:2`-`:3`) sem teste; é a janela que `dashboard.js:4` consome. |
| `src/services/dashboard.js` | 7 | **N** | `stats()` — os **indicadores do painel** (principal, juros, vencidas, prestes, recentes) sem um único teste. |
| `src/services/clients.js` | 44 | I | carregado em `backup.test.mjs`; `validate`,`saveClient`,`deleteClient`,`addDoc`,`removeDoc`,`counts` **sem teste**. |
| `src/services/debts.js` | 34 | I | `validate` (puro!) e `saveDebt`/`deleteDebt`/`findByRate`/`applyBulk` **sem teste**. |
| `src/services/viacep.js` | 34 | **N** | 6 códigos de erro distintos (`INVALID`,`OFFLINE`,`TIMEOUT`,`NETWORK`,`UNAVAILABLE`,`INVALID_RESPONSE`) + cache — **0 testes**. |
| `src/services/apicpf.js` | 58 | **N** | TTL de 30 min, dedupe de `PENDING`, timeout 9 s, `navigator.onLine` — **0 testes**, apesar de existir `apicpf.test.mjs` (que testa outra coisa: §2.7). |
| `src/services/google-drive.js` | 226 | **N** | maior módulo do repo, **0 testes**, inclui `parseClientJson` (`:33`-`:42`) que é **puro** e a soma SHA-256 (`:178`) que é **pura**. |
| `src/core/live.js` | 3 | **N** | `watch/unwatch`; top-level `addEventListener` (`live.js:2`). |
| `src/db/idb.js` | 30 | I | **persistência inteira sem teste comportamental** (ver §5 temas 4 e 5). |

### 3.2 `src/security/` + `src/export/` + `src/files/` + `src/ui/` + outros

| Módulo | Linhas | Cob. | Por quê / o que falta |
| --- | ---: | :-: | --- |
| `src/security/crypto.js` | 22 | **D** | `crypto.test.mjs` (5, densos). Falta travar `ITER=600000` e os metadados. |
| `src/security/auth.js` | 69 | I | **autenticação, cofre, tentativas e auto-lock sem teste** (temas 1–3). |
| `src/export/backup-format.js` | 45 | **D** | `backup.test.mjs` (17) — boa cobertura do formato. |
| `src/export/xlsx.js` | 17 | D (nominal) | chamado em `backup.test.mjs:26` mas **sem asserção** sobre o output → na prática não coberto. |
| `src/export/reports.js` | 21 | **D (parcial)** | só `inPeriod`/`label`; `load()` e `xlsxBytes()` sem teste. |
| `src/export/backup.js` | 30 | **N** | **`createBackup`/`restore` sem teste** — inclui `mode:'replace'` que apaga tudo (`backup.js:15`). Risco máximo. |
| `src/export/lib.js` | 5 | I | loader de `<script>`; `save()` (`lib.js:5`, download via `URL.createObjectURL`) sem teste. |
| `src/files/process.js` | 16 | **N** | limite de 15 MB (`:6`), SHA-256 (`:7`), passthrough não-imagem (`:9`), conversão WebP (`:11`-`:14`) — **0 testes**. Ramo não-imagem **roda em Node hoje** (§4.2). |
| `src/main.js` | 65 | **N** | bootstrap, roteamento de views e **política de senha (`main.js:19`-`:21`)** sem teste. |
| `src/pwa.js` | 11 | **N** | `registerSW`,`requestPersist`,`storageInfo`,`isStandalone`,`isIOS`,`canInstall` sem teste. |
| `src/config/google.js` | 11 | **N** | constante; sem teste de sanidade (ex.: `origins` é array, `clientId` termina em `.apps.googleusercontent.com`). |
| `src/ui/kit.js` | 39 | **N** | `initials`,`when`,`day`,`longDay`,`plural` (`kit.js:3`-`:7`) **são puros e exportados → testáveis em Node sem stub nenhum**; `pager` (`:18`-`:38`, algoritmo de paginação com elipses) recebe `h` **injetado** → testável com um fake `h` de 5 linhas. |
| `src/ui/icons.js` | 47 | **N** | mapa nome→SVG; testável com fake `h`. |
| `src/ui/avatar.js` | 29 | **N** | `clientAvatar(h,c)` injeta `h`; usa `URL.createObjectURL` (`:7`-`:13`). |
| `src/ui/clientlist.js` | 34 | **N** | 2 DOM-hits. |
| `src/ui/dashboard.js` | 43 | **N** | 1 DOM-hit — quase só composição. |
| `src/ui/debtspage.js` | 38 | **N** | 5 DOM-hits. |
| `src/ui/debts.js` | 70 | **N** | 3 DOM-hits. |
| `src/ui/settings.js` | 64 | **N** | 4 DOM-hits; a função de formatação `mb` (`settings.js:11`) é **privada** (não exportada → não testável sem refatorar). |
| `src/ui/shell.js` | 64 | **N** | 20 DOM-hits; `document.getElementById` no corpo (`:11`). |
| `src/ui/clients.js` | 186 | **N** | 26 DOM-hits: `dialog.showModal` (`:128`), `window.open`+`w.location.href` (`:143`-`:144`), `URL.createObjectURL`/`revokeObjectURL` (`:5`,`:37`,`:145`). |
| `src/ui/tools.js` | 208 | **N** | 19 DOM-hits (relatórios + backup + Drive). |
| `sw.js` | 5 | **N** | `install`/`activate`/`fetch` (`sw.js:3`-`:5`). |

### 3.3 Totais

| | src (37) | api+sw (2) | **Total (39)** |
| --- | ---: | ---: | ---: |
| **Direto (D)** | 9 | 1 | **10** |
| **Indireto (I)** — só carregado, zero asserção | 7 | 0 | **7** |
| **Sem teste (N)** | **21** | **1** | **22** |
| Linhas em módulos **N** | 1.291 | 5 | 1.296 |

- **21 dos 37 módulos `src/` (57%) não são alcançados por nenhum teste**, representando **1.291 de 1.624 linhas = 79,5% do código-fonte sem teste algum**.
- Somando "sem teste" + "indireto sem asserção": **28 de 39 módulos (72%) não têm nenhuma asserção sobre seu comportamento**.
- Distribuição das lacunas: `src/ui/*` 833 linhas, `src/services/*`+`main.js`+`pwa.js` 411 linhas.
- Cobertura medida com a flag nativa (`node --test --experimental-test-coverage tests/money.test.mjs`): `money.js | 100.00 line | 89.47 branch | 100.00 funcs` — ou seja, **dá para medir cobertura hoje, sem instalar nada**.

### 3.4 Módulos críticos sem teste algum (ranking por risco)

1. **`src/export/backup.js` (restore/create)** — destrutivo, não transacional no nível de decisão (`backup.js:15` apaga tudo no modo replace), 0 testes. **Risco: perda de dados do usuário.**
2. **`src/security/auth.js`** — cofre, bloqueio, backoff de tentativas (`auth.js:29`), sessão em `sessionStorage`, auto-lock. Criptografia subjacente é testada; **a máquina de estados de segurança, não**.
3. **`src/db/idb.js`** — migrations versionadas (`idb.js:2`-`:9`) e a garantia "só resolve em `transaction.oncomplete`" (`idb.js:18`). Um erro de migration = banco inutilizável sem restore testado.
4. **`src/services/clients.js` / `debts.js`** — CRUD + `applyBulk` (`debts.js:28`-`:34`) que reescreve N dívidas em uma transação com detecção de conflito (`:31`).
5. **`src/services/dashboard.js` + `settings.js`** — os números que o usuário lê.
6. **`src/files/process.js`** — decide o que é armazenado (e silenciosamente **não converte** quando falta canvas, §4.2).
7. **`src/services/viacep.js` / `apicpf.js`** — as duas integrações do cliente, ambas com contratos de erro ricos.
8. **`sw.js`** — 52 recursos pre-cacheados; uma URL errada derruba o offline silenciosamente (ver §7 passo "SW validation"; hoje, por sorte, **nenhuma entrada está ausente do disco** — verifiquei).

---

## 4. Viabilidade de testar cada camada sem browser e sem dependências novas

### 4.1 O que o runtime Node 22.23.4 já dá de graça

**Web globals presentes (verificado por `typeof globalThis[k]`):** `crypto` (com `subtle` e `getRandomValues`; `randomUUID` usado por `records.js:3` e `auth.js:10` funciona), `navigator`, `Blob`, `File`, `Response`, `Request`, `Headers`, `URL`, `URLSearchParams`, `TextEncoder`, `AbortController`, `performance`, `structuredClone`, `EventTarget`, `CustomEvent`, `MessageChannel`.

**Ausentes (precisam de stub):** `indexedDB`, `IDBKeyRange`, `window`, `document`, `localStorage`, `sessionStorage`, `matchMedia`, `caches`, `serviceWorker`, `FileReader`, `HTMLElement`, **`createImageBitmap`**.

**Built-ins:** 68 módulos não-`internal` disponíveis (`node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:crypto`, `node:vm`, `node:worker_threads`, `node:sqlite` — este último existe mas é experimental).

**`node:test` completo:** `test`, `describe`, `it`, `before`, `after`, `mock`, `run`, `snapshot` todos presentes. **`mock.timers` existe** (com `ExperimentalWarning`) → os timers de auto-lock (`auth.js:60` `setTimeout(check,mins*60000)`) são controláveis **sem dependência nova**.

**Reporters nativos:** `node:test/reporters` exporta `default, dot, junit, lcov, spec, tap` → JUnit XML para CI sem nada instalar (verifiquei `node --test --test-reporter=junit` emitindo `<testsuites>`).

**`structuredClone(CryptoKey)` funciona no Node 22** (verificado: `OK, algorithm = AES-GCM`, inclusive para chave **não-extraível**). Isso é o que destrava o teste de `restoreSession`, pois `auth.js:55` grava um `CryptoKey` dentro do IndexedDB e `auth.js:42` valida `s.dek.algorithm?.name==='AES-GCM'`.

### 4.2 Experimento: quais módulos importam com um stub mínimo de 3 linhas

Rodei `import()` sobre todos os 39 módulos em Node puro, e de novo com apenas `addEventListener`/`removeEventListener`/`navigator` stubados:

| Condição | Importáveis |
| --- | --- |
| Node puro | **29 / 39** |
| + `globalThis.addEventListener/removeEventListener/navigator` | **38 / 39** (todos exceto `src/main.js`) |

Os 10 que falham em Node puro falham **por efeito colateral no top-level do módulo**, não por dependência profunda:

| Arquivo:linha | Código no topo do módulo |
| --- | --- |
| `src/core/live.js:2` | `let cb=null;addEventListener('data-changed',...)` |
| `src/pwa.js:2` | `addEventListener('beforeinstallprompt',...)` |
| `src/main.js:4` | `const root=document.getElementById('app')` ← **único que ainda precisa de `document`** |
| `src/main.js:62`,`:63` | `P.registerSW()` e IIFE de bootstrap rodando na importação |
| `sw.js:3`,`:4`,`:5` | `addEventListener('install'/'activate'/'fetch',...)` |
| via import | `src/ui/{clients,dashboard,debtspage,settings,tools,clientlist}.js` falham só porque importam `main.js`/`live.js`/`pwa.js` em cascata |

**Conclusão: um shim de ~6 linhas (3 globals) + um mini-`document` com `getElementById` é suficiente para carregar 100% do código-fonte em Node.** Não é preciso jsdom para *importar*; é preciso harness para *executar*.

### 4.3 Experimento: o que ainda trava a **execução** (não só o import)

Com os 3 stubs acima instalados, chamei as operações reais:

| Operação | Estado | Global que falta |
| --- | --- | --- |
| `db.openDB()` / `db.get` / `db.batch` | BLOQUEADO | `indexedDB` |
| `A.hasVault()` / `A.unlock()` / `A.lock()` | BLOQUEADO | `indexedDB`; `A.lock` additionally `document` (`auth.js:12`) |
| `A.restoreSession()` | **"OK" → `false` silencioso** | ver aviso abaixo |
| `rec.uid()` | **OK** | — (`crypto.randomUUID` nativo) |
| `rec.list('clients')` | BLOQUEADO | `indexedDB` |
| `bv.createBackup()` | BLOQUEADO | `indexedDB` |
| `P.toStored(arquivo .txt)` | **OK** | — hash + passthrough rodam em Node puro |
| `P.toStored(arquivo .png)` | **"OK"** | ⚠ ver abaixo |

**Achado importante sobre `restoreSession` (`auth.js:38`-`:48`):** retornou `false` sem erro porque `read()` em `auth.js:7` embrulha `sessionStorage.getItem` em `try/catch{return null}`, e `sessionStorage` não existe → `ReferenceError` capturado → `id` nulo → `if(!id)return false` (`:40`). **Armadilha para testes:** na ausência do stub, o auto-lock/sessão "passa" fazendo nada. Todo teste de sessão precisa *assertir que o stub está ativo*, não apenas chamar a função.

**Achado importante sobre `files/process.js`:** `P.toStored(png)` retornou **OK sem converter**, porque o bloco `try` (`:10`-`:14`) lança em `createImageBitmap` (inexistente) e o `catch{}` em `:15` engole silenciosamente quando `force!==true`. Ou seja: **o teste "passa" no Node devolvendo o original não-comprimido** — que é exatamente o que o código promete (`:2`-`:3`), mas significa que em Node só é possível testar (i) limite de 15 MB, (ii) SHA-256, (iii) passthrough não-imagem, (iv) a degradação graciosa. A conversão real (resize + WebP + "só troca se ficou menor") **exige navegador**.

### 4.4 Tamanho real do stub de IndexedDB necessário (é pequeno)

Extraí a superfície de API de IndexedDB que o código **realmente usa** (grep em `src/db`, `src/services`, `src/security`, `src/export`):

```
indexedDB.open (1) · createObjectStore (4) · createIndex (1) · transaction (2) · objectStore() (5)
get (24) · put (8) · delete (2) · getAll (4) · .result (5) · .error (6)
onupgradeneeded · onsuccess · onerror (5) · oncomplete (3) · onabort (2) · onblocked · onversionchange · abort (7)
```

**Não é usado `IDBKeyRange`, `openCursor` nem `.index()` em lugar nenhum do `src/`** (grep confirmou: *NONE*). O `idb.js` pede índices só na criação do schema (`idb.js:5`), e todas as leituras são `getAll` + filtro em JS (`records.js:5`, `clients.js:29`).

Logo, um fake próprio precisa implementar apenas: `open()` com `onupgradeneeded`/`onsuccess`/`onerror`/`onblocked`, um `DB` com `createObjectStore`/`createIndex`/`transaction`/`close`, `tx.objectStore(s).{get,put,delete,getAll}`, eventos `oncomplete`/`onerror`/`onabort`, `tx.abort()`, e `versionchange`. Estimativa: **~120–150 linhas**. Só falta acrescentar `globalThis.dispatchEvent`/`Event` para `idb.js:30` (`dispatchEvent(new Event('data-changed'))`) — `EventTarget` é global no Node 22, mas **`dispatchEvent` global não existe**, então o `batch()` real nunca rodaria sem isso.

**Recomendo escrever o fake, não instalar `fake-indexeddb`** — justificativa quantitativa em §6.3.

### 4.5 Ambiente offline / dependências (NADA foi instalado)

| Checagem | Resultado |
| --- | --- |
| `ls /usr/local/lib/node_modules` | **`(missing)`** — o Node vem de nvm |
| `npm root -g` | `/home/ubuntu/.nvm/versions/node/v22.23.4/lib/node_modules` |
| Conteúdo do global | `@astrojs`, `@prisma`, `@vue`, `corepack`, `dockerfile-language-server-nodejs`, `graphql-language-service-cli`, `intelephense`, `npm`, `pnpm`, `pyright`, `svelte-language-server`, `typescript`, `typescript-language-server`, `vscode-langservers-extracted`, `yaml-language-server` |
| **`fake-indexeddb`** | **NÃO EXISTE** — `find / -maxdepth 7 -type d -name fake-indexeddb` → nada. Nem jsdom, nem happy-dom, nem testing-library em lugar nenhum. |
| Rede para npm | `https://registry.npmjs.org/` respondeu **HTTP 200** (há egress genérico), mas **não instalei nada**, conforme a regra |

**Playwright / navegador:**

| Checagem | Resultado |
| --- | --- |
| `python3 -c "import playwright"` | **OK** → `/usr/local/lib/python3.12/dist-packages/playwright/__init__.py` |
| `python3 -m playwright --version` | **`Version 1.64.1`** |
| `which chromium` | **`/usr/bin/chromium`** → `Chromium 156.0.8078.73` |
| `~/.cache/ms-playwright` | **NÃO EXISTE** — os browsers do Playwright não foram baixados; seria preciso apontar para o Chromium do sistema (`executable_path='/usr/bin/chromium'` / `channel`) ou baixar na primeira execução |

**Veredito de ambiente:** existe sim condição material de rodar navegador real **neste sandbox** via Playwright-python + Chromium do sistema, servindo o app por HTTP estático (README:214 já prescreve "Sirva a raiz por HTTP", e `python3 -m http.server` não requer dependência). **Ressalva crítica:** isso é característica *deste* sandbox, **não** do repo (não há `requirements.txt`/`pyproject.toml`/`package-lock.json` que fixe Playwright). **NÃO CONFIRMADO:** se os runners do GitHub Actions terão Chromium disponível sem um passo de download (`browser-actions/setup-chrome` ou `playwright install`). **NÃO escrevi nenhum teste Playwright**, conforme instruído.

### 4.6 Latência por arquivo (medida, 2 corridas)

| Arquivo | Corrida 1 | Corrida 2 |
| --- | ---: | ---: |
| `address.test.mjs` | 42 ms | 47 ms |
| `money.test.mjs` | 45 ms | 44 ms |
| `stage4.test.mjs` | 46 ms | 47 ms |
| `validators.test.mjs` | 44 ms | 48 ms |
| `crypto.test.mjs` | 471 ms | 470 ms |
| `backup.test.mjs` | 673 ms | 678 ms |
| **`apicpf.test.mjs`** | **1385 ms** | **2100 ms** (já medido 3248 ms e 5821 ms) |

`crypto` 471 ms é custo legítimo: `crypto.js:4` `ITER=600000` PBKDF2, 3 derivações no arquivo (medi um `deriveKey` de 600k isolado; é ~150 ms cada). `backup` 678 ms é custo legítimo: AES-GCM sobre 5 KB × várias mutações + zip. **`apicpf` é o único cujo tempo é patológico e não-preditivo, e a causa é D1 (§2.7)** — os primeiros ~1,9–2,4 s são o `await` da *primeira* chamada, antes de qualquer stub.

---

## 5. Avaliação da ETAPA 3 — classificação dos 15 temas

Categorias: **(a)** Node puro com stubs leves (≤3 globals, sem IndexedDB/DOM) · **(b)** Node com harness próprio (fake IndexedDB e/ou `document`/`h` falso escritos à mão) · **(c)** exige navegador real.

| # | Tema | Cat. | Justificativa técnica (com evidência) |
| --- | --- | :-: | --- |
| 1 | **Cadastro / autenticação** | **(b)** | `A.setup` (`auth.js:18`-`:23`) precisa de `db.get/put('meta')` → IndexedDB fake; e `unlock` chama `bind()` (`auth.js:35`→`:11`) que usa `addEventListener` **global** e `document.addEventListener('visibilitychange')` → exige stub de `document`. Criptografia em si é (a) (já testada). ⚠ A **política de senha** (`main.js:19`-`:21`: ≥8 chars, confirmação, `ack` marcado) mora no `main.js`, cujo import exige `document.getElementById` (`main.js:4`) → ou (b) com harness DOM, ou refatorar a validação para um módulo puro. |
| 2 | **Desbloqueio e auto-lock** | **(b)** | `touch/check/lock` (`auth.js:58`-`:69`) são controláveis com `node:test` `mock.timers` (presente, verificado) + `sessionStorage` fake (`auth.js:7`-`:9`) + IDB fake (`saveSession` grava `CryptoKey` em `auth.js:55` — e `structuredClone(CryptoKey)` funciona em Node, verificado §4.1). **Sem dependência nova.** Armadilha obrigatória: assertir que o stub de sessionStorage está vivo, senão `restoreSession` retorna `false` mudo (§4.3). |
| 3 | **Tentativas incorretas** | **(b)** | Backoff em `auth.js:26`-`:32`: `g.fails++`, e a partir de 5 falhas `until = Date.now()+min(5000*2^(fails-5), 300000)`. Puro cálculo + persistência em `meta/guard` → IDB fake + `mock.timers`/`mock` de `Date.now`. Altíssimo valor (trava de segurança), custo baixo. |
| 4 | **Persistência IndexedDB** | **(b)** primário · **(c)** para garantias reais | `openDB` com `DB_VERSION=MIGRATIONS.length` (`idb.js:10`), cadeia de migrations (`idb.js:14`), `onblocked` (`idb.js:16`), `onversionchange→close` (`idb.js:15`) são todos reproduzíveis num fake próprio (superfície pequena, §4.4). **Mas** `durability:'strict'` (`idb.js:20`,`:28`) e o commit no disco **só têm significado em navegador real** → (c) para essa asserção específica. |
| 5 | **Integridade de transações** | **(b)** + **(c)** | O contrato "tudo ou nada" está em `idb.js:27`-`:30` (`batch` abre **uma** transação multi-store via `[...new Set(ops.map(o=>o[1]))]` e faz `t.abort()` em erro) e `idb.js:19`-`:21` (`run` só resolve em `oncomplete`). Um fake pode simular abort e provar que **nenhuma** store mudou. Os chamadores críticos — `saveClient` (`clients.js:27`), `applyBulk` (`debts.js:34`), `restore` (`backup.js:29`), `deleteClient` (`clients.js:35`) — são (b). Atomicidade real (queda de energia/quota) é (c). |
| 6 | **Criptografia / adulteração** | **(a)** ✅ | Já coberto e melhorável em Node puro: `crypto.test.mjs:6` inverte byte, `:7` IV único, `:8` chave não-extraível. Faltam asserts de custo/formato (`ITER`, `kdf`, `cipher`, `v` de `crypto.js:11`) — 100% (a). Backup cifrado (a) **exceto** `createBackup`, que precisa de IDB → (b). |
| 7 | **CRUD clientes** | **(b)** | `validate(d,old,all)` (`clients.js:7`-`:14`) é **puro** (só `validators.js`) → (a) imediato: nome obrigatório, CPF vs CNPJ por `type==='PJ'`, **unicidade de doc** (`:11`), telefone 10–11 dígitos, regex de e-mail. `saveClient`/`deleteClient`/`addDoc`/`removeDoc`/`counts` precisam de IDB + chave destravada + `toStored` → (b). ramo de *foto* com conversão de imagem → (c) (por causa de `createImageBitmap`, §4.3). |
| 8 | **CRUD dívidas** | **(b)** | `validate(d)` (`debts.js:7`-`:13`) é **puro** → (a) hoje mesmo: `principal>0 && <=1e13`, `rate>0 && <=MAXR`, `iso()` de data, e a regra "vencimento não pode ser anterior ao registro" (`:12`). `saveDebt`/`deleteDebt`/`findByRate` → (b). `applyBulk` com detecção de conflito (`debts.js:31`) → (b) e é **o teste de concorrência mais valioso do repo**. |
| 9 | **Cálculos / arredondamento** | **(a)** ✅ | `money.js` é 100% puro e já tem 23 asserts + cobertura medida em 100% de linha. Só falta: valores negativos, `cents` de string inválida, e **propriedades** (ex.: `interest(p,r) === round(p*r/1e4)` sobre geração aleatória, que é (a) com `node:crypto` como RNG). |
| 10 | **Vencimentos / indicadores** | **(a)** +(b) | `due.js` puro → (a), mas **falta fixar `TZ`** (`due.js:3` `todayISO()` depende de `getTimezoneOffset`). `settings.getDueWindow` (`settings.js:2`) → (b). `dashboard.stats()` (`dashboard.js:3`-`:7`) → (b): agrega `listClients`+`listDebts`+`list('history')`+janela e classifica `overdue`/`soon`. É o caminho dos "indicadores" e hoje não tem nada. |
| 11 | **Backup / restore** | **(a)** para formato · **(b)** para o que importa | Formato cifrado/manifest/adulteração já é (a) e bom. **`createBackup` e `restore(mode)` (`backup.js:4`-`:29`) são (b)** — dependem de IDB + `enc`/`blobOp`. Alta complexidade branchy: replace (`:15`-`:18`), merge com dedupe por id **ou** CPF (`:22`), remapeamento de `clientId` (`:24`,`:27`), dedupe de documento por `clientId+hash` (`:26`). **Prioridade nº 1 de risco.** |
| 12 | **Exportação XLSX** | **(a)** para bytes · **(c)** para compatibilidade | `buildXlsx(F,sheets)` (`xlsx.js:9`) recebe `fflate` **como parâmetro** → injetável, e o vendor já é carregado em Node com o truque de `backup.test.mjs:2`. Dá para asserir (a): é zip válido, contém `[Content_Types].xml`, `xl/workbook.xml`, `sheet1/sheet2`, `esc()` neutraliza `<>&"` (`xlsx.js:2` — o fixture atual até usa `'Manoel Junior <&>'` em `backup.test.mjs:26`, mas **sem asserção**), colunas/congelamento (`:4`), e que `{v,s}` vira `s="2"`. **Abrir no Excel/LibreOffice é (c)/manual** — hoje é feito "olho no `/tmp/amostra.xlsx`" (`backup.test.mjs:25`). |
| 13 | **Offline** | **(a)**/**(b)** para lógica · **(c)** para o app | Os *ramos* offline são testáveis com stub de `navigator.onLine`: `viacep.js:10` (usa guard defensivo `typeof navigator!=='undefined'` → o mais fácil), `apicpf.js:9` (usa `navigator.onLine` cru → precisa do global), `ui/clients.js:78`,`:118`. `sw.js:5` tem fallback de navegação (`caches.match('index.html')`) que **só faz sentido em SW real** → (c). Comportamento "instalei e funciona sem rede" é (c). |
| 14 | **Atualização do service worker** | **(c)** | `sw.js:3`-`:5` usa `caches.open/addAll/keys/delete`, `skipWaiting()`, `clients.claim()`, `e.respondWith`, `e.waitUntil`, `Response.error()`. Dá para *simular* tudo isso com um `EventTarget` + fake `CacheStorage` (~150 linhas, categoria (b) forçada), **mas** as propriedades que realmente interessam — quando o browser ativa, se `skipWaiting`/`clients.claim` produz o refresh correto, se `V` novo limpa o cache velho numa atualização no ar (`sw.js:4`), e o `Cache-Control: no-cache` do `sw.js` (`vercel.json`) — **só existem num navegador real** e na interação com `src/pwa.js:3` `navigator.serviceWorker.register`. Classifico **(c)**; com ressalva de que dá para cobrir em (b) o **contrato do arquivo** (que `V` mudou, que `FILES` lista todos os `src/*.js`) — e isso hoje vale mais que o teste comportamental, porque a versão é manual (`sw.js:1`: "Ao adicionar arquivos nas próximas etapas: inclua-os em FILES e incremente V"). |
| 15 | **Integrações externas** | **(a)**/**(b)** para contrato · **(c)** para OAuth | **ViaCEP** (`viacep.js`) e **APICPF client** (`apicpf.js`): só `fetch`+`AbortController`+`navigator`, todos nativos/stubáveis → **(a)/(b)** com alta fidelidade (timeout 8s/9s, TTL 30 min `apicpf.js:3`, dedupe `PENDING` `apicpf.js:13`, mapeamento/validação de campos `apicpf.js:32`-`:36`). **Proxy `api/cpf.js`**: (a), já coberto — mas precisa corrigir D1. **Google Drive** (`google-drive.js`, 226 linhas): `parseClientJson` (`:33`-`:42`) e `sha256` (`:178`) e o boundary multipart (`:184`) são **(a)**; `configState` precisa `location.origin`+`localStorage` → **(b)**; `loadGis` injeta `<script>` de `accounts.google.com` (`:57`-`:69`) e `isReady` lê `window.google.accounts.oauth2` (`:50`) → **(b)** forçado / **(c)** para o fluxo real, porque **o popup de consentimento do Google e a `gisPromise` não são reproduzíveis** sem navegador — e mesmo em (c) o OAuth humano não é automatizável (README/docs:120+ exigem "Permitir pop-ups"), logo o melhor viável é (c) com credenciais falsas + stub de `window.google`. |

### 5.1 Resumo da classificação

| Categoria | Temas |
| --- | --- |
| **(a) Node puro + stubs leves** | 6 criptografia, 9 cálculos, 12 XLSX (bytes), + **fatias puras de 7, 8, 10** (`validate` de clientes/dívidas, `due.js`), + contrato de 15 (ViaCEP/APICPF/proxy) |
| **(b) Node com harness próprio** | 1 cadastro/auth, 2 desbloqueio+auto-lock, 3 tentativas, 4 persistência IDB, 5 transações, 7 CRUD clientes, 8 CRUD dívidas, 10 indicadores, 11 backup/restore, 13 offline (lógica) |
| **(c) navegador real** | 14 service worker (comportamento), 13 offline (app instalado), 4/5 garantias de durabilidade real, 12 abrir no Excel, 15 OAuth Google |

**Nenhum** dos 15 temas precisa de **dependência nova** para ser coberto até o nível (b). O único bloco genuinely (c) são SW/OAuth/compatibilidade de Excel, e aí o Playwright-python **já presente neste sandbox** (§4.5) é a via natural — mas (c) deve ficar **fora do gate bloqueante** (ver §7).

**Sequência de maior retorno:** 11 (restore) → 3 (tentativas) → 2 (auto-lock) → 8 (dívidas) → 7 (clientes) → 5 (transações) → 10 (indicadores) → 15 (integrações) → 4 → 12 → 1. Só então decidir (c).

---

## 6. Arquitetura de suíte proposta

### 6.1 Princípio norteador

Respeitar a decisão já registrada no repo: **README:157 — `| Testes | Node.js, sem dependências externas |`** e README:210 — "Node.js 18+ apenas para executar os testes". A proposta usa **exclusivamente** `node:test` + `node:assert/strict` + globals do Node 22. **Zero `npm install`.**

### 6.2 Estrutura de pastas

```
tests/
├── unit/                          # camada (a): sem harness
│   ├── money.test.mjs             # migra o atual + negativos + cents('abc') + parseRate bordas
│   ├── money-properties.test.mjs  # propriedades de arredondamento com RNG de node:crypto
│   ├── validators.test.mjs
│   ├── address.test.mjs
│   ├── due.test.mjs               # RENOMEADO de stage4; roda com TZ fixado via process.env.TZ em sub-processo
│   ├── search.test.mjs            # separado de due: são módulos diferentes
│   ├── crypto.test.mjs            # + asserts de ITER/kdf/cipher/v
│   ├── backup-format.test.mjs     # split do backup.test.mjs (só formato)
│   ├── xlsx.test.mjs              # split: asserções sobre os BYTES do zip (substitui o /tmp/amostra.xlsx)
│   ├── reports.test.mjs           # inPeriod/label
│   ├── api-cpf.test.mjs           # o atual apicpf.test.mjs CORRIGIDO (fetch stub antes da 1ª chamada)
│   ├── viacep.test.mjs            # 6 códigos de erro + cache + timeout (novo, (a))
│   ├── apicpf-client.test.mjs     # TTL/PENDING/timeout/navigator.onLine (novo, (a))
│   ├── drive-config.test.mjs      # parseClientJson + sha256 + multipart boundary (novo, (a))
│   └── kit-pure.test.mjs          # initials/plural/day/when/longDay (novo, (a), zero stub)
├── svc/                           # camada (b): com harness de IDB/sessão/DOM-fake
│   ├── idb.test.mjs               # migrations, open/onblocked/versionchange
│   ├── idb-tx.test.mjs            # run()/batch() oncomplete, abort → nada persiste
│   ├── auth-setup.test.mjs        # tema 1
│   ├── auth-lockout.test.mjs      # tema 3 (sequência de falhas + exponential backoff + reset)
│   ├── auth-idle.test.mjs         # tema 2 (mock.timers + sessionStorage + restoreSession)
│   ├── records.test.mjs           # enc/dec/blobOp round-trip com chave real
│   ├── clients-crud.test.mjs      # saveClient/update/delete cascade de blobs+histórico
│   ├── clients-validate.test.mjs  # validate() puro (pode ficar em unit/)
│   ├── debts-crud.test.mjs        # saveDebt/deleteDebt + interest derivado sempre recalculado
│   ├── debts-bulk.test.mjs        # applyBulk + conflito "dados mudaram"
│   ├── settings.test.mjs
│   ├── dashboard.test.mjs         # stats(): principal/interest/overdue/soon/recent
│   ├── backup-create.test.mjs
│   ├── backup-restore.test.mjs    # tema 11 PRIORIDADE 1: replace vs merge, dedupe por CPF, blob órfão
│   └── ui-kit.test.mjs            # pager()/filePicker() com fake h
├── smoke/                         # camada (c), NÃO-bloqueante (fase posterior)
│   └── README.md                  # descreve o roteiro manual/e2e; sem código por ora
├── helpers/
│   ├── fake-idb.mjs               # §6.3 — ~140 linhas, sem deps
│   ├── globals.mjs                # installBrowserStubs({withDocument,withSessionStorage})
│   ├── fake-h.mjs                 # hyperscript que devolve objetos JS (tag/attrs/children), p/ ui/
│   ├── vault.mjs                  # cria cofre pronto + chave destravada (setup/auth reuse)
│   ├── fixtures.mjs               # §6.4 — dados fictícios ÚNICOS
│   ├── fetch-mock.mjs             # roteia por URL+status, contabiliza chamadas, NUNCA cai na rede
│   ├── timers.mjs                 # wrapper fino sobre node:test mock.timers
│   └── assert-no-net.mjs          # guarda: falha se algum fetch não-rotulado sair
└── _legacy/                       # (opcional) estágios intermediários da migração
```

**Manter o padrão de nome `*.test.mjs`** para casar com `node --test tests/**/*.test.mjs` e com o glob atual.

### 6.3 Fake IndexedDB próprio vs. biblioteca — **próprio**

Critério objetivo, com base no que foi medido em §4.4:

| Aspecto | Fake próprio | `fake-indexeddb` |
| --- | --- | --- |
| Bytes adicionados ao repo | ~5 KB, versionado, auditável | `node_modules/` (o repo é "sem build"; `.gitignore` já ignora `node_modules`, mas exigiria lockfile + `npm ci` + supply chain + um passo de rede no CI) |
| Superfície a emular | **só 13 métodos/props, sem cursor, sem `IDBKeyRange`, sem `.index()`** | implementa cursores, indexes query, `multiEntry`, `autoIncrement`, clona por structuredClone — 95% inutilizado aqui |
| Risco | falso-positivo por semântica mal imitada | dependência de terceiros num projeto deliberadamente sem deps |
| Conflito com a política do repo | alinhado (README:157) | **viola o stated constraint** |

**Contrato do fake (o que ele DEVE fazer para não virar teatro):**
1. Respeitar a semântica de eventos usada em `idb.js:14`-`:16`: `onupgradeneeded` recebe `{oldVersion}` e roda `MIGRATIONS[v](r.result, r.transaction)` em cascata; `onsuccess` dispara depois; `onblocked`/`onerror` rejeitam.
2. `transaction(...)` **não** resolve no request, resolve no `oncomplete` — espelhando `idb.js:21`. Isso é o que torna o teste de transação honesto.
3. `tx.abort()` deve fazer **todas** as escritas da transação sumirem (`idb.js:29`) — sem isso o tema 5 é falso.
4. `db.transaction([stores...])` multi-store (`idb.js:28`) com `objectStore(s)` por nome.
5. `onversionchange` → `close()` + reset do singleton `p` (`idb.js:15`).
6. **Ser honesto sobre o que não simula:** `durability:'strict'` (`idb.js:20`,`:28`) é **ignorado** — e deve haver um teste que documenta isso, mais um comentário explícito `// NÃO simulado: durabilidade em disco; ver tema (c)`.
7. Também publicar `globalThis.dispatchEvent`/`globalThis.Event` (ou um `window`-como-`EventTarget`), porque `idb.js:30` emite `'data-changed'` no global — sem isso, **nenhum** teste de `batch()` passa, e o `src/core/live.js` nunca dispara.
8. Um **meta-teste** obrigatório (`helpers/fake-idb.test.mjs`) que verifica o próprio fake: abort reverte, `oncomplete` só depois de todos os requests, migrations em cascata v1→v2→v3. *Um harness sem teste é passivo de silenciosamente não testar nada.*

### 6.4 Convenções

**Naming** — `<módulo>-<aspecto>.test.mjs`, nunca `<etapa>.test.mjs`. Cada caso com `test('nome da propriedade, não nome da linha', ...)` para ganhar a granularidade que hoje falta (§1.7). Agrupar por `describe()` por módulo de produto, de modo que `# tests` no CI signifique "casos", não "arquivos".

**Fixtures** — um único módulo `helpers/fixtures.mjs`, re-exportando os dados já usados (para não divergir dos testes existentes):
- CPFs de exemplo válidos e **amplamente divulgados como material didático de validação**: `529.982.247-25` (usado em `tests/validators.test.mjs:2`), `52998224725`, e `11144477735` (o clássico da documentação técnica, em `tests/apicpf.test.mjs:4`).
- CNPJ de exemplo: `11.222.333/0001-81` (`tests/validators.test.mjs:3`).
- Inválidos por repetição: `111.111.111.11`, `00000000000000`.
- Nomes **fictícios**: manter "Ana", "Bia", "João da Conceição", "Manoel Junior" (`backup.test.mjs:5`,`:26`, `stage4.test.mjs:4`) — já são do repo e não são dados reais.
- **Regra:** nada de CPF/nome "verossímil" gerado à mão; exportar `clienteFicticio(overrides)` e `dividaFicticia(overrides)` como *factories* puras, substituindo o `mk()` local de `backup.test.mjs:5`-`:7`. Proibir dados de produção em teste (não há `*.env` commitado — `.gitignore` cobre `.env*`).
- Documentos fictícios por `type`: `'text/plain'` (passthrough testável em Node) + `'image/png'` (para o ramo de degradação de `process.js:15`).

**Determinismo** —
- Relógio: **proibido** `Date.now()` nu em teste de negócio; usar `mock.timers`/`node:test` `mock.method(Date,'now')`. `due.js` testes devem **fixar `TZ`** (recomendo rodar a suíte em CI com `TZ=America/Sao_Paulo` e um job extra com `TZ=UTC`).
- Aleatoriedade: `crypto.getRandomValues` é não-determinístico (`crypto.js:5`) — **nunca** assertar bytes de IV; assertar apenas *desigualdade* (padrão correto já usado em `crypto.test.mjs:7`).
- IDs: `crypto.randomUUID()` (`records.js:3`) → assertar contagem/prefixo, não valor.

**Anti-regras (o que NÃO fazer)** —
- ❌ **Não introduzir framework novo** (Jest/Vitest/Playwright-runner) sem um ganho que o `node:test` não dê. Ele já entrega `describe/it/mock/mock.timers/snapshot/run`, 5 reporters e cobertura nativa (§4.1). Peso adicionado: lockfile, `npm ci`, supply chain, e quebra da premissa "sem build".
- ❌ **Não instalar `fake-indexeddb`/jsdom/happy-dom** — §6.3 mostra que a superfície usada cabe em ~140 linhas.
- ❌ **Não escrever um "DOM completo" genérico.** Usar `fake-h.mjs` (hiperscript que devolve `{tag,attrs,children,addEventListener}`), aproveitando que o app **injeta `h`** (`main.js:5` definido e passado por `ctx()`; `kit.js:18 pager(h,...)`, `avatar.js:13 clientAvatar(h,c)`, `settings.js:17` destrói `const{h,show,home,fmt}=X`). Isso torna grande parte de `src/ui/*` testável **sem nenhum DOM**. `fake-h` não deve tentar ser um DOM: sem `querySelector`, sem layout.
- ❌ **Não acionar a rede real a partir de teste.** Manter `assert-no-net.mjs` substituindo `globalThis.fetch` por um mock que **lança** para qualquer URL não roteada (é exatamente a falha D1).
- ❌ **Não escrever arquivo fora da árvore de teste** para "validação humana" (padrão atual `backup.test.mjs:26` → `/tmp/amostra.xlsx`). Se for preciso, gerar em `artifacts/` sob o workspace e **asserir antes de gravar**.
- ❌ Não deixar teste de camada (c) bloquear merge (§7).
- ❌ Não converter a suíte inteira de uma vez: migrar arquivo a arquivo, mantendo verde.

### 6.5 Como rodar

```sh
# tudo (o que vira o gate do CI)
node --test tests/unit/*.test.mjs tests/svc/*.test.mjs        # ~2 s hoje; alvo < 20 s

# por camada
node --test tests/unit/*.test.mjs                              # alvo < 4 s
node --test tests/svc/*.test.mjs                               # alvo < 12 s

# com cobertura (nativo, sem deps)
node --test --experimental-test-coverage tests/unit/*.test.mjs tests/svc/*.test.mjs

# relatório JUnit para CI (nativo)
node --test --test-reporter=junit --test-reporter-destination=test-results.xml tests/unit/*.test.mjs

# conveniência — adicionar em package.json (hoje NÃO existe scripts)
#   "test":          "node --test tests/unit/*.test.mjs tests/svc/*.test.mjs"
#   "test:unit":     "node --test tests/unit/*.test.mjs"
#   "test:coverage": "node --test --experimental-test-coverage tests/**/*.test.mjs"
#   "check:syntax":  "node --check <todos os .js/.mjs>"  (ver §7)
#   "check:sw":      "node tests/../scripts/check-sw.mjs"
```

### 6.6 Tempo-alvo

| Camada | Casos esperados | Alvo | Racional |
| --- | ---: | ---: | --- |
| `unit/` | ~180 | **< 4 s** | hoje 6 arquivos custam <250 ms; `crypto` (471 ms) e `backup-format` (~450 ms do total de 678) são PBKDF2-600k-inerentes |
| `svc/` | ~120 | **< 12 s** | fake IDB é in-memory (µs); o custo real é derivar chave por teste → usar `helpers/vault.mjs` com **`iter` baixo injetável**? **Não** — isso mudaria a política de segurança em teste. Recomendação: **um único cofre por arquivo de teste** (módulo de topo, `before()`), nunca por caso |
| **Gate total** | ~300 | **< 20 s** | vs. 1,8–2,5 s hoje, que é só mais rápido porque testa 10x menos |
| Smoke (c) | ~10 fluxos | **< 90 s**, `continue-on-error` | fora do gate |

Se `crypto`/`backup` dominarem, paralelizar com `--test-concurrency=N` (`node --test` já faz por arquivo — é por isso que os 1.385 ms do `apicpf` **não** somam ao total de 2.050 ms).

---

## 7. Pipeline GitHub Actions proposto

### 7.1 Confirmação: o repo **NÃO** tem CI hoje

| Checagem | Resultado |
| --- | --- |
| `ls -a \| grep -iE 'github\|gitlab\|circle\|travis\|jenkins\|azure'` | **`(no CI dir in root)`** |
| `ls .github` | **`ls: cannot access '.github': No such file or directory`** |
| `find . -name '*.yml' -o -name '*.yaml'` (excl. `.git`) | **nenhum arquivo** |
| `.git/hooks` (não-`.sample`) | **`(none active)`** |
| `package.json` `scripts` | **ausente** → `npm test` falha com *"Missing script"* |
| Remote | `origin https://github.com/JS171555/scipione-cred-offline.git` → GitHub **Actions é aplicável** |

`vercel.json` existe, mas é **configuração de deploy/headers** (Cache-Control, CSP, COOP), não pipeline de teste.

### 7.2 Pré-requisito não-negociável antes de ligar o gate

O `main` hoje está **verde sem querer num caso** (§2.7, D1). Se o CI for ativado sem corrigir D1, o job ficará (i) dependente de egress para `apicpf.com`, (ii) lento, (iii) passará sem cobrir a guarda de chave, e (iv) poderá enviar um CPF a terceiro a cada build. **Primeiro passo do trabalho de testes: corrigir `tests/apicpf.test.mjs:15`** e só depois bloquear merge. Também criar os `scripts` do `package.json` (§6.5) — hoje não existe forma canônica de "rodar os testes".

### 7.3 Workflow

```yaml
# .github/workflows/test.yml
name: testes
on:
  pull_request:            # todo PR, inclusive de branches de feature
  push:
    branches: [main]       # valida o que entrou
  workflow_dispatch:       # execução manual / triagem
permissions:
  contents: read           # princípio do menor privilégio
concurrency:
  group: testes-${{ github.ref }}
  cancel-in-progress: true # derruba job velho do mesmo branch (PWA pequeno)
env:
  NODE_VERSION: '22'       # o repo é testado em v22.23.4; README:210 pede >=18
  TZ: America/Sao_Paulo    # o app é pt-BR; due.js/money.js têm sensibilidade a localidade

jobs:
  estatico:
    name: Sintaxe e integridade do service worker
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ---- checagem de sintaxe de TODOS os js/mjs, sem resolver nada ----
      # node --check funciona para ESM .js porque package.json declara "type":"module".
      # Verificado localmente: 46/46 arquivos do repo (excl. vendor) + vendor/fflate.min.js => 47 OK.
      - name: node --check em todos os .js/.mjs
        run: |
          set -euo pipefail                      # <- falha em qualquer erro/pipe/undefined
          shopt -s globstar nullglob
          n=0
          for f in **/*.js **/*.mjs; do
            case "$f" in vendor/*|node_modules/*|.git/*) continue ;; esac
            node --check "$f"                    # exit != 0 aborta o step (sem `|| true`)
            n=$((n+1))
          done
          echo "sintaxe OK em $n arquivos"

      # ---- validação dos arquivos essenciais do service worker ----
      # sw.js:1 exige manter V incrementado e FILES em dia com src/*. A correção disso
      # é 100% determinística e não tem NENHUM teste hoje (sw.js:3 usa caches.*).
      # Verificado neste snapshot: V='sc-v69', 52 entradas, 0 ausentes do disco,
      # 0 módulos src/*.js fora do pre-cache. Este step congela esse estado.
      - name: service worker — pre-cache íntegro e V incrementado
        run: |
          set -euo pipefail
          node scripts/check-sw.mjs              # script novo, ~40 linhas, sem dependências
          # contratos que o script deve impor (todos derivados do código real):
          #  1) existe `const V='...'` e casa o regex ^sc-v[0-9]+$
          #  2) cada item de FILES existe no disco            -> hoje: 52/52 OK
          #  3) todo src/**/*.js e api/*.js referenciado por import está em FILES
          #  4) 'index.html', 'manifest.json', 'css/app.css', 'css/ui.css' presentes
          #  5) comparando com a base do PR: se FILES mudou, V TEM de mudar.
          #     Sem isso, `sw.js:4` (caches.keys().filter(x=>x!==V)) nunca expurga o
          #     cache velho e o app continua servindo o bundle antigo para sempre.

      - name: JSON/manifest válidos e campos obrigatórios
        run: |
          set -euo pipefail
          for j in manifest.json package.json vercel.json; do node -e "JSON.parse(require('fs').readFileSync('$j','utf8'))"; done
          node -e "const m=require('./manifest.json'); if(!m.name||!m.start_url||!m.icons?.length) throw new Error('manifest incompleto')"
          node -e "const p=require('./package.json'); if(p.type!=='module') throw new Error('package.json: type deve ser module')"

  testes:
    name: Unitários e de serviço (Node ${{ env.NODE_VERSION }})
    needs: estatico            # falha de sintaxe SW antes de gastar tempo de teste
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - { name: 'pt-BR / fuso de São Paulo', tz: 'America/Sao_Paulo' }
          - { name: 'UTC (detecta dependência de fuso)', tz: 'UTC' }
    env:
      TZ: ${{ matrix.tz }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}   # >=18 do README; 22 é o validado
          # SEM cache: 'npm' — não existe lockfile nem node_modules no repo.
          # Adicionar cache:npm exigiria introduzir dependências (ver §6.4 anti-regras).

      - name: "Nenhuma dependência (documenta a premissa do repo)"
        run: |
          set -euo pipefail
          if [ -d node_modules ]; then echo "FAIL: node_modules presente num projeto sem dependências"; exit 1; fi
          node -e "const p=require('./package.json'); if(p.dependencies||p.devDependencies) console.warn('AVISO: deps declaradas'); "

      # ---------------- O GATE BLOQUEANTE ----------------
      - name: Executar testes com falha bloqueante
        run: |
          set -euo pipefail                  # pipefail é OBRIGATÓRIO: sem ele o exit
                                             # code do `node` é perdido ao passar pelo tee
          node --test --test-reporter=tap \
                  tests/unit/*.test.mjs tests/svc/*.test.mjs 2>&1 | tee test-output.tap
          grep -E '^# fail 0$' test-output.tap > /dev/null   # sem `|| true`: grep != 0 aborta
          grep -E '^# cancelled 0$' test-output.tap > /dev/null
          grep -E '^# skipped 0$'   test-output.tap > /dev/null || true  # informativo

      - name: Porta de cobertura mínima (nativa, sem dependências)
        run: |
          set -euo pipefail
          node --test --experimental-test-coverage \
                  --test-coverage-exclude=vendor/** --test-coverage-exclude=tests/** \
                  tests/unit/*.test.mjs tests/svc/*.test.mjs | tee coverage.txt
          # meta verificada em §4.1: a flag funciona no Node 22 e reporta por arquivo
          #   (medido: src/domain/money.js -> 100.00 line / 89.47 branch / 100.00 funcs)
          # gate sugerido para a 1a semana: falhar se QUALQUER src/domain/*.js ou
          # src/security/crypto.js cair abaixo de 95% de linha; depois subir progressivamente
          node scripts/coverage-gate.mjs coverage.txt   # ~35 linhas, sem dependências

      - name: Publicar relatório de teste
        if: ${{ !cancelled() }}              # publica também quando falha - é o ponto
        uses: actions/upload-artifact@v4
        with:
          name: relatorio-testes-${{ matrix.tz }}
          path: |
            test-output.tap
            coverage.txt
          retention-days: 14

  # camada (c) - informativo, nunca bloqueia merge
  smoke-navegador:
    name: Smoke em navegador real (informativo)
    if: ${{ github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main' }}
    needs: testes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Servir raiz e verificar o SW no ar
        run: |
          set -euo pipefail
          # sem framework de teste: python http.server + curl, ambos no runner
          python3 -m http.server 8123 >/tmp/http.log 2>&1 &
          SRV=$!; trap 'kill $SRV' EXIT
          for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8123/index.html >/dev/null && break; sleep 0.5; done
          curl -fsS http://127.0.0.1:8123/sw.js    | grep -q "addEventListener('install'"
          curl -fsS http://127.0.0.1:8123/manifest.json | grep -q SCIPIONE
      - name: Playwright (opcional; fora do gate)
        continue-on-error: true              # <- ÚNICO lugar onde isso é aceitável
        run: |
          set -uo pipefail                   # NOTE: sem -e; o step é não-bloqueante por design
          python3 -m pip install playwright && python3 -m playwright install --with-deps chromium
          python3 -m pytest smoke/ -q || echo "smoke falhou (informativo)"
```

### 7.4 Como este pipeline impede que falha de teste vire aprovação

| Mecanismo | O que falha sem ele |
| --- | --- |
| **`set -euo pipefail` no topo de cada `run`** | Sem `pipefail`, `node --test ... \| tee x` reporta o exit code do **`tee`** (0) e o build passa com testes vermelhos. Este é exatamente o bug latente no comando documentado em `README:293` (§8, D2). Sem `-u`, `$f` vazio em glob que não casa gera um passo que "roda nada" e fica verde. |
| **Sem `continue-on-error` nem `|| true` no job `testes`** | `|| true` é a forma canônica de engolir falha. Só aparece em um lugar, no step de smoke, deliberadamente. |
| **`grep -E '^# fail 0$' test-output.tap` sem sufixo** | Redundância de segurança: mesmo que o exit code se perca de alguma forma, o sumário TAP é re-interpretado. `# fail 0` com `grep` não-casando retorna exit 1 → step falha. |
| **Exit code do `node --test` verificado experimentalmente** | Medido neste repo: suíte verde → `0`; com um assert quebrado → `1` + `not ok 1` + `# fail 1` (§1.8). O runner **não** precisa de `--test-force-exit` nem de truques. |
| **`shopt -s globstar nullglob` + contador de arquivos** | Um glob que não casa (`tests/unit/*.test.mjs` vazio) faria o step rodar zero testes e passar. O `echo "sintaxe OK em $n arquivos"` torna visível; recomenda-se `n>=46` asserido. |
| **`needs: estatico`** | Evita o cenário "sintaxe quebrada → `node --test` não executa os arquivos → zero casos → verde". |
| **Porta de cobertura** | Ataca o risco remanescente mais provável: suíte verde porque quase nada é exercitado (hoje 79,5% das linhas `src/` sem teste — §3.3). |
| **`TZ` na matriz com `fail-fast: false`** | Sem `fail-fast:false`, um fuso quebrando cancelaria o outro e a informação se perderia. |
| **`if: !cancelled()` no artifact** | Sem isto, o `upload-artifact` é pulado justamente quando o teste falha e o relatório é mais necessário. |
| **`permissions: contents: read`** | Um `GITHUB_TOKEN` com escrita permite que um passo comprometido altere o repo; não há necessidade aqui. |

### 7.5 Proteções de branch (fora do YAML, mas necessário)

Um workflow pode ser contornado se o branch protection não estiver ligado. Recomendo: `main` → *Require a pull request*; *Require status checks to pass* → **`estatico`** e **`testes (pt-BR / fuso de São Paulo)`** + **`testes (UTC...)`** como obrigatórios; **`smoke-navegador` NÃO obrigatório** (é `continue-on-error` por design e um flaky de navegador não deve barrar merge); *Require branch to be up to date*.

---

## 8. Dívidas e problemas encontrados nos testes atuais

Formato: gravidade · evidência · por que importa.

---

**D1 · CRÍTICO · `tests/apicpf.test.mjs:15`-`:16` faz requisição HTTPS real e o `503` é obtido pela razão errada.**
`process.env.APICPF_API_KEY=key` com `key=undefined` (`:7`) → Node coerção para `"undefined"`, que é truthy → a guarda `if(!key)` de `api/cpf.js:20` **não dispara** → o handler chama `fetch` real de `api/cpf.js:25`, porque o stub só entra em `:26`. Prova por spy: `attempt(s) to real apicpf.com during the test: 1 -> https://apicpf.com/api/consulta?cpf=11144477735`, e o teste reporta `apicpf: ok`. Este é o motivo do arquivo custar 1.385–5.821 ms contra 42–48 ms dos testes puros.
*Impacto:* falsa confiança (a "sem chave configurada" nunca foi testada), acoplamento a rede externa (flaky em CI com egress), vazamento de CPF para terceiro em todo build e potencial log da URL em caso de falha.

---

**D2 · ALTO · O comando de teste documentado no README não propaga falha.**
`README:293`:
```sh
for t in money validators address crypto stage4 backup apicpf; do node tests/$t.test.mjs; done
```
O código de saída de um `for` em bash é o do **último** comando. Se `money` quebrar e `apicpf` passar, o script retorna `0`. Não há `-e`, nem verificação de exit, nem agregação. Como esse é o único "como testar" documentado (README:288-296), qualquer humano ou script que o use **vai tratar falha como aprovação** — o risco que a área de testes deveria eliminar. Correlato: o repo não tem `npm test` (§1.1), então não há uma forma canônica e segura de rodar a suíte.
*(A variante com `node --test tests/*.test.mjs`, usada por mim em §1.4, retorna `1` corretamente — ver §1.8 — mas não é o que está documentado.)*

---

**D3 · ALTO · O README afirma a existência de um smoke test ponta a ponta que não existe no repositório.**
`README:296`: *"A interface também é validada com um smoke test de ponta a ponta cobrindo clientes, documentos, dívidas, juros em lote, Excel, backup, bloqueio e desbloqueio."*
`grep -rn -il 'playwright|puppeteer|selenium|smoke'` em `.js/.mjs/.json/.md` retorna **apenas `./README.md`**. Não há arquivo, script, pasta `e2e/` ou `smoke/` no repo (§1.2, §4.5). Nenhum dos itens dessa lista tem um único teste hoje: `applyBulk` ("juros em lote", `debts.js:28`) — zero; `restore` ("backup", `backup.js:12`) — zero; `lock/unlock/restoreSession` ("bloqueio e desbloqueio", `auth.js:38`,`:65`) — zero; `buildXlsx` ("Excel", `xlsx.js:9`) — só gerado em `/tmp` sem asserção.
*Impacto:* a cobertura real da camada de interface/fluxo está sendo reportada aos stakeholders como superior ao que existe.

---

**D4 · ALTO · 21 dos 37 módulos `src/` (79,5% das linhas) não são alcançados por nenhum teste** (§3.3).
Classificados por risco em §3.4. Os piores casos não são "falta polish", são funções destrutivas e de dinheiro sem uma asserção:
- `src/export/backup.js:15` — modo `replace` apaga **todas** as stores (`for(const s of[...LISTS,'blobs'])...ops.push(['delete',...])`) e não tem teste.
- `src/export/backup.js:22` — merge dedupe cliente por `id` **ou** `digits(doc)`; um erro aqui duplica ou engole clientes; sem teste.
- `src/services/debts.js:31` — `applyBulk` recusa se `cur.get(p.d.id)?.rate!==p.d.rate`; o mecanismo anti-perda de update otimista nunca foi exercitado.
- `src/security/auth.js:29` — `if(g.fails>=5)g.until=Date.now()+Math.min(5000*2**(g.fails-5),300000)`: política de bloqueio por tentativas, sem teste.
- `src/main.js:19`-`:21` — a política de senha mínima mora na view, logo **não** é alcançável pelo `crypto.test.mjs` (que só vê `crypto.js`, e `createVault` aceita senha de qualquer tamanho).

---

**D5 · MÉDIO · A suíte não cresce com o código.**
`git log --oneline -- tests/` tem **5** commits; os 45 demais não tocaram `tests/`. Os três módulos maiores do repo — `google-drive.js` (226), `ui/tools.js` (208), `ui/clients.js` (186) — foram adicionados **depois** do último commit de teste (`fd6bc3c`) e não entraram na suíte. Sinaliza que "escrever teste" não faz parte do Definition of Done do projeto.

---

**D6 · MÉDIO · `crypto.test.mjs` não trava os parâmetros de custo do cofre — o teste de segurança mais barato que falta.**
`src/security/crypto.js:4` define `ITER=600000` e `:11` persiste `{salt,iv,wrapped,iter:ITER,kdf:'PBKDF2-SHA256',cipher:'AES-GCM-256',v:1}`. O teste faz `const{meta}=await createVault(...)` (`:3`) e **nunca asser nada sobre `meta`**. Reduzir `ITER` para `1000` (ou trocar `kdf`) deixa a suíte 100% verde e derruba a resistência do cofre a força bruta em ~600× — e `openVault` (`:14`) usa `m.iter` do arquivo, então o downgrade passa despercebido até ser tarde. Quatro `assert.equal(meta.iter, ITER)` fecham isso.

---

**D7 · MÉDIO · `buildXlsx` é chamado sem nenhuma asserção e produz artefato fora da árvore.**
`tests/backup.test.mjs:25`-`:27`: comentário *"xlsx de amostra para validação externa"* + `writeFileSync('/tmp/amostra.xlsx', buildXlsx(...))`. O teste valida apenas que a função não lança. Concretamente: o `esc()` de `xlsx.js:2` (que neutraliza `<>&"`) tem um fixture que o exercitaria — `'Manoel Junior <&>'` em `:26` — **mas nenhuma asserção o verifica**; um regresso que injetasse XML quebrado ou permitisse injection passaria verde. Gravar em `/tmp` torna o resultado não-arquivável no CI e o "teste" é um convite a abrir Excel manualmente.

---

**D8 · MÉDIO · Testes são scripts nus: falha-rápida e zero granularidade.**
`grep` por `describe(|it(|test(` em `tests/` → **NENHUM** (§1.7). Consequência direta: um `assert` quebrado na `:2` de `tests/money.test.mjs` (que tem 23) impede a execução dos 21 restantes; o relatório de CI fica preso a `# tests 7` independentemente do crescimento da suíte; e não há como rodar "só o caso de arredondamento". Não há também **nenhum teste negativo de import** — se `src/domain/money.js` for renomeado, o `node --test` reporta fail por exceção (ok), mas se um `export` for removido, várias asserções viram `undefined===undefined` silenciosas onde os esperados também forem `undefined`.

---

**D9 · MÉDIO · `tests/stage4.test.mjs` — nome ininteligível e fuso não fixado.**
O arquivo é nomeado por numeração interna da missão (`console.log('etapa4: ok')` em `:7`); o conteúdo é `due.js` + `search.js`, que não têm relação semântica entre si — deveriam ser dois arquivos (`due.test.mjs`, `search.test.mjs`). Nada no repo define "etapa 4". Além disso, `daysUntil`/`status` dependem de `todayISO()` (`due.js:3`) que usa `getTimezoneOffset()`; o `T='2026-11-14'` é **injetado explicitamente** em `:2`-`:3` (bom!), mas `todayISO()` em si — a função que escolhe "hoje" — **nunca é chamada em teste algum**, e a suíte nunca roda com `TZ` variado.

---

**D10 · MÉDIO · `tests/backup.test.mjs:2` embute infraestrutura de loader dentro do teste.**
`new Function('module','exports', readFileSync(...vendor/fflate.min.js...))(m,m.exports); globalThis.fflate=m.exports` é código de harness UMD→ESM. Está correto, mas vive no corpo de um arquivo de teste: não é reutilizável, é a única razão de `xlsx`/`reports` não terem arquivo próprio, e `new Function` com conteúdo de arquivo é um padrão que merece comentário explícito. Pertence a `helpers/fflate.mjs` (§6.2).

---

**D11 · BAIXO · `tests/crypto.test.mjs:8` referencia o global `crypto` nu.**
`await assert.rejects(crypto.subtle.exportKey('raw',k))` funciona em Node 22 (global `crypto` = webcrypto, verificado) e no browser (`window.crypto`) por coincidência de nome, mas o resto do módulo usa `crypto.subtle` capturado no import-time (`crypto.js:3` `S=crypto.subtle`). O teste deveria referenciar `globalThis.crypto.subtle` explicitamente, ou importar a chave via API própria — para que um stub de `crypto` num harness futuro não torne a asserção vacua.

---

**D12 · BAIXO · Nenhum teste cobre o nome que carrega: `apicpf.test.mjs` não testa `src/services/apicpf.js`.**
`apicpf.test.mjs:2` importa `../api/cpf.js`. O módulo **homônimo** `src/services/apicpf.js` (58 linhas) tem zero cobertura (§3.1) justamente as partes difíceis: cache com TTL de 30 min (`:3`), dedupe de chamadas simultâneas por `PENDING` (`:13`), timeout de 9 s com distinção `TIMEOUT` vs `abort` manual (`:20`,`:43`-`:46`), e `if(!navigator.onLine)throw fail('OFFLINE')` (`:9`). Nome idêntico + conteúdo distinto é uma armadilha ativa de manutenção.

---

**D13 · BAIXO · Assimetria de profundidade entre as camadas.**
`src/domain/address.js` (12 linhas) tem 14 asserções; `src/export/backup.js` (30 linhas de lógica de dados **destrutiva**) tem zero. `src/domain/*` está essencialmente bem coberto (4 módulos, todos com teste direto, `money.js` com 100% de linha medido em §3.3); `src/services/*`+`src/security/auth.js`+`src/ui/*` — onde mora o estado e o risco — é onde a suíte é decorativa.

---

**D14 · BAIXO · Sem `engines`/CI/versionamento da suíte.**
`package.json` tem 33 bytes e só `{"type":"module","private":true}`: sem `scripts.test`, sem `engines`, e README:210 fala em "Node.js 18+" enquanto o ambiente validado aqui é `v22.23.4` (`node --version`). Como `node --test` só ficou estável e com `describe/it/mock` no 20+, e `structuredClone(CryptoKey)` (necessário para os testes de sessão, §4.1) em Node 18 é **duvidoso**, a afirmação de compatibilidade do README não é verificada em lugar nenhum. *(NÃO CONFIRMADO para Node 18/20 específicos — não instalei/executei outra versão.)*

---

**D15 · INFO · Boas práticas que já existem e devem ser preservadas como padrão.**
- Contratos de erro por `code` (`assert.rejects(...,x=>x.code==='NEEDS_PASSWORD')`, `backup.test.mjs:13`) em vez de comparar mensagem — robusto a reescrita de UX.
- Teste de não-vazamento em texto claro com mensagem explicativa (`backup.test.mjs:15`: `'nomes não podem aparecer em claro no backup criptografado'`).
- Verificação de anti-enumeração na API pública (`apicpf.test.mjs:42`: garante que `message` do upstream não chega ao corpo).
- Limpeza de estado global em `finally` (`apicpf.test.mjs:52`-`:55`).
- Uso de `BigInt` no produto (`money.js:9`) com teste de grandeza (`money.test.mjs:4`) — casa de aritmética monetária bem feita.
- IV/nonce uniqueness asserido como desigualdade, nunca como valor (`crypto.test.mjs:7`) — o padrão correto.

---

## 9. Verificações de integridade que já podem virar teste hoje (bônus, custo ~0)

Executadas nesta auditoria em Node puro, sem dependências, e **nenhuma** tem teste no repo:

| Checagem | Resultado atual |
| --- | --- |
| `node --check` nos 47 arquivos `.js`/`.mjs` (46 + `vendor/fflate.min.js`) | **47 OK / 0 falha** |
| `sw.js` `V` presente e com o formato esperado | `V='sc-v69'` |
| Itens de pre-cache `sw.js FILES` existentes no disco | **52 / 52 presentes, 0 ausentes** |
| `src/**/*.js` não referenciado no pre-cache | **0** (todos os 37 presentes) |
| `manifest.json` parseável com `name`/`start_url`/`icons` | OK |
| `package.json` com `type:'module'` | OK |

Estes 6 viram os passos `estatico` do §7 sem escrever lógica de produto em teste.

---

## 10. Limites desta auditoria / NÃO CONFIRMADO

- **NÃO CONFIRMADO:** comportamento real de `apicpf.com` sem chave válida (sem egress no sandbox; `curl` não retornou em 12 s). A conclusão D1 não depende disso — a *tentativa de rede* foi provada por spy local.
- **NÃO CONFIRMADO:** disponibilidade de Chromium nos runners do GitHub Actions sem passo de download; se o Playwright do sandbox opera com `/usr/bin/chromium` apontando `executable_path` (não testei — a instrução era não escrever testes).
- **NÃO CONFIRMADO:** cobertura real de linha/ramo da suíte completa (medi apenas `money.test.mjs` isolado para validar que a flag nativa funciona). Um número agregado é a primeira coisa que o CI deveria começar a reportar.
- **NÃO CONFIRMADO:** execução sob `TZ` diferentes (§9 D9) — recomendei, não executei a matriz.
- Estimativa de ~116 execuções de assert é derivada estaticamente dos 94 call sites + aritmética dos laços de `stage4.test.mjs:5`,`:6` e `apicpf.test.mjs:37`, não instrumentada em runtime.
- Escopo: esta auditoria cobre **testes e infraestrutura de qualidade**. Não avaliou correção funcional das regras de negócio, nem segurança de implementação, nem UI/UX.
- Nenhuma asserção deste documento sobre o código de produto foi provada por execução além das listadas em §4.2, §4.3, §1.8 e §9 (todas reproduzíveis pelos comandos citados).
