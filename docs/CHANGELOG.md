# Changelog — SCIPIONE CRED

Histórico verificável das mudanças do repositório. Formato inspirado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), com uma diferença deliberada: **o projeto não publica versões nem tags** (nenhum `git tag` existe, e `package.json:1` não tem campo `version` — ver `docs/ROADMAP.md`, trilha T7). Os marcos abaixo são organizados por data e confirmados pelo histórico do Git.

Cada linha de marcos anteriores a esta branch foi derivada de `git log` (64 commits, `6fa0a7f` → `e78d776`), não de memória nem de documentação. Os hashes curtos são o meio de conferência.

Legenda das travas de projeto: **PWA** = exige `sw.js` com `V` incrementado e arquivo em `FILES`; **cofre** = toca em criptografia/sessão; **schema** = altera IndexedDB; **UI** = altera identidade visual.

---

## [Não publicado] — branch `fix/api-cpf-exposure-and-debt-integrity`

Correção dos dois itens mais importantes apontados pela auditoria anterior: **S-02** (`/api/cpf` como oráculo público, sem autenticação nem rate limit) e **D-01** (`saveDebt` aceitava `clientId` inexistente). Base: `chore/project-audit-and-test-infrastructure` (PR #1). Nenhum outro item foi tocado. **Sem mudança de schema, de cofre ou de regra financeira**; nenhuma linha de CSS, texto de botão, ícone ou estrutura de tela foi alterada. **PWA**: três arquivos pré-cacheados mudaram (`src/services/apicpf.js`, `src/services/debts.js`, `src/ui/debts.js`) e o `V` foi de `sc-v69` para `sc-v70` (`sw.js:2`); `api/cpf.js` é função serverless e não entra em `FILES`.

### Para quem usa o aplicativo

- Nada muda na tela, com uma exceção: ao tentar salvar uma dívida de um cliente que não existe mais (perfil excluído em outra aba, por exemplo), aparece a mensagem **"Cliente não encontrado. Atualize a tela e tente de novo."** em vez de um `TypeError` cru. Antes a dívida era gravada mesmo sem cliente — o registro órfão entrava nos totais do painel, não aparecia no extrato de ninguém e fazia a restauração de backup ser rejeitada. Agora a escrita é recusada (`src/services/debts.js:20`), depois de a validação de campo continuar respondendo primeiro para a UI pintar por campo (`src/services/debts.js:15`).
- A consulta de CPF continua silenciosa: `429`, `403`, `413` e `415` caem no mesmo caminho de "indisponível" que já existia (`src/services/apicpf.js:24-27`,`:47`), sem código de erro novo e sem aviso na interface.

### Para quem opera o deploy

- **Contrato novo:** o navegador passa a enviar o CPF no corpo de um `POST` (`src/services/apicpf.js:28-33`). O `GET /api/cpf?cpf=` legado **continua aceito e está deprecado**: sai de cena quando não houver mais instalação com bundle antigo chamando a forma velha (`api/cpf.js:71-72`).
- A perna servidor→APICPF **não mudou**: `GET ${ENDPOINT}?cpf=...` com `X-API-KEY` (`api/cpf.js:114`) é o contrato da provedora e não é nosso para mudar. O ganho de privacidade é entre o navegador e a *nossa* função; a assimetria é intencional.
- **Quatro variáveis de ambiente novas**, lidas a cada requisição (`api/cpf.js:15-17`): `CPF_QUOTA_WINDOW_MS` (60000), `CPF_QUOTA_PER_IP` (30), `CPF_QUOTA_PER_INSTANCE` (300) e `SCIPIONE_ALLOWED_ORIGINS` (vazio = só o host da requisição). Placeholders no `.env.example`.
- **Respostas novas do `/api/cpf`:** `405` para método fora de GET/POST, `415` sem `content-type: application/json`, `403` para origem estrangeira e `429` com header `Retry-After` em segundos (`api/cpf.js:94-100`); `413` para corpo acima de 1024 bytes e `422` para JSON quebrado, campo ausente ou CPF inválido — sem ecoar o CPF (`api/cpf.js:104-106`). `403`/`429`/`503` mantêm `Cache-Control: no-store`.
- **Pendente, e fora do repositório:** a cota é em memória e **por instância aquecida**, não distribuída (`api/cpf.js:19-22`). O teto real de custo é uma regra de rate limit da WAF da Vercel, **ainda não criada no dashboard** — os passos estão no `README.md`, seção Deploy › Vercel. Por código (`routes[].mitigate` em `vercel.json`) só cabem `challenge` e `deny`, e o SDK `@vercel/firewall` é dependência externa, proibida pelo projeto.

### Para quem desenvolve

- **Suíte: 497 casos, 55 suítes, 0 falhas, ~10,7 s** em 28 arquivos (4.509 linhas, 1.180 chamadas de `assert`), verde tanto em `TZ=America/Sao_Paulo` quanto em `TZ=UTC` — 46 legados + 161 `unit` + 175 `svc` + 115 `contracts`. Os novos casos estão em `tests/apicpf.test.mjs` (20 → 40), `tests/unit/apicpf-client.test.mjs` (11 → 15) e `tests/svc/debts.test.mjs` (17 → 23); `tests/svc/dashboard.test.mjs` teve 2 casos reescritos (17).
- Como a cota é estado de módulo por design, `api/cpf.js` exporta `__quota` com `reset()`, `size()` e `ip(req)` (`api/cpf.js:138`), para os testes isolarem contadores sem reiniciar o processo. Não é API pública do aplicativo.
- A dívida órfã passou a ser **injetada por escrita direta no store** nos testes: pela guarda nova, o caminho normal de criação não produz mais órfão, então o cenário legado só é alcançável gravando o registro à margem do serviço.
- O teste de navegador com a **função serverless real** roda fora do repositório e fora da CI: um shim `node:http` serve `api/cpf.js` com o upstream da APICPF stubado em memória. Nesta rodada: **23/23 verificações** — POST com corpo e nenhuma query na URL da função, preenchimento de nome/nascimento/gênero, normalização (`trim`, whitelist `M/F/I`, ISO estrito) aplicada no cliente, `?cpf=` ainda na URL do provedor, chave só no salto servidor→provedor, `403` em origem estrangeira, `415` em content-type errado e, no caminho órfão, mensagem amigável, nenhum `TypeError`, store `debts` inalterada e **zero** linhas novas em `history`.

### Itens fechados

- **D-01 — feito.** Guarda de integridade referencial em `saveDebt` (`src/services/debts.js:20`) **mais** a correção do defeito que a escondia: `src/ui/debtspage.js:16` resolve `undefined` para dívida órfã legada e o submit estourava `TypeError` antes de qualquer mensagem legível; passou a `c?.id` (`src/ui/debts.js:27`), de modo que o `undefined` chega ao serviço e vira texto.
- **S-02 — parcial: código feito, WAF pendente.** `api/cpf.js` foi reescrito (48 → 138 linhas) com transporte no corpo, checagem de origem, cota por IP/instância e `429` + `Retry-After`. Não é autenticação: `Origin`/`Referer` são controlados pelo cliente e, sem header nenhum, o pedido segue.

### Lacunas novas registradas por esta entrega

- `deleteDebt` (`src/services/debts.js:29`) e `applyBulk` (`src/services/debts.js:38`) ainda escrevem linha em `history` com `clientId` de cliente inexistente quando o dado é legado: a guarda cobre criação/edição de dívida, não o histórico órfão.
- Não há caminho na UI para **reatribuir** uma dívida órfã legada a um cliente existente; o formulário apenas recusa o salvamento.
- O `GET /api/cpf` legado continua aceito, e a barreira efetiva contra IP rotacionado depende de `CPF_QUOTA_PER_INSTANCE` mais a regra WAF do dashboard.
- S-01, S-03..S-09 e D-02..D-09 permanecem intocados.

---

## [Não publicado] — branch `chore/project-audit-and-test-infrastructure`

Auditoria técnica completa, documentação canônica, infraestrutura de testes e CI. Base: `main@e78d776`. **Nenhuma alteração funcional, visual, de schema ou de regras financeiras.**

### Adicionado

- **Documentação técnica** (`docs/`): `ARCHITECTURE.md` (camadas, decisões, invariantes), `PROJECT_MAP.md` (inventário arquivo a arquivo + grafo de dependências + mapa "funcionalidade → arquivo"), `DATABASE.md` (esquema IndexedDB real, envelope de cifração, transações, riscos de integridade, roteiro de migração), `SECURITY.md` (vulnerabilidades confirmadas × riscos potenciais × boas práticas, com evidência), `API.md` (137 contratos: função serverless, terceiros e exports internos), `TESTING.md` (como testar, cobertura real e lacunas), `ROADMAP.md` (62 itens em 7 trilhas, 19 exigindo autorização) e este `CHANGELOG.md`.
- **`AGENTS.md`** na raiz: manual operacional de 10 passos para agentes de IA que forem modificar o projeto, com travas, armadilhas conhecidas e checklist de PR.
- **Infraestrutura de testes** (`tests/`): helpers sem dependências externas — `fake-idb.mjs` (stub determinístico de IndexedDB), `dom.mjs` (stubs mínimos de navegador, com limites declarados), `fetch-mock.mjs` (intercepta `globalThis.fetch` e nega rede por padrão), `vault.mjs` (setup/unlock/lock usando o código real) e `fixtures.mjs` (dados 100% fictícios).
- **Novas suítes** (`tests/unit/` 9 arquivos, `tests/svc/` 8, `tests/contracts/` 3): a suíte passou de 26 para **461 casos** em 27 arquivos (4.570 linhas, 973 asserções, ~9,5 s), cobrindo os 15 comportamentos da auditoria. Cobertura medida: 25 dos 38 módulos de aplicação carregados por teste, média de 96,50 % de linha entre os medidos; os 13 restantes são a camada de UI, `main.js` e `pwa.js`, que exigem navegador (§5 de `docs/TESTING.md`). Inclui o conteúdo real do `.xlsx` gerado (`tests/unit/xlsx.test.mjs`), que antes só era escrito em `/tmp` sem asserção. *(Contagem: 461 é o estado desta PR #1; a branch de correção fechou em **497 casos**, 28 arquivos, ~10,7 s — os números vigentes estão na seção do topo.)*
- **Scripts de qualidade** (`scripts/`): `check-static.mjs` (sintaxe, `V`/`FILES` vs disco, JSONs, segredos commitados, ausência de dependências novas) e `run-tests.mjs` (descoberta de testes, falha se a descoberta for vazia, re-leitura do TAP, artefatos).
- **Integração contínua** (`.github/workflows/ci.yml`): jobs `estatico` → `testes` (matriz de fuso horário `America/Sao_Paulo` e `UTC`) → `smoke-navegador` (não bloqueante), com gate bloqueante e artefatos de execução.

### Corrigido

- **`tests/apicpf.test.mjs`**: o caso "sem `APICPF_API_KEY`" fazia `process.env.APICPF_API_KEY = undefined`, que o Node coage para a **string** `"undefined"` (truthy). A guarda de `api/cpf.js:20` era burlada e o teste disparava uma **requisição HTTPS real** a um terceiro com CPF na URL antes de instalar o stub; o `503` esperado vinha do `catch` (`api/cpf.js:43`), não da guarda — cobertura real da guarda: 0 %. Agora a variável é apagada com `delete`, o fetch-espião é instalado antes de qualquer chamada e se assevera **zero** requisições de rede. Reprodução e evidência em `docs/TESTING.md`.
- Mesma camada, dois casos que cobravam validação do **cliente** (`src/services/apicpf.js:33-35`) sobre o **proxy** (`api/cpf.js:35`, que só checa tipo) foram reescritos como testes de caracterização do comportamento real das duas camadas.

- **`docs/API.md`**: a linha de `isoOf` afirmava que um timestamp inválido produzia `'NaN-NaN-NaN'`. Medido em Node 22: `isoOf()` **lança** `RangeError: Invalid time value` para `'não-e-data'`, `undefined` e `''`, e `isoOf(null)` é coagido a `0` devolvendo a época deslocada pelo fuso. Corrigido com base no teste novo.

> **Nota de re-leitura desta seção:** as linhas `api/cpf.js:20`, `api/cpf.js:43` e `src/services/apicpf.js:33-35` citadas acima descrevem o código **como era nesta PR #1**. Na branch de correção, `api/cpf.js` foi reescrito (48 → 138 linhas) e `src/services/apicpf.js` passou de 58 para 64; os equivalentes de hoje são a guarda da chave em `api/cpf.js:108`,`:109`, o `catch` de indisponibilidade em `api/cpf.js:129`-`:130`, a normalização da resposta em `src/services/apicpf.js:38-42` e o transporte no corpo em `src/services/apicpf.js:28-33`.

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
