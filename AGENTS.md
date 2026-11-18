# AGENTS.md — manual operacional para agentes de programação

Leia inteiro antes de tocar em qualquer arquivo. Cada afirmação aqui tem `arquivo:linha`; se a sua mudança
fizer alguma linha desta página mentir, corrija esta página na mesma entrega. Em conflito, o código vence; em
dúvida de intenção, `docs/ARCHITECTURE.md` vence; o que não confirmou, marque `NÃO CONFIRMADO`.

## 0. Identidade do projeto

PWA offline-first de gestão de clientes e dívidas. ES Modules puros, **sem build, sem npm, sem framework**
(`package.json:1` = `{"type":"module","private":true}`). Dados em IndexedDB com **cofre cifrado** no aparelho
do usuário (PBKDF2-HMAC-SHA256 600000 + AES-GCM 256, `src/security/crypto.js:4,6`). Publicado como estático
na Vercel com uma única função serverless, `api/cpf.js`. Interface pt-BR, dark, dourado/marfim. Stack real:
HTML5 + CSS3 + JS de navegador, Web Crypto, Service Worker + `manifest.json`, `vendor/fflate.min.js` (única
lib, 0.8.2, global injetado em runtime por `src/export/lib.js:2-4`), testes em `node:test`/`node:assert`.

**Rodar local:** `python3 -m http.server 8080` na raiz e abrir `http://localhost:8080` — SW e Web Crypto exigem
contexto seguro; abrir `index.html` como arquivo não funciona. **Instalar:** Chrome/Edge pelo ícone da barra de
endereço; iOS por Safari › Compartilhar › Adicionar à Tela de Início; Android pelo menu (`src/pwa.js:2-9`; a UI
de instalação existe só em `src/ui/settings.js:58`).

## 1. Entender a arquitetura antes de modificar

Ordem obrigatória de leitura: **este arquivo → `docs/ARCHITECTURE.md` → `docs/PROJECT_MAP.md` → o doc da área
(`docs/DATABASE.md`, `docs/API.md`, `docs/SECURITY.md`, `docs/TESTING.md`) → o código do arquivo de entrada →
os arquivos que importam o que você vai mudar (item 3).** `docs/SECURITY.md` é leitura obrigatória se a
mudança encosta em cofre, sessão, rede, headers ou backup. Camadas reais e direção de import (N só importa
N-1 ou inferior):

| # | Camada | Caminho / evidência |
|---|---|---|
| 1 | Entrada, primitivo `h`, gate de boot | `index.html`, `src/main.js` (`main.js:5`, `:63`, `:65`) |
| 2 | Shell e navegação | `src/ui/shell.js` (`shell.js:28-36`, destaque `:53-54`) |
| 3 | Telas | `src/ui/*.js` |
| 4 | Serviços / regra de negócio | `src/services/*.js` |
| 5 | Domínio puro | `src/domain/*.js` |
| 6 | Persistência | `src/db/idb.js` (zero imports) |
| 7 | Segurança | `src/security/crypto.js`, `src/security/auth.js` |
| 8 | Exportação / arquivos | `src/export/*.js`, `src/files/process.js` |
| 9 | PWA | `sw.js`, `src/pwa.js`, `manifest.json` |
| 10 | Serverless | `api/cpf.js` |

Não existe roteador nem URL por tela: a tela é o conteúdo de `#app` e o destaque do menu é lido do DOM
(`shell.js:52-54`). O estado global é um único callback (`src/core/live.js:2-3`).

## 2. Identificar os arquivos envolvidos

A coluna da direita **não é opcional**: são os arquivos que mudam JUNTO (regra dos 4 toques, item 6).

| Quero mudar… | Arquivo de entrada | Atualizar JUNTO |
|---|---|---|
| Uma tela (layout/fluxo) | `src/ui/<tela>.js` (mapa em `docs/PROJECT_MAP.md`) | `main.js:65` se novo destino; `shell.js:28-36` se novo item; `sw.js:2` |
| Campo do formulário de cliente | `src/ui/clients.js:59-68` + payload `src/ui/clients.js:46` | `src/services/clients.js:5` (`LABEL`) e `:7-14` (`validate`), perfil `src/ui/clients.js:170`, busca `src/services/search.js:3-4`, `sw.js:2` |
| Campo do formulário de dívida | `src/ui/debts.js:28-35` | `src/services/debts.js:4` (`rec` — **whitelist**: fora dela o campo é descartado em silêncio), `:3`, `:7-13`, `src/ui/debtspage.js:17-20` |
| Um store ou índice | `src/db/idb.js:2-9` (acrescentar função no fim; nunca editar as antigas, `idb.js:1`) | `src/export/backup-format.js:5` (`LISTS`), `src/export/backup.js:5-9,15-18`, `docs/DATABASE.md`, `sw.js:2` |
| Regra de vencimento | `src/domain/due.js:5` | `src/services/dashboard.js:5-6`, `src/ui/debtspage.js:11,16-17`, `src/ui/dashboard.js:13-16`, janela `src/services/settings.js:2`, testes de `due` |
| Moeda / R$ / juros | `src/domain/money.js:3-9` | `src/services/debts.js:5-6`, telas que importam `money.js`, colunas do Excel `src/export/reports.js:16-18` |
| Conteúdo do backup | `src/export/backup.js:4-10` | `src/export/backup-format.js:12-18`, `:20-27` (`validate`), UI `src/ui/tools.js:31-208` |
| Restauração (merge/replace) | `src/export/backup.js:12-30` | `LISTS`, `src/ui/tools.js:161-166`, `docs/DATABASE.md` |
| XLSX (abas, colunas, estilos) | `src/export/reports.js:14-21` | `src/export/xlsx.js:7-8` (índices de estilo), `src/ui/tools.js:17`; teto de 26 colunas em `xlsx.js:5` |
| Service Worker (estratégia) | `sw.js:3-5` | `sw.js:2` (`V` e `FILES`), `vercel.json:5-15`, teste manual offline |
| Arquivo novo no app | o arquivo em `src/` | **`sw.js:2`: adicionar a `FILES` E incrementar `V`** (`sw.js:1`) |
| `manifest.json` (nome, ícones, cor) | `manifest.json:1` | `index.html:4,6-7`, `sw.js:2`, `docs/screenshots/`, `README.md` |
| CSP e headers | `index.html:3` (meta) e `vercel.json:3-60` | `docs/SECURITY.md`; **EXIGE AUTORIZAÇÃO** (item 5) |
| Função `/api/cpf` | `api/cpf.js` | `src/services/apicpf.js:24-41` (contrato), `.env.example:3`, `docs/apicpf.md`, `docs/API.md`, `tests/apicpf.test.mjs` |
| Ícone da UI | `src/ui/icons.js:2-41` | `shell.js:5-9` se quiser auto-aplicação por rótulo; `sw.js:2`; nome errado cai em `info` (`icons.js:47`) |
| Token de cor | `css/app.css:5-19` | literais que fura o token: `#080808` em `css/ui.css:13,28,70,195,391,412`, hover `#272420` em `ui.css:96,121,133`, `theme-color` `index.html:4`, `manifest.json:1` |
| Breakpoint | `css/ui.css` (`:3` = contrato das faixas; `:500` tablet 768, `:519` desktop 1100, `:537` formulários 720, `:554` config 1200) | `docs/README.md:28`, `sw.js:2`; **não** misture `max-width:X` com `min-width:X` no mesmo componente (`ui.css:130` vs `:181`) |
| Autenticação / desbloqueio / lockout | `src/security/auth.js:24-36` | `src/main.js:11-43`, `src/security/crypto.js`, `docs/SECURITY.md`; **EXIGE AUTORIZAÇÃO** |
| Auto-lock por inatividade | `src/security/auth.js:58-64` | `src/ui/settings.js:28-29` (1/5/15/30 min), `saveSession` `auth.js:50-57`; **EXIGE AUTORIZAÇÃO** |
| Integração externa nova | `src/services/<novo>.js` (modelo `src/services/viacep.js`) | **`connect-src` em `index.html:3`** (sem isso o navegador bloqueia em silêncio), `sw.js:2`, `docs/API.md` |
| Google Drive (escopo, pasta, nome) | `src/services/google-drive.js:6-11` | `src/config/google.js:5-10`, CSP `index.html:3`, `src/ui/tools.js:63-192`, `docs/google-drive.md`; **EXIGE AUTORIZAÇÃO** |
| Relatório impresso / visual | `css/app.css:41-57,59-74` | `src/ui/tools.js:8-29`, `src/export/reports.js` |
| Navegação / menu | `src/ui/shell.js:28-36` | mapa `data-page→data-k` `shell.js:53`, `css/ui.css:500,519`, `main.js:65` |
| Fotografia do cliente | `src/services/clients.js:20-22` | `src/ui/kit.js:8-16` (`filePicker`), `.media-field` `css/ui.css:164-186`, `src/files/process.js` (`force:true,maxSide:512`), `src/ui/avatar.js` |
| Busca de clientes | `src/services/search.js:3-4` | `src/ui/clientlist.js:22-28`, `src/ui/dashboard.js:40` |
| Validação de CPF/CNPJ | `src/domain/validators.js:2-5` | `src/services/clients.js:10-11` e `api/cpf.js:17` — **compartilhado com o servidor**: não adicione dependência de browser aqui |

## 3. Verificar dependências

Grafo real: **74 nós, 204 arestas internas (107 de app + 97 de testes e scripts), 0 ciclos, 0 imports
quebrados**; os únicos especificadores externos são `node:*` em `tests/` e `scripts/` — nenhum em código de
aplicação. A contagem evoluiu porque o número de arquivos de teste cresce nesta branch; a v1 do extrator
(47 nós/57 arestas) **estava subcontada** porque a regex ancorava no início da linha e perdia imports
múltiplos na mesma linha (`src/main.js:3`, `src/ui/clients.js:1`, `src/ui/tools.js:1`).
Números canônicos: `docs/ARCHITECTURE.md` §2. Reconstruir:

```sh
python3 /home/ubuntu/audit/deps.py     # fora do repo: artefato da auditoria, não é entregável
for f in $(find api src tests -type f \( -name '*.js' -o -name '*.mjs' \) ! -name sw.js); do  # uma aresta por linha
  grep -oE "['\"]\.\.?/[^'\"]+['\"]" "$f" | tr -d "'\"" | while read -r d; do
    printf '%s -> %s\n' "$f" "$(realpath -m --relative-to=. "$(dirname "$f")/$d")"; done
done | sort -u                          # o total sobe conforme entram suítes novas: confira contra docs/ARCHITECTURE.md
```

Regras que **não podem ser invertidas**: `src/domain/*` só importa `src/domain/*` (`src/domain/address.js:1` é a
única aresta do diretório); `src/db/idb.js` é folha; serviços nunca importam UI; UI nunca importa `src/db/idb.js`
nem `src/security/crypto.js` — as duas exceções estão em Configurações (`src/ui/settings.js:2,4`, só no teste de
integridade `:30-36`); `api/cpf.js` só enxerga `src/domain/validators.js` (`api/cpf.js:1`). Aresta ascendente
nova ⇒ **PARE**.

| Módulo | fan-in | Por que é perigoso |
|---|---:|---|
| `src/domain/validators.js` | 9 | UI, serviços **e** a função serverless |
| `src/ui/icons.js` | 9 | todas as telas; `icon()` silencioso em nome errado (`icons.js:47`) |
| `src/security/auth.js` | 9 | `getKey()` (`auth.js:14`) está no caminho de toda leitura decifrada |
| `src/domain/money.js` | 8 | formatadores e `interest()` em 6 telas + Excel |
| `src/core/live.js` · `src/ui/kit.js` · `src/db/idb.js` · `src/services/clients.js` | 7 cada | callback único global; componentes compartilhados; schema; cadastro+cascata |
| `src/services/records.js` · `debts.js` · `src/security/crypto.js` | 5 cada | envelope cifrado (`records.js:7`); `rec()` é whitelist (`debts.js:4`); primitivas do cofre — **EXIGE AUTORIZAÇÃO** |

## 4. Preservar regras de negócio

| Invariante | Onde | O que NÃO fazer |
|---|---|---|
| Dinheiro é **inteiro em centavos**; `interest` usa `BigInt` e **lança `RangeError`** em fracionário | `src/domain/money.js:9` (medido na auditoria 2 §4.1) | Não converter para float; não arredondar na entrada; não persistir `interest` — ele é derivado (`src/services/debts.js:5-6`) |
| Taxa em centésimos de ponto percentual, `0 < rate ≤ 1000%` | `src/domain/money.js:1-2`, `src/services/debts.js:10` | Não aceitar taxa 0; não trocar a unidade |
| `due` é **obrigatório**; `due` ausente **lança `TypeError`** e derruba `stats()` | `src/services/debts.js:12`, `src/domain/due.js:2`, `src/services/dashboard.js:5` | Não relaxar a validação nem gravar dívida sem `due` por caminho alternativo |
| `date`/`due` são ISO `AAAA-MM-DD` **sem fuso**; "hoje" vem do aparelho | `src/services/debts.js:2`, `src/domain/due.js:2-3` | Não usar `new Date().toISOString()` direto; não introduzir horário local |
| Vencimento: `n<0` vencida, `0≤n≤janela` prestes, resto em dia; janela default 7 | `src/domain/due.js:5`, `src/services/settings.js:2` | Não mudar limiar sem atualizar `src/ui/debtspage.js:16-17` e `src/ui/dashboard.js:13-16` |
| CPF/CNPJ por dígito verificador, únicos por cadastro | `src/domain/validators.js:2-5`, `src/services/clients.js:10-11` | Não trocar por regex de máscara; a unicidade é checada fora da transação (item 4 da tabela de armadilhas) |
| Excluir cliente apaga dívidas + documentos + blobs + histórico + cliente em **uma** transação | `src/services/clients.js:31-35` → `db.batch` (`src/db/idb.js:27-30`) | Não excluir `clients` sem os demais; não esquecer os `blobs` (`clients.js:33,35`) |
| `saveDebt` **aceita `clientId` inexistente** (dívida órfã possível) | `src/services/debts.js:14-16` | Não "consertar" de carona: é achado registrado em `docs/ROADMAP.md`; mexer aqui é mudança de regra de negócio |
| `history` é append-only; só a cascata do cliente apaga evento | `src/services/records.js:10`, `src/services/clients.js:34` | Não criar "limpar histórico"; não reescrever `type`/`detail` antigos |
| Duplicidade de anexo checada por SHA-256 **fora** da transação | `src/services/clients.js:40`, `src/files/process.js:7` | Não mover a checagem para dentro do `batch` sem teste de regressão |
| Só `id`/`createdAt`/`clientId` ficam em claro; o resto vai cifrado em `data` | `src/services/records.js:4,7` | Não promover campo novo para o envelope em claro sem análise em `docs/SECURITY.md` |

## 5. Preservar os mecanismos de segurança

KDF **PBKDF2-HMAC-SHA256, 600000 iterações** (`src/security/crypto.js:4`; o mesmo número no backup:
`src/export/backup-format.js:5`). Cifra **AES-GCM 256** (`crypto.js:6,9,15,17,22`). **Envelope KEK→DEK**: DEK
aleatória, não extrativel, embrulhada pela KEK derivada da senha; a senha nunca é guardada — senha correta =
`unwrapKey` destranca pela tag do GCM (`crypto.js:2,6-16`, `src/security/auth.js:28`). **IV de 12 bytes novo
por gravação**, prefixado ao ciphertext (`crypto.js:17-18`). Renderização 100% por `createElement` com o
primitivo `h` (`src/main.js:5`): **zero** ocorrências de `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
`document.write`, `eval`, `srcdoc` ou `javascript:` no app. Nenhum segredo no cliente: `APICPF_API_KEY` só é
lida no servidor (`api/cpf.js:19`) e `.env.example:3` está vazia; `client_secret` é descartado no import
(`src/services/google-drive.js:41`) e bloqueado em `.gitignore:5-8`; **token do Drive só em memória**
(`google-drive.js:14,101-103`, zerado em `:19,:115,:139`) com escopo mínimo `drive.file` (`:8`). Headers de
produção em `vercel.json:3-60` (`sw.js` com `no-store` + `Service-Worker-Allowed: /`, `nosniff`, `no-referrer`,
`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`); a CSP rica vive em `index.html:3`. Riscos: `docs/SECURITY.md`.

**Regra: se a mudança enfraquecer qualquer um desses pontos, PARE e peça autorização.**

EXIGE AUTORIZAÇÃO: editar `src/security/crypto.js` ou `auth.js` (cofre, sessão, lockout, auto-lock); alterar
`ITER`, algoritmo, salt/IV ou o registro de `meta` (`crypto.js:4,6,17`; `auth.js:21,55`); mudar formato de backup
ou `FORMAT` (`backup-format.js:5,32`); schema (`idb.js:2-9`); `LISTS` ou envelope cifrado (`backup-format.js:5`,
`records.js:7`); CSP/headers (`index.html:3`, `vercel.json`); escopo ou destino do Drive (`google-drive.js:6-11`);
rota que apague dados em massa (`backup.js:15`, `clients.js:31-35`); política de senha (`src/main.js:19`).

## 6. Fazer alterações pequenas e controladas

Um commit por mudança coerente; diff mínimo. **Sem refatoração de carona, sem renomear arquivos, sem apagar
arquivos, sem mudar design, sem framework novo, sem dependência nova, sem `npm install`.** Identidade visual e
faixas de tela são contrato: paleta e tipografia (`css/app.css:5-19`), fontes locais em `assets/fonts/`, marca
inteira sem recorte nem contorno (`docs/README.md:39`), estética sem bordas (`css/ui.css:61,92`), faixas
`<768 / 768-1099 / ≥1100` (`css/ui.css:3,500,519`), paginação 20/10/5 (`src/ui/clientlist.js:3`,
`src/ui/debtspage.js:4`, `src/ui/clients.js:146`).

Branch: `git switch -c <tipo>/<assunto>` a partir de `main`; trabalhe na branch e abra PR. **Nunca faça merge em
`main`** (decisão humana) e **não faça deploy** — não há CI de publicação e ela é manual (`README.md:230-248`).

**Regra dos 4 toques.** Mudou arquivo pré-cacheado? 1) edite o arquivo, 2) confira se ele está em `FILES`
(`sw.js:2`), 3) **adicione o caminho** se não estiver, 4) **increment `V`** (`sw.js:2`, hoje `sc-v69`).
Violações reais: `ef4b96f`, `ff247af`, `922f584` (todos em `src/config/google.js`) e `ba6227b` (`css/ui.css` +
`src/ui/clients.js`) mexeram em arquivos listados em `FILES` **sem** tocar `sw.js`/`V`; como o `fetch` é
cache-first puro e não escreve em runtime (`sw.js:5`), o app instalado serve o arquivo velho indefinidamente.
`node scripts/check-static.mjs --only=sw` verifica isso; não pule.

## 7. Executar os testes relacionados

Runtime verificado: **Node v22.23.4**.

```sh
node --test "tests/unit/money.test.mjs"       # um arquivo
node --test "tests/unit/*.test.mjs"           # por área: unit
node --test "tests/svc/*.test.mjs"            # serviços, com fake de IndexedDB
node --test "tests/contracts/*.test.mjs"      # contratos externos
node --test "tests/**/*.test.mjs"             # CANÔNICO — roda tudo
node --test tests/*.test.mjs                  # só os legados na raiz de tests/
```

**PROIBIDO:** `node --test tests` — neste runtime falha com `Cannot find module '…/tests'`, `# fail 1`,
exit 1 (medido); e o laço `for t in …; do node tests/$t.test.mjs; done` — o código de saída de um laço `for` é
o do **último** comando, então falha anterior vira verde (medido: exit 0 com uma iteração falsa no início).
Ambos estão proibidos em `README.md:316` e `docs/README.md:22`. Terceiro modo de ficar verde sem testar nada:
glob que não casa nada roda **zero** arquivos com exit 0 — leia o `# tests` do sumário antes de afirmar coisa.

Sob fuso: `TZ=America/Sao_Paulo node --test "tests/**/*.test.mjs"` e depois `TZ=UTC` (a matriz do CI faz isso,
`.github/workflows/ci.yml:161-185`), porque `src/domain/due.js:3` depende do fuso do aparelho.

## 8. Executar os testes de regressão

Sequência mínima **antes de qualquer PR**, toda ela verde:

1. `node scripts/check-static.mjs` — essenciais, sintaxe, `V`/`FILES` vs disco, JSON, grafo, segredos.
2. `node scripts/run-tests.mjs` — descobre os testes, roda sem shell, grava `artifacts/results.tap` e **relê** o TAP.
3. `node --test "tests/**/*.test.mjs"` — o comando canônico, para ver o sumário com seus próprios olhos.
4. `find api src tests scripts vendor sw.js -name '*.js' -o -name '*.mjs' | xargs -n1 node --check`.
5. **Cofre à mão:** limpar o site em `localhost:8080`, criar cofre, bloquear, desbloquear, recarregar a aba — a
   sessão persiste na mesma aba e morre em aba nova (`src/security/auth.js:38-48`).
6. **Backup → restore round-trip:** gerar com senha, restaurar em *merge* e em *replace*, conferir contadores e
   fotografia (`src/export/backup.js:12-30`, `src/export/backup-format.js:28-44`).
7. **Instalação/offline:** instalar, derrubar a rede, navegar por todas as telas, gerar XLSX e backup local.

O gate de CI é bloqueante de propósito: cada passo declara `set -euo pipefail` (sem ele, `node --test … | tee`
devolve o exit do `tee`, que é 0 com a suíte vermelha), não há `|| true` nem `continue-on-error` no job de
testes, e o TAP é **relido** exigindo `# fail 0` e `# cancelled 0` (`.github/workflows/ci.yml:216-238`,
`scripts/run-tests.mjs:10-22`).

## 9. Atualizar a documentação

| Mudança | Doc |
|---|---|
| Store, índice, formato de registro, transação | `docs/DATABASE.md` |
| Módulo novo, arquivo novo, função pública movida | `docs/PROJECT_MAP.md` |
| Camada, fronteira, dependência, decisão estrutural | `docs/ARCHITECTURE.md` |
| Endpoint ou contrato externo (`/api/cpf`, ViaCEP, Drive) | `docs/API.md` (+ `docs/apicpf.md`, `docs/google-drive.md`) |
| Achado, risco ou mitigação de segurança | `docs/SECURITY.md` |
| Teste novo, harness, convenção de suíte | `docs/TESTING.md` |
| Decisão adiada, feature, bug de caracterização | `docs/ROADMAP.md` (prefijos `S-`, `D-`, `P-`, `A-`, `Q-`, `I-`, `DOC-`) |
| **Toda entrega** | `docs/CHANGELOG.md` |

Nenhuma afirmação técnica sem `arquivo:linha`. Não duplique o conteúdo desses documentos — aponte para eles.

## 10. Registrar todas as modificações

Commit: imperativo, em inglês, frase curta sem prefixo de convenção, igual aos 64 commits do histórico
("`Use the upload glyph and center icon with label in the photo picker`", "`Group client form into personal
data and address sections`"). Um commit = uma mudança. Tocou `sw.js`, registre no corpo (`Cache: sc-v69 → sc-v70`).

`docs/CHANGELOG.md` é mantido **à mão**, no formato Keep a Changelog (`Added`/`Changed`/`Fixed`/`Deprecated`/
`Removed`/`Security`), com link para o doc da área e para os `arquivo:linha` afetados. No PR escreva: **o quê**
mudou; **por quê**; **risco** (baixo/médio/alto + superfície: cofre, schema, backup, UI, rede); **impacto para
quem já instalou o app** (precisou de bump de `V`? tem migração? backup antigo restaura?); **testes executados**
(comandos reais e resultado, incluindo os 7 passos do item 8).

Descobriu um bug que não é da sua mudança? **Não conserte de carona.** Registre como *characterization* em
`docs/ROADMAP.md` (e `docs/SECURITY.md` se for de segurança) com `arquivo:linha`, repro e comportamento atual.

## Travas inegociáveis (regras do cliente)

1. Não reescrever a aplicação. 2. Não alterar o design. 3. Não modificar regras financeiras. 4. Não alterar
estrutura de dados sem necessidade comprovada. 5. Não mudar o funcionamento do cofre. 6. Não remover
funcionalidades. 7. Não substituir bibliotecas sem justificativa. 8. Não apagar arquivos. 9. Não modificar dados
de usuários. 10. Não publicar segredos. 11. Não fazer deploy. 12. Não fazer merge automático em `main`.

## Pare e peça autorização quando…

- Criar, remover ou alterar store/índice/keyPath (`src/db/idb.js:2-9`) — qualquer migração de schema.
- Tocar iterações, algoritmo, formato do envelope, tamanho de salt/IV ou o registro de `meta`
  (`src/security/crypto.js:4-18`, `src/security/auth.js:21,55`).
- Adicionar dependência (npm, CDN, vendor, framework) — inclusive "só para testes".
- Alterar CSP (`index.html:3`), headers (`vercel.json:3-60`), `connect-src` ou `frame-src`.
- Mudar `FORMAT`, `LISTS` ou os nomes das entradas do ZIP (`src/export/backup-format.js:5,12-18`).
- Mexer em fluxo de pagamento, cálculo de juros, política de vencimento ou janela de cobrança (§4).
- Criar rota destrutiva em massa (apagar cofre, `restore replace`, exclusão de cliente/documento).
- Alterar escopo OAuth, `clientId` ou destino dos backups no Drive (`google-drive.js:6-11`).

## Mapa de dependências

```text
index.html ─▶ src/main.js ─▶ src/ui/shell.js ─▶ src/ui/icons.js
                  │             └─ (lê data-page do DOM: shell.js:52-54)
                  ├─▶ src/pwa.js            sw.js  (sem imports; FILES lista tudo)
                  ├─▶ src/security/auth.js ─┬─▶ src/db/idb.js        (folha)
                  │                         └─▶ src/security/crypto.js
                  └─▶ src/ui/* ─▶ src/services/* ─▶ src/domain/*     (folha)
                        │              │      └────▶ src/db/idb.js
                        │              └───────────▶ src/security/auth.js (getKey)
                        └─▶ src/export/* ─▶ src/files/process.js
   src/export/lib.js ┄┄▶ vendor/fflate.min.js   (injetado por <script>, lido do global — invisível ao grafo)
   api/cpf.js ─▶ src/domain/validators.js       (única aresta servidor→app)
   Regra: N importa N-1 ou inferior. Domínio e idb.js são folhas. Zero ciclos.
```

Fan-in verificado: `validators.js` 9 · `icons.js` 9 · `auth.js` 9 · `money.js` 8 · `live.js` 7 · `kit.js` 7 ·
`idb.js` 7 · `clients.js` 7 · `records.js` 5 · `debts.js` 5 · `crypto.js` 5 · `due.js` 4 · `settings.js` 3 ·
`lib.js` 3 · `address.js` 3. Aresta a aresta: `docs/ARCHITECTURE.md` §2 e `docs/PROJECT_MAP.md`.

## Armadilhas conhecidas

- **Cache-first sem runtime caching** (`sw.js:5`): arquivo fora de `FILES` funciona online e **quebra offline**
  em silêncio; `c.addAll` é tudo-ou-nada (`sw.js:3`), uma entrada errada derruba a instalação inteira.
- **`db.put`/`db.del` NÃO emitem `data-changed`** — só `db.batch` emite (`src/db/idb.js:30` vs `:24-25`), e
  `batch([])` também não emite (`:27`). Trocar a janela de vencimentos (`src/services/settings.js:3`) ou o
  auto-lock (`auth.js:49`) não revalida a tela aberta.
- **O menu perde `aria-current`** em `new-client`, `edit-client` e `edit-debt`: o mapper ancora no início da
  string (`src/ui/shell.js:53`) e nenhum `data-k` casa (`shell.js:31-36`).
- **O índice `history.at` nunca é gravado**: `src/db/idb.js:8` o cria, mas `hist()` grava `createdAt`
  (`src/services/records.js:10`). Índice morto — não consulte por ele.
- **`fflate` sem fallback** (`src/export/lib.js:2-4`): se o `<script>` não carregar, backup e Excel somem; e o
  ramo "Biblioteca inválida" **não** descarta a promise em cache, então a falha persiste até recarregar.
- **`align-content` da fotografia**: em `.media-field .file-pick`, `align-content:center` (`css/ui.css:175-176`)
  é o que impede as linhas do grid de esticarem e afastarem o ícone do texto. Mexer no CSS do campo sem reler o
  comentário desfaz o alinhamento da prévia (commits `c3d06be`, `584ce89`, `e78d776`).
- **Rótulo é chave de ícone**: `src/ui/shell.js:5-9` casa `textContent` com regex (`^Novo cliente`,
  `^Excluir|Remover`, `^Restaurar`). Renomear botão troca ou perde o ícone e o estilo `.danger` em silêncio.
- **Colisão em exatamente 560px**: `max-width:560` (`css/ui.css:130,281,364`) e `min-width:560` (`:84,181`).
- **Duplicidade checada fora da transação**: dois cadastros concorrentes com o mesmo CPF passam
  (`src/services/clients.js:17`→`:27`), porque nenhum índice é `unique` (`src/db/idb.js:5`).
- **`listDebts` ordena por `date`, não por `due`** (`src/services/debts.js:6`) — não existe ordenação por
  vencimento no app. **`settings` e `meta` não passam por `enc()`** (`src/services/settings.js:3`,
  `src/security/auth.js:21`): ficam em texto claro.
- **Doc ≠ código:** `docs/README.md:28` diz "barra inferior até 719px"; o código usa 768px (`css/ui.css:500`).
- **`icon('nome-errado')` não lança**: cai em `info` (`src/ui/icons.js:47`); e `setDueWindow` grava qualquer
  valor sem validar (`src/services/settings.js:3`), o que degrada o cálculo de `status()` (`src/domain/due.js:5`).

## Checklist de PR

- [ ] Li `docs/ARCHITECTURE.md` + `docs/PROJECT_MAP.md` da área, e `docs/SECURITY.md` se toquei cofre/rede.
- [ ] O diff é a menor mudança que resolve o problema; nenhuma refatoração de carona.
- [ ] Nenhum arquivo renomeado, movido ou apagado; nenhuma dependência nova.
- [ ] Tocou arquivo pré-cacheado? `FILES` atualizado **e** `V` incrementado (`sw.js:2`); tocou formulário?
  `LABEL`/`rec()`/`validate` do serviço acompanharam (item 2).
- [ ] Tocou schema, cofre, backup, CSP ou escopo OAuth? autorização explícita obtida **antes** (item 5).
- [ ] Nenhuma regra financeira mudou (centavos, taxa, juros, `due`, janela de vencimento).
- [ ] `node scripts/check-static.mjs` e `node scripts/run-tests.mjs` verdes; `node --test "tests/**/*.test.mjs"`
  verde em `TZ=America/Sao_Paulo` **e** `TZ=UTC`.
- [ ] Round-trip backup→restore e instalação→offline testados à mão quando a mudança os alcança (item 8).
- [ ] Docs do item 9 atualizados com `arquivo:linha`; `docs/CHANGELOG.md` atualizado; PR descreve risco,
  impacto para usuário instalado e testes executados (itens 9 e 10).
- [ ] Bugs achados de passagem estão registrados em `docs/ROADMAP.md`, não consertados neste PR.
