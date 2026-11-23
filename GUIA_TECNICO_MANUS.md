# Guia técnico para futuras melhorias — SCIPIONE CRED

> **Revisão técnica:** 23/11/2026. Este documento descreve a implementação encontrada no repositório nesta data. Antes de qualquer alteração, confirme os arquivos e o estado atual do Git: o código é a fonte de verdade; este guia e outros documentos podem ficar desatualizados.
>
> **Objetivo:** orientar a Manus em melhorias futuras, preservando as regras financeiras, os dados locais, a criptografia, os backups, o funcionamento offline e as funcionalidades já existentes.

---

## 1. Regras para qualquer mudança

1. Leia este guia, o `README.md`, `docs/README.md` e as instruções locais do repositório. Inspecione também os módulos e testes relacionados ao pedido; não implemente com base apenas em uma cópia ZIP ou em descrições antigas.
2. Confira `git status`, branch e alterações locais antes de editar. Preserve mudanças do proprietário; não reverta arquivos que não pertencem ao escopo solicitado.
3. Faça a menor mudança que resolva o pedido. Não remova, simplifique ou redesenhe outras funcionalidades sem necessidade e autorização.
4. Não introduza Supabase, outro backend, sincronização, analytics, dependências externas ou mudanças na arquitetura local-first sem solicitação explícita.
5. Nunca use dados reais de clientes em testes, exemplos, capturas de tela, logs ou backups de demonstração. Use dados fictícios e identificadores claramente demonstrativos.
6. Se uma alteração afetar saldo, juros, baixa, exclusão, migração irreversível, restauração ou privacidade e a regra não estiver clara, explique a decisão necessária ao proprietário antes de alterar o comportamento.
7. Execute os testes relevantes e a suíte completa. Faça uma verificação funcional em desktop e mobile quando a mudança alterar a interface ou o fluxo do usuário.
8. O proprietário prefere alterações publicadas diretamente no GitHub em vez de receber arquivos. Ao publicar: busque `origin/main` antes, preserve commits remotos, não altere a configuração global do Git/GitHub e informe o commit e os testes. Se a publicação não for possível sem conflito ou permissão adicional, explique o bloqueio em vez de sobrescrever alterações.

---

## 2. Arquitetura atual

O SCIPIONE CRED é uma aplicação estática, local-first e offline-first, escrita em JavaScript ES Modules, HTML e CSS. Não há etapa de build nem dependências de instalação para executar o app. O banco de dados principal é o IndexedDB local, chamado `scipione-cred`; os dados não são enviados a um servidor do aplicativo.

A senha do cofre protege uma chave de dados com PBKDF2-SHA256; os registros são cifrados com AES-GCM. O Service Worker mantém uma lista explícita de recursos em cache para operação offline. Cada origem/navegador tem seu próprio cofre. A transferência entre aparelhos ou origens é feita por backup e restauração.

### Mapa rápido de módulos

| Responsabilidade | Arquivos principais | Observações |
| --- | --- | --- |
| Inicialização e rotas | `src/main.js` | Inicializa autenticação, telas e shell responsivo. |
| Navegação | `src/ui/shell.js` | Monta o mesmo menu em barra mobile, rail tablet e menu desktop. |
| Banco e migrações | `src/db/idb.js` | Stores, índices, transações, `batch` e `compareAndBatch`. |
| Criptografia/sessão | `src/security/crypto.js`, `src/security/auth.js` | PBKDF2, AES-GCM, chave do cofre e bloqueio. |
| Acesso comum a registros | `src/services/records.js` | `list`, `one`, `enc`, `hist`, blobs e metadados cifrados. |
| Regras monetárias | `src/domain/money.js` | Centavos inteiros, taxas e juros mensais com `BigInt`. |
| Regras de parcelamento | `src/domain/installments.js` | Datas, divisão das parcelas e cálculo do principal após baixa/estorno. |
| Clientes e filtros | `src/services/clients.js`, `src/ui/clientlist.js`, `src/domain/client-filters.js` | Cadastro, documentos, busca, filtros alfabéticos e taxa selecionada. |
| Dívidas | `src/services/debts.js`, `src/ui/debts.js`, `src/ui/debtspage.js` | Cadastro, alteração, filtros e taxa; o principal vinculado a plano tem restrições. |
| Parcelamentos | `src/services/installments.js`, `src/ui/installments.js` | Criação, prévia, marcação/desmarcação de baixa e exclusão do plano. |
| Painel e dados derivados | `src/services/dashboard.js`, `src/ui/dashboard.js` | Indicadores derivados dos clientes e dívidas. |
| Relatórios e exportação | `src/export/reports.js`, `src/export/xlsx.js`, `src/ui/tools.js` | Relatório A4 de dívidas/parcelas e arquivos Excel. |
| Backup/restauração | `src/export/backup-format.js`, `src/export/backup.js`, `src/ui/tools.js` | ZIP, verificação de integridade, senha opcional e Google Drive opcional. |
| PWA e atualização | `src/pwa.js`, `sw.js`, `manifest.json` | Instalação, persistência e cache offline. |
| Estilos e arquivos | `css/app.css`, `css/ui.css`, `src/files/process.js` | Tokens visuais, componentes, responsividade e tratamento de anexos. |
| Testes | `tests/*.test.mjs` | Suíte nativa do Node; sem dependências de teste externas. |

---

## 3. IndexedDB, cifra e integridade

### 3.1 Stores existentes

`src/db/idb.js` define as migrações em `MIGRATIONS`; a versão do banco é `MIGRATIONS.length`. No estado de referência deste guia, as stores são:

| Store | Conteúdo/uso | Índices ou observações |
| --- | --- | --- |
| `meta` | Metadados necessários ao cofre | Inclui salt e chave de dados protegida. |
| `settings` | Preferências do aplicativo | Chave primária `key`. |
| `clients` | Dados dos clientes | `id`, `createdAt`. |
| `debts` | Dívidas e principal atual | `id`, `clientId`, `createdAt`. |
| `documents` | Metadados de anexos | `id`, `clientId`. |
| `blobs` | Bytes cifrados de fotos/documentos | Separada dos metadados. |
| `history` | Eventos de cliente e financeiros | `id`, `clientId` e índices declarados no esquema. |
| `installment_plans` | Plano e array `items` de parcelas | `id`, `clientId`, `debtId`; índice `debtId` único. Não há store separada de parcelas no modelo atual. |

A migração inicial cria o esquema base e a migração seguinte adiciona `installment_plans`. **Nunca edite ou reordene migrações já publicadas.** Para um novo store ou índice, acrescente uma migração ao final e teste a atualização de um banco que já contém dados.

### 3.2 Campos cifrados e metadados

`src/services/records.js` concentra a codificação. O conteúdo de negócio é salvo cifrado no campo `data`. Para permitir chave primária, índices, ordenação ou unicidade, alguns metadados ficam em claro: `id`, `createdAt`, `clientId` e, nos planos, `debtId`. Trate esses metadados como informação sensível mesmo que não estejam cifrados.

Use `enc()`/`list()`/`one()` em vez de criar formatos de registro paralelos. Fotos e anexos passam por `src/files/process.js` e são cifrados como blobs. Não registre dados pessoais ou chaves no console, em erros, URLs ou telemetria.

### 3.3 Transações e operações concorrentes

- `db.batch(ops)` grava múltiplas operações em uma transação IndexedDB e só conclui após `transaction.oncomplete`.
- `db.compareAndBatch(checks, ops)` compara snapshots e grava na mesma transação. É usado para impedir que uma baixa se baseie em plano/dívida que mudou desde a leitura.
- Prepare e cifre os dados **antes** de abrir a transação. Não aguarde Web Crypto nem outra operação assíncrona dentro de uma transação que precisa permanecer ativa.
- Quando várias entidades precisam mudar juntas, inclua todas em uma única transação: sucesso total ou nenhuma gravação. Use `compareAndBatch` se houver risco de concorrência ou saldo desatualizado.
- Mantenha invariantes explícitas e testadas; uma verificação apenas na interface não protege o banco contra outra aba ou estado obsoleto.

---

## 4. Regras financeiras e parcelamentos atuais

### 4.1 Representação de dinheiro

- Valores monetários são **centavos inteiros**. Taxas são armazenadas em centésimos de ponto percentual; por exemplo, 15% é `1500`.
- `src/domain/money.js` define formatação/conversão e `interest(principal, rate)`. Juros mensais simples são derivados do principal e da taxa, com `BigInt` e arredondamento ao centavo.
- Não use números de ponto flutuante como fonte persistida de valores em reais. Ao dividir um valor, distribua quociente e resto em centavos e garanta que a soma das parcelas seja exatamente igual ao total.

### 4.2 Modelo atual de dívida e plano

`debts.principal` representa o principal ainda associado à dívida. Os juros são derivados; não existe um campo independente de juros acumulados. O plano guarda `totalCents`, `count`, datas e `items[]` (cada item contém número, `amountCents`, `dueDate` e `paidAt`). O array do plano está no conteúdo cifrado de `installment_plans`.

Comportamento implementado:

- Um plano pode conter de 1 a 60 parcelas, com pelo menos R$ 0,01 por parcela. A soma dos valores é igual ao principal disponível na criação.
- O primeiro vencimento deve ser igual ou posterior à data de início. Os vencimentos seguintes usam avanço mensal com ajuste ao último dia do mês.
- As parcelas não recebem juros adicionais. O juro mensal da dívida continua sendo calculado sobre o principal restante.
- Marcar uma parcela como paga desconta o valor integral dela do principal. Desmarcá-la devolve exatamente o mesmo valor. Não existe pagamento parcial avulso de uma parcela.
- Uma dívida pode ter apenas um plano vinculado por vez; o índice único de `debtId` também protege essa regra.
- Com plano vinculado, `saveDebt()` impede alterar o principal da dívida; `deleteDebt()` impede excluir a dívida. A exclusão do cliente é bloqueada quando o plano contém parcelas baixadas, para preservar o histórico financeiro.
- Excluir um plano não altera o principal atual e não reverte baixas já efetuadas. Isso pode deixar o valor originalmente programado maior que o saldo atual; não “corrigir” esse estado automaticamente.

**Não mude silenciosamente** a composição do saldo, cálculo de juros, divisão/ordem dos centavos, significado de `paidAt`, exclusões ou possibilidade de renegociação. Antes de uma nova regra, defina e aprove a semântica financeira, a compatibilidade dos dados e o comportamento de relatórios/backups.

---

## 5. Padrões de implementação por camada

### 5.1 Domínio e serviços

Coloque regras puras e sem acesso ao DOM em `src/domain/`; regras que carregam/gravam entidades e integram banco em `src/services/`. Valide entradas novamente no serviço, não apenas no formulário. Preserve mensagens de erro úteis em português brasileiro.

Para novas regras de lista, mantenha filtros combináveis e centralize helpers reutilizáveis em `src/domain/` quando fizer sentido. O filtro de taxa de clientes usa igualdade exata da taxa; a inicial alfabética ignora caixa e acentos. O totalizador considera as dívidas da taxa escolhida para os clientes que também satisfazem os filtros ativos — não soma todas as dívidas desses clientes.

### 5.2 Interface, rotas e atualização de telas

- Use os componentes/funções de tela já adotados e a fábrica DOM recebida pelo contexto (`h`, `show`/`U.render`, `U.top` conforme a tela existente). Evite adicionar um framework ou duplicar componentes sem necessidade.
- Para uma tela nova, integre sua função em `src/main.js` e `src/ui/shell.js`; o menu gera os layouts mobile, tablet e desktop a partir das mesmas ações.
- Observe os dados com `watch()` de `src/core/live.js` e remova observadores com `unwatch()` ao navegar, seguindo a tela correspondente. `batch` e `compareAndBatch` disparam `data-changed` após a gravação.
- Preserve navegação por teclado, rótulos associados, mensagens `role="alert"`/`role="status"`, foco visível, alvos de toque e `prefers-reduced-motion`.
- Reutilize variáveis e componentes de `css/app.css` e `css/ui.css`. Teste em larguras mobile, tablet e desktop; não resolva layout mobile ampliando a página inteira ou escondendo conteúdo funcional.

### 5.3 Relatórios e Excel

`src/export/reports.js` contém consultas e transformação dos dados; `reportsView()` está em `src/ui/tools.js`. Os relatórios existentes têm semânticas de período distintas:

- Dívidas: filtra pela data de registro (`debt.date`); histórico/movimentações, pela data do evento.
- Parcelamentos: filtra pela data de início do plano (`startDate`), não pelo vencimento da parcela.

A pré-visualização A4 e a impressão são compartilhadas com o fluxo atual. Exportações são construídas em `src/export/xlsx.js` sem biblioteca de planilha. Se incluir campos, mantenha os totais e unidades coerentes e teste o conteúdo das abas; não altere o relatório de dívidas ao adicionar outro tipo.

### 5.4 Backup e restauração

O formato atual é `FORMAT=1`. `src/export/backup-format.js` lista `clients`, `debts`, `documents`, `history` e `installment_plans`, além de settings e arquivos anexos. O ZIP inclui manifest, contagens e SHA-256; a criptografia opcional usa senha própria e PBKDF2/AES-GCM. A senha do cofre e as chaves do cofre não são exportadas.

Backups antigos podem não conter `installment_plans`; a leitura atual fornece uma lista vazia. A restauração valida hashes e relacionamentos antes de gravar. A mesclagem respeita clientes/documentos existentes e verifica que o saldo de dívida combina com as parcelas já pagas; se não combinar, deve falhar com mensagem clara, sem fazer uma restauração parcial.

Ao adicionar dados persistidos, inclua-os em criação, contagem, validação, backup, restauração por substituição e mesclagem. Só aumente a versão do formato quando necessário; mantenha leitura retrocompatível e teste backup antigo e novo, mesclagem e substituição. Nunca reduza validações para “fazer o backup passar”.

---

## 6. Offline, integrações e segurança

- `sw.js` usa a lista explícita `FILES` e atualmente define a chave `V='sc-v0'`. Arquivo novo necessário à execução offline deve entrar na lista. Ao alterar recursos servidos pelo cache, atualize a chave de cache de modo que clientes instalados obtenham a versão nova; respeite uma instrução explícita do proprietário sobre a versão desejada.
- Teste a primeira instalação com rede e a reabertura offline após ativação do Service Worker. Não use cache longo que impeça a atualização do `sw.js`/HTML.
- Integrações externas são opcionais. ViaCEP, APICPF e Google Drive devem falhar com comportamento compreensível e não bloquear fluxos locais. Segredos de servidor como `APICPF_API_KEY` nunca devem entrar no JavaScript entregue ao navegador; `client_secret` OAuth não é necessário no frontend.
- Se adicionar uma origem ou serviço externo, atualize a CSP de `index.html` e as configurações de cabeçalho aplicáveis (`vercel.json`); explique os dados que saem do aparelho, limite-os ao mínimo e defina o comportamento offline.
- Não reduza PBKDF2, AES-GCM, validações de backup, confirmação de ações destrutivas ou proteções transacionais para simplificar implementação.

---

## 7. Testes e validação

Comandos do projeto:

```bash
npm test
npm start
```

`npm test` executa `node --test tests/*.test.mjs`. Não fixe no guia o número de testes; ele cresce com a implementação. `npm start` serve a aplicação localmente na porta 8080; Web Crypto e Service Worker exigem `localhost` ou HTTPS.

Para cada mudança:

1. Adicione testes unitários para regras puras e testes de serviço para persistência/transações.
2. Cubra limites e entradas inválidas, incluindo centavos, arredondamento e datas se a mudança for financeira.
3. Cubra cenários de estado obsoleto/concorrência e atomicidade quando várias entidades mudarem.
4. Teste migração a partir de banco com dados existentes e compatibilidade de backups quando tocar em esquema/dados.
5. Rode a suíte completa. Em mudanças de UI, faça verificação manual em desktop e mobile; em mudanças offline, valide com o Service Worker atualizado e sem rede.
6. Execute `git diff --check`; confirme que o diff contém apenas arquivos do escopo e nenhum dado real, segredo ou artefato local temporário.

---

## 8. Decisões que exigem definição do proprietário

Peça esclarecimento somente quando a resposta alterar regra de negócio, dados, segurança ou comportamento difícil de reverter. Exemplos:

- incluir juros vencidos no valor parcelado ou manter as parcelas sem juros adicionais;
- permitir múltiplos planos/renegociações para a mesma dívida;
- permitir pagamento parcial, alterar ou remover baixas e preservar o histórico correspondente;
- mudar a política de exclusão de dívida/cliente com plano ou baixas;
- alterar a estrutura/semântica de backups, sincronizar aparelhos ou mover dados para serviço remoto;
- migrar, limpar ou recalcular dados já existentes.

Para escolhas visuais ou técnicas reversíveis dentro do pedido, siga os padrões do projeto e prossiga; não interrompa o trabalho com perguntas desnecessárias.

---

## 9. Checklist de entrega para futuras tarefas

- [ ] Li o pedido, o README, este guia e os arquivos atuais; confirmei branch/estado do Git.
- [ ] Mantive o escopo solicitado e preservei funcionalidades não relacionadas.
- [ ] Mantive as regras de centavos, juros, transações e cifra; se a regra financeira mudou, obtive definição explícita.
- [ ] Atualizei migração, relatórios, backups, Service Worker e CSP quando aplicável.
- [ ] Incluí testes para o novo comportamento e rodei `npm test`.
- [ ] Verifiquei UI desktop/mobile e funcionamento offline quando aplicável.
- [ ] Revisei `git diff --check`, referências e ausência de dados reais/segredos.
- [ ] Antes de publicar, busquei `origin/main` e confirmei que nenhuma alteração remota seria perdida.
- [ ] Informei no resumo o que mudou, commit/branch e verificações realizadas.

---

## 10. Instrução-base para uma futura melhoria

> Leia `GUIA_TECNICO_MANUS.md`, `README.md`, `docs/README.md` e o código atual antes de alterar o SCIPIONE CRED. Use o repositório como fonte de verdade e verifique o estado do Git para preservar alterações existentes. Implemente somente a melhoria solicitada, seguindo as camadas e convenções atuais; não introduza backend, sincronização ou dependências sem autorização. Preserve IndexedDB, criptografia, dados, backups, compatibilidade offline, acessibilidade e regras financeiras. Se o pedido depender de uma regra financeira ou mudança destrutiva não definida, esclareça essa decisão antes de codificar. Acrescente testes, execute `npm test`, valide UI/offline conforme o escopo e revise o diff. O proprietário prefere atualização direta no GitHub: busque primeiro `origin/main`, não sobrescreva commits e reporte o commit e as validações.
