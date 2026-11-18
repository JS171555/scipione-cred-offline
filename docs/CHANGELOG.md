# Changelog — SCIPIONE CRED

Histórico verificável das mudanças do repositório. Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), com uma diferença deliberada: **o projeto não publica versões nem tags** (nenhum `git tag` existe, e `package.json:1` não tem campo `version` — ver `docs/ROADMAP.md`, trilha T7). Os marcos abaixo são organizados por data e confirmados pelo histórico do Git.

Cada linha de marcos anteriores a esta branch foi derivada de `git log` (64 commits, `6fa0a7f` → `e78d776`), não de memória nem de documentação. Os hashes curtos são o meio de conferência.

Legenda das travas de projeto: **PWA** = exige `sw.js` com `V` incrementado e arquivo em `FILES`; **cofre** = toca em criptografia/sessão; **schema** = altera IndexedDB; **UI** = altera identidade visual.

---

## [Não publicado] — branch `chore/project-audit-and-test-infrastructure`

Auditoria técnica completa, documentação canônica, infraestrutura de testes e CI. Base: `main@e78d776`. **Nenhuma alteração funcional, visual, de schema ou de regras financeiras.**

### Adicionado

- **Documentação técnica** (`docs/`): `ARCHITECTURE.md` (camadas, decisões, invariantes), `PROJECT_MAP.md` (inventário arquivo a arquivo + grafo de dependências + mapa "funcionalidade → arquivo"), `DATABASE.md` (esquema IndexedDB real, envelope de cifração, transações, riscos de integridade, roteiro de migração), `SECURITY.md` (vulnerabilidades confirmadas × riscos potenciais × boas práticas, com evidência), `API.md` (137 contratos: função serverless, terceiros e exports internos), `TESTING.md` (como testar, cobertura real e lacunas), `ROADMAP.md` (62 itens em 7 trilhas, 19 exigindo autorização) e este `CHANGELOG.md`.
- **`AGENTS.md`** na raiz: manual operacional de 10 passos para agentes de IA que forem modificar o projeto, com travas, armadilhas conhecidas e checklist de PR.
- **Infraestrutura de testes** (`tests/`): helpers sem dependências externas — `fake-idb.mjs` (stub determinístico de IndexedDB), `dom.mjs` (stubs mínimos de navegador, com limites declarados), `fetch-mock.mjs` (intercepta `globalThis.fetch` e nega rede por padrão), `vault.mjs` (setup/unlock/lock usando o código real) e `fixtures.mjs` (dados 100% fictícios).
- **Novas suítes** (`tests/unit/` 9 arquivos, `tests/svc/` 8, `tests/contracts/` 3): a suíte passou de 26 para **461 casos** em 27 arquivos (4.570 linhas, 973 asserções, ~9,5 s), cobrindo os 15 comportamentos da auditoria. Cobertura medida: 25 dos 38 módulos de aplicação carregados por teste, média de 96,50 % de linha entre os medidos; os 13 restantes são a camada de UI, `main.js` e `pwa.js`, que exigem navegador (§5 de `docs/TESTING.md`). Inclui o conteúdo real do `.xlsx` gerado (`tests/unit/xlsx.test.mjs`), que antes só era escrito em `/tmp` sem asserção.
- **Scripts de qualidade** (`scripts/`): `check-static.mjs` (sintaxe, `V`/`FILES` vs disco, JSONs, segredos commitados, ausência de dependências novas) e `run-tests.mjs` (descoberta de testes, falha se a descoberta for vazia, re-leitura do TAP, artefatos).
- **Integração contínua** (`.github/workflows/ci.yml`): jobs `estatico` → `testes` (matriz de fuso horário `America/Sao_Paulo` e `UTC`) → `smoke-navegador` (não bloqueante), com gate bloqueante e artefatos de execução.

### Corrigido

- **`tests/apicpf.test.mjs`**: o caso "sem `APICPF_API_KEY`" fazia `process.env.APICPF_API_KEY = undefined`, que o Node coage para a **string** `"undefined"` (truthy). A guarda de `api/cpf.js:20` era burlada e o teste disparava uma **requisição HTTPS real** a um terceiro com CPF na URL antes de instalar o stub; o `503` esperado vinha do `catch` (`api/cpf.js:43`), não da guarda — cobertura real da guarda: 0 %. Agora a variável é apagada com `delete`, o fetch-espião é instalado antes de qualquer chamada e se assevera **zero** requisições de rede. Reprodução e evidência em `docs/TESTING.md`.
- Mesma camada, dois casos que cobravam validação do **cliente** (`src/services/apicpf.js:33-35`) sobre o **proxy** (`api/cpf.js:35`, que só checa tipo) foram reescritos como testes de caracterização do comportamento real das duas camadas.

- **`docs/API.md`**: a linha de `isoOf` afirmava que um timestamp inválido produzia `'NaN-NaN-NaN'`. Medido em Node 22: `isoOf()` **lança** `RangeError: Invalid time value` para `'não-e-data'`, `undefined` e `''`, e `isoOf(null)` é coagido a `0` devolvendo a época deslocada pelo fuso. Corrigido com base no teste novo.

### Documentado como não corrigido

As vulnerabilidades e dívidas encontradas **não** foram corrigidas aqui, por exigência de escopo: cada uma virou item rastreável em `docs/ROADMAP.md` (com severidade, evidência e critério de aceite) e em `docs/SECURITY.md`.

---

## 2026-11-17 — CPF, endereço e formulário de cliente

### Adicionado

- Validação de CPF por provedor externo com proxy serverless (`fd6bc3c`): `api/cpf.js` + `src/services/apicpf.js` — **PWA**, **cofre** (dado sai do aparelho).
- Consulta de endereço por CEP (ViaCEP) no cadastro (`0939c91`) e reordenação dos campos de endereço com número (`8d57ccb`) e complemento (`3d374a1`) — **UI**.
- Rótulo "Razão social" para pessoas jurídicas (`ec34286`) e agrupamento do formulário em "Dados pessoais" e "Endereço" (`40dd7d6`) — **UI**.
- Alinhamento da prévia de fotografia com caixa de envio quadrada e compacta (`c3d06be`), caixa de upload em largura máxima em tablet/desktop (`584ce89`) e ícone de upload centralizado junto ao rótulo, com ícone reduzido na prévia circular (`e78d776`) — **UI**, **PWA**.

### Corrigido / ajustado

- Diagnóstico de OAuth do Google: seleção de conta (`9ebd096`), clareza sobre propriedade do projeto e clientes obsoletos (`922f584`), redefinição em um clique (`8ee8dd6`), projeto atual definido (`7c4dae1`).
- Compatibilidade do backup no Google Drive entre navegadores (`229a052`), mantendo o comportamento do backup local inalterado (`7510df2`).

## 2026-11-16 — Login, paginação, Drive e endurecimento

### Adicionado

- Paginação em clientes, dívidas e histórico do cliente (`078837a`) — **UI**.
- Backup e restauração via Google Drive (`6884b97`) e configuração com cliente OAuth Web (`7dfef00`) — **PWA**.
- Documento abaixo das dívidas no perfil (`f1aecb1`) e hierarquia financeira destacada no cartão de dívida (`ff68d49`) — **UI**.

### Corrigido

- Endurecimento de views assíncronas, armazenamento e segurança de implantação (`3f4bc03`) — **cofre**.
- Colunas de relatório consistentes em tela e impressão (`e89572d`).
- Ciclo de iteração do login: reconstrução editorial (`09ab709`), cenas sem corte (`757d06c`) e três restaurações sucessivas ao layout anterior (`feecaa5`, `224d8c9`, `50c96ad`) — registro histórico de que a direção visual foi revista e revertida; o estado vigente é o pré-redesign.
- Alinhamento das ações do perfil no mobile (`ba6227b`, `07c5fee`, `bbbf783`, `ad998df`) com bump de cache explícito (`fce04d3`); a tentativa `338cc80` foi revertida por `87bedb0`.
- README e capturas atualizados (`0dce5b2`).

## 2026-11-15 — Fundação

### Adicionado

- Estrutura inicial do app, cofre local e implantabilidade na Vercel (`6fa0a7f`, `d58733d`, `bd325ed`), logo completo sem corte (`0a5c679`) e guia de publicação no GitHub Pages (`2677445`) com README reescrito (`f4fa046`).
- Identidade visual Scipione (`6eb2460`), fotos dos clientes nas listas (`fa501ce`) com ícone próprio para substituir foto (`92d4bcd`), áreas de envio de arquivo refinadas (`db7e1ce`) e prévia alinhada à área de envio (`d9413e3`) — **UI**.
- Sessão persistente entre recarregamentos da página (`120eacd`) — **cofre**.
- Feedback por toast com auto-fechamento (`1075512`), transições e carregamento (`51b131c`), barras de rolagem ocultas (`f491a7c`).
- Relatórios: colunas e cabeçalhos alinhados (`fa6d66b`), datas de vencimento (`e4745bd`), remoção de total redundante (`948f866`), correção de overflow do campo de mês no iOS (`3f01591`).
- Página de configurações responsiva com cartões de sistema reposicionados (`2ef404e`) e cenas de login rotativas (`a1917df`) — **UI**.

---

## Como atualizar este arquivo

1. Uma entrada por mudança **coerente** (não por commit forçado); mantenha o hash curto para conferência.
2. Se a mudança toca arquivo pré-cacheado, marque **PWA** e confirme `V` incrementado em `sw.js` — quatro commits históricos (`ba6227b`, `ff247af`, `ef4b96f`, `922f584`) alteraram arquivos em `FILES` sem bumpar `V`, o que deixa instalação antiga servindo módulo velho (`docs/ROADMAP.md`, item P-01).
3. Se muda schema, formato de backup ou o cofre, marque a trava correspondente e atualize `docs/DATABASE.md`/`docs/SECURITY.md` — essas mudanças exigem autorização explícita do mantenedor.
4. Nunca registre como "corrigido" algo que apenas foi documentado: use a seção "Documentado como não corrigido".
