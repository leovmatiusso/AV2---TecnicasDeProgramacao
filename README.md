# GreenCode AV2

A AV2 adiciona uma API HTTP REST ao GreenCode, preservando o CLI e os dados locais da AV1. A API usa Fastify, Prisma e PostgreSQL, organiza o acesso a dados em repositório/serviço/rotas, valida JWT e registra auditoria das operações.

## Requisitos

- Node.js 20 ou superior
- PostgreSQL instalado localmente (versão 16 recomendada)

## Configurar e iniciar

No PowerShell, na pasta do projeto:

```powershell
Copy-Item .env.example .env
```

Instale e inicie o PostgreSQL no Windows. Pelo instalador, crie ou confirme um usuário e senha do banco, e crie um banco chamado `greencode`. Depois, edite `.env` para que `DATABASE_URL` use os dados configurados. O formato é:

```text
postgresql://USUARIO:SENHA@localhost:5432/greencode?schema=public
```

Troque também `JWT_SECRET` por um segredo aleatório de pelo menos 32 caracteres e `SEED_ADMIN_PASSWORD` por uma senha de pelo menos 12 caracteres. O `.env` não deve ser enviado ao Git.

Com o serviço do PostgreSQL iniciado e o banco criado, execute:

```powershell
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

A API inicia em `http://localhost:3000`. `GET /health` verifica se o servidor está respondendo. Para compilar e iniciar sem modo de desenvolvimento:

```powershell
npm run build
npm run start:api
```

As migrations e o seed precisam que o PostgreSQL esteja em execução e acessível pela `DATABASE_URL`.

## Documentação da API

Com o servidor ligado, abra `http://localhost:3000/docs` no navegador. Essa página interativa lista as rotas e permite fazer chamadas. Primeiro use `POST /api/auth/login`; copie o campo `token`, clique em **Authorize** e informe `Bearer SEU_TOKEN` para testar as rotas protegidas.

## Teste automatizado da API

O comando `npm test` compila o projeto e executa os testes da AV1 e testes da camada HTTP da AV2 (saúde, Swagger, autenticação, validação e autorização), sem precisar conectar ao banco.

Com o banco iniciado, migrations aplicadas, seed executado e API rodando em um terminal, abra outro PowerShell na pasta do projeto e rode:

```powershell
npm run jornada:api
```

O roteiro testa saúde do servidor, login/JWT, criação de organização e contrato, criação de lote com equipamento, triagem, movimentações e relatório. Ele imprime cada etapa. Cria novos registros de demonstração a cada execução e os deixa no banco.

## Teste manual rápido no PowerShell

Com a API em execução, o login e a consulta de organizações podem ser testados assim (use a senha definida em `.env`):

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType 'application/json' -Body '{"nomeUsuario":"admin","senha":"SUA_SENHA_DO_SEED"}'
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Get -Uri http://localhost:3000/api/organizations -Headers $headers
```

Se o usuário seed não se chamar `admin`, substitua pelo valor de `SEED_ADMIN_USER`. Para o teste completo, use `npm run jornada:api`.

## Autenticação e concorrência

Faça `POST /api/auth/login` com `nomeUsuario` e `senha`. Envie o token retornado nas chamadas seguintes usando `Authorization: Bearer <token>`. O token expira em 30 minutos. Senhas são armazenadas com bcrypt.

Alterações e exclusões recebem `versao` no corpo. Leia o recurso, use a versão recebida, e em conflito `409` consulte o recurso novamente antes de repetir. As escritas que afetam mais de uma tabela são executadas em transação; operações relevantes também são registradas em `Auditoria`.

## Endpoints principais

| Recurso | Rotas |
| --- | --- |
| Sessão | `POST /api/auth/login` |
| Usuários | `GET/POST /api/users`, `GET/PATCH /api/users/:id` |
| Organizações | `GET/POST /api/organizations`, `GET/PATCH/DELETE /api/organizations/:id` |
| Contratos | `GET/POST/DELETE /api/organizations/:id/contract`, `POST /api/organizations/:id/contract/renew` |
| Lotes | `GET/POST /api/lots`, `GET/PATCH/DELETE /api/lots/:id`, rotas `/triage/start` e `/triage/complete` |
| Equipamentos | `GET/POST /api/equipment`, `GET/PATCH/DELETE /api/equipment/:id`, `POST /api/equipment/:id/movements` |
| Relatórios | `GET /api/reports/summary` |

Os papéis de usuário limitam operações de escrita. Administradores gerenciam usuários; operadores de cadastro mantêm organizações e contratos; gestores de almoxarifado registram lotes, equipamentos, triagem e movimentações. Os demais papéis consultam dados permitidos.

Para excluir ou editar, envie a versão atual. Exemplo de criação de organização:

```json
{
  "razaoSocial": "Empresa Exemplo",
  "cnpj": "11222333000181",
  "email": "contato@empresa.com"
}
```

Os dados de demonstração do seed são fictícios e servem apenas para exercitar a API local.
