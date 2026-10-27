import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PapelUsuario, PrismaClient } from '@prisma/client';
import { criarAppApi } from './app.js';

const prisma = new PrismaClient();
let app: Awaited<ReturnType<typeof criarAppApi>>;

before(async () => {
  app = await criarAppApi(
    prisma,
    'teste-de-integracao-local-segredo-seguro-com-mais-de-32-caracteres',
  );
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test('API informa saúde e expõe a documentação Swagger sem conectar ao banco', async () => {
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const documentation = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(documentation.statusCode, 200);
  assert.match(documentation.headers['content-type'] ?? '', /text\/html/);

  const openApi = await app.inject({ method: 'GET', url: '/docs/json' });
  assert.equal(openApi.statusCode, 200);
  const specification = openApi.json();
  assert.ok(specification.paths['/api/auth/login']);
  assert.equal(specification.paths['/api/organizations'].get.security[0].bearerAuth.length, 0);
});

test('API bloqueia rota protegida sem JWT e valida corpo de login', async () => {
  const protegido = await app.inject({ method: 'GET', url: '/api/organizations' });
  assert.equal(protegido.statusCode, 401);

  const loginInvalido = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { nomeUsuario: 'a', senha: '' },
  });
  assert.equal(loginInvalido.statusCode, 400);

  const tokenAuditor = app.jwt.sign({
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    papel: PapelUsuario.AUDITOR,
  });
  const escritaRestrita = await app.inject({
    method: 'POST',
    url: '/api/organizations',
    headers: { authorization: `Bearer ${tokenAuditor}` },
    payload: {
      razaoSocial: 'Não deve ser criada',
      cnpj: '11222333000181',
      email: 'teste@example.com',
    },
  });
  assert.equal(escritaRestrita.statusCode, 403);
});
