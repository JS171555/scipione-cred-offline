# SCIPIONE CRED — documentação técnica
Executar: `python3 -m http.server 8080` (ou `npx serve`) nesta pasta e abrir http://localhost:8080. Para celular/instalação, publique em HTTPS (service worker e Web Crypto exigem contexto seguro).
Teste da criptografia: `node tests/crypto.test.mjs`.

Módulos: `db/idb.js` (IndexedDB versionado, gravação confirmada em oncomplete) · `security/crypto.js` (PBKDF2 600 mil + AES-GCM, DEK embrulhada) · `security/auth.js` (cadastro, login, sessão persistente na mesma aba, bloqueio, inatividade, atraso após 5 erros) · `pwa.js` · `sw.js` (cache offline) · `main.js` (telas) · `ui/settings.js` (configurações) · `services/google-drive.js` (OAuth e Drive API) · `services/viacep.js` (consulta de CEP) · `domain/address.js` (máscara e composição do endereço) · `config/google.js` (ID público do cliente).
Identidade: tokens em `css/app.css` (fundo `#080808`, cards `#171717`, dourado `#B89A62`, marfim `#E8DFC9`, bronze `#34302A`); Cormorant Garamond e DM Sans em `assets/fonts`, com fallback local e cache offline.
Safari/iOS: campos `date` e `month` recebem `min-width:0`, `max-width:100%` e reset de aparência nativa para não estourarem os cards; o seletor nativo continua abrindo ao toque.

Limites: a criptografia protege dados em repouso; não protege contra aparelho comprometido, malware ou XSS com o app desbloqueado. O atraso após tentativas erradas é local e contornável: a defesa real é o custo do PBKDF2 e uma senha forte. Sem recuperação de senha. No iOS, o Safari pode apagar dados de sites não instalados após ~7 dias sem uso: instale na Tela de Início e faça backups regulares.

## Núcleo funcional (resumo técnico)
- **Dados:** registros cifrados com AES-GCM (id, createdAt e clientId em claro para índices); `db.batch` grava várias operações numa transação e avisa as telas (`data-changed`). Dinheiro em centavos, taxa em centésimos de ponto percentual, juros simples = principal × taxa / 100 (BigInt, arredondamento ao centavo).
- **Excel:** `src/export/xlsx.js` gera o .xlsx (XML + ZIP via fflate), sem biblioteca de planilha. Abas: Dívidas (registradas no período) e Movimentações (histórico no período).
- **Relatório A4:** HTML com CSS de impressão (`@page` retrato/paisagem). Pré-visualização na tela e botão Imprimir.
- **Backup (formatVersion 1):** ZIP com `manifest.json` (contagens, versão, SHA-256 de cada arquivo), `data/*.json` e `files/<id>.bin`. Criptografado: ZIP externo com `manifest.json` (salt, iterações) + `payload.enc` (AES-GCM, PBKDF2 600 mil). A senha do cofre não entra no backup; cada aparelho tem o seu cofre.
- **Google Drive:** OAuth 2.0 no navegador via Google Identity Services, escopo `drive.file`, pasta `SCIPIONE CRED - Backups`, upload multipart e download com SHA-256 gravado em `appProperties`. O token fica só na memória da aba; o `client_secret` nunca é usado. O projeto já vem configurado com um cliente OAuth **Web** para a origem de produção da Vercel; para localhost ou outro domínio, autorize a origem ou importe o JSON do cliente. Veja `docs/google-drive.md`.
  A CSP libera `accounts.google.com` e `www.googleapis.com`; `style-src` permite estilos inline porque o script do Google Identity Services os injeta, enquanto `script-src` continua restrito a `'self'` e ao domínio do Google.
- **ViaCEP:** ao completar 8 dígitos, o formulário consulta `https://viacep.com.br/ws/<cep>/json/` com debounce, timeout de 8 s e cancelamento da consulta anterior. A CSP libera apenas `viacep.com.br` em `connect-src`. A consulta só ocorre com `navigator.onLine`; falha, CEP inexistente ou modo offline mostram um aviso discreto e mantêm todos os campos editáveis. A API recebe somente o CEP, nunca nome, CPF ou outros dados do cliente.
- **Restauração:** valida estrutura, SHA-256 e relacionamentos; prepara tudo antes de tocar no banco; troca em uma única transação. Modos: substituir tudo ou mesclar (cliente com mesmo CPF/CNPJ não é duplicado; dívidas com id já existente são ignoradas).
- **Instalação:** servir a pasta por HTTPS (ou localhost) e instalar pelo navegador (iPhone: Safari › Compartilhar › Adicionar à Tela de Início). Ao criar arquivos novos, incluí-los em `FILES` no `sw.js` e incrementar `V`.
- **Testes:** `for t in money validators address crypto stage4 backup; do node tests/$t.test.mjs; done`.

## Interface e experiência (UI/UX)
Camada exclusivamente visual, sem alteração de regras de negócio, banco ou fluxos:
- **Estilos:** `css/app.css` (tokens de cor e tipografia, base, relatório e impressão) e `css/ui.css` (componentes, grades, breakpoints, movimento reduzido).
- **Componentes compartilhados:** `src/ui/kit.js` (iniciais, datas, plural, seletor de arquivo em pt-BR e paginação) e `src/ui/icons.js` (ícones SVG de traço fino, 1,6 px).
- **Navegação:** `src/ui/shell.js` monta barra inferior até 719 px, rail de 96 px de 720 a 1099 px e menu lateral a partir de 1100 px. Título, ações de bloqueio/saída e navegação usam os mesmos componentes nas três faixas. No celular, Configurações aparece como ícone no topo, ao lado do bloqueio; no tablet e no desktop, como item no rodapé do menu.
- **Configurações:** `src/ui/settings.js` reúne Sistema, Segurança, Instalação e Vencimentos, com os mesmos handlers de bloqueio automático, teste de integridade, instalação e janela de vencimento.
- **Perfil do cliente:** dados, dívidas, documentos e histórico, nessa ordem; o card de documentos fica abaixo do card de dívidas. A edição fica no ícone superior direito do card, a troca de foto no botão circular sobre o avatar e a exclusão dentro de “Editar perfil”, após “Cancelar”.
- **Endereço:** CEP, UF, rua, bairro, cidade e endereço completo no mesmo formulário. O CEP é mascarado, consultado com debounce e o resultado preenche os campos; o aviso de consulta/erro é discreto e todos os campos permanecem editáveis. Em telas pequenas os campos ficam em uma coluna; a partir de 720 px, em duas, com rua e endereço completo ocupando a linha inteira.
- **Responsivo:** conteúdo em coluna única no celular; métricas em uma coluna no celular e três colunas a partir de 720 px; listas em 2 colunas e cartões lado a lado a partir de 1000 px; formulários em 2 colunas a partir de 720 px.
- **Paginação:** 20 clientes, 10 dívidas e 5 atividades de histórico por página; navegação com Anterior, Próxima e números, além de “Mostrando X–Y de Z”. A paginação é apenas de exibição: filtros, busca, ordenação e todos os registros permanecem intactos.
- **Rolagem:** barras de rolagem ocultas em todos os tamanhos de tela; rolagem preservada por toque, roda e teclado.
- **Feedback:** transições suaves entre telas, spinners nas ações assíncronas e estado de carregamento acessível (`aria-busy`).
- **Uploads:** áreas pontilhadas com ícone central e texto simples, adaptadas a celular, tablet e desktop.
- **Login:** duas cenas do escritório alternam automaticamente em crossfade (ciclo de 18 s), como banner no celular e painel lateral dividido a partir de 760 px, com sobreposição escura e degradê de transição para o painel. Com `prefers-reduced-motion`, a primeira cena fica estática.
- **Marca:** imagem original do chapéu inteira e sem recorte, com a moldura dourada original, usada na navegação, no login e nos ícones do aplicativo (192, 512, maskable e apple-touch), sem contorno adicional, sombra ou cantos arredondados.
- **Estética:** sem bordas, linhas divisórias ou separadores; hierarquia por espaçamento, superfícies e contraste; botões e campos sem contorno em repouso.
- **Acessibilidade:** link "Ir para o conteúdo", foco visível (halo suave em campos e anel em botões), alvos de toque >= 44 px, `aria-current` na navegação, rótulos associados, `role="alert"`/`status` nas mensagens e `prefers-reduced-motion` respeitado.
- **Impressão:** `@page` retrato/paisagem, tabela do relatório sem corte, dica de rolagem apenas em tela.
