# Guia técnico de implementação para a Manus

## Projeto SCIPIONE CRED --- Parcelamentos, filtros de clientes e relatórios

**Material analisado:** `scipione-cred-offline-main.zip`\
**Objetivo:** orientar a implementação das cinco etapas solicitadas
usando a arquitetura real do repositório, preservando dados,
criptografia, funcionamento offline e compatibilidade com backups
existentes.

------------------------------------------------------------------------

## 1. Diagnóstico do projeto atual

### 1.1 Arquitetura e persistência

O SCIPIONE CRED é uma aplicação web estática, local-first e
offline-first.

-   A base de dados principal é **IndexedDB**, no banco `scipione-cred`.
-   Não foi identificada integração do banco principal com Supabase.
-   Os registros de clientes, dívidas, documentos e histórico são
    criptografados antes de serem persistidos.
-   A criptografia e a sessão do cofre estão em `src/security/`.
-   A camada de acesso ao IndexedDB está em `src/db/idb.js`.
-   O app utiliza ES Modules e não possui framework de frontend
    aparente; a interface é construída com JavaScript e elementos DOM.
-   O Service Worker mantém os arquivos da aplicação em cache para uso
    offline.
-   Os dados pertencem à origem/navegador em que foram cadastrados; a
    transferência entre origens/aparelhos é feita por backup e
    restauração.

**Consequência:** não criar tabelas SQL no Supabase como solução padrão
para esta implementação. A nova funcionalidade deve seguir o mecanismo
IndexedDB + criptografia já existente, a menos que o proprietário decida
explicitamente mudar a arquitetura.

### 1.2 Estrutura atual do IndexedDB

Arquivo: `src/db/idb.js`

O banco está versionado por uma lista `MIGRATIONS`. A versão atual é
derivada de `MIGRATIONS.length`.

Object stores identificados na migração atual:

  Store         Finalidade
  ------------- ----------------------------
  `meta`        Metadados do cofre
  `settings`    Configurações
  `clients`     Clientes
  `debts`       Dívidas
  `documents`   Documentos anexados
  `blobs`       Arquivos binários cifrados
  `history`     Histórico de atividades

As stores de registros usam `id` como chave primária. Clientes e dívidas
possuem índices de `createdAt`; dívidas, documentos e histórico também
possuem índice `clientId`.

**Regra de evolução:** nunca editar migrações antigas. Adicionar uma
nova função ao final de `MIGRATIONS` para criar as novas stores e
índices. A migração deve ser compatível com cofres que já possuem dados.

### 1.3 Camada de criptografia e serviços

Arquivos importantes:

-   `src/services/records.js`: funções `uid`, `list`, `one`, `enc`,
    `hist` e operações de arquivos cifrados.
-   `src/security/auth.js`: estado do cofre e chave de criptografia.
-   `src/security/crypto.js`: funções de criptografia e descriptografia.
-   `src/db/idb.js`: `get`, `getAll`, `put`, `del` e `batch`.

Os registros de negócio são cifrados por `enc()`. Os campos de
identificação necessários a índices --- como `id`, `createdAt` e
`clientId` --- ficam fora do conteúdo cifrado, conforme o padrão atual.

`db.batch()` executa operações em uma única transação IndexedDB, com
confirmação em `transaction.oncomplete`. É o mecanismo existente para
gravar várias alterações de forma atômica.

**Atenção:** preparar os dados cifrados antes de abrir a transação. Não
executar operações assíncronas de criptografia dentro de uma transação
IndexedDB já aberta, pois ela pode ficar inativa.

------------------------------------------------------------------------

## 2. Mapa dos arquivos que a Manus deve estudar

  --------------------------------------------------------------------------------
  Necessidade             Arquivos existentes              Orientação
  ----------------------- -------------------------------- -----------------------
  Evolução do banco       `src/db/idb.js`                  Nova migração, sem
                                                           alterar as antigas

  Criptografia e          `src/services/records.js`,       Reutilizar `enc`,
  registros               `src/security/crypto.js`,        `list`, `one`, `uid` e
                          `src/security/auth.js`           `hist`

  Regras monetárias       `src/domain/money.js`            Trabalhar em centavos
                                                           inteiros

  Clientes                `src/services/clients.js`        Reaproveitar
                                                           `listClients`,
                                                           `getClient`,
                                                           `listHistory`

  Dívidas                 `src/services/debts.js`          Reaproveitar
                                                           `listDebts`, `saveDebt`
                                                           e os padrões de
                                                           validação

  Lista de clientes e     `src/ui/clientlist.js`           Acrescentar filtro
  filtros                                                  alfabético e
                                                           totalizador sem remover
                                                           filtro de taxa

  Navegação e telas de    `src/ui/clients.js`              Integrar nova
  clientes                                                 tela/fluxo mantendo o
                                                           padrão de renderização

  Página de dívidas       `src/ui/debtspage.js`,           Entender os padrões de
                          `src/ui/debts.js`                listagem, formulário e
                                                           atualização

  Menu principal          `src/ui/shell.js`                Inserir Parcelamentos
                                                           logo após Dívidas

  Inicialização e rotas   `src/main.js`                    Registrar a nova tela e
                                                           sua navegação

  Relatórios              `src/export/reports.js`,         Reaproveitar estrutura
                          `src/ui/tools.js`                de relatório, impressão
                                                           e exportação

  Backup/restauração      `src/export/backup-format.js`,   Incluir os novos dados
                          `src/export/backup.js`           e validar integridade

  Cache offline           `sw.js`                          Incluir cada arquivo
                                                           novo em `FILES` e
                                                           incrementar `V`

  Estilos                 `css/app.css`, `css/ui.css`      Seguir tokens,
                                                           componentes e
                                                           responsividade atuais

  Testes                  `tests/*.test.mjs`               Criar testes de
                                                           domínio, serviços,
                                                           migração e backup
  --------------------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Regras financeiras já existentes --- cuidado para não quebrar

### 3.1 Dinheiro em centavos inteiros

Arquivo: `src/domain/money.js`

O projeto representa dinheiro em **centavos inteiros**, não em reais de
ponto flutuante. A taxa é armazenada em centésimos de ponto percentual.
Por exemplo, 15% corresponde a `1500`.

Funções existentes:

-   `M.cents(...)`: converte entrada monetária em centavos.
-   `M.brl(...)`: formata centavos como reais.
-   `M.interest(principal, rate)`: calcula juros mensais com `BigInt`.
-   `M.parseRate(...)` e `M.rate(...)`: interpretam e formatam taxas.

Todo cálculo de parcelas deve seguir o padrão de centavos inteiros. Não
usar `valor / quantidade` em reais de ponto flutuante como fonte
persistida do valor das parcelas.

Para distribuir o valor: calcular quociente e resto em centavos
inteiros. Distribuir os centavos restantes de forma determinística entre
as primeiras parcelas, de modo que a soma final seja exatamente igual ao
total.

### 3.2 O modelo atual de dívida não possui amortização/baixa

Arquivo: `src/services/debts.js`

A dívida atual possui, entre outros campos, `principal`, `rate`, `date`
e `due`. Os juros são derivados em `withI()` a partir do principal e da
taxa.

O README do projeto informa que atualmente não existe
quitação/amortização: a dívida continua contando no saldo enquanto
existir. Não foi identificada uma entidade de pagamento de dívida na
estrutura atual.

**Este é o principal ponto de integração a resolver antes de implementar
a baixa.**

A Manus deve estudar e documentar como o sistema calcula o saldo exibido
no dashboard, perfil e relatórios. Não presumir que `principal` é
necessariamente igual ao saldo total em aberto em todos os contextos.

Antes de programar, definir explicitamente qual valor poderá ser
parcelado: - somente o principal original; - principal acrescido de
juros acumulados; - ou outro saldo calculado pela regra já adotada pelo
produto.

O requisito do usuário fala em "saldo da dívida", mas o código atual
deriva juros mensais e não mantém histórico de amortização. Não inventar
uma regra contábil silenciosamente. Se o código não permitir determinar
o saldo correto, apresentar essa decisão ao proprietário antes de
alterar o comportamento financeiro.

### 3.3 Fonte única da verdade

Evitar armazenar o mesmo saldo editável em vários lugares. Definir uma
fonte canônica para: - valor original parcelado; - pagamentos
efetivamente registrados; - saldo restante; - saldo da dívida de origem.

Se algum saldo for armazenado como cache, ele deve ser recalculável e
validado contra os lançamentos. Preferir derivar totais a partir das
parcelas e pagamentos, ou atualizar tudo atomicamente com invariantes
testadas.

------------------------------------------------------------------------

## 4. Modelo de dados recomendado para parcelamentos

A proposta abaixo é uma orientação de modelagem, não uma afirmação de
que essas entidades já existem.

### 4.1 Nova store `installments` ou `installment_plans`

Guardar cada contrato/plano de parcelamento com: - `id` - `clientId` -
`debtId` (dívida de origem) - `createdAt`, `updatedAt` - `totalCents` -
`installmentCount` - `startDate` - `firstDueDate` - demais metadados
estritamente necessários

### 4.2 Nova store `installment_items`

Guardar cada parcela: - `id` - `clientId` - `planId` - `debtId` -
`number` - `amountCents` - `dueDate` - `paidAt` ou estado derivado -
`createdAt`

Criar índices úteis para `clientId`, `planId`, `debtId` e datas,
respeitando o padrão de stores atual. Como o conteúdo é cifrado, decidir
cuidadosamente quais metadados precisam ficar em claro para indexação,
minimizando exposição.

### 4.3 Pagamentos e idempotência

A baixa deve ter uma identidade única associada à parcela. Uma restrição
de unicidade ou mecanismo transacional deve impedir dois pagamentos
ativos para a mesma parcela.

Como o `idb.js` atual não oferece uma operação de "compare-and-set"
pronta, a Manus deve implementar a proteção dentro de uma única
transação que leia e escreva os registros envolvidos. Se necessário,
ampliar a camada de banco com uma operação transacional específica, sem
fazer `get` e `put` em transações separadas.

A baixa deve: 1. confirmar que a parcela existe e ainda não foi paga; 2.
gravar o pagamento/baixa; 3. atualizar o estado da parcela ou seu
vínculo; 4. atualizar a dívida de origem conforme a regra aprovada; 5.
registrar histórico do cliente; 6. confirmar tudo em uma única
transação.

Se uma etapa falhar, nenhuma parte da baixa pode permanecer gravada.

### 4.4 Exclusão de cliente e dívida

`deleteClient()` em `src/services/clients.js` atualmente remove
documentos, blobs, dívidas e histórico relacionados ao cliente.

Ao adicionar parcelamentos, revisar a exclusão para evitar registros
órfãos. Não apagar silenciosamente um parcelamento com pagamentos:
definir bloqueio, arquivamento ou exclusão em cascata com histórico, de
acordo com as regras aprovadas.

Também revisar `deleteDebt()` em `src/services/debts.js`: uma dívida que
já possui parcelamento deve ter comportamento seguro e explícito (por
exemplo, impedir exclusão enquanto houver parcelamento ativo ou
histórico financeiro).

------------------------------------------------------------------------

## 5. Regras específicas para as cinco etapas

### Etapa 1 --- Área e navegação

-   O menu é montado em `src/ui/shell.js`.
-   Hoje há itens Início, Clientes, Dívidas, Relatórios e Backup.
-   Inserir Parcelamentos imediatamente após Dívidas, tanto na navegação
    desktop quanto na versão mobile --- ambas derivam do mesmo menu.
-   O shell recebe funções de tela via `initShell()` em `src/main.js`.
-   Seguir o padrão de páginas existente: `U.top(...)`, `U.render(...)`,
    `h(...)` e atualização via eventos de dados.
-   Verificar o comportamento de `data-changed` e o mecanismo de
    observação em `src/core/live.js`.

### Etapa 2 --- Criação e cálculo

-   Selecionar cliente e depois filtrar as dívidas desse cliente.
-   Exibir somente dívidas elegíveis e o saldo calculado conforme regra
    financeira aprovada.
-   Limitar de 1 a 60 parcelas.
-   Usar datas ISO `YYYY-MM-DD`, como o restante do domínio.
-   Calcular vencimentos mensalmente sem acumular erro de calendário:
    cada vencimento deve ser calculado a partir da data-base original e
    do índice da parcela, limitando o dia ao último dia do mês quando
    necessário.
-   Pré-visualizar todas as parcelas antes de persistir.
-   Salvar plano e parcelas em lote atômico.
-   Impedir parcelar novamente o mesmo saldo já comprometido por outro
    plano.

### Etapa 3 --- Baixas, estados e histórico

-   Estado "paga" deve decorrer de um pagamento persistido, não apenas
    de uma checkbox visual.
-   Estado "vencida" deve ser derivado: não paga e `dueDate` anterior à
    data local atual.
-   "Pendente": não paga e ainda não vencida.
-   A baixa deve ser idempotente e transacional.
-   Estorno, se implementado, deve criar registro de reversão e
    preservar auditoria; não apagar a baixa original.
-   Registrar eventos no histórico do cliente com
    `hist(clientId, tipo, detalhe)`.
-   Definir se pagamento parcial será permitido. O requisito original
    descreve baixa integral de parcela; não implementar pagamento
    parcial sem aprovação.

### Etapa 4 --- Filtros de Clientes

Arquivo central: `src/ui/clientlist.js`.

O filtro atual já tem busca, ordenação e taxa. A taxa usa
`M.parseRate()` e `findByRate()` no serviço de dívidas.

-   Adicionar filtro alfabético sem remover busca, ordenação, paginação
    ou taxa.
-   Comparar nomes ignorando caixa e acentos, por exemplo com
    normalização Unicode e remoção de diacríticos.
-   O totalizador deve somar somente as dívidas que satisfazem o filtro
    de taxa, não o principal de todas as dívidas dos clientes
    retornados.
-   Evitar somar a mesma dívida mais de uma vez se o cliente tiver mais
    de um registro correspondente.
-   Definir a interação quando taxa e letra estiverem simultaneamente
    ativas: aplicar ambos os critérios e calcular o total sobre as
    dívidas correspondentes aos dois filtros.
-   Preservar paginação e atualizar a página para 1 quando os filtros
    mudarem.

### Etapa 5 --- Relatórios e compatibilidade

Arquivos: `src/export/reports.js` e `src/ui/tools.js`.

O relatório atual é A4, com pré-visualização, impressão e Excel.
Reaproveitar seus padrões de layout e impressão.

-   Criar seção de relatório de parcelamentos sem alterar o relatório
    atual de dívidas.
-   Mostrar cada plano e suas parcelas, com datas, estados, total pago e
    saldo restante.
-   Aplicar filtros na consulta, sem modificar registros.
-   Se criar exportação Excel, seguir o gerador já existente em
    `src/export/xlsx.js`.

------------------------------------------------------------------------

## 6. Backup, restauração e PWA --- obrigatório

### 6.1 Backup

`src/export/backup-format.js` declara atualmente `FORMAT=1` e
`LISTS=['clients','debts','documents','history']`.

Ao adicionar novas stores: - incluir os novos registros no backup; -
validar relacionamentos entre plano, parcela, cliente e dívida; -
incluir os novos dados na restauração; - manter compatibilidade com
backups antigos que não possuem parcelamentos; - definir valores
vazios/defaults para stores ausentes em backups antigos; - testar tanto
backup antigo quanto backup novo; - testar mesclagem e substituição,
conforme os modos já existentes; - preservar criptografia e verificação
SHA-256.

Não alterar o formato antigo de modo que backups existentes deixem de
restaurar. Se precisar evoluir o formato, implementar leitura
retrocompatível.

### 6.2 Service Worker

`sw.js` mantém uma lista explícita `FILES` e uma versão de cache `V`.

Todo arquivo JavaScript/CSS novo precisa entrar em `FILES`, e a versão
`V` deve ser incrementada. Caso contrário, a aplicação instalada pode
continuar servindo código antigo ou não carregar os novos módulos
offline.

------------------------------------------------------------------------

## 7. Testes mínimos exigidos

Criar testes automatizados para as regras de domínio e serviços. O
projeto usa `node --test` e o comando é `npm test`.

### Cálculo

-   1, 2, 12, 24 e 60 parcelas.
-   Valores divisíveis e não divisíveis em centavos.
-   Soma das parcelas idêntica ao total.
-   Vencimentos no dia 29, 30 e 31.
-   Fevereiro em ano bissexto e não bissexto.
-   Mudança de ano.

### Integridade

-   Cliente inexistente.
-   Dívida inexistente, quitada ou sem saldo.
-   Tentativa de parcelar saldo já comprometido.
-   Duas baixas concorrentes da mesma parcela.
-   Baixa repetida.
-   Falha no meio da transação.
-   Estorno e histórico, se houver.

### Filtros

-   Nomes com e sem acentos.
-   Maiúsculas/minúsculas.
-   Letra + taxa simultaneamente.
-   Total apenas das dívidas filtradas.
-   Paginação após alteração do filtro.

### Compatibilidade

-   Migração de um cofre com dados antigos.
-   Backup antigo restaurado na versão nova.
-   Backup novo restaurado.
-   Mesclagem sem duplicar registros.
-   Uso offline após atualização do Service Worker.
-   Testes em desktop e viewport mobile.

Executar `npm test` e os testes funcionais do navegador. Corrigir falhas
antes de concluir.

------------------------------------------------------------------------

## 8. Decisões que a Manus não deve tomar silenciosamente

Antes de implementar, confirmar no código e, se não houver resposta
inequívoca, perguntar ao proprietário:

1.  **Composição do saldo parcelável:** o saldo é somente principal ou
    inclui juros? O sistema atual calcula juros mensais derivados, mas
    não possui amortização.
2.  **Tratamento da dívida original:** ao criar o parcelamento, a dívida
    original fica bloqueada/comprometida, é marcada como parcelada ou
    seu saldo é convertido? Não deixar a dívida original e o
    parcelamento cobrando o mesmo valor em duplicidade.
3.  **Múltiplos parcelamentos:** uma dívida pode ter mais de um
    parcelamento ao longo do tempo, por renegociação, ou apenas um plano
    ativo?
4.  **Pagamento:** a baixa é sempre integral por parcela? O requisito
    atual sugere baixa integral; pagamento parcial não deve ser
    presumido.
5.  **Estorno:** quais perfis/condições podem estornar uma parcela paga?
    O projeto atual é local e não aparenta ter perfis multiusuário.

------------------------------------------------------------------------

## 9. Instrução pronta para acompanhar o ZIP na Manus

> Analise o repositório `scipione-cred-offline-main.zip` e leia
> integralmente o documento `GUIA_TECNICO_MANUS.md` antes de modificar
> qualquer arquivo. Use o código real como fonte de verdade. O guia
> identifica a arquitetura, os arquivos centrais, as regras financeiras
> atuais e os pontos de compatibilidade.
>
> Implemente as cinco etapas do documento funcional fornecido,
> respeitando o padrão local-first, IndexedDB, criptografia e
> funcionamento offline. Não introduza Supabase ou backend novo sem
> autorização explícita. Não entregue apenas telas: implemente serviços,
> persistência, validações, backup/restauração, testes e atualização do
> Service Worker.
>
> Antes de alterar a regra de saldo da dívida, examine o modelo atual e
> esclareça as decisões listadas na seção 8 do guia. Preserve os dados e
> a compatibilidade com backups anteriores. Trabalhe em etapas pequenas,
> execute os testes e apresente ao final um resumo dos arquivos
> alterados, migrações, decisões financeiras, testes executados e
> limitações restantes.

------------------------------------------------------------------------

## 10. Critério de conclusão

A implementação só deve ser considerada concluída quando: - o
parcelamento for persistido e reaberto corretamente; - a baixa atualizar
a dívida sem duplicidade; - os totais forem matematicamente
consistentes; - os filtros exibirem e totalizarem os registros
corretos; - o relatório imprimir corretamente; - backups antigos
continuarem restaurando; - o sistema funcionar offline após
atualização; - os testes automatizados e funcionais passarem; - nenhuma
funcionalidade anterior tiver sido removida ou degradada.
