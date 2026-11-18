# Testes — SCIPIONE CRED

Documento canônico sobre como testar este projeto, o que a suíte cobre de fato e onde ela **não** alcança. Escrito na branch `chore/project-audit-and-test-infrastructure` a partir do commit `e78d776`; todos os números daqui foram medidos nesta árvore de trabalho, não copiados de relatório anterior.

Runtime da medição: **Node.js v22.23.4**, `node:test` nativo, zero dependências de terceiros (regra do projeto — `package.json` não tem `dependencies`, e `tests/contracts/no-egress.test.mjs` + `scripts/check-static.mjs` bloqueiam violação).

## 1. Como executar

| Objetivo | Comando | O que faz |
|---|---|---|
| Suíte completa | `node --test "tests/**/*.test.mjs"` | 497 casos, 55 suítes, 0 falhas, 0 cancelados, ~10,7 s. É o comando canônico. |
| Um arquivo | `node --test tests/unit/money.test.mjs` | Útil em desenvolvimento. |
| Suíte + artefatos + gate | `node scripts/run-tests.mjs` | Descobre os 28 arquivos (contagem de `find tests -name '*.test.mjs'` nesta árvore), exige `# fail 0`, `# cancelled 0` e `# tests >= nº de arquivos`; grava TAP/JUnit/log em `artifacts/`; **exit 2** se a descoberta for vazia. |
| Checagens estáticas | `node scripts/check-static.mjs` | 48 verificações em 7 grupos: `essenciais`, `sintaxe`, `sw`, `json`, `deps`, `segredos` (35) e `docs` (13). Lista em `scripts/check-static.mjs:23`. |
| Só o contrato de citações | `node scripts/check-static.mjs --only=docs` | Varre a documentação em busca de `arquivo:linha` pendente, linha fora da faixa e referência fora do repositório; origem da checagem em `scripts/check-static.mjs:402`. |
| Cobertura | `node --test --experimental-test-coverage "tests/**/*.test.mjs"` | Informativa, sem threshold (ver §6). |

Duas invocações **não** funcionam e não devem voltar a aparecer em documentação:

- `node --test tests` falha com `MODULE_NOT_FOUND` (o runner não recursora a partir de caminho de diretório nesta versão).
- O laço que existia no README antigo — `for t in tests/*.test.mjs; do node tests/$t; done` — devolve o exit do **último** comando, portanto uma suíte vermelha terminava em verde. É exatamente o modo como o defeito do §3.2 passou despercebido.

Os Critérios de aceitação da CI rodam a suíte nos fusos `America/Sao_Paulo` e `UTC` (`fail-fast: false`) porque o vencimento depende de data local (`src/domain/due.js:2`, `src/services/dashboard.js`). A suíte está verde nos dois.

## 2. Anatomia da suíte

| Caminho | Casos | Papel |
|---|---:|---|
| `tests/*.test.mjs` (7 arquivos legados) | 46 | Scripts históricos de asserção solta; 6 deles contam como **1** caso no runner, porque nunca usaram `node:test`. Continham o único teste com rede real do repositório (§3.2). `apicpf.test.mjs` saiu de 20 para **40** casos nesta branch (+20) e é todo o crescimento da linha. |
| `tests/unit/` (9 arquivos) | 161 | Lógica pura: `money` 18, `due` 19, `validators` 19, `address` 13, `backup-format` 32, `security` 23, `apicpf-client` **15** (era 11), `live` 8, `xlsx` 14. |
| `tests/svc/` (8 arquivos) | 175 | Serviços sobre o IndexedDB simulado: `clients` 21, `debts` **23** (era 17), `documents` 17, `records` 22, `backup-restore` 30, `dashboard` 17 (estável, 2 casos reescritos), `viacep` 16, `google-drive` 29. |
| `tests/contracts/` (4 arquivos) | 115 | Guardas estruturais: `sw-files` 59 (um caso por entrada de `FILES`), `imports` 43 (um por par de import), `no-egress` 7 e `docs-refs` 6 (§2.1). |
| `tests/helpers/` (5 arquivos) | — | Infraestrutura compartilhada, descrita abaixo. |

Total executado nesta rodada: **28 arquivos `.test.mjs`, 4.509 linhas, 1.180 chamadas de `assert`, 497 casos, 55 suítes, 0 falhas, 0 cancelados, ~10,7 s**, verde em `TZ=America/Sao_Paulo` **e** em `TZ=UTC`. Método declarável para os três números estruturais: `find tests -name '*.test.mjs' | xargs wc -l` (4.509) e `find tests -name '*.test.mjs' | xargs grep -ho "assert\.[a-zA-Z]*(" | wc -l` (1.180) — a medição anterior do documento (4.570 linhas / 973 asserções) contava **também** os `.mjs` de `tests/helpers/`, e por isso não é comparável a esta.

A suíte foi reexecutada por inteiro com o 28º arquivo já na árvore: **497 = 46 legados + 161 `unit` + 175 `svc` + 115 `contracts`**, 0 falhas e 0 cancelados. O degrau anterior, 491 casos, valeu só enquanto `docs-refs.test.mjs` ainda não estava na árvore; a soma fechada acima é a medida vigente.

### Os helpers e o que cada um simula

- `fake-idb.mjs` — stub determinístico de IndexedDB cobrindo a superfície que o app usa (13 métodos, sem cursores). Grava e lê objetos estruturados reais, respeita `keyPath` e `autoIncrement`, e reproduz o commit/abort de transação que `src/db/idb.js:30` observa. **Não** implementa: cursores, índices compostos, `versionchange` real, multiprocessos, nem a garantia de durabilidade `durability:"strict"` (o browser ignora a opção e o stub também).
- `dom.mjs` — `window`, `document`, `navigator` mínimos para módulos que tocam eventos globais. Não renderiza: não há layout, `matchMedia`, `IntersectionObserver`, `createImageBitmap` nem `URL.createObjectURL`.
- `fetch-mock.mjs` — intercepta `globalThis.fetch` com **negação por padrão**: rota desconhecida vira exceção local, nunca tentativa de conexão. Mantém log para asserção de contagem de chamadas.
- `vault.mjs` — `setup`/`unlock`/`lock` do cofre real sobre o `fake-idb`, para testes de serviço não reimplementarem criptografia.
- `fixtures.mjs` — dados 100% fictícios: CPFs/CNPJs de exemplo de documentação, nomes genéricos, e-mails em `*.invalid`, datas relativas. **Nenhum dado real de cliente entra na suíte**, e `scripts/check-static.mjs` (grupo `segredos`) recusa padrões de segredo commitado.

### 2.1 O contrato de citações da documentação (`tests/contracts/docs-refs.test.mjs`)

6 casos que chamam o **script real** (`scripts/check-static.mjs:402`, grupo `docs`) contra a árvore do repositório e contra fixtures montadas em memória, para provar que o mecanismo pega problema e não é enfeite:

| Caso | O que fixa | Linha no teste |
|---|---|---|
| documentação canônica limpa | `--only=docs` tem de sair com exit 0 na árvore real — nenhuma citação pendente, nenhuma linha fora da faixa, nenhum caminho absoluto | `tests/contracts/docs-refs.test.mjs:43` |
| alvo inexistente | citação para arquivo que não está no repositório é pega | `:51` |
| linha acima do tamanho do arquivo | `arquivo:999` é pega mesmo com arquivo existindo | `:63` |
| caminho absoluto | referência a uma máquina específica é pega; a raiz do próprio projeto não | `:71` |
| sufixo ambíguo | forma abreviada (`ui/debtspage.js:35`) resolve quando o nome casa um único arquivo; com dois candidatos o mesmo nome, vira **aviso** com exit 0 — não falha | `:88` |
| evidência congelada | `docs/auditoria/` é histórico e fica fora da checagem de faixa | `:101` |

Estado honesto da checagem nesta rodada: `node scripts/check-static.mjs --only=docs` devolve **2 verificações OK e 11 falhas**. Todas as 11 caem no primeiro caso da tabela (`tests/contracts/docs-refs.test.mjs:43`), porque a documentação ainda cita o rastro da auditoria por caminhos que não são versionados (`audit/*.md`) e por caminhos absolutos de máquina específica em `README.md`, `AGENTS.md` e nos docs de área. Nenhuma referência foi introduzida por esta entrega e a re-ponte global é trabalho separado, combinado com o mantenedor. Os seis grupos anteriores continuam em 39 verificações OK, 0 falhas.

## 3. Estado encontrado (ETAPA 3)

### 3.1 O que os 7 testes legados realmente cobriam

Eles exercitam comportamento real — os asserts são válidos — mas como scripts de afirmação solta: o veredito era "o processo morreu em 0?". Um assert quebrado na linha 2 impedia as ~21 afirmações seguintes de rodar, e `# tests 7` nunca mudaria. `stage4.test.mjs` não tinha nome inteligível; o carregador UMD da fflate vivia dentro de `backup.test.mjs:2`; `crypto.test.mjs` referenciava o global `crypto` nu. Nada disso foi apagado: os arquivos continuam no lugar e verdes, agora com o `it` que faltava em `apicpf.test.mjs` e com os temas novos ao lado.

### 3.2 O defeito que a auditoria encontrou e foi corrigido

`tests/apicpf.test.mjs` tinha um caso "sem `APICPF_API_KEY` deve devolver 503". A atribuição era

```js
process.env.APICPF_API_KEY = undefined;   // antes
```

Em Node, isso grava a **string** `"undefined"`, que é truthy. A guarda de `api/cpf.js:20` não disparava (numeração do arquivo de 48 linhas de então; no `api/cpf.js` atual, de 138 linhas, a mesma guarda está em `:109`); o handler seguia e fazia uma **requisição HTTPS real** a `https://apicpf.com/api/consulta?cpf=…` com header `X-API-KEY: undefined` e um CPF na URL. O `503` aprovado pelo teste vinha do `catch` (`api/cpf.js:43` de então; hoje `api/cpf.js:129-130`), não da guarda: cobertura real da guarda era 0 %, e a suíte inteira dependia de rede/terceiro para passar (1,4–5,8 s só naquele arquivo).

Prova reproduzível, com espião no lugar de `fetch`: com a atribuição, `fetchCalls().length === 1` e o CPF aparece na URL; com `delete process.env.APICPF_API_KEY`, `fetchCalls().length === 0` e o status vem da linha de guarda. A correção apagou a variável, instalou o mock antes de qualquer chamada e asseriu **zero** requisições. O arquivo passou de 7 para 20 casos e de ~1,4 s para 205 ms na etapa de auditoria; nesta rodada foi reescrito de novo e fechou com **40 casos em 678 ms**, sem nenhuma saída para a rede. O caso é generalizado em `tests/contracts/no-egress.test.mjs`, que nega rede e falha se qualquer teste tentar sair.

**A mesma armadilha renasceu no harness desta rodada e foi pega pela asserção de zero rede.** Ao escrever o helper de POST, a forma natural era `postCpf(undefined)` para o caso "sem `APICPF_API_KEY`". Como o parâmetro tem valor default (`tests/apicpf.test.mjs:118`), passar `undefined` **reativa** a chave fictícia em vez de apagá-la: o handler passaria pela guarda de `api/cpf.js:109`, chamaria o upstream de verdade (`api/cpf.js:114`) e o `503` sairia do `catch` (`api/cpf.js:129-130`) — cobertura falsa, exatamente o defeito de antes, agora no lado do teste. A convenção fixada no arquivo é usar **`null` como marcador de "chave ausente"**, convertido em `delete` dentro de `call()` (`tests/apicpf.test.mjs:96-97`); o comentário em `tests/apicpf.test.mjs:116-117` registra o motivo. O que denuncia o erro é a dupla asserção do caso sem chave — `tests/apicpf.test.mjs:161-162` exige que a variável esteja **ausente** do ambiente e `tests/apicpf.test.mjs:166` exige `fetchCalls().length === 0` — que falhou na primeira execução deste arquivo, antes de qualquer correção; a prova transversal do arquivo inteiro está em `tests/apicpf.test.mjs:575` e `tests/apicpf.test.mjs:588` (`deniedCalls()` vazio). Lição para quem escreve teste aqui: **default de parâmetro não é ausência de variável de ambiente**.
### 3.3 Uma afirmação de documentação derrubada por teste

Enquanto se escrevia o teste de XLSX, descobriu-se que `docs/API.md` afirmava que `isoOf()` de timestamp inválido devolvia `'NaN-NaN-NaN'`. Medido em Node 22: `isoOf('não-e-data')`, `isoOf(undefined)` e `isoOf('')` lançam `RangeError: Invalid time value` (`new Date(NaN).toISOString()`), e `isoOf(null)` é coagido a `0` e devolve a época deslocada pelo fuso. A tabela de `docs/API.md` foi corrigida e o teste fixa o comportamento real de forma independente de fuso (asserção de faixa, não de valor). É um exemplo do motivo pelo qual a cobertura sozinha não basta: o módulo era "100 % executado" e a descrição estava errada.

### 3.4 Os 20 casos novos do proxy (de 20 para 40 em `tests/apicpf.test.mjs`)

Cada linha abaixo é um grupo de casos que só existe porque o contrato de `/api/cpf` mudou nesta branch; a âncora é o primeiro `it()` do grupo.

| Grupo | O que é provado | Casos / âncora | Guarda no código |
|---|---|---|---|
| POST nas três formas de corpo | o runtime da Vercel pode entregar `req.body` como **objeto pronto**, como **string** ou **indefinido** (stream) e os três chegam ao mesmo resultado | `tests/apicpf.test.mjs:331` | `api/cpf.js:79-87` |
| POST canônico | 200 com o mesmo mapeamento do GET, **nenhuma query** na URL da nossa função, corpo `{"cpf":"..."}` | `tests/apicpf.test.mjs:290` | `src/services/apicpf.js:28-33` |
| Espelhos do GET sobre POST | 422 para CPF inválido no corpo, 503 sem chave **sem tocar na rede**, `?cpf=` da URL ignorado (quem manda é o corpo), `cpf` numérico aceito | `tests/apicpf.test.mjs:306`, `:315`, `:322`, `:380` | `api/cpf.js:90`, `api/cpf.js:106` |
| Corpo malformado | JSON quebrado, corpo vazio ou sem o campo `cpf` cai em 422/INVALID sem sair para a rede | `tests/apicpf.test.mjs:360` | `api/cpf.js:88-90` |
| 415 | `content-type` que não é `application/json` é recusado **antes** de qualquer leitura de corpo | `tests/apicpf.test.mjs:347` | `api/cpf.js:95-96` |
| 413 | corpo acima de 1 KiB é cortado **no meio do stream**, sem estourar memória nem tocar a rede | `tests/apicpf.test.mjs:387` | `api/cpf.js:85`, `api/cpf.js:103` |
| Origem | 403 em origem estrangeira; same-origin (host da própria função) passa; allowlist CSV de `SCIPIONE_ALLOWED_ORIGINS` aceita a listada e recusa a vizinha; **sem** `Origin`/`Referer` o pedido segue — limitação documentada, não bug | `tests/apicpf.test.mjs:404`, `:418`, `:428`, `:443` | `api/cpf.js:48-56`, `api/cpf.js:17`, `api/cpf.js:98` |
| Cota por IP | com `CPF_QUOTA_PER_IP=3`, o 4º pedido do mesmo IP recebe 429 com header `Retry-After` em segundos **e outro IP ainda passa** | `tests/apicpf.test.mjs:459` | `api/cpf.js:66`, `api/cpf.js:100` |
| Cota por instância | com `CPF_QUOTA_PER_INSTANCE=5`, o 6º pedido é bloqueado mesmo trocando o IP — é o trava-custos contra rotação de IP | `tests/apicpf.test.mjs:480` | `api/cpf.js:67` |
| Gancho de cota | `__quota.reset()` volta a permitir imediatamente: a cota é estado de módulo por design, os casos isolam contadores sem reiniciar o processo | `tests/apicpf.test.mjs:495` | `api/cpf.js:138` |
| Expiração de janela | com `CPF_QUOTA_WINDOW_MS` curto e **espera real**, o mesmo IP volta a ser atendido quando a janela vira (não é reset artificial) | `tests/apicpf.test.mjs:507` | `api/cpf.js:60-62` |
| 429 não vaza | a resposta de cota não devolve mensagem do terceiro nem o CPF, e não consome cota de upstream | `tests/apicpf.test.mjs:525` | `api/cpf.js:100` |
| Ausência de eco | nenhuma resposta, em nenhum caminho de status, ecoa o CPF consultado (nem mascarado) nem a chave do provedor | `tests/apicpf.test.mjs:541`, asserções de chave em `tests/apicpf.test.mjs:566-567` | `api/cpf.js:27-32` |
| Prova transversal | **nenhuma** requisição de teste saiu para fora: todas as URLs registradas são do upstream simulado, a saída é `GET` por contrato e o CPF só aparece na URL do provedor | `tests/apicpf.test.mjs:571`, `tests/apicpf.test.mjs:578` | `api/cpf.js:114` |

No lado do cliente (`tests/unit/apicpf-client.test.mjs`, de 11 para 15 casos), os casos que valem pelo contrato novo: o transporte é `POST /api/cpf` com o CPF no corpo e nenhum `?cpf=` na URL (`tests/unit/apicpf-client.test.mjs:103`); máscara na entrada vira só dígitos no corpo (`:111`); **403/413/415/429 do proxy caem no mesmo `UNAVAILABLE` silencioso que já existia, sem código de erro novo e sem vazar o motivo** (`:143`) — por isso nenhuma tela foi tocada; nenhuma retomada regressiva para `GET`, nem por falha, nem por retry, nem por cache frio (`:195`); e a prova de que nenhuma chamada saiu fora do mock e nenhum CPF entrou em URL no arquivo inteiro (`:238`).

## 4. Mapa dos 15 comportamentos exigidos

| # | Comportamento | Onde está coberto | Lacuna honesta |
|---|---|---|---|
| 1 | Cadastro e autenticação (criar cofre) | `unit/security` (setup, `meta/vault` com `iter/kdf/cipher/v`, salt/IV únicos, DEK não exportável, `setup()` duplicado recusa) | Validação do **formulário** de senha vive em `src/ui/*` — camada sem teste (ver §5). |
| 2 | Desbloqueio e bloqueio automático | `unit/security` (unlock correto/errado, `lock()` zera chave + apaga `meta/session` + dispara assinantes, motivo `'idle'` propagado, `lock()` fire-and-forget) | A **contagem regressiva de inatividade** (`src/security/auth.js:64`) não roda em Node: exige eventos reais de ponteiro/teclado. `auth.js` fecha em 84,06 % de linha por causa disso. |
| 3 | Tentativas incorretas de senha | `unit/security` (senha errada rejeita e cofre continua fechado) | O **backoff visível** ("aguardar N s") está implementado no módulo de UI do login, não no serviço — não medido. Registrado como item da trilha Q do `docs/ROADMAP.md`. |
| 4 | Persistência no IndexedDB | `svc/records` (round-trip das 7 stores), `svc/clients`, `svc/debts`, `svc/documents`, `svc/dashboard` | Índices reais e cursores não existem no stub; `durability:"strict"` é ignorado (camada c). |
| 5 | Integridade das transações | `svc/records` (atomicidade de `db.batch`, abort propaga), `contracts/*` | `get/put/del` **não** emitem `data-changed` (só `batch`) — caracterizado em `svc/records`, não corrigido. |
| 6 | Criptografia e adulteração de dados | `unit/security` (flip de 1 byte em qualquer posição, troca de IV, downgrade de `iter`, tag GCM), `unit/backup-format` (sha256 por entrada), `svc/backup-restore` (`BAD_PASSWORD`) | `openVault` confia no `iter` do arquivo (ataque de custo) — caracterizado, decisão de correção pendente de autorização. |
| 7 | Cadastro, edição e exclusão de clientes | `svc/clients` (21 casos: criação vs edição, cascata de `deleteClient`, contadores, validação de documento) | Foto de perfil exige `createImageBitmap` → só em navegador. |
| 8 | Cadastro, edição e exclusão de dívidas | `svc/debts` (23 casos). A integridade referencial **saiu de caracterização para asserção da guarda**: cliente inexistente (`tests/svc/debts.test.mjs:100-113`), `clientId` falsy (`:116-125`), ordem `validate()` antes da guarda (`:128-137`) e o caso real da UI — perfil excluído em outra aba, cadastro **e** edição recusados (`tests/svc/debts.test.mjs:139-148`) — com `code:'NO_CLIENT'` vindo de `src/services/debts.js:20` | A órfã **legada** não tem caminho de reatribuição na UI: ela continua sendo injetada nos testes por escrita direta (`rec.enc` + `db.batch`, `tests/svc/debts.test.mjs:153`) para representar cofre de versão anterior, e é lida como está — quadro em `docs/DATABASE.md` §6.1. |
| 9 | Cálculos financeiros e arredondamentos | `unit/money` (18: centavos, `RangeError` de valor fracionário, arredondamento), `svc/dashboard` (juros somados por dívida) | Nada a declarar: `money.js` 100/100/100. |
| 10 | Vencimentos e indicadores | `unit/due` (19: janela, meia-noite, `overdue/soon/ok`), `svc/dashboard` (17: três situações com datas relativas, janelas 3/7/30, mesmos dados em dois fusos) | `stats()` não devolve contagem de `ok` — caracterizado. |
| 11 | Backup e restauração | `unit/backup-format` (32: envelope, `FORMAT=1`, cifrado × claro, truncamento), `svc/backup-restore` (30: ida e volta com DEK diferente, `merge` × `replace`, blob ausente, `dueWindow`) | A recusa continua sendo a barreira: backup com dívida órfã é irrestaurável em `INVALID` na leitura (`src/export/backup-format.js:24`, caminho `:43`). O que mudou em D-01 é a **montante** — pela camada de serviço a órfã não se cria mais (`src/services/debts.js:20`), então o backup legado continua preso e um conserto retroativo é migração, não teste. |
| 12 | Exportação XLSX | `unit/xlsx` (14: ZIP desmontado, partes OOXML obrigatórias, célula numérica × `inlineStr`, estilos 164/165, escape de markup de usuário, pane congelado, larguras, relatório vazio, limite de 26 colunas) | O teste legado só gravava `/tmp/amostra.xlsx` sem asserir nada; agora a asserção existe. |
| 13 | Funcionamento offline | `contracts/sw-files` (V com formato `sc-vN` e as 52 entradas de `FILES` presentes no disco, `src/**.js` coberto), caminhos `OFFLINE` de `unit/apicpf-client` e `svc/viacep` | O `fetch` handler cache-first do `sw.js` não roda em Node. |
| 14 | Atualização do Service Worker | `contracts/sw-files` + `scripts/check-static.mjs` (grupo `sw`, incluindo a comparação `base...head` do bump de `V`) + job `estatico` da CI | Instalação/ativação de verdade (SKIP_WAITING, client reload) é comportamento de navegador. |
| 15 | Integrações externas | `unit/apicpf-client` (15), `tests/apicpf` (40, função serverless real — ver §7.1), `svc/viacep` (16), `svc/google-drive` (29) | `google-drive.js` em 52,21 % de linha: o fluxo OAuth (`connect()`/`preload()`) depende do script da Google e não é instanciável em Node. O salto servidor→provedor é provado só contra mock (`tests/apicpf.test.mjs:578`); a resposta real da APICPF não foi exercitada nesta rodada. |

## 5. Cobertura medida

Relatório do Node (`--experimental-test-coverage`) sobre os 38 módulos de aplicação (`src/**.js` + `api/cpf.js`): **25 módulos carregados por pelo menos um teste, média de 96,50 % de linha entre os medidos**.

Esta rodada **não reexecutou** a cobertura (outros agentes na mesma árvore), então os percentuais acima continuam os da medição anterior e não são reivindicados como novos. O que se pode afirmar da estrutura sem reexecutar: a base de módulos não mudou — 37 arquivos em `src/` + `api/cpf.js` = 38 — e `api/cpf.js` (de 48 para 138 linhas) continua entre os alcançados, agora com muito mais caminho coberto pelos 40 casos de `tests/apicpf.test.mjs`; `src/services/apicpf.js` (58 → 64) e `src/services/debts.js` (34 → 39) também continuam alcançados; `src/ui/debts.js` (mudado em `:27`) **continua sem medição em Node**, porque a camada de UI só roda em navegador.

Abaixo de 100 % de linha: `src/services/google-drive.js` 52,21 %, `src/export/reports.js` 76,19 %, `src/security/auth.js` 84,06 %. Abaixo de 80 % de ramo: `src/files/process.js` 70,59 %, `src/export/lib.js` 75,00 % (carregador de script injetado — DOM), `src/security/auth.js` 75,00 %, `src/services/search.js` 85,71 %.

**Sem nenhuma medição (13 módulos):** `src/main.js`, `src/pwa.js` e os 11 arquivos de `src/ui/`. Eles formam a camada de apresentação e o bootstrap: só instanciam quando existe DOM real, `matchMedia`, `createImageBitmap`, `IntersectionObserver` e ciclo de vida de Service Worker. Não há como medir isso com `node:test` + stub sem mentir sobre o que está sendo provado, e o `dom.mjs` declara explicitamente esses limites em vez de fingir cobertura. São, portanto, o alvo natural da suíte de navegador descrita no §7 — e a razão de a cobertura não ser gate no §6.

## 6. Por que a cobertura é informativa e não bloqueante

O projeto tem **1.775 linhas de aplicação** medidas nesta rodada (`src/` = 1.637 em 37 arquivos + `api/cpf.js` = 138) e uma regra de ausência de build/dependências. Um threshold artificial faria a equipe escrever asserção vazia para subir número — exatamente o que a auditoria pediu para não acontecer. O gate da CI é: (a) todos os casos passam; (b) `# tests >= número de arquivos descobertos` (arquivo sem caso é arquivo que não rodou); (c) `# cancelled 0`; (d) checagens estáticas; (e) o contrato de `V`/`FILES`. A cobertura entra como artefato e comparação entre execuções.

## 7. Testes de navegador (ETAPA 4): avaliação

Avaliou-se rodar Playwright sobre Chromium no sandbox. **Conclusão: tecnicamente viável, mas não adicionado nesta branch**, por três motivos objetivos: (1) Playwright é dependência pesada e a missão manda não introduzi-la sem necessidade; (2) o `tests/` atual não a usa, então adicioná-la criaria dois caminhos de QA com a CI sem browser confiável; (3) o ganho imediato está em outra parte — os 15 comportamentos da ETAPA 3 já foram cobertos em Node, e o que sobra é especificamente DOM/SW.

O que ela provaria e hoje **não é provado** (lista para o item `Q-*` do `docs/ROADMAP.md`):

1. IndexedDB **real** com upgrade de versão e `versionchange` entre duas abas.
2. Desbloqueio com teclado físico + disparo do timer de inatividade (§4, itens 2 e 3).
3. Instalação do PWA: `install` → `activate` → recarga com novo `V` (item 14).
4. Offline real: desligar a rede e navegar todas as 15 telas (item 13).
5. `createImageBitmap` no recorte de foto de perfil e os três breakpoints do campo de fotografia.
6. Impressão e `window.print()` dos relatórios.

O job `smoke-navegador` da CI existe, é **não bloqueante** (`continue-on-error`) e dispara por `workflow_dispatch`: ele detecta um navegador disponível, serve o app estático, verifica que `index.html` carrega e que `sw.js` é servido, e publica como documentação do build o roteiro acima. Assim que o item 1 e o 3 virarem teste real, o job passa a ser candidato a bloqueante.

### 7.1 O que foi rodado à mão nesta rodada: a função serverless real dentro do navegador

Os itens 1 e 3 acima continuam em aberto, mas **uma lacuna específica deste PR foi fechada por execução manual com navegador real**: provar que o `POST` com CPF no corpo funciona contra a função serverless **publicada**, e não contra uma reimplementação de teste.

Montagem (artefato de execução, **não** versionado no repositório): um shim Node com `node:http`, de assinatura `(req, res)` — exatamente a de `api/cpf.js:93`, o que dispensa adaptador — serve os estáticos do app em `127.0.0.1:8080` e roteia `/api/cpf` para o `handler` importado do arquivo real. O upstream da APICPF é substituído em memória por dois CPFs fictícios, e um endpoint do próprio shim devolve o log das saídas ao provedor, para asserir para onde foi cada chamada e com que URL.

**Resultado: 23 de 23 verificações passaram.** Distribuição por grupo:

| Grupo | Verificações |
|---|---|
| Transporte de entrada | o cliente chama `/api/cpf` com `POST`; nenhuma chamada regressiva para `GET` no bundle novo; o corpo JSON leva `cpf`; **nenhuma query string** na URL da nossa função; `content-type: application/json` enviado |
| Preenchimento | selo "Validado"; nome, nascimento e gênero preenchidos no formulário |
| Normalização no cliente | `trim` no nome aplicado; gênero fora do whitelist **rejeitado**; nascimento fora de ISO **rejeitado** — com o selo intacto (`src/services/apicpf.js:39-41`) |
| Saída para o provedor | exatamente 1 chamada; `GET` com `?cpf=` na URL do provedor (contrato da APICPF, `api/cpf.js:114`); chave lida em `api/cpf.js:108` e enviada **só** nesse salto |
| Barreiras | 403 em origem estrangeira (`api/cpf.js:98`); 415 em `content-type` errado (`api/cpf.js:95-96`) |
| Caminho órfão | a órfã **legada** (injetada por escrita direta no IndexedDB do navegador, porque `src/services/debts.js:20` não deixa mais o service criá-la) aparece na página Dívidas (`src/ui/debtspage.js:35`); nome resolvido como `—`; o submit exibe a mensagem amigável do serviço (`src/ui/debts.js:27-28`); **nenhum `TypeError` novo** no console; store `debts` inalterada; **zero** linhas novas em `history`; ao voltar, a lista continua com 1 dívida |
| Sessão | zero erros de página no navegador durante toda a sessão |

**Por que não está na CI:** a suíte de navegador exige Playwright, dependência de terceiros proibida pela regra do projeto (`package.json:1` não tem `dependencies`; o contrato `tests/contracts/no-egress.test.mjs` e o grupo `deps` de `scripts/check-static.mjs` bloqueiam violação) e o job `smoke-navegador` é `continue-on-error` exatamente por não haver navegador confiável no runner. Este resultado é **evidência de execução pontual, reproduzível pelo roteiro, não um gate**: não protege contra regressão futura. O que é gate continua sendo `tests/apicpf.test.mjs` (40 casos contra o handler real com `fetch` simulado), `tests/unit/apicpf-client.test.mjs` (15 casos), `tests/svc/debts.test.mjs` (23 casos) e `tests/svc/dashboard.test.mjs` (17 casos).

## 8. Testes de caracterização

26 marcações `// conhecido: ver docs/ROADMAP.md` em 10 arquivos (contagem medida nesta rodada, inalterada) fixam comportamento **indesejado mas real**: dedupe de documento só por `clientId+hash`, blob órfão em `removeDoc`, `setDueWindow('abc')` gravado sem validar, `parseRate('1001')` acima do máximo, `status(due, undefined)` que nunca dá `soon`, `validate()` que aceita `principal` como string, `lock()` que não apaga `meta/vault`, cache do ViaCEP sem TTL, config OAuth em claro no `localStorage`, 26 colunas no XLSX, entre outros.

**O que mudou de status nesta rodada:** os dois itens de dívida órfã saíram da caracterização. "dívida órfã aceita" e "`saveDebt` sem validação de cliente" agora são **asserção da guarda** em `src/services/debts.js:20` (quatro casos em `tests/svc/debts.test.mjs:100-148`), exatamente como manda a regra abaixo — a asserção antiga falhou de propósito quando o comportamento mudou e foi reescrita por quem corrigiu. Permanece caracterizada, e é importante não confundir, a **leitura** do legado que a guarda não alcança: `tests/svc/dashboard.test.mjs:159` (a órfã legada entra nos totais e não aparece por cliente) e `tests/svc/dashboard.test.mjs:172` (`stats()` não denuncia a inconsistência; é o `validate()` do backup que a barra depois). A órfã de teste passou a ser semeada por **escrita direta** (`rec.enc` + `db.batch`, `tests/svc/debts.test.mjs:153` e `tests/svc/dashboard.test.mjs:148-155`), o mesmo caminho já usado em `tests/svc/records.test.mjs:42`: depois da guarda não existe mais API de serviço que produza o estado, e a alternativa seria apagar o caso — ou mentir que o legado não existe.

A regra é explícita: **nunca** deixar um teste vermelho para denunciar um problema conhecido. Vermelho permanente ensina a ignorar a CI. Quando o bug for corrigido, o teste de caracterização falha de propósito e obriga quem corrigiu a atualizar a asserção e o `docs/ROADMAP.md`.

## 9. Como escrever um teste novo

1. Escolha a camada: `unit/` (função pura, sem banco), `svc/` (usa `fake-idb` + `vault`), `contracts/` (estrutura do repositório).
2. Importe `tests/helpers/fixtures.mjs` para dados e **nunca** escreva um CPF/nome próprio no teste: os valores de exemplo são os de documentação (`529.982.247-25`, `11.222.333/0001-81`), sempre com e-mail `*.invalid`.
3. Precisa de cofre aberto? Use `await unlockVault()` do `vault.mjs` e `lockNow()` no `after` — sem isso, o timer de inatividade do `auth.js` mantém o processo vivo.
4. Precisa de rede? Use `installFetchMock({ routes })`. Rota fora do mock **lança**: se quer que falhe, deixe lançar; se quer assentar que não chamou, use `fetchCalls()`.
5. Datas: derive de `todayISO()` em vez de fixar `'2026-11-17'`, senão o teste envelhece e quebra de madrugada ou em outro fuso.
6. As asserções devem ser **específicas** (valor, código de erro, contagem de chamadas). `assert.ok(x)` de objeto sem verificar campo é o padrão que a auditoria criticou no legado.
7. Antes de abrir PR: `node --test "tests/**/*.test.mjs"`, `TZ=UTC node --test "tests/**/*.test.mjs"`, `node scripts/check-static.mjs`, `node scripts/run-tests.mjs`. Se tocou arquivo pré-cacheado, `V` precisa mudar.
8. Precisa de **dado inválido herdado** (órfã, blob sem referência, `due` podre)? Escreva direto na store com `rec.enc`/`rec.hist` dentro de `db.batch` — o serviço agora recusa esses estados de propósito (`src/services/debts.js:20`), e o teste que tenta criá-los pela API de negócio passa a provar outra coisa. Deixe o motivo no comentário, como em `tests/svc/dashboard.test.mjs:146-147`.
9. Mexeu em código **ou** em documentação? `node scripts/check-static.mjs --only=docs` antes de abrir PR: citação para arquivo fora do repositório, linha acima do tamanho do arquivo e caminho absoluto de máquina específica são falha (mecanismo em `scripts/check-static.mjs:402`, contrato em `tests/contracts/docs-refs.test.mjs:43`).

## 10. Não confunda

- Executar o módulo **não** é cobrir o comportamento: `reports.js` estava com linha "executada" pelo legado sem nenhuma asserção sobre o arquivo gerado.
- Cobertura **não** prova segurança: o §4, itens 2 e 3, e o `meta/session` com a DEK embrulhada estão cobertos como comportamento, mas as decisões de endurecimento continuam pendentes em `docs/ROADMAP.md` e exigem autorização do mantenedor.
- Verde na máquina **não** é verde na CI: a descoberta muda com novos subdiretórios, por isso o `run-tests.mjs` reimplementa a varredura e o gate de contagem.
