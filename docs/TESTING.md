# Testes — SCIPIONE CRED

Documento canônico sobre como testar este projeto, o que a suíte cobre de fato e onde ela **não** alcança. Escrito na branch `chore/project-audit-and-test-infrastructure` a partir do commit `e78d776`; todos os números daqui foram medidos nesta árvore de trabalho, não copiados de relatório anterior.

Runtime da medição: **Node.js v22.23.4**, `node:test` nativo, zero dependências de terceiros (regra do projeto — `package.json` não tem `dependencies`, e `tests/contracts/no-egress.test.mjs` + `scripts/check-static.mjs` bloqueiam violação).

## 1. Como executar

| Objetivo | Comando | O que faz |
|---|---|---|
| Suíte completa | `node --test "tests/**/*.test.mjs"` | 461 casos, 55 suítes, ~9,5 s. É o comando canônico. |
| Um arquivo | `node --test tests/unit/money.test.mjs` | Útil em desenvolvimento. |
| Suíte + artefatos + gate | `node scripts/run-tests.mjs` | Descobre os 27 arquivos, exige `# fail 0`, `# cancelled 0` e `# tests >= nº de arquivos`; grava TAP/JUnit/log em `artifacts/`; **exit 2** se a descoberta for vazia. |
| Checagens estáticas | `node scripts/check-static.mjs` | 35 verificações em 6 grupos: `sintaxe`, `essenciais`, `sw`, `json`, `deps`, `segredos`. |
| Cobertura | `node --test --experimental-test-coverage "tests/**/*.test.mjs"` | Informativa, sem threshold (ver §6). |

Duas invocações **não** funcionam e não devem voltar a aparecer em documentação:

- `node --test tests` falha com `MODULE_NOT_FOUND` (o runner não recursora a partir de caminho de diretório nesta versão).
- O laço que existia no README antigo — `for t in tests/*.test.mjs; do node tests/$t; done` — devolve o exit do **último** comando, portanto uma suíte vermelha terminava em verde. É exatamente o modo como o defeito do §3.2 passou despercebido.

Os Critérios de aceitação da CI rodam a suíte nos fusos `America/Sao_Paulo` e `UTC` (`fail-fast: false`) porque o vencimento depende de data local (`src/domain/due.js:2`, `src/services/dashboard.js`). A suíte está verde nos dois.

## 2. Anatomia da suíte

| Caminho | Casos | Papel |
|---|---:|---|
| `tests/*.test.mjs` (7 arquivos legados) | 26 | Scripts históricos de asserção solta; 6 deles contam como **1** caso no runner, porque nunca usaram `node:test`. Continham o único teste com rede real do repositório (§3.2). |
| `tests/unit/` (9 arquivos) | 157 | Lógica pura: `money` 18, `due` 19, `validators` 19, `address` 13, `backup-format` 32, `security` 23, `apicpf-client` 11, `live` 8, `xlsx` 14. |
| `tests/svc/` (8 arquivos) | 169 | Serviços sobre o IndexedDB simulado: `clients` 21, `debts` 17, `documents` 17, `records` 22, `backup-restore` 30, `dashboard` 17, `viacep` 16, `google-drive` 29. |
| `tests/contracts/` (3 arquivos) | 109 | Guardas estruturais: `sw-files` 59 (um caso por entrada de `FILES`), `imports` 43 (um por par de import), `no-egress` 7. |
| `tests/helpers/` (5 arquivos) | — | Infraestrutura compartilhada, descrita abaixo. |

Total: **27 arquivos `.test.mjs`, 4.570 linhas, 973 asserções, 461 casos, 0 falhas**.

### Os helpers e o que cada um simula

- `fake-idb.mjs` — stub determinístico de IndexedDB cobrindo a superfície que o app usa (13 métodos, sem cursores). Grava e lê objetos estruturados reais, respeita `keyPath` e `autoIncrement`, e reproduz o commit/abort de transação que `src/db/idb.js:30` observa. **Não** implementa: cursores, índices compostos, `versionchange` real, multiprocessos, nem a garantia de durabilidade `durability:"strict"` (o browser ignora a opção e o stub também).
- `dom.mjs` — `window`, `document`, `navigator` mínimos para módulos que tocam eventos globais. Não renderiza: não há layout, `matchMedia`, `IntersectionObserver`, `createImageBitmap` nem `URL.createObjectURL`.
- `fetch-mock.mjs` — intercepta `globalThis.fetch` com **negação por padrão**: rota desconhecida vira exceção local, nunca tentativa de conexão. Mantém log para asserção de contagem de chamadas.
- `vault.mjs` — `setup`/`unlock`/`lock` do cofre real sobre o `fake-idb`, para testes de serviço não reimplementarem criptografia.
- `fixtures.mjs` — dados 100% fictícios: CPFs/CNPJs de exemplo de documentação, nomes genéricos, e-mails em `*.invalid`, datas relativas. **Nenhum dado real de cliente entra na suíte**, e `scripts/check-static.mjs` (grupo `segredos`) recusa padrões de segredo commitado.

## 3. Estado encontrado (ETAPA 3)

### 3.1 O que os 7 testes legados realmente cobriam

Eles exercitam comportamento real — os asserts são válidos — mas como scripts de afirmação solta: o veredito era "o processo morreu em 0?". Um assert quebrado na linha 2 impedia as ~21 afirmações seguintes de rodar, e `# tests 7` nunca mudaria. `stage4.test.mjs` não tinha nome inteligível; o carregador UMD da fflate vivia dentro de `backup.test.mjs:2`; `crypto.test.mjs` referenciava o global `crypto` nu. Nada disso foi apagado: os arquivos continuam no lugar e verdes, agora com o `it` que faltava em `apicpf.test.mjs` e com os temas novos ao lado.

### 3.2 O defeito que a auditoria encontrou e foi corrigido

`tests/apicpf.test.mjs` tinha um caso "sem `APICPF_API_KEY` deve devolver 503". A atribuição era

```js
process.env.APICPF_API_KEY = undefined;   // antes
```

Em Node, isso grava a **string** `"undefined"`, que é truthy. A guarda de `api/cpf.js:20` não disparava; o handler seguia e fazia uma **requisição HTTPS real** a `https://apicpf.com/api/consulta?cpf=…` com header `X-API-KEY: undefined` e um CPF na URL. O `503` aprovado pelo teste vinha do `catch` (`api/cpf.js:43`), não da guarda: cobertura real da guarda era 0 %, e a suíte inteira dependia de rede/terceiro para passar (1,4–5,8 s só naquele arquivo).

Prova reproduzível, com espião no lugar de `fetch`: com a atribuição, `fetchCalls().length === 1` e o CPF aparece na URL; com `delete process.env.APICPF_API_KEY`, `fetchCalls().length === 0` e o status vem da linha de guarda. A correção apagou a variável, instalou o mock antes de qualquer chamada e asseriu **zero** requisições. O arquivo passou de 7 para 20 casos e de ~1,4 s para 205 ms. O caso é generalizado em `tests/contracts/no-egress.test.mjs`, que nega rede e falha se qualquer teste tentar sair.

### 3.3 Uma afirmação de documentação derrubada por teste

Enquanto se escrevia o teste de XLSX, descobriu-se que `docs/API.md` afirmava que `isoOf()` de timestamp inválido devolvia `'NaN-NaN-NaN'`. Medido em Node 22: `isoOf('não-e-data')`, `isoOf(undefined)` e `isoOf('')` lançam `RangeError: Invalid time value` (`new Date(NaN).toISOString()`), e `isoOf(null)` é coagido a `0` e devolve a época deslocada pelo fuso. A tabela de `docs/API.md` foi corrigida e o teste fixa o comportamento real de forma independente de fuso (asserção de faixa, não de valor). É um exemplo do motivo pelo qual a cobertura sozinha não basta: o módulo era "100 % executado" e a descrição estava errada.

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
| 8 | Cadastro, edição e exclusão de dívidas | `svc/debts` (17 casos) | `saveDebt` aceita `clientId` inexistente (dívida órfã) — caracterizado. |
| 9 | Cálculos financeiros e arredondamentos | `unit/money` (18: centavos, `RangeError` de valor fracionário, arredondamento), `svc/dashboard` (juros somados por dívida) | Nada a declarar: `money.js` 100/100/100. |
| 10 | Vencimentos e indicadores | `unit/due` (19: janela, meia-noite, `overdue/soon/ok`), `svc/dashboard` (17: três situações com datas relativas, janelas 3/7/30, mesmos dados em dois fusos) | `stats()` não devolve contagem de `ok` — caracterizado. |
| 11 | Backup e restauração | `unit/backup-format` (32: envelope, `FORMAT=1`, cifrado × claro, truncamento), `svc/backup-restore` (30: ida e volta com DEK diferente, `merge` × `replace`, blob ausente, `dueWindow`) | Dívida órfã torna o backup irrestaurável com erro em `INVALID` na leitura — caracterizado (D-01). |
| 12 | Exportação XLSX | `unit/xlsx` (14: ZIP desmontado, partes OOXML obrigatórias, célula numérica × `inlineStr`, estilos 164/165, escape de markup de usuário, pane congelado, larguras, relatório vazio, limite de 26 colunas) | O teste legado só gravava `/tmp/amostra.xlsx` sem asserir nada; agora a asserção existe. |
| 13 | Funcionamento offline | `contracts/sw-files` (V com formato `sc-vN` e as 52 entradas de `FILES` presentes no disco, `src/**.js` coberto), caminhos `OFFLINE` de `unit/apicpf-client` e `svc/viacep` | O `fetch` handler cache-first do `sw.js` não roda em Node. |
| 14 | Atualização do Service Worker | `contracts/sw-files` + `scripts/check-static.mjs` (grupo `sw`, incluindo a comparação `base...head` do bump de `V`) + job `estatico` da CI | Instalação/ativação de verdade (SKIP_WAITING, client reload) é comportamento de navegador. |
| 15 | Integrações externas | `unit/apicpf-client` (11), `tests/apicpf` (20, função serverless), `svc/viacep` (16), `svc/google-drive` (29) | `google-drive.js` em 52,21 % de linha: o fluxo OAuth (`connect()`/`preload()`) depende do script da Google e não é instanciável em Node. |

## 5. Cobertura medida

Relatório do Node (`--experimental-test-coverage`) sobre os 38 módulos de aplicação (`src/**.js` + `api/cpf.js`): **25 módulos carregados por pelo menos um teste, média de 96,50 % de linha entre os medidos**.

Abaixo de 100 % de linha: `src/services/google-drive.js` 52,21 %, `src/export/reports.js` 76,19 %, `src/security/auth.js` 84,06 %. Abaixo de 80 % de ramo: `src/files/process.js` 70,59 %, `src/export/lib.js` 75,00 % (carregador de script injetado — DOM), `src/security/auth.js` 75,00 %, `src/services/search.js` 85,71 %.

**Sem nenhuma medição (13 módulos):** `src/main.js`, `src/pwa.js` e os 11 arquivos de `src/ui/`. Eles formam a camada de apresentação e o bootstrap: só instanciam quando existe DOM real, `matchMedia`, `createImageBitmap`, `IntersectionObserver` e ciclo de vida de Service Worker. Não há como medir isso com `node:test` + stub sem mentir sobre o que está sendo provado, e o `dom.mjs` declara explicitamente esses limites em vez de fingir cobertura. São, portanto, o alvo natural da suíte de navegador descrita no §7 — e a razão de a cobertura não ser gate no §6.

## 6. Por que a cobertura é informativa e não bloqueante

O projeto tem 1,7 mil linhas de aplicação e uma regra de ausência de build/dependências. Um threshold artificial faria a equipe escrever asserção vazia para subir número — exatamente o que a auditoria pediu para não acontecer. O gate da CI é: (a) todos os casos passam; (b) `# tests >= número de arquivos descobertos` (arquivo sem caso é arquivo que não rodou); (c) `# cancelled 0`; (d) checagens estáticas; (e) o contrato de `V`/`FILES`. A cobertura entra como artefato e comparação entre execuções.

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

## 8. Testes de caracterização

26 marcações `// conhecido: ver docs/ROADMAP.md` em 10 arquivos fixam comportamento **indesejado mas real**: dívida órfã aceita, `saveDebt` sem validação de cliente, dedupe de documento só por `clientId+hash`, blob órfão em `removeDoc`, `setDueWindow('abc')` gravado sem validar, `parseRate('1001')` acima do máximo, `status(due, undefined)` que nunca dá `soon`, `validate()` que aceita `principal` como string, `lock()` que não apaga `meta/vault`, cache do ViaCEP sem TTL, config OAuth em claro no `localStorage`, 26 colunas no XLSX, entre outros.

A regra é explícita: **nunca** deixar um teste vermelho para denunciar um problema conhecido. Vermelho permanente ensina a ignorar a CI. Quando o bug for corrigido, o teste de caracterização falha de propósito e obriga quem corrigiu a atualizar a asserção e o `docs/ROADMAP.md`.

## 9. Como escrever um teste novo

1. Escolha a camada: `unit/` (função pura, sem banco), `svc/` (usa `fake-idb` + `vault`), `contracts/` (estrutura do repositório).
2. Importe `tests/helpers/fixtures.mjs` para dados e **nunca** escreva um CPF/nome próprio no teste: os valores de exemplo são os de documentação (`529.982.247-25`, `11.222.333/0001-81`), sempre com e-mail `*.invalid`.
3. Precisa de cofre aberto? Use `await unlockVault()` do `vault.mjs` e `lockNow()` no `after` — sem isso, o timer de inatividade do `auth.js` mantém o processo vivo.
4. Precisa de rede? Use `installFetchMock({ routes })`. Rota fora do mock **lança**: se quer que falhe, deixe lançar; se quer assentar que não chamou, use `fetchCalls()`.
5. Datas: derive de `todayISO()` em vez de fixar `'2026-11-17'`, senão o teste envelhece e quebra de madrugada ou em outro fuso.
6. As asserções devem ser **específicas** (valor, código de erro, contagem de chamadas). `assert.ok(x)` de objeto sem verificar campo é o padrão que a auditoria criticou no legado.
7. Antes de abrir PR: `node --test "tests/**/*.test.mjs"`, `TZ=UTC node --test "tests/**/*.test.mjs"`, `node scripts/check-static.mjs`, `node scripts/run-tests.mjs`. Se tocou arquivo pré-cacheado, `V` precisa mudar.

## 10. Não confunda

- Executar o módulo **não** é cobrir o comportamento: `reports.js` estava com linha "executada" pelo legado sem nenhuma asserção sobre o arquivo gerado.
- Cobertura **não** prova segurança: o §4, itens 2 e 3, e o `meta/session` com a DEK embrulhada estão cobertos como comportamento, mas as decisões de endurecimento continuam pendentes em `docs/ROADMAP.md` e exigem autorização do mantenedor.
- Verde na máquina **não** é verde na CI: a descoberta muda com novos subdiretórios, por isso o `run-tests.mjs` reimplementa a varredura e o gate de contagem.
