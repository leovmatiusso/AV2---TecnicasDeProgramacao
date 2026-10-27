import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError, ApiService } from './services/api-service.js';
import { PrismaRepository } from './repositories/prisma-repository.js';
import { registrarRotas } from './routes.js';

export async function criarAppApi(
  prisma = new PrismaClient(),
  segredoJwt = process.env.JWT_SECRET,
  logger = false,
): Promise<FastifyInstance> {
  if (!segredoJwt || segredoJwt.length < 32) {
    throw new Error('Defina JWT_SECRET com pelo menos 32 caracteres no arquivo .env.');
  }

  const app = Fastify({ logger });
  const apiService = new ApiService(new PrismaRepository(prisma));

  await app.register(jwt, { secret: segredoJwt });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'GreenCode API',
        description: 'API REST para logística reversa de equipamentos eletrônicos.',
        version: '2.0.0',
      },
      servers: [{ url: `http://localhost:${process.env.PORT ?? 3000}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorate('apiService', apiService);
  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ erro: 'Token ausente ou inválido.' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.addHook('onRoute', (route) => {
    if (route.url !== '/health' && route.url !== '/api/auth/login') {
      route.schema = {
        ...route.schema,
        security: [{ bearerAuth: [] }],
      };
    }
  });

  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ApiError) {
      return reply.code(erro.statusCode).send({ erro: erro.message });
    }

    const erroHttp = erro as Error & { validation?: unknown[]; statusCode?: number };

    if (erroHttp.validation) {
      return reply.code(400).send({
        erro: 'Dados da requisição inválidos.',
        detalhes: erroHttp.validation,
      });
    }

    if (erroHttp.statusCode && erroHttp.statusCode >= 400 && erroHttp.statusCode < 500) {
      return reply.code(erroHttp.statusCode).send({ erro: erroHttp.message });
    }

    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === 'P2002') {
        return reply.code(409).send({ erro: 'Já existe um registro com esse valor único.' });
      }
      if (erro.code === 'P2025' || erro.code === 'P2003') {
        return reply.code(409).send({ erro: 'Registro relacionado não encontrado ou ainda utilizado.' });
      }
      if (erro.code === 'P2034') {
        return reply.code(409).send({ erro: 'Conflito de concorrência; atualize os dados e tente novamente.' });
      }
    }

    request.log.error(erro);
    return reply.code(500).send({ erro: 'Erro interno do servidor.' });
  });

  await app.register(registrarRotas);
  await app.ready();
  return app;
}
