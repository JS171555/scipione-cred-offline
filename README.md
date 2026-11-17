<p align="center">
  <img src="assets/icons/icon-512.png" alt="Ícone do SCIPIONE CRED" width="128">
</p>

<h1 align="center">SCIPIONE CRED</h1>

<p align="center">
  <strong>Gestão offline e criptografada de clientes e dívidas.</strong><br>
  Um cofre local para organizar crédito, vencimentos, documentos e histórico sem conta nem backend próprio.
</p>

<p align="center">
  <a href="https://scipione-cred-offline.vercel.app/"><img alt="Aplicação online" src="https://img.shields.io/badge/Demo-Vercel-B89A62?style=for-the-badge&logo=vercel&logoColor=white"></a>
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Instalável-B89A62?style=for-the-badge">
  <img alt="Offline" src="https://img.shields.io/badge/Offline-First-B89A62?style=for-the-badge">
  <img alt="Criptografia" src="https://img.shields.io/badge/AES--GCM-256-B89A62?style=for-the-badge">
</p>

<p align="center">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-75.3%25-F7DF1E?style=flat-square&logo=javascript&logoColor=000">
  <img alt="CSS" src="https://img.shields.io/badge/CSS-23.6%25-1572B6?style=flat-square&logo=css&logoColor=fff">
  <img alt="HTML" src="https://img.shields.io/badge/HTML-1.1%25-E34F26?style=flat-square&logo=html5&logoColor=fff">
</p>

---

## Sobre o projeto

**SCIPIONE CRED** é um aplicativo web progressivo (PWA) para controle pessoal ou profissional de clientes e dívidas. Os dados são armazenados localmente no navegador com IndexedDB e protegidos por uma senha mestra que desbloqueia uma chave criptográfica. O projeto não possui backend próprio e não envia os dados de clientes ou dívidas para servidores.

O aplicativo funciona offline após o primeiro carregamento, pode ser instalado no celular ou computador e não exige conta remota. Recursos opcionais de internet incluem consulta de CEP, validação online de CPF e integração com Google Drive.

## Funcionalidades

### Clientes

- Cadastro de pessoas físicas e jurídicas com máscara e validação de CPF/CNPJ.
- Dados pessoais, endereço, contato, foto e documentos anexos.
- Busca, filtros por taxa de juros e ordenação.
- Lista paginada com 20 clientes por página.
- Ajuste de taxa de juros em lote.
- Perfil do cliente com dados, dívidas, documentos e histórico.
- Consulta de CEP com o ViaCEP quando há conexão.

### Dívidas

- Valor principal, taxa mensal, data de registro, vencimento e observações.
- Cálculo de juros simples em centavos com aritmética inteira (`BigInt`).
- Indicadores de dívidas vencidas e próximas do vencimento.
- Lista paginada com 10 dívidas por página.
- Ajuste de taxas em lote com pré-visualização.
- Janela de vencimentos configurável.

### Painel e relatórios

- Saldo total, juros mensais, quantidade de clientes e vencimentos.
- Últimos clientes e atividades recentes.
- Relatórios mensais ou diários em A4, com impressão em retrato ou paisagem.
- Exportação para Excel `.xlsx` sem biblioteca externa de planilhas.

### Segurança e backup

- Senha protegida por PBKDF2-SHA256 com 600.000 iterações.
- Dados cifrados com AES-GCM de 256 bits e chave separada para os registros.
- Bloqueio por inatividade e atraso após tentativas incorretas.
- Backup em ZIP, com criptografia opcional e verificação SHA-256.
- Restauração com modo mesclar ou substituir tudo.
- Integração opcional com Google Drive usando OAuth no navegador e escopo `drive.file`.

### Interface

- PWA instalável e layout responsivo para celular, tablet e desktop.
- Navegação por teclado, foco visível e respeito a `prefers-reduced-motion`.
- Interface em português brasileiro com identidade visual escura e dourada.
- Modo standalone no celular e no desktop.

## Tecnologias

| Área | Tecnologia |
| --- | --- |
| Interface | HTML5, CSS3 e JavaScript ES Modules |
| Dados locais | IndexedDB |
| Criptografia | Web Crypto API: PBKDF2-SHA256 e AES-GCM 256 |
| PWA | Web App Manifest e Service Worker |
| Exportação | Gerador próprio de XLSX e ZIP com `fflate` |
| Serviços opcionais | ViaCEP, Google Identity Services, Google Drive API e APICPF |
| Testes | Node.js, sem dependências externas |
| Build | Nenhuma; o projeto é servido como site estático |

## Requisitos

- Navegador moderno com suporte a ES Modules, Web Crypto API, IndexedDB e Service Worker.
- Python 3 ou outro servidor HTTP estático.
- Node.js 18+ para executar a suíte de testes.

> Service Workers e Web Crypto exigem contexto seguro. Utilize `localhost` ou HTTPS. Abrir `index.html` diretamente pelo sistema de arquivos não é suficiente.

## Instala��ão e execução

### Ambiente local

```bash
git clone https://github.com/JS171555/scipione-cred-offline.git
cd scipione-cred-offline
python3 -m http.server 8080
```

Acesse:

```text
http://localhost:8080
```

O projeto não possui instalação npm nem etapa de build.

### Instalar como PWA

| Plataforma | Procedimento |
| --- | --- |
| Chrome / Edge | Usar o ícone de instalação na barra de endereço |
| Android | Abrir o menu do navegador e selecionar **Instalar aplicativo** |
| iPhone / iPad | Safari → Compartilhar → **Adicionar à Tela de Início** |

## Configuração opcional

### Validação de CPF na Vercel

A validação online é opcional. Sem configuração, o cadastro continua disponível com validação manual.

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Informe a chave da APICPF:

```dotenv
APICPF_API_KEY=sua_chave_apicpf
```

Na Vercel, cadastre `APICPF_API_KEY` em **Project Settings → Environment Variables**. A chave é utilizada apenas pela função `api/cpf.js` e não é enviada ao navegador.

### Google Drive

A configuração detalhada está em [docs/google-drive.md](docs/google-drive.md).

É possível usar um cliente OAuth publicado no projeto ou importar o JSON de um cliente Web próprio em **Backup → Google Drive → Selecionar JSON do Google Cloud**.

## Testes

Os testes são executados diretamente pelo Node.js, sem dependências externas:

```bash
for t in money validators address crypto stage4 backup apicpf; do
  node "tests/$t.test.mjs"
done
```

A suíte cobre aritmética monetária, validadores, composição de endereço, criptografia, persistência, backup/restauração e a função APICPF.

## Estrutura do projeto

```text
.
├── api/                 # Função serverless de validação de CPF
├── assets/              # Imagens, fontes e ícones do PWA
├── css/                 # Estilos da interface e componentes
├── docs/                # Documentação técnica e capturas
├── src/
│   ├── config/          # Configurações opcionais de serviços
│   ├── core/            # Núcleo da aplicação
│   ├── db/              # Camada IndexedDB
│   ├── domain/          # Regras e modelos do domínio
│   ├── export/          # Geração de XLSX e relatórios
│   ├── files/           # Arquivos e documentos anexados
│   ├── security/        # Cofre, autenticação e criptografia
│   ├── services/        # Integrações e serviços
│   ├── ui/              # Telas e componentes visuais
│   ├── main.js          # Inicialização da aplicação
│   └── pwa.js           # Registro e atualização do PWA
├── tests/               # Testes em Node.js
├── vendor/              # Dependências locais
├── index.html           # Entrada da aplicação
├── manifest.json        # Manifesto PWA
├── sw.js                # Service Worker
├── vercel.json          # Configuração de deploy e cabeçalhos
└── .env.example         # Variável opcional da APICPF
```

## Deploy

### Vercel

1. Importe o repositório na Vercel.
2. Selecione o preset **Other**.
3. Deixe **Build Command** e **Install Command** vazios.
4. Configure **Output Directory** como `.` (raiz).
5. Adicione `APICPF_API_KEY` apenas se desejar habilitar a validação online de CPF.
6. Faça o deploy.

A configuração em `vercel.json` controla cache do Service Worker e da página inicial, além de cabeçalhos de segurança e CSP.

### GitHub Pages

1. Abra **Settings → Pages** no repositório.
2. Selecione **Deploy from a branch**.
3. Escolha a branch `main` e a pasta `/ (root)`.
4. Salve e aguarde a publicação.

A URL esperada segue o padrão:

```text
https://js171555.github.io/scipione-cred-offline/
```

## Privacidade e segurança

- Clientes, dívidas, documentos e histórico não são enviados a servidores pelo núcleo do aplicativo.
- A senha do cofre não é armazenada e não há recuperação de senha.
- Metadados mínimos podem permanecer em claro no IndexedDB para permitir índices e ordenação; o conteúdo dos registros é cifrado.
- O CPF pode ser enviado à função serverless APICPF somente quando o recurso está configurado e o usuário solicita validação online.
- A criptografia protege dados em repouso, mas não protege contra malware ou acesso físico a um aparelho já desbloqueado.
- Cada origem possui um cofre próprio. `localhost`, Vercel e GitHub Pages não compartilham automaticamente os dados.

> Faça backups regularmente. Perder a senha do cofre torna os dados cifrados indisponíveis.

## Uso básico

1. Abra o aplicativo local ou publicado.
2. Crie o cofre com uma senha forte.
3. Cadastre os clientes.
4. Adicione dívidas, taxas, vencimentos e observações.
5. Acompanhe vencimentos e saldo no painel.
6. Gere relatórios ou exporte os dados para Excel.
7. Crie backups locais criptografados periodicamente.

## Documentação

- [Documentação técnica](docs/README.md)
- [Configuração e uso do Google Drive](docs/google-drive.md)

## Licença

Este é um projeto pessoal. Nenhuma licença de código aberto está definida no repositório. Entre em contato com o autor antes de reutilizar ou distribuir o código.

## Autor

Desenvolvido por [JS171555](https://github.com/JS171555).

---

<p align="center"><sub>SCIPIONE CRED — seus dados ficam com você.</sub></p>
