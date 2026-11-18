# PROJECT_MAP — SCIPIONE CRED (offline)

## 1. Como ler este mapa

Este documento responde a uma única pergunta: **onde eu modifico esta funcionalidade?** Comece pela seção 3 (Funcionalidade → arquivos); cada linha aponta `arquivo:linha` do ponto de entrada real. Use as seções 2, 4 e 5 quando precisar do entorno de um arquivo (o que ele importa e quem o importa).

Referência: branch `chore/project-audit-and-test-infrastructure`, commit **e78d776** (17/11/2026 19:28 UTC) — mapa gerado em 17/11/2026. Base mecânica: `python3 /home/ubuntu/audit/deps.py` (v2, que conta imports múltiplos na mesma linha) => **74 nós, 204 arestas internas (107 app + 97 testes/scripts), 0 quebrados, 0 ciclos**, com 8 especificadores externos do Node (lista na seção 4). Os números foram conferidos por recálculo independente e batem. Arquivos versionados em `git ls-files`: **87** (excluindo `.git`); a branch acrescenta **36 arquivos** de documentação técnica, infraestrutura de testes e CI, inventariados no fim da seção 2.

---

## 2. Inventário dos arquivos versionados (87)

"Quem importa": para JS/MJS é o mapa reverso de `import` / `export ... from` / `import()`; para os demais, quem referencia o arquivo (HTML, CSS, service worker, README).

| Arquivo | Linhas · tamanho | Papel | Quem importa / referencia |
|---|---|---|---|
| **(raiz) — 9** | | | |
| `.env.example` | 3 · 166 B | Modelo da variável `APICPF_API_KEY` (uso só serverless) | `api/cpf.js:19` via `process.env`; `docs/apicpf.md` |
| `.gitignore` | 8 · 86 B | Ignora `.vercel`, `node_modules`, `client_secret*.json`, `.env*` | somente git |
| `.nojekyll` | 0 · 0 B | Arquivo vazio que desativa o processador Jekyll | — |
| `README.md` | 319 · 15,7 KB | Entrada pública: galeria (`:34-75`), árvore do projeto (`:163-202`), rodar local (`:216-218`), testes (`:292-294`) | — |
| `index.html` | 11 · 1,9 KB | Documento único: CSP (`:3`), fontes/tema (`:4-6`), CSS (`:10`), `#nav`+`#app`+boot (`:11`) | navegador; `sw.js:2` |
| `manifest.json` | 1 · 501 B | Manifesto PWA (nome, ícones, `start_url`, `display`) | `index.html:6`; `sw.js:2` |
| `package.json` | 1 · 33 B | Apenas `{"type":"module","private":true}`: sem scripts nem dependências | — |
| `sw.js` | 5 · 1,8 KB | Service worker: `V`+`FILES` (`:2`), install/activate/fetch (`:3-5`) | registrado em `src/pwa.js:3`; `vercel.json:5` |
| `vercel.json` | 62 · 1,2 KB | Headers de `/sw.js` (`:5`), `/` (`:18`), `/index.html` (`:27`), `/(.*)` (`:36`); `outputDirectory` (`:61`) | plataforma Vercel |
| **css/ — 2** | | | |
| `css/app.css` | 74 · 4,9 KB | Tokens de identidade (`:5-19`), `@font-face` (`:3-4`), relatório A4 (`:40-57`), `@media print` (`:59-74`) | `index.html:10`; `sw.js:2` |
| `css/ui.css` | 571 · 36,3 KB | Camada de componentes: 25 seções comentadas, breakpoints (`:84`…`:554`), print (`:566`) | `index.html:10`; `sw.js:2` |
| **api/ — 1** | | | |
| `api/cpf.js` | 48 · 1,8 KB | Função serverless que repassa a APICPF: handler (`:13`), endpoint (`:3`) | `tests/apicpf.test.mjs`; chamado em `src/services/apicpf.js:24` |
| **vendor/ — 2** | | | |
| `vendor/fflate.min.js` | 1 (minificado) · 31,9 KB | ZIP puro (MIT), expõe o global `fflate` | injetado por `<script>` em `src/export/lib.js:4`; `sw.js:2` |
| `vendor/LICENSES.md` | 3 · 368 B | Licença da fflate e motivo de não usar ExcelJS (CSP sem `unsafe-eval`) | — |
| **src/ — 2** | | | |
| `src/main.js` | 65 · 4,8 KB | Boot, `h()` (`:5`), telas de acesso (`:11-43`), painel (`:44-60`), ligação do shell (`:65`) | ninguém (entrada via `index.html:11`) |
| `src/pwa.js` | 11 · 1,2 KB | Registro do SW, storage persistente, instalação, standalone/iOS | `src/main.js`; `src/ui/settings.js` |
| **src/config/ — 1** | | | |
| `src/config/google.js` | 11 · 560 B | `clientId`/`projectId`/`origins` públicos do OAuth do Drive (`:4`) | `src/services/google-drive.js:4` |
| **src/core/ — 1** | | | |
| `src/core/live.js` | 3 · 276 B | Reatividade: escuta `data-changed` e chama o observador único (`watch`/`unwatch`) | `main.js`, `ui/clients.js`, `ui/clientlist.js`, `ui/dashboard.js`, `ui/debtspage.js`, `ui/settings.js`, `ui/tools.js` |
| **src/db/ — 1** | | | |
| `src/db/idb.js` | 30 · 2,4 KB | IndexedDB versionado: `MIGRATIONS` (`:2`), `DB_VERSION` (`:10`), CRUD e `batch` (`:27`) | `security/auth.js`, `services/records.js`, `services/clients.js`, `services/debts.js`, `services/settings.js`, `export/backup.js`, `ui/settings.js` |
| **src/domain/ — 4** | | | |
| `src/domain/address.js` | 12 · 778 B | CEP: dígitos, máscara, validade (`:3-4`) e `composeAddress` (`:6`) | `services/viacep.js`, `ui/clients.js`, `tests/address.test.mjs` |
| `src/domain/due.js` | 5 · 490 B | Datas ISO sem fuso: `todayISO`/`daysUntil`/`status` (`:3-5`) | `services/dashboard.js`, `ui/debtspage.js`, `ui/tools.js`, `tests/stage4.test.mjs` |
| `src/domain/money.js` | 11 · 1,1 KB | Centavos e taxa: `brl`/`cents`/`parseRate`/`interest` (`:3-9`)/`planRate` (`:11`) | `services/debts.js`, `ui/clientlist.js`, `ui/dashboard.js`, `ui/debts.js`, `ui/debtspage.js`, `ui/tools.js`, `tests/money.test.mjs` |
| `src/domain/validators.js` | 9 · 1,0 KB | `digits`, `validCPF`, `validCNPJ`, `mask.cpf/cnpj/phone` (`:1-9`) | `api/cpf.js`, `domain/address.js`, `services/clients.js`, `services/viacep.js`, `services/apicpf.js`, `export/backup.js`, `ui/clients.js`, `tests/validators.test.mjs` |
| **src/export/ — 5** | | | |
| `src/export/backup-format.js` | 45 · 4,3 KB | Contrato do arquivo de backup: `FORMAT`/`ITER`/`LISTS` (`:5`), `buildBackup` (`:10`), `validate` (`:20`), `readBackup` (`:28`) | `export/backup.js`, `tests/backup.test.mjs` |
| `src/export/backup.js` | 30 · 2,6 KB | Coleta do banco e escrita: `createBackup` (`:4`), `restore` mesclar/substituir (`:12`) | `src/ui/tools.js:1` |
| `src/export/lib.js` | 5 · 646 B | Carregador do `vendor/fflate.min.js` (`:4`) e download por `<a>` (`save` `:5`) | `backup-format.js`, `reports.js`, `ui/tools.js` |
| `src/export/reports.js` | 21 · 2,1 KB | Período (`:4-6`), coleta (`load` `:8`) e montagem do XLSX (`xlsxBytes` `:14`) | `ui/tools.js`, `tests/backup.test.mjs` |
| `src/export/xlsx.js` | 17 · 4,2 KB | Gerador mínimo OOXML: `buildXlsx` (`:9`), estilos (`:8`) | `export/reports.js`, `tests/backup.test.mjs` |
| **src/files/ — 1** | | | |
| `src/files/process.js` | 16 · 1,6 KB | Normalização de anexo: limite 15 MB, SHA-256, reamostragem WebP (`toStored` `:5`) | `src/services/clients.js:1` |
| **src/security/ — 2** | | | |
| `src/security/auth.js` | 69 · 4,0 KB | Ciclo do cofre e da sessão: `setup` (`:18`), `unlock` (`:24`), `restoreSession` (`:38`), idle (`:58-64`), `lock` (`:65`) | `main.js`, `services/records.js`, `ui/clients.js`, `ui/clientlist.js`, `ui/dashboard.js`, `ui/debtspage.js`, `ui/settings.js`, `ui/avatar.js` |
| `src/security/crypto.js` | 22 · 1,9 KB | PBKDF2/KEK/DEK (`:6-16`), selar e abrir bytes/JSON (`:17-20`), `deriveAesKey` do backup (`:22`) | `security/auth.js`, `services/records.js`, `export/backup-format.js`, `ui/settings.js`, `tests/crypto.test.mjs` |
| **src/services/ — 9** | | | |
| `src/services/apicpf.js` | 58 · 1,9 KB | Cliente do endpoint `/api/cpf`: `lookupCpf` (`:6`), cache 30 min e dedupe (`:3`) | `src/ui/clients.js:1` |
| `src/services/clients.js` | 44 · 4,0 KB | Casos de uso de cliente: `validate` (`:7`), `saveClient` (`:16`), `deleteClient` (`:31`), documentos (`:36-44`) | `ui/clients.js`, `ui/clientlist.js`, `ui/avatar.js`, `ui/debtspage.js`, `services/debts.js`, `services/dashboard.js`, `export/reports.js` |
| `src/services/dashboard.js` | 7 · 912 B | Indicadores agregados do painel: `stats` (`:3`) | `src/ui/dashboard.js:1` |
| `src/services/debts.js` | 34 · 3,2 KB | Dívidas: `listDebts` (`:6`), `validate` (`:7`), `saveDebt` (`:14`), `deleteDebt` (`:24`), lote (`:25-28`) | `ui/debts.js`, `ui/clientlist.js`, `ui/debtspage.js`, `services/dashboard.js`, `export/reports.js` |
| `src/services/google-drive.js` | 226 · 12,9 KB | OAuth GIS + Drive v3: config (`:21-48`), `connect` (`:84`), `disconnect` (`:114`), pasta/lista (`:149-171`), upload (`:181`), download (`:206`) | `src/ui/tools.js:1` |
| `src/services/records.js` | 10 · 1,0 KB | Camada cifra/decifra sobre o idb: `list`/`one`/`enc`/`blobOp`/`blobBytes`/`hist` (`:5-10`) | `services/clients.js`, `services/debts.js`, `services/dashboard.js`, `export/backup.js`, `export/reports.js` |
| `src/services/search.js` | 4 · 528 B | Busca textual sem acento + por dígitos: `match` (`:3`) | `src/ui/clientlist.js:1`, `tests/stage4.test.mjs` |
| `src/services/settings.js` | 3 · 194 B | Parâmetro `dueWindow` no store `settings` (`:2-3`) | `services/dashboard.js`, `ui/debtspage.js`, `ui/settings.js` |
| `src/services/viacep.js` | 34 · 1,8 KB | Consulta ViaCEP com cache, timeout 8 s e códigos de falha: `lookupCep` (`:6`) | `src/ui/clients.js:1` |
| **src/ui/ — 11** | | | |
| `src/ui/avatar.js` | 29 · 947 B | Avatar com iniciais + foto sob demanda, com cache e limpeza no lock (`:7`, `:13`) | `ui/clientlist.js`, `ui/dashboard.js` |
| `src/ui/clientlist.js` | 34 · 3,5 KB | Tela de clientes (lista, filtros, paginação 20/20): `clientList` (`:4`) | `src/ui/clients.js:1` |
| `src/ui/clients.js` | 186 · 17,6 KB | Núcleo de clientes: `clientsView` (`:13`), `form` (`:17`), `profile` (`:129`), viewer (`:128`) | `src/main.js:3` |
| `src/ui/dashboard.js` | 43 · 3,2 KB | Cartões do painel e busca global: `card` (`:3`) | `src/main.js:3` |
| `src/ui/debts.js` | 70 · 7,0 KB | Bloco de dívidas do perfil (`section` `:4`), formulário (`form` `:19`), lote (`bulk` `:43`) | `ui/clients.js`, `ui/debtspage.js` |
| `src/ui/debtspage.js` | 38 · 4,7 KB | Tela Dívidas com filtros e resumo: `page` (`:5`) | `src/ui/clients.js:1` |
| `src/ui/icons.js` | 47 · 3,7 KB | 38 paths SVG de traço 1,5 (`:2-41`) e fábrica `icon()` (`:43`) | `kit.js`, `shell.js`, `clients.js`, `clientlist.js`, `dashboard.js`, `debts.js`, `debtspage.js`, `settings.js`, `tools.js` |
| `src/ui/kit.js` | 39 · 2,8 KB | Utilitários de apresentação: `initials`/`when`/`day`/`longDay`/`plural` (`:3-7`), `filePicker` (`:8`), `pager` (`:18`) | `main.js`, `avatar.js`, `clientlist.js`, `clients.js`, `dashboard.js`, `debtspage.js`, `tools.js` |
| `src/ui/settings.js` | 64 · 4,7 KB | Tela Configurações: `settingsView` (`:15`), idle (`:28`), teste de cifra (`:30`), instalação (`:38`), janela (`:42`) | `src/main.js:3` |
| `src/ui/shell.js` | 64 · 6,0 KB | Navegação persistente e automação visual: `initShell` (`:10`), menu (`:28-36`), sincronização (`:47-62`) | `src/main.js:3` |
| `src/ui/tools.js` | 208 · 18,1 KB | Telas Relatórios (`reportsView` `:6`) e Backup/Drive (`backupView` `:31`) | `src/main.js:3` |
| **tests/ — 7** | | | |
| `tests/address.test.mjs` | 17 · 1,3 KB | Máscara/validação de CEP e montagem de endereço | executado por `node tests/*.test.mjs` (`README.md:292-294`) |
| `tests/apicpf.test.mjs` | 54 · 2,1 KB | Contrato da função serverless com `fetch` simulado | idem |
| `tests/backup.test.mjs` | 28 · 3,1 KB | Round-trip do formato de backup (aberto e cifrado) | idem |
| `tests/crypto.test.mjs` | 9 · 681 B | Abrir cofre com senha errada rejeita | idem |
| `tests/money.test.mjs` | 12 · 1,3 KB | Arredondamento de juros e formatação em centavos | idem |
| `tests/stage4.test.mjs` | 7 · 842 B | Situação de vencimento e regras de busca | idem |
| `tests/validators.test.mjs` | 6 · 643 B | CPF/CNPJ e máscaras | idem |
| **docs/ — 4** | | | |
| `docs/README.md` | 42 · 9,2 KB | Índice da documentação técnica e resumo por módulo | linkado informalmente pelo `README.md` |
| `docs/apicpf.md` | 35 · 2,8 KB | Chave, fluxo e privacidade da APICPF | — |
| `docs/auditoria-ui-ux-codigo.md` | 37 · 5,0 KB | Registro da auditoria de UI/UX de 16/11/2026 | — |
| `docs/google-drive.md` | 141 · 7,5 KB | Configuração do cliente OAuth, erros comuns | `README.md:282` |
| **docs/screenshots/ — 14** | | | |
| `login-desktop.webp` | 318 · 79,5 KB | Captura da tela de acesso (desktop) | `README.md:34` |
| `login-mobile.webp` | 105 · 26,2 KB | Captura da tela de acesso (celular) | `README.md:39` |
| `dashboard-desktop.webp` | 200 · 45,5 KB | Captura do painel (desktop) | `README.md:46` |
| `dashboard-mobile.webp` | 62 · 18,8 KB | Captura do painel (celular) | `README.md:69` |
| `clients-desktop.webp` | 91 · 23,3 KB | Captura da lista de clientes | `README.md:52` |
| `clients-mobile.webp` | 57 · 14,4 KB | Captura de clientes no celular | `README.md:70` |
| `profile-desktop.webp` | 161 · 33,8 KB | Captura do perfil do cliente | `README.md:56` |
| `profile-mobile.webp` | 63 · 18,2 KB | Captura do perfil no celular | `README.md:71` |
| `debts-desktop.webp` | 136 · 35,7 KB | Captura da página de dívidas | `README.md:53` |
| `debts-mobile.webp` | 43 · 11,9 KB | Captura de dívidas no celular | `README.md:74` |
| `reports-desktop.webp` | 198 · 45,1 KB | Captura do relatório A4 | `README.md:60` |
| `backup-desktop.webp` | 107 · 30,0 KB | Captura de backup e restauração | `README.md:61` |
| `settings-desktop.webp` | 132 · 28,0 KB | Captura de configurações | `README.md:57` |
| `settings-mobile.webp` | 49 · 13,1 KB | Captura de configurações no celular | `README.md:75` |
| **assets/fonts/ — 4** | | | |
| `cormorant-garamond-latin.woff2` | — · 36,8 KB | Fonte serifada de marca (peso 500-700) | `css/app.css:3`; `index.html:4`; `sw.js:2` |
| `dm-sans-latin.woff2` | — · 36,1 KB | Fonte sans de interface (peso 400-600) | `css/app.css:4`; `index.html:4`; `sw.js:2` |
| `OFL-CormorantGaramond.txt` | 93 · 4,3 KB | Licença SIL OFL da Cormorant Garamond | arquivo legal, sem referência de código |
| `OFL-DMSans.txt` | 93 · 4,5 KB | Licença SIL OFL da DM Sans | arquivo legal, sem referência de código |
| **assets/icons/ — 4** | | | |
| `icon-192.png` | — · 55,0 KB | Ícone PWA 192 | `manifest.json:1`; `index.html:6`; `sw.js:2` |
| `icon-512.png` | — · 432,6 KB | Ícone PWA 512 | `manifest.json:1`; `README.md:2`; `sw.js:2` |
| `icon-maskable-512.png` | — · 432,6 KB | Ícone maskable 512 | `manifest.json:1`; `sw.js:2` |
| `apple-touch-icon.png` | — · 48,1 KB | Ícone iOS | `index.html:7`; `sw.js:2` |
| **assets/img/ — 3** | | | |
| `hat.webp` | — · 126,2 KB | Marca (chapéu) usada no login, topo e menu | `main.js:35,52`; `shell.js:29`; `index.html:6`; `sw.js:2` |
| `office.webp` | — · 98,0 KB | Cena do painel de autenticação | `main.js:38`; `index.html:6`; `sw.js:2` |
| `office-desk.webp` | — · 194,8 KB | Segunda cena do painel de autenticação | `main.js:39`; `index.html:6`; `sw.js:2` |
| **novos nesta branch — ainda NÃO versionados (fora dos 87)** | | | |
| `tests/helpers/dom.mjs` | 190 · 12,0 KB | Stub mínimo e honesto de ambiente de navegador (define o `addEventListener` de topo que `src/core/live.js:2` e `src/pwa.js:2` exigem) | `tests/helpers/vault.mjs:24` |
| `tests/helpers/fake-idb.mjs` | 275 · 15,0 KB | IndexedDB falso determinístico cobrindo a superfície real do app (`open`/`createObjectStore`/`createIndex`/`transaction`) | `tests/helpers/vault.mjs:23` |
| `tests/helpers/fetch-mock.mjs` | 117 · 5,6 KB | Mock de `fetch` que impede qualquer chamada à rede na suíte | `tests/apicpf.test.mjs` |
| `tests/helpers/fixtures.mjs` | 158 · 7,2 KB | Clientes/dívidas fictícios determinísticos (nomes "Maria Exemplo", "João Teste") | `tests/helpers/vault.mjs:25` |
| `tests/helpers/vault.mjs` | 64 · 3,7 KB | Cofre pronto para testes de serviço: usa os módulos REAIS de `src/security/` (import em `vault.mjs:22`) sobre o idb falso | ainda nenhum (fan-in 0) |
| `scripts/run-tests.mjs` | 287 · 13,1 KB | Forma canônica de rodar a suíte, com guarda contra descoberta vazia de testes | chamado por `.github/workflows/ci.yml` e pela mão |
| `scripts/check-static.mjs` | 663 · 30,3 KB | Fonte única das checagens estáticas, em grupos `--only=sintaxe\|essenciais\|sw\|json\|deps\|segredos` | `.github/workflows/ci.yml` (job `estatico`, `:112-146`) |
| `.github/workflows/ci.yml` | 398 · 20,3 KB | Pipeline que chama os scripts acima e a suíte; nada de critério vive no YAML | — |
| `tests/unit/`, `tests/svc/`, `tests/contracts/` | — | diretórios previstos para a suíte nova | **NÃO CONFIRMADO**: `test -d` falhou para os três nesta escrita (ainda não existem no disco) |

Somando os grupos versionados: 9 + 2 + 1 + 2 + 2 + 1 + 1 + 1 + 4 + 5 + 1 + 2 + 9 + 11 + 7 + 4 + 14 + 4 + 4 + 3 = **87 arquivos versionados**, mais **8 arquivos novos** da infraestrutura de teste/CI (5 helpers + 2 scripts + 1 workflow) = **95 arquivos rastreados neste mapa**. Nenhum dos 95 foi inventado: todos passaram por `test -f`/`stat`; os três diretórios de suíte acima estão marcados como NÃO CONFIRMADO.

---

## 3. Funcionalidade → arquivos

Formato: ponto de entrada como `arquivo:linha`; depois os arquivos que a implementam. 14 telas + 1 diálogo, todas renderizadas em `#app` (`index.html:11`) e identificadas por `data-page` (conferido: `home`, `clients`, `client`, `new-client`, `edit-client`, `debts`, `edit-debt`, `bulk`, `reports`, `backup`, `settings`).

| Funcionalidade | Ponto de entrada | Também mexe em |
|---|---|---|
| Cadastro do cofre (primeiro acesso) | `src/main.js:11` (`authView(setup)`) | `src/security/auth.js:18` (setup), `src/security/crypto.js:7` (createVault), campos `src/main.js:9,29-33`, aviso de irreversibilidade `src/main.js:21,31` |
| Desbloqueio do cofre | `src/main.js:23` (`A.unlock`) | `src/security/auth.js:24-36` (unlock), `src/security/crypto.js:13` (openVault), trava por tentativas `src/security/auth.js:26-30` |
| Retomar sessão na mesma aba | `src/main.js:63` (`A.restoreSession`) | `src/security/auth.js:38-48`, gravação da sessão `src/security/auth.js:50-57`, `sessionStorage` `src/security/auth.js:5-9` |
| Bloqueio automático (inatividade) | `src/security/auth.js:58` (`touch`) e `:64` (`check`) | opções `src/ui/settings.js:28-29`, persistência `src/security/auth.js:49` (setIdle), listeners `src/security/auth.js:11-12`, re-render `src/main.js:61` |
| Bloquear agora / sair | `src/ui/shell.js:36` (itens `lock`/`out`) | `src/security/auth.js:65` (lock), util do cabeçalho `src/ui/shell.js:42-43`, motivos em `src/main.js:61` |
| Clientes — listar, buscar, ordenar, filtrar por taxa | `src/ui/clientlist.js:4` (`clientList`) | `src/ui/clients.js:13` (`clientsView`), `src/services/clients.js:6` (listClients), `src/services/debts.js:6` (taxas), `src/services/search.js:3` (match), paginação 20/20 `src/ui/clientlist.js:3,20` |
| Clientes — novo | `src/ui/clients.js:17` (`form({})`) | render/título `src/ui/clients.js:124`, gravação `src/services/clients.js:16-27`, validação `src/services/clients.js:7-14`, máscara de documento `src/ui/clients.js:71,97` |
| Clientes — editar | `src/ui/clients.js:17` (`form(c)`) | botão do perfil `src/ui/clients.js:163`, campos pré-cheios `src/ui/clients.js:27`, histórico de alteração `src/services/clients.js:25` |
| Clientes — perfil | `src/ui/clients.js:129` (`profile(id)`) | `src/ui/clients.js:15` (`openProfile`, usado em `src/main.js:47`), bloco de dívidas `src/ui/debts.js:4`, documentos `src/ui/clients.js:172-184`, histórico `src/ui/clients.js:146-158` |
| Clientes — excluir | `src/ui/clients.js:42` (`removeClient`) | botão `src/ui/clients.js:70`, cascata em `src/services/clients.js:31-35` (documents+blobs+debts+history+cliente) |
| Clientes — fotografia | `src/ui/clients.js:36` (`paint`) | seletor `src/ui/clients.js:55`, remover `src/ui/clients.js:56`, substituir `src/ui/clients.js:140,166`, gravação `src/services/clients.js:20-22`, `changePhoto` `src/services/clients.js:28`, redimensionamento `src/files/process.js:5`, avatar `src/ui/avatar.js:13` |
| Documentos anexados | `src/ui/clients.js:142` (campos categoria/nome/arquivo) | adicionar `src/ui/clients.js:177` → `src/services/clients.js:38-42`; abrir `src/ui/clients.js:143`; baixar `src/ui/clients.js:145`; remover `src/ui/clients.js:183` → `src/services/clients.js:43`; diálogo de imagem `src/ui/clients.js:128`; duplicidade por hash `src/services/clients.js:40` |
| Dívidas — listar e filtrar | `src/ui/debtspage.js:5` (`page`) | `src/services/debts.js:6` (listDebts), filtros `src/ui/debtspage.js:29-32`, resumo `src/ui/debtspage.js:14`, paginação 10/10 `src/ui/debtspage.js:4` |
| Dívidas — nova / editar | `src/ui/debts.js:19` (`form`) | gatilhos `src/ui/debtspage.js:28` e `src/ui/debtspage.js:21`; `src/services/debts.js:14-23` (saveDebt), validação `src/services/debts.js:7-13`, prévia de juros `src/ui/debts.js:32,38` |
| Dívidas — excluir | `src/ui/debtspage.js:22` (botão Excluir) | também `src/ui/debts.js:17` (dentro do perfil); `src/services/debts.js:24` (deleteDebt + histórico) |
| Juros em lote | `src/ui/debts.js:43` (`bulk`) | busca `src/services/debts.js:25` (findByRate), plano `src/domain/money.js:11` (planRate), aplicação `src/services/debts.js:28-34` (applyBulk, uma transação + conflito detectado `:31`), botão de entrada em `src/ui/clientlist.js:30` |
| Cálculo de dinheiro e juros | `src/domain/money.js:9` (`interest`) | centavos/taxa `src/domain/money.js:1-2`, formatação `src/domain/money.js:3-7`, entrada do usuário `src/ui/debts.js:30-31,39` |
| Dashboard / indicadores | `src/ui/dashboard.js:3` (`card`) | agregação `src/services/dashboard.js:3-7` (stats), tiles `src/ui/dashboard.js:5-7,26-29`, chamado no boot `src/main.js:47`, atualização reativa `src/ui/dashboard.js:37` |
| Vencimentos (vencidas / prestes a vencer) | `src/domain/due.js:5` (`status`) | `daysUntil` `src/domain/due.js:4`, janela configurável `src/services/settings.js:2-3`, UI da janela `src/ui/settings.js:42-44`, alerta do painel `src/ui/dashboard.js:15-16`, selo da lista `src/ui/debtspage.js:16,18` |
| Histórico de atividades | `src/services/records.js:10` (`hist`) | listagem `src/services/clients.js:37`, linha do tempo do perfil `src/ui/clients.js:147-158`, painel `src/ui/dashboard.js:22-24`, tipos gerados em `src/services/clients.js:24-26` e `src/services/debts.js:17-21,33` |
| Relatórios (período, A4) | `src/ui/tools.js:6` (`reportsView`) | coleta `src/export/reports.js:8` (load), período `src/export/reports.js:4`, rótulo `src/export/reports.js:6`, botão Visualizar `src/ui/tools.js:25`, orientação `src/ui/tools.js:11,23` |
| Exportação XLSX | `src/ui/tools.js:26` (botão Exportar Excel) | `src/export/reports.js:14` (xlsxBytes), `src/export/xlsx.js:9` (buildXlsx), download `src/export/lib.js:5`, ZIP `src/export/lib.js:4` + `vendor/fflate.min.js` |
| Impressão do relatório | `src/ui/tools.js:28` (botão Imprimir) | `css/app.css:40` (`@page` port/land), `css/app.css:41-57` (documento), `css/app.css:59-74` (`@media print`), `css/ui.css:566-571` (esconder nav/pager) |
| Backup local (gerar) | `src/ui/tools.js:37` (`gen`) | coleta `src/export/backup.js:4-10`, montagem do ZIP `src/export/backup-format.js:10-19`, cifragem `src/security/crypto.js:22` |
| Backup — restauração | `src/ui/tools.js:44` (`check`) | leitura `src/export/backup-format.js:28-45`, integridade `src/export/backup-format.js:20-27`, escrita `src/export/backup.js:12-30` (merge `:20-27` / replace `:14-19`) |
| Formato do arquivo de backup | `src/export/backup-format.js:5` (`FORMAT`, `ITER`, `LISTS`) | layout documentado em `src/export/backup-format.js:1-3`, manifest `:15,18`, verificação SHA-256 `:6-7,38-40` |
| Google Drive (navegador) | `src/ui/tools.js:63` (`renderDrive`) | `src/services/google-drive.js:84` (connect), `:114` (disconnect), `:160` (listBackups), `:181` (uploadBackup multipart), `:206` (downloadBackup), config `src/config/google.js:4`, importação de JSON `:33-47`, pasta `:9,149-154` |
| ViaCEP (autocompletar endereço) | `src/services/viacep.js:6` (`lookupCep`) | debounce 650 ms `src/ui/clients.js:113-121`, preenchimento `src/ui/clients.js:101-112`, máscara `src/domain/address.js:3`, composição `src/domain/address.js:6`, CSP `index.html:3` |
| APICPF — cliente | `src/services/apicpf.js:6` (`lookupCpf`) | debounce 700 ms `src/ui/clients.js:72-81`, preenchimento/`status` `src/ui/clients.js:82-95`, cache/dedupe `src/services/apicpf.js:3`, validação local `src/domain/validators.js:2` |
| APICPF — serverless | `api/cpf.js:13` (`handler`) | endpoint e chave `api/cpf.js:3,19-20`, códigos devolvidos `api/cpf.js:14-42`, variável `.env.example:3`, teste `tests/apicpf.test.mjs`, doc `docs/apicpf.md` |
| Configurações (tela) | `src/ui/settings.js:15` (`settingsView`) | sistema `src/ui/settings.js:49-51` (usa `src/pwa.js:5` e `src/db/idb.js:10`), segurança `:52-56`, instalação `:58`, vencimentos `:59-62` |
| Service worker / cache offline | `sw.js:2` (`V` e `FILES`) | instalação `sw.js:3`, limpeza de caches `sw.js:4`, rede-com-fallback-e-`index.html` `sw.js:5`, registro `src/pwa.js:3`, header `vercel.json:5-16` |
| Manifesto / instalação (PWA) | `manifest.json:1` | evento de instalação `src/pwa.js:2`, `canInstall` `:7`, `install` `:9`, `isStandalone`/`isIOS` `:10-11`, UI `src/ui/settings.js:38-40`, links `index.html:6-9` |
| Tema e identidade visual | `css/app.css:5-19` (tokens `:root`) | `@font-face` `css/app.css:3-4`, `color-scheme` `css/app.css:18`, componentes `css/ui.css` (seções comentadas `:5`…`:565`), `theme-color` `index.html:4` e `manifest.json:1` |
| Navegação / shell | `src/ui/shell.js:10` (`initShell`) | montagem `src/main.js:65`, itens do menu `src/ui/shell.js:28-36`, destaque de aba `src/ui/shell.js:52-54`, containers `index.html:11`, estilos `css/ui.css:482-530` (navegação, tablet e desktop) |
| Suíte de testes e CI | `scripts/run-tests.mjs` (runner canônico) | helpers `tests/helpers/vault.mjs`, `dom.mjs`, `fake-idb.mjs`, `fetch-mock.mjs`, `fixtures.mjs`; checagens `scripts/check-static.mjs` (`--only=...`); pipeline `.github/workflows/ci.yml:74` (job `estatico`); suítes `tests/unit`, `tests/svc`, `tests/contracts`: **NÃO CONFIRMADO** (diretórios ainda não existem) |
| Utilitários de DOM | `src/main.js:5` (`h`) | `src/ui/kit.js:8` (`filePicker`), `src/ui/kit.js:18` (`pager`), `src/ui/kit.js:3-7` (`initials`/`when`/`day`/`longDay`/`plural`), `src/ui/icons.js:43` (`icon`), `src/ui/avatar.js:13` (`clientAvatar`), `src/export/lib.js:5` (`save`) |
---

## 4. Mapa de dependências entre módulos

Grafo verificado com `python3 /home/ubuntu/audit/deps.py` (v2, que conta imports múltiplos na mesma linha) e confirmado por recálculo independente: **74 arquivos JS/MJS, 204 arestas internas (107 do app + 97 de testes e scripts), 0 imports quebrados, 0 ciclos**. Especificadores externos: `node:assert/strict`, `node:child_process`, `node:crypto`, `node:fs`, `node:path`, `node:process`, `node:test`, `node:url` — todos em código de teste/ferramenta, nenhum em código de aplicação. Os 74 nós são os 39 do app (`src/`, `api/`, `sw.js`, `vendor/`) mais 33 de teste (`tests/*.test.mjs`, `tests/{unit,svc,contracts,helpers}/*`) e 2 de ferramenta (`scripts/*.mjs`).

```text
ENTRADA E APRESENTACAO (ui)
  index.html:11 ──> src/main.js ──┬─> src/ui/shell.js ────────> src/ui/icons.js
        |                         ├─> src/ui/clients.js (telas de cliente)
  manifest.json ──> (navegador)   ├─> src/ui/dashboard.js
                                  ├─> src/ui/tools.js ─┐
                                  └─> src/ui/settings.js │
   src/ui/clients.js ─┬─> src/ui/clientlist.js ─> src/ui/avatar.js ─┐
                     ├─> src/ui/debtspage.js ──> src/ui/debts.js   │
                     └─> src/ui/debts.js                            │
   src/ui/kit.js ─────────────────────────────────────────────────┘─> src/ui/icons.js
```

```text
ui ──> services ──> domain / db / security
  src/ui/*            src/services/*          src/domain/*   src/db/idb.js
  dashboard.js ──────> services/dashboard.js ─┼> services/records.js ─> db/idb.js
  clients.js ────────> services/clients.js ───┼> files/process.js
  clientlist.js ─────> services/debts.js ─────┼> services/search.js
  debtspage.js ──────> services/settings.js ──┼> domain/due.js, domain/money.js
  tools.js ──────────> services/google-drive.js ──> config/google.js
  clients.js ────────> services/viacep.js, services/apicpf.js ──> domain/validators.js
  6 telas (clients, clientlist, dashboard,      |  security/auth.js ─┬─> security/crypto.js
  debtspage, settings, avatar) ─> security/auth.js |  (crypto e idb nao importam nada)
  atalho real: src/ui/settings.js importa DIRETO src/db/idb.js e src/security/crypto.js
  reacao transversal: db/idb.js:30 dispara 'data-changed' -> src/core/live.js -> telas
```

```text
export (relatorios, xlsx, backup)          pwa / service worker
  src/ui/tools.js ─┬─> export/reports.js ─┬─> export/xlsx.js          src/main.js ─> src/pwa.js
                   │                      ├─> export/lib.js ──(script)─> vendor/fflate.min.js
                   │                      └─> services/{debts,clients,records}.js
                   ├─> export/backup.js ─┬─> export/backup-format.js ─> export/lib.js
                   │                     │                            └─> security/crypto.js
                   │                     └─> db/idb.js, services/records.js, domain/validators.js
                   └─> export/lib.js (save/download)                   src/pwa.js ──register──> sw.js
  api (serverless)                                                       (sw.js nao importa nada)
    src/ui/clients.js ──fetch──> services/apicpf.js ──fetch──> /api/cpf (api/cpf.js:13) ─> validators.js

  teste/CI (fora do bundle): tests/helpers/vault.mjs ─> security/auth.js + dom/fake-idb/fixtures;
    tests/helpers/fixtures.mjs ─> domain/validators.js; scripts/{run-tests,check-static}.mjs ─ Node puro.
```

Fan-in dos módulos do app (mais importados = mais perigosos de alterar):

| Arquivo | fan-in | fan-out | | Arquivo | fan-in | fan-out |
|---|---:|---:|---|---|---:|---:|
| `src/security/auth.js` | 9 | 2 | | `src/security/crypto.js` | 5 | 0 |
| `src/ui/icons.js` | 9 | 0 | | `src/services/records.js` | 5 | 3 |
| `src/domain/validators.js` | 9 | 0 | | `src/domain/due.js` | 4 | 0 |
| `src/services/clients.js` | 7 | 4 | | `src/domain/address.js` | 3 | 1 |
| `src/ui/kit.js` | 7 | 1 | | `src/export/lib.js` | 3 | 0 |
| `src/db/idb.js` | 7 | 0 | | `src/services/settings.js` | 3 | 1 |
| `src/domain/money.js` | 7 | 0 | | `src/ui/debts.js` | 2 | 3 |
| `src/core/live.js` | 7 | 0 | | `src/ui/avatar.js` | 2 | 3 |
| `src/services/debts.js` | 5 | 4 | | `src/export/backup-format.js` | 2 | 2 |
| | | | | `src/export/reports.js` | 2 | 5 |
| | | | | `src/export/xlsx.js` | 2 | 0 |

Fan-in do lado de teste: `tests/helpers/vault.mjs` (imports em `:22-25`) é importado por 0 arquivos até agora (foi escrito para as suítes novas), `tests/helpers/dom.mjs`, `fake-idb.mjs` e `fixtures.mjs` têm fan-in 1 (todos via `vault.mjs:23-25`, que importa os três) e `fetch-mock.mjs` tem fan-in 1 (`tests/apicpf.test.mjs`).

Módulos folha e módulos raiz:

| Categoria | Arquivos |
|---|---|
| Nada importam (fan-out 0) | `src/db/idb.js`, `src/domain/validators.js`, `src/domain/money.js`, `src/domain/due.js`, `src/core/live.js`, `src/security/crypto.js`, `src/services/search.js`, `src/export/lib.js`, `src/export/xlsx.js`, `src/files/process.js`, `src/pwa.js`, `src/config/google.js`, `src/ui/icons.js`, `sw.js`, `vendor/fflate.min.js`, `tests/helpers/fake-idb.mjs`, `tests/helpers/fetch-mock.mjs` |
| Ninguém os importa (fan-in 0) | `src/main.js` (raiz do bundle, entrada de `index.html:11`), `sw.js` (registrado em runtime, sem imports), `vendor/fflate.min.js` (injetado por `<script>`, não por `import`), os 7 `tests/*.test.mjs`, `scripts/run-tests.mjs`, `scripts/check-static.mjs` e `tests/helpers/vault.mjs` |
| Maior fan-out (mais acoplados) | `src/ui/clients.js` (12), `src/ui/debtspage.js` (10), `src/ui/clientlist.js` (9), `src/ui/tools.js` (9), `src/main.js` (9), `src/ui/settings.js` (7), `src/ui/dashboard.js` (7); no lado de teste, `tests/helpers/vault.mjs` (4) |

**Aresta invisível ao grafo — `vendor/fflate.min.js`.** Nenhum módulo o importa com `import`: ele é injetado como tag `<script>` por `src/export/lib.js:2-4` (`load('vendor/fflate.min.js','fflate')`), que consome o global `fflate`. Por isso o grafo mostra fan-out 0 / fan-in 0 nesse arquivo e ele **precisa continuar em `FILES` do `sw.js:2`**, senão o ZIP do Excel e do backup quebra só no modo offline — caso em que o `<script>` não tem de onde baixar. É também o motivo de a CSP não precisar de `unsafe-eval` (ver `vendor/LICENSES.md:3`).

Prova de 0 ciclos: DFS com marcação gray/black sobre os 74 nós e 204 arestas internas (`audit/deps.py` v3) não encontrou nenhuma aresta de retorno; `ciclos = 0` também na recálculo independente. A razão estrutural é que as setas sempre descem `ui → services/export → domain/db/security`, os testes só apontam para cima (`tests` → `src`) e nenhum módulo de baixo importa de cima. A única dependência "de volta" é um evento, não um import: `src/db/idb.js:30` emite `data-changed` e `src/core/live.js:2` o escuta.

## 5. Mapa de imports por arquivo (arquivo → importa)

Gerado de `/home/ubuntu/audit/deps.json` (v3, 74 nós; caminhos relativos resolvidos; `ext:` = import externo do Node).

| Arquivo | Importa |
|---|---|
| `api/cpf.js` | `src/domain/validators.js` |
| `scripts/check-static.mjs` | `ext:node:child_process`, `ext:node:fs`, `ext:node:path`, `ext:node:process`, `ext:node:url` |
| `scripts/run-tests.mjs` | `ext:node:child_process`, `ext:node:fs`, `ext:node:path`, `ext:node:process`, `ext:node:url` |
| `src/config/google.js` | — |
| `src/core/live.js` | — |
| `src/db/idb.js` | — |
| `src/domain/address.js` | `src/domain/validators.js` |
| `src/domain/due.js` | — |
| `src/domain/money.js` | — |
| `src/domain/validators.js` | — |
| `src/export/backup-format.js` | `src/export/lib.js`, `src/security/crypto.js` |
| `src/export/backup.js` | `src/db/idb.js`, `src/domain/validators.js`, `src/export/backup-format.js`, `src/services/records.js` |
| `src/export/lib.js` | — (injeta `vendor/fflate.min.js` por `<script>`, `:2-4`) |
| `src/export/reports.js` | `src/export/lib.js`, `src/export/xlsx.js`, `src/services/clients.js`, `src/services/debts.js`, `src/services/records.js` |
| `src/export/xlsx.js` | — |
| `src/files/process.js` | — |
| `src/main.js` | `src/core/live.js`, `src/pwa.js`, `src/security/auth.js`, `src/ui/clients.js`, `src/ui/dashboard.js`, `src/ui/kit.js`, `src/ui/settings.js`, `src/ui/shell.js`, `src/ui/tools.js` |
| `src/pwa.js` | — |
| `src/security/auth.js` | `src/db/idb.js`, `src/security/crypto.js` |
| `src/security/crypto.js` | — |
| `src/services/apicpf.js` | `src/domain/validators.js` |
| `src/services/clients.js` | `src/db/idb.js`, `src/domain/validators.js`, `src/files/process.js`, `src/services/records.js` |
| `src/services/dashboard.js` | `src/domain/due.js`, `src/services/clients.js`, `src/services/debts.js`, `src/services/records.js`, `src/services/settings.js` |
| `src/services/debts.js` | `src/db/idb.js`, `src/domain/money.js`, `src/services/clients.js`, `src/services/records.js` |
| `src/services/google-drive.js` | `src/config/google.js` (`:4`) |
| `src/services/records.js` | `src/db/idb.js`, `src/security/auth.js`, `src/security/crypto.js` |
| `src/services/search.js` | — |
| `src/services/settings.js` | `src/db/idb.js` |
| `src/services/viacep.js` | `src/domain/address.js`, `src/domain/validators.js` |
| `src/ui/avatar.js` | `src/security/auth.js`, `src/services/clients.js`, `src/ui/kit.js` |
| `src/ui/clientlist.js` | `src/core/live.js`, `src/domain/money.js`, `src/security/auth.js`, `src/services/clients.js`, `src/services/debts.js`, `src/services/search.js`, `src/ui/avatar.js`, `src/ui/icons.js`, `src/ui/kit.js` |
| `src/ui/clients.js` | `src/core/live.js`, `src/domain/address.js`, `src/domain/validators.js`, `src/security/auth.js`, `src/services/apicpf.js`, `src/services/clients.js`, `src/services/viacep.js`, `src/ui/clientlist.js`, `src/ui/debts.js`, `src/ui/debtspage.js`, `src/ui/icons.js`, `src/ui/kit.js` |
| `src/ui/dashboard.js` | `src/core/live.js`, `src/domain/money.js`, `src/security/auth.js`, `src/services/dashboard.js`, `src/ui/avatar.js`, `src/ui/icons.js`, `src/ui/kit.js` |
| `src/ui/debts.js` | `src/domain/money.js`, `src/services/debts.js`, `src/ui/icons.js` |
| `src/ui/debtspage.js` | `src/core/live.js`, `src/domain/due.js`, `src/domain/money.js`, `src/security/auth.js`, `src/services/clients.js`, `src/services/debts.js`, `src/services/settings.js`, `src/ui/debts.js`, `src/ui/icons.js`, `src/ui/kit.js` |
| `src/ui/icons.js` | — |
| `src/ui/kit.js` | `src/ui/icons.js` |
| `src/ui/settings.js` | `src/core/live.js`, `src/db/idb.js`, `src/pwa.js`, `src/security/auth.js`, `src/security/crypto.js`, `src/services/settings.js`, `src/ui/icons.js` |
| `src/ui/shell.js` | `src/ui/icons.js` |
| `src/ui/tools.js` | `src/core/live.js`, `src/domain/due.js`, `src/domain/money.js`, `src/export/backup.js`, `src/export/lib.js`, `src/export/reports.js`, `src/services/google-drive.js`, `src/ui/icons.js`, `src/ui/kit.js` |
| `sw.js` | — |
| `tests/address.test.mjs` | `ext:node:assert/strict`, `src/domain/address.js` |
| `tests/apicpf.test.mjs` | `api/cpf.js`, `ext:node:assert/strict`, `ext:node:fs`, `ext:node:test`, `tests/helpers/fetch-mock.mjs` |
| `tests/backup.test.mjs` | `ext:node:assert/strict`, `ext:node:fs`, `src/export/backup-format.js`, `src/export/reports.js`, `src/export/xlsx.js` |
| `tests/crypto.test.mjs` | `ext:node:assert/strict`, `src/security/crypto.js` |
| `tests/helpers/dom.mjs` | `ext:node:fs`, `ext:node:url` |
| `tests/helpers/fake-idb.mjs` | — |
| `tests/helpers/fetch-mock.mjs` | — |
| `tests/helpers/fixtures.mjs` | `src/domain/validators.js` |
| `tests/helpers/vault.mjs` | `src/security/auth.js`, `tests/helpers/dom.mjs`, `tests/helpers/fake-idb.mjs`, `tests/helpers/fixtures.mjs` |
| `tests/money.test.mjs` | `ext:node:assert/strict`, `src/domain/money.js` |
| `tests/stage4.test.mjs` | `ext:node:assert/strict`, `src/domain/due.js`, `src/services/search.js` |
| `tests/validators.test.mjs` | `ext:node:assert/strict`, `src/domain/validators.js` |
| `vendor/fflate.min.js` | — (UMD; entra por `<script>`, ver seção 4) |

## 6. Arquivos sensíveis (exigem cuidado extra)

| Arquivo | Por que é sensível | O que precisa ser atualizado junto |
|---|---|---|
| `sw.js:2` | `V='sc-v69'` + `FILES` é a lista de pré-cache; arquivo novo fora da lista não funciona offline, e `V` velho faz cache antigo sobreviver (`sw.js:4` só delete caches de nome diferente) | incrementar `V`; adicionar o caminho em `FILES`; manter os mesmos caminhos de `index.html:4-10` e dos imports; se o arquivo é novo, citá-lo também aqui na seção 5 |
| `src/db/idb.js:2-9` | `MIGRATIONS` + `DB_VERSION` (`:10`) definem o schema do IndexedDB; errar aqui corrompe ou bloqueia dados existentes (o comentário em `:1` manda nunca editar migração antiga) | nova função ao fim de `MIGRATIONS` (não editar as anteriores); `dbVersion` vai para o backup em `src/export/backup.js:9` e é lido em `src/export/backup-format.js:15`; a versão aparece na UI em `src/ui/settings.js:50`; abas abertas geram `onblocked` (`src/db/idb.js:16`) |
| `src/security/crypto.js` | `ITER=600000` (`:4`), formato do envelope (iv 12 bytes + ciphertext, `:17-18`) e parâmetros PBKDF2/AES-GCM (`:6-16`): qualquer mudança torna indecifráveis os registros já gravados | metadados gravados em `meta.vault` (`src/security/auth.js:20-21`), compatibilidade de leitura em `openVault` (`crypto.js:13`), `ITER` espelhado no backup (`src/export/backup-format.js:5,17-18`), teste `tests/crypto.test.mjs`, `docs/README.md` |
| `src/security/auth.js` | Gerencia chave em memória, sessão por aba (`:5-9`, `:38-57`) e trava por tentativas (`:26-30`); mudar a semântica de `lock`/`onLock` afeta 8 consumidores | `src/main.js:61,63` (re-render e retomada de sessão); `clean()` em `src/ui/clients.js:3-4`; `A.onLock` em `src/ui/avatar.js:12`; checagens `isUnlocked()` em `ui/clients.js`, `ui/clientlist.js`, `ui/dashboard.js`, `ui/debtspage.js`, `ui/settings.js`; `getKey()` usado por `src/services/records.js:2` |
| `src/export/backup-format.js:5` | `FORMAT`, `ITER` e `LISTS` são o contrato público do arquivo de backup; um ZIP gerado hoje tem de ser lido por versões futuras | `validate` (`:20-27`) e `readBackup` (`:28-45`), `buildBackup` (`:10-19`), coleção em `src/export/backup.js:4-10` (inclui `settings.dueWindow` `:8`), modes de `restore` (`:12-30`), `tests/backup.test.mjs`, a nota de migração em `:3` e `docs/README.md` |
| `index.html:3` | A CSP é o que mantém o app seguro e funcionando: `script-src 'self' https://accounts.google.com`, `connect-src` com allowlist explícita (`viacep.com.br`, `googleapis.com`, `oauth2.googleapis.com`), `style-src` com `'unsafe-inline'` só pelo Google Identity Services | toda nova origem de rede exige editar `connect-src` aqui **e** revisar `vercel.json:55-56`; novo asset precisa de `img-src`/`font-src`/`preload` (`index.html:4-6`) e entrada em `sw.js:2`; biblioteca nova provavelmente viola a regra sem `unsafe-eval` (ver `vendor/LICENSES.md:3`) |
| `vercel.json:5-60` | Cabeçalhos que o app depende para funcionar: `Service-Worker-Allowed: /` (`:12`) e `Cache-Control: no-cache` em `/sw.js`, `/` e `/index.html` (`:5-33`) — sem isso o SW nunca atualiza; `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `COOP` e CSP `frame-ancestors` (`:36-58`) | qualquer mudança de CSP na meta tag de `index.html:3` precisa ser espelhada aqui; `outputDirectory: "."` (`:61`) obriga a listar os novos arquivos também em `sw.js:2` |
| `api/cpf.js` | Único ponto que fala com o mundo externo com credencial: lê `process.env.APICPF_API_KEY` (`:19`), expõe contrato JSON consumido pelo cliente (`:31-42`) | `src/services/apicpf.js:24-41` (parse de `ok`/`data`/`reason`), códigos esperados pelo UI em `src/ui/clients.js:90-93`, `.env.example:3`, `docs/apicpf.md`, `tests/apicpf.test.mjs`, e a ausência da URL no `connect-src` (o app só chama `/api/cpf`, mesmo origin) |
| `src/config/google.js:4-11` | `clientId` público real do OAuth; trocar o valor invalida configurações importadas em navegadores | `src/services/google-drive.js:29-47` (config importada vs. padrão), aviso de cliente divergente `src/ui/tools.js:70-74`, origens autorizadas `:95`, `docs/google-drive.md:7-40`, e o `origins` do próprio arquivo |
| `src/ui/shell.js:53` | Mapeamento `data-page → item do menu`; tela nova sem `data-page` cai em `home` e o menu não destaca | o `data-page` de cada tela (`src/ui/clients.js:9,124,159`, `src/ui/clientlist.js:26`, `src/ui/debtspage.js:25`, `src/ui/debts.js:40,63`, `src/ui/tools.js:3,21,199`, `src/ui/settings.js:12`, `src/main.js:51`) e o par `item()` em `src/ui/shell.js:31-36` |

---

## 7. Como localizar algo (padrões verificados neste repositório)

Todos os comandos abaixo foram executados na raiz do repo (`/home/ubuntu/scipione-cred-offline`) e retornaram resultados.

| Objetivo | Comando |
|---|---|
| Achar em que store um dado vive | `grep -rn "createObjectStore\|objectStore(" src` (definições em `src/db/idb.js:2-9`) e `grep -rn "'meta'\|'settings'\|'clients'\|'debts'\|'documents'\|'history'\|'blobs'" src` |
| Achar o texto de UI que aparece na tela | `grep -rn "h('h2',{},'" src/ui` (títulos), `grep -rn "label',\|'placeholder'\|placeholder:" src/ui` (rótulos), e para um termo exato `grep -rn "Juros em lote" src` |
| Achar toda chamada de rede | `grep -rn "fetch(" src api` (ViaCEP `src/services/viacep.js:17`, APICPF `src/services/apicpf.js:24`, Drive `src/services/google-drive.js:134`, serverless `api/cpf.js:25`); URLs-base: `grep -rnoE "https://[A-Za-z0-9./_-]+" src api manifest.json | cut -d: -f3- | sort -u` |
| Achar um token CSS e seus usos | `grep -n -- "--gold" css/app.css` (definição `css/app.css:5-19`) e `grep -rn "var(--gold" css src` (consumo) |
| Achar um breakpoint / regra responsiva | `grep -n "@media" css/ui.css css/app.css` (o mapa de larguras está documentado em `css/ui.css:3`) |
| Achar qual tela é qual | `grep -rn "'data-page'" src` e o mapeamento do menu em `grep -n "page===" src/ui/shell.js` (`src/ui/shell.js:53`) |
| Achar um ícone | `grep -rn "icon('lock'" src` (uso) e as paths em `src/ui/icons.js:2-41`; nomes já usados: `grep -rho "icon('[a-z]*'" src \| sort -u` |
| Achar quem importa um módulo | `grep -rn "db/idb.js" src api` (troque o nome do módulo); versão exata com fan-in/fan-out: `python3 /home/ubuntu/audit/deps.py` |
| Achar um evento/reatividade | `grep -rn "data-changed" src` (emitido em `src/db/idb.js:30`, escutado em `src/core/live.js:2` e `src/ui/shell.js:27`) |
| Achar onde um valor é salvo | `grep -rn "db.put('settings'" src` (ex.: `dueWindow` em `src/services/settings.js:3`, `idleMinutes` em `src/security/auth.js:21,49`) |
| Rodar os testes | `node scripts/run-tests.mjs` (canônico, recusa descoberta vazia); o laço antigo do `README.md:292-294` ainda funciona para os 7 arquivos atuais |
| Rodar as checagens estáticas | `node scripts/check-static.mjs --only=sw` (grupos: `sintaxe`, `essenciais`, `sw`, `json`, `deps`, `segredos`; origem: `.github/workflows/ci.yml:112-146`) |
| Achar um helper de teste | `grep -rn "export " tests/helpers` e `grep -rn "helpers/" tests scripts` |
| Rodar localmente | `python3 -m http.server 8080` (`README.md:216-218`; HTTPS é obrigatório para SW/Web Crypto) |

Histórico da base mecânica (reproduzível): a v1 de `audit/deps.py` exigia quebra de linha antes de `import` e, por isso, perdia imports como os de `src/main.js:3` e `src/ui/clients.js:1` (relatava 47 nós e 57 arestas). A v2 passou a contar imports múltiplos na mesma linha; a v3 atual varre todo o repositório (inclusive `tests/unit`, `tests/svc`, `tests/contracts`), separa arestas de app e de ferramenta e reporta os 74 nós / 204 arestas usados aqui. A v3 ainda descarta especificadores montados por template literal (`import(`…${x}…`)`), que não são arestas estáticas — os dois únicos `missing` residuais são strings de exemplo dentro de `tests/contracts/imports.test.mjs` e são filtradas por `check-static.mjs` e pelo próprio teste de contrato, que afirmam 0 imports quebrados. Se algum dia `deps.json` voltar a divergir do código, o teste de sanidade é: soma de `fan-out` interno == arestas internas, e `missing`/`cycles` vazios.

---

## 8. Convenções de nomenclatura observadas no código

| Convenção | Onde se vê | Observação |
|---|---|---|
| Diretório = camada; arquivo = módulo | `src/ui/`, `src/services/`, `src/domain/`, `src/db/`, `src/security/`, `src/export/`, `src/files/`, `src/core/`, `src/config/` | nenhum módulo de camada baixa importa camada alta |
| `*.test.mjs` em `tests/` com Node puro | `tests/crypto.test.mjs` | extensão `.mjs` marca ESM sem depender de `package.json` por pasta |
| Aliases de import por papel | `import*as db from'../db/idb.js'`, `V` validators, `M` money, `S` serviço, `A` auth, `P` pwa, `CEP`, `CPF`, `G` drive, `CL`/`D`/`P` em `ui/clients.js:1` | `ui/clients.js` usa `X` para o `ctx` e `U` para o objeto de apresentação compartilhado (`:2,12`) |
| Funções de tela em minúscula, views exportadas com sufixo `View` | `clientsView` (`ui/clients.js:13`), `debtsPageView` (`:14`), `reportsView`/`backupView` (`ui/tools.js:6,31`), `settingsView` (`ui/settings.js:15`) | `initShell` (`ui/shell.js:10`) e `card` (`ui/dashboard.js:3`) são as duas exceções estabelecidas |
| `data-page` em kebab-case como identificador de tela | `home`, `clients`, `client`, `new-client`, `edit-client`, `debts`, `edit-debt`, `bulk`, `reports`, `backup`, `settings` | serve de chave para o menu (`ui/shell.js:53`) |
| `data-*` de comportamento no shell | `data-k` (chave do item), `data-i` (já processado) | `ui/shell.js:16,57` |
| Classes CSS BEM-like com sufixo `--modificador` | `.field--full`, `.avatar--lg`, `.tile--accent`, `.badge--type`, `.card--debts`, `.form-section--address`, `.list--grid`, `.search--page`, `.pager-btn.is-current`, `.auth-shell` | definidas em `css/ui.css`, usadas por `h(...,{class:'...'})` |
| Constantes em `SCREAMING_CASE`, chaves de storage em pontos | `MAXR`, `ITER`, `FORMAT`, `LISTS`, `CATS`, `GOOGLE_OAUTH`, `SS_SID='sc.sid'`, `STORE='scipione.google.oauth'`, `FOLDER='SCIPIONE CRED - Backups'` | `src/domain/money.js:2`, `src/export/backup-format.js:5`, `src/security/auth.js:5`, `src/services/google-drive.js:6-11` |
| Serviços devolvem erros com `code` estável | `fail(msg,'NOT_FOUND')`, `fail('INVALID')`, `reason:'UNAVAILABLE'` | `src/services/viacep.js:5-31`, `src/services/apicpf.js:4-48`, `api/cpf.js:14-42` |
| Código do domínio fala em centavos e taxa em centésimos | `principal`, `rate`, `interest`, `due`, `createdAt`, `updatedAt`, `clientId`, `blobId`, `photoId`, `photoType`, `hash` | `src/services/debts.js:4`, `src/services/records.js:7` (esses campos ficam em claro para os índices) |
| Texto de interface em português, comentários também | `src/ui/clients.js:48`, `src/main.js:19-33` | nomes de módulo e identificadores ficam em inglês |
| Ferramental em kebab-case dentro de `scripts/` e `tests/helpers/`, com flags `--only=<grupo>` | `scripts/run-tests.mjs`, `scripts/check-static.mjs`, `tests/helpers/fake-idb.mjs` | scripts são `.mjs` executáveis (shebang `#!/usr/bin/env node`) e não entram no bundle nem em `FILES` do service worker |
| Formato: uma instrução por linha quando possível, imports comprimidos | `src/ui/clients.js:1`, `tests/money.test.mjs:1` | não há bundler nem minificador no build: o que está no repositório é o que o navegador baixa (`sw.js:2` espelha exatamente esses caminhos) |
