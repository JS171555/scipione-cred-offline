# Auditoria de UI/UX e código — 16/11/2026

Esta auditoria partiu de uma leitura completa da aplicação e de testes no navegador antes de qualquer alteração. O critério adotado foi conservador: só entrou no código o que pôde ser reproduzido, corrigido e validado sem mudar regras de negócio, banco de dados ou fluxos existentes.

## Melhorias implementadas

| Área | Problema identificado | Correção aplicada | Evidência |
| --- | --- | --- | --- |
| Sessão e telas assíncronas | Uma tela iniciada antes do bloqueio podia terminar de carregar e aparecer sobre o cadeado. O caso de Configurações foi reproduzido de forma determinística. | Guardas de sessão em Configurações, Início, Clientes, Dívidas e Perfil; observadores registrados antes do primeiro carregamento. | Testes de corrida: tela de bloqueio presente, tela antiga ausente. |
| Memória e arquivos | URLs temporárias de prévias de fotografia, avatar e visualizador não eram liberadas em todos os caminhos. | Liberação ao fechar o visualizador, ao trocar a prévia e ao descartar elementos desconectados. | Teste de prévia e avatar; PDF abre normalmente. |
| Exclusão de cliente | A remoção de documentos fazia uma leitura extra por documento e podia falhar com registro ausente. | Uma única leitura de documentos do cliente antes do lote de exclusão. | Cliente com documentos excluído; lista atualizada; sem erros. |
| IndexedDB | Um lote vazio lançava erro de transação, afetando restaurações sem novidades. | Lote vazio passou a ser uma operação segura sem efeito. | Teste direto de `batch([])` e restauração sem novidades. |
| Service worker | Falha de qualquer asset retornava o `index.html`, mascarando erros e podendo entregar HTML no lugar de imagem ou script. | Fallback de `index.html` apenas para navegação; assets ausentes falham explicitamente. | Teste online/offline e requisição de asset inexistente. |
| Segurança de deployment | A aplicação não restringia objetos incorporados e o Vercel não negava enquadramento. | CSP com `object-src 'none'`; `X-Frame-Options: DENY` e `frame-ancestors 'none'` no Vercel. | PDF do cliente continua abrindo; configuração JSON validada. |
| Toque e acessibilidade | Alguns controles menores que 44 px e o visualizador sem nome acessível. | Ações do perfil, alerta e paginação com alvo mínimo de 44 px; diálogo com `aria-label`. | Medições em 320, 390, 834 e 1280 px; sem overflow horizontal. |
| Instalação PWA | Cada visita a Configurações acumulava um callback de instalação. | Apenas o callback mais recente é mantido. | Teste com dois registros: uma execução. |
| Fotografia ausente | Falha ao ler a foto do perfil podia gerar rejeição não tratada. | Falha silenciosa e manutenção das iniciais. | Teste de prévia e perfil. |

## Itens identificados e não alterados

A tela de login ainda ultrapassa a altura da janela em alguns aparelhos. As medições foram 1121 px de altura em 320×480, 1129 px em 390×844 e 859 px em 1280×800. Não alterei a composição porque qualquer correção exige uma decisão visual sobre tipografia, imagem e espaçamento, e versões anteriores do login foram revertidas por decisão de design. A recomendação é aprovar uma variante compacta específica para alturas menores.

Os cabeçalhos `X-Frame-Options` e `frame-ancestors` só podem ser aplicados no Vercel; o GitHub Pages não permite cabeçalhos HTTP personalizados. Para produção no GitHub Pages, a proteção contra enquadramento depende de um proxy compatível ou de aceitar essa limitação.

O filtro de período dos relatórios continua usando a data de registro da dívida, enquanto a coluna DATA mostra a data de vencimento, conforme pedido anterior. Alterar o filtro mudaria a regra do relatório, portanto ficou preservado.

O backup sem senha mantém o formato aberto por definição; o backup criptografado continua disponível e é o caminho recomendado para transporte.

## Testes realizados

Todos os módulos passaram em `node --check`. A suíte existente (`money`, `validators`, `crypto`, `stage4`, `backup`) passou. O teste funcional completo percorreu criação de cliente, documento, edição, dívida, exclusão, juros em lote, Excel, backup, bloqueio e desbloqueio, terminando sem erros de console.

Também foram executados testes específicos de paginação com 25 clientes, 18 dívidas e 23 atividades; de corrida de sessão em Configurações, Início e Perfil; de service worker online/offline; de prévia de fotografia; de abertura de PDF; de exclusão de cliente; de restauração sem novidades; e de overflow horizontal em 320, 390, 834 e 1280 px em todas as rotas principais.

## Arquivos alterados

`src/main.js`, `src/ui/dashboard.js`, `src/ui/clientlist.js`, `src/ui/debtspage.js`, `src/ui/settings.js`, `src/ui/clients.js`, `src/services/clients.js`, `src/db/idb.js`, `src/pwa.js`, `css/ui.css`, `index.html`, `vercel.json` e `sw.js`.
