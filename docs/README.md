# SCIPIONE CRED, Etapa 1
Executar: `python3 -m http.server 8080` (ou `npx serve`) nesta pasta e abrir http://localhost:8080. Para celular/instalação, publique em HTTPS (service worker e Web Crypto exigem contexto seguro).
Teste da criptografia: `node tests/crypto.test.mjs`.

Módulos: `db/idb.js` (IndexedDB versionado, gravação confirmada em oncomplete) · `security/crypto.js` (PBKDF2 600 mil + AES-GCM, DEK embrulhada) · `security/auth.js` (cadastro, login, bloqueio, inatividade, atraso após 5 erros) · `pwa.js` · `sw.js` (cache offline) · `main.js` (telas).

Limites: a criptografia protege dados em repouso; não protege contra aparelho comprometido, malware ou XSS com o app desbloqueado. O atraso após tentativas erradas é local e contornável: a defesa real é o custo do PBKDF2 e uma senha forte. Sem recuperação de senha. No iOS, o Safari pode apagar dados de sites não instalados após ~7 dias sem uso: instale na Tela de Início e faça backups (Etapa 5).

## Etapas 2 a 5 (resumo técnico)
- **Dados:** registros cifrados com AES-GCM (id, createdAt e clientId em claro para índices); `db.batch` grava várias operações numa transação e avisa as telas (`data-changed`). Dinheiro em centavos, taxa em centésimos de ponto percentual, juros simples = principal × taxa / 100 (BigInt, arredondamento ao centavo).
- **Excel:** `src/export/xlsx.js` gera o .xlsx (XML + ZIP via fflate), sem biblioteca de planilha. Abas: Dívidas (registradas no período) e Movimentações (histórico no período).
- **Relatório A4:** HTML com CSS de impressão (`@page` retrato/paisagem). Pré-visualização na tela e botão Imprimir.
- **Backup (formatVersion 1):** ZIP com `manifest.json` (contagens, versão, SHA-256 de cada arquivo), `data/*.json` e `files/<id>.bin`. Criptografado: ZIP externo com `manifest.json` (salt, iterações) + `payload.enc` (AES-GCM, PBKDF2 600 mil). A senha do cofre não entra no backup; cada aparelho tem o seu cofre.
- **Restauração:** valida estrutura, SHA-256 e relacionamentos; prepara tudo antes de tocar no banco; troca em uma única transação. Modos: substituir tudo ou mesclar (cliente com mesmo CPF/CNPJ não é duplicado; dívidas com id já existente são ignoradas).
- **Instalação:** servir a pasta por HTTPS (ou localhost) e instalar pelo navegador (iPhone: Safari › Compartilhar › Adicionar à Tela de Início). Ao criar arquivos novos, incluí-los em `FILES` no `sw.js` e incrementar `V`.
- **Testes:** `for t in money validators crypto stage4 backup; do node tests/$t.test.mjs; done`.

## Etapa 6 (UI/UX)
Camada exclusivamente visual, sem alteração de regras de negócio, banco ou fluxos:
- **Estilos:** `css/app.css` (tokens de cor e tipografia, base, relatório e impressão) e `css/ui.css` (componentes, grades, breakpoints, movimento reduzido).
- **Componentes compartilhados:** `src/ui/kit.js` (iniciais, datas, plural, seletor de arquivo em pt-BR) e `src/ui/icons.js` (ícones SVG de traço fino, 1,6 px).
- **Navegação:** `src/ui/shell.js` monta barra inferior até 719 px, rail de 96 px de 720 a 1099 px e menu lateral a partir de 1100 px. Título, ações de bloqueio/saída e navegação usam os mesmos componentes nas três faixas.
- **Responsivo:** conteúdo em coluna única no celular; métricas em uma coluna no celular e três colunas a partir de 720 px; listas em 2 colunas e cartões lado a lado a partir de 1000 px; formulários em 2 colunas a partir de 720 px.
- **Rolagem:** barras de rolagem ocultas em todos os tamanhos de tela; rolagem preservada por toque, roda e teclado.
- **Feedback:** transições suaves entre telas, spinners nas ações assíncronas e estado de carregamento acessível (`aria-busy`).
- **Uploads:** áreas pontilhadas com ícone central e texto simples, adaptadas a celular, tablet e desktop.
- **Login:** cena do escritório como banner no celular e painel lateral dividido a partir de 760 px, com sobreposição escura e degradê de transição para o painel, mantendo a leitura.
- **Marca:** imagem original do chapéu inteira e sem recorte, com a moldura dourada original, usada na navegação, no login e nos ícones do aplicativo (192, 512, maskable e apple-touch), sem contorno adicional, sombra ou cantos arredondados.
- **Estética:** sem bordas, linhas divisórias ou separadores; hierarquia por espaçamento, superfícies e contraste; botões e campos sem contorno em repouso.
- **Acessibilidade:** link "Ir para o conteúdo", foco visível (halo suave em campos e anel em botões), alvos de toque >= 44 px, `aria-current` na navegação, rótulos associados, `role="alert"`/`status` nas mensagens e `prefers-reduced-motion` respeitado.
- **Impressão:** `@page` retrato/paisagem, tabela do relatório sem corte, dica de rolagem apenas em tela.
