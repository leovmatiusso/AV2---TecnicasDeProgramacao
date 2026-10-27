import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import {
  EstadoFisico,
  PapelUsuario,
  StatusRastreamento,
  TipoEquipamento,
} from '@prisma/client';
import { ApiService, type UsuarioAutenticado } from './services/api-service.js';
type EquipamentoInput = {
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      papel: PapelUsuario;
    };
    user: {
      sub: string;
      papel: PapelUsuario;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    apiService: ApiService;
    authenticate: preHandlerHookHandler;
  }
}

type CorpoLogin = { nomeUsuario: string; senha: string };
type CorpoOrganizacao = {
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual?: string;
  enderecoCompleto?: string;
  telefone?: string;
  email: string;
};
type CorpoLote = {
  dataEntrada: string;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
  equipamentos?: Array<{
    tipo: TipoEquipamento;
    marca: string;
    modelo: string;
    anoFabricacao: number;
    estadoFisico: EstadoFisico;
    pesoQuilogramas: number;
  }>;
};

const exigirPapel = (...papeis: PapelUsuario[]): preHandlerHookHandler =>
  async (request, reply) => {
    if (!papeis.includes(request.user.papel)) {
      return reply.code(403).send({ erro: 'Seu papel não permite esta operação.' });
    }
  };

const adminOuCadastro = exigirPapel(
  PapelUsuario.ADMINISTRADOR,
  PapelUsuario.OPERADOR_CADASTRO,
);
const adminOuEstoque = exigirPapel(
  PapelUsuario.ADMINISTRADOR,
  PapelUsuario.GESTOR_ALMOXARIFADO,
);
const apenasAdmin = exigirPapel(PapelUsuario.ADMINISTRADOR);

const autenticado = (app: FastifyInstance) => [app.authenticate];

export async function registrarRotas(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CorpoLogin }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['nomeUsuario', 'senha'],
          additionalProperties: false,
          properties: {
            nomeUsuario: { type: 'string', minLength: 3, maxLength: 32 },
            senha: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const usuario: UsuarioAutenticado = await app.apiService.login(
        request.body.nomeUsuario,
        request.body.senha,
      );
      const token = app.jwt.sign(
        { sub: usuario.id, papel: usuario.papel },
        { expiresIn: '30m' },
      );

      return reply.send({ token, usuario });
    },
  );

  app.get('/api/users', {
    preHandler: [...autenticado(app), apenasAdmin],
  }, () => app.apiService.listarUsuarios());

  app.get<{ Params: { id: string } }>('/api/users/:id', {
    preHandler: [...autenticado(app), apenasAdmin],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
  }, (request) => app.apiService.obterUsuario(request.params.id));

  app.post<{ Body: { nomeUsuario: string; senha: string; papel: PapelUsuario } }>(
    '/api/users',
    {
      preHandler: [...autenticado(app), apenasAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['nomeUsuario', 'senha', 'papel'],
          additionalProperties: false,
          properties: {
            nomeUsuario: { type: 'string', minLength: 3, maxLength: 32 },
            senha: { type: 'string', minLength: 12 },
            papel: { type: 'string', enum: Object.values(PapelUsuario) },
          },
        },
      },
    },
    (request, reply) =>
      app.apiService
        .criarUsuario(request.body, request.user.sub)
        .then((usuario) => reply.code(201).send(usuario)),
  );

  app.patch<{
    Params: { id: string };
    Body: { versao: number; papel?: PapelUsuario; ativo?: boolean };
  }>(
    '/api/users/:id',
    {
      preHandler: [...autenticado(app), apenasAdmin],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['versao'],
          additionalProperties: false,
          properties: {
            versao: { type: 'integer', minimum: 1 },
            papel: { type: 'string', enum: Object.values(PapelUsuario) },
            ativo: { type: 'boolean' },
          },
        },
      },
    },
    (request) =>
      app.apiService.atualizarUsuario(
        request.params.id,
        request.body.versao,
        {
          ...(request.body.papel !== undefined ? { papel: request.body.papel } : {}),
          ...(request.body.ativo !== undefined ? { ativo: request.body.ativo } : {}),
        },
        request.user.sub,
      ),
  );

  app.get('/api/organizations', {
    preHandler: autenticado(app),
  }, () => app.apiService.listarOrganizacoes());

  app.post<{ Body: CorpoOrganizacao }>(
    '/api/organizations',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        body: {
          type: 'object',
          required: ['razaoSocial', 'cnpj', 'email'],
          additionalProperties: false,
          properties: {
            razaoSocial: { type: 'string', minLength: 2, maxLength: 200 },
            cnpj: { type: 'string', minLength: 11, maxLength: 18 },
            inscricaoEstadual: { type: 'string', maxLength: 30 },
            enderecoCompleto: { type: 'string', maxLength: 300 },
            telefone: { type: 'string', maxLength: 30 },
            email: { type: 'string', format: 'email', maxLength: 254 },
          },
        },
      },
    },
    (request, reply) =>
      app.apiService
        .criarOrganizacao(request.body, request.user.sub)
        .then((organizacao) => reply.code(201).send(organizacao)),
  );

  app.get<{ Params: { id: string } }>(
    '/api/organizations/:id',
    { preHandler: autenticado(app) },
    (request) => app.apiService.obterOrganizacao(request.params.id),
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<CorpoOrganizacao> & { versao: number };
  }>(
    '/api/organizations/:id',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          required: ['versao'],
          additionalProperties: false,
          properties: {
            versao: { type: 'integer', minimum: 1 },
            razaoSocial: { type: 'string', minLength: 2, maxLength: 200 },
            cnpj: { type: 'string', minLength: 11, maxLength: 18 },
            inscricaoEstadual: { type: 'string', maxLength: 30 },
            enderecoCompleto: { type: 'string', maxLength: 300 },
            telefone: { type: 'string', maxLength: 30 },
            email: { type: 'string', format: 'email', maxLength: 254 },
          },
        },
      },
    },
    (request) => {
      const { versao, ...alteracoes } = request.body;
      return app.apiService.atualizarOrganizacao(
        request.params.id,
        versao,
        alteracoes,
        request.user.sub,
      );
    },
  );

  app.delete<{
    Params: { id: string };
    Body: { versao: number };
  }>(
    '/api/organizations/:id',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        body: {
          type: 'object',
          required: ['versao'],
          additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      const resultado = await app.apiService.desativarOrganizacao(
        request.params.id,
        request.body.versao,
        request.user.sub,
      );
      return reply.send(resultado);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/organizations/:id/contract',
    { preHandler: autenticado(app) },
    async (request, reply) => {
      const contrato = (await app.apiService.obterOrganizacao(request.params.id)).contratoVigente;
      if (!contrato) return reply.code(404).send({ erro: 'Contrato não encontrado.' });
      return contrato;
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      dataVencimento: string;
      clausulas?: string[];
      valorMensal: number;
      renovacaoAutomatica?: boolean;
    };
  }>(
    '/api/organizations/:id/contract',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object', required: ['dataVencimento', 'valorMensal'], additionalProperties: false,
          properties: {
            dataVencimento: { type: 'string', format: 'date' },
            clausulas: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 50 },
            valorMensal: { type: 'number', minimum: 0 },
            renovacaoAutomatica: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const contrato = await app.apiService.criarContrato(
        request.params.id,
        request.body,
        request.user.sub,
      );
      return reply.code(201).send(contrato);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { versao: number; novoVencimento: string };
  }>(
    '/api/organizations/:id/contract/renew',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao', 'novoVencimento'], additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 }, novoVencimento: { type: 'string', format: 'date' } } },
      },
    },
    (request) =>
      app.apiService.renovarContrato(
        request.params.id,
        request.body.versao,
        request.body.novoVencimento,
        request.user.sub,
      ),
  );

  app.delete<{
    Params: { id: string };
    Body: { versao: number };
  }>(
    '/api/organizations/:id/contract',
    {
      preHandler: [...autenticado(app), adminOuCadastro],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao'], additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 } } },
      },
    },
    (request) =>
      app.apiService.cancelarContrato(
        request.params.id,
        request.body.versao,
        request.user.sub,
      ),
  );

  app.get('/api/lots', {
    preHandler: autenticado(app),
  }, () => app.apiService.listarLotes());

  app.post<{ Body: CorpoLote }>(
    '/api/lots',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        body: {
          type: 'object',
          required: ['dataEntrada', 'organizacaoId', 'notaFiscal', 'transportadora'],
          additionalProperties: false,
          properties: {
            dataEntrada: { type: 'string', format: 'date' },
            organizacaoId: { type: 'string', format: 'uuid' },
            notaFiscal: { type: 'string', minLength: 1, maxLength: 80 },
            transportadora: { type: 'string', minLength: 1, maxLength: 160 },
            observacoes: { type: 'string', maxLength: 2000 },
            equipamentos: {
              type: 'array',
              items: {
                type: 'object',
                required: ['tipo', 'marca', 'modelo', 'anoFabricacao', 'estadoFisico', 'pesoQuilogramas'],
                additionalProperties: false,
                properties: {
                  tipo: { type: 'string', enum: Object.values(TipoEquipamento) },
                  marca: { type: 'string', minLength: 1, maxLength: 100 },
                  modelo: { type: 'string', minLength: 1, maxLength: 100 },
                  anoFabricacao: { type: 'integer', minimum: 1970 },
                  estadoFisico: { type: 'string', enum: Object.values(EstadoFisico) },
                  pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const lote = await app.apiService.criarLote(request.body, request.user.sub);
      return reply.code(201).send(lote);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/lots/:id',
    { preHandler: autenticado(app) },
    (request) => app.apiService.obterLote(request.params.id),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      versao: number;
      dataEntrada?: string;
      notaFiscal?: string;
      transportadora?: string;
      observacoes?: string;
    };
  }>(
    '/api/lots/:id',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao'], additionalProperties: false,
          properties: {
            versao: { type: 'integer', minimum: 1 },
            dataEntrada: { type: 'string', format: 'date' },
            notaFiscal: { type: 'string', minLength: 1, maxLength: 80 },
            transportadora: { type: 'string', minLength: 1, maxLength: 160 },
            observacoes: { type: 'string', maxLength: 2000 },
          } },
      },
    },
    (request) => {
      const { versao, ...alteracoes } = request.body;
      return app.apiService.atualizarLote(
        request.params.id,
        versao,
        alteracoes,
        request.user.sub,
      );
    },
  );

  app.delete<{
    Params: { id: string };
    Body: { versao: number };
  }>(
    '/api/lots/:id',
    { preHandler: [...autenticado(app), adminOuEstoque] },
    async (request, reply) => {
      await app.apiService.excluirLote(
        request.params.id,
        request.body.versao,
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string }; Body: { versao: number } }>(
    '/api/lots/:id/triage/start',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao'], additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 } } },
      },
    },
    (request) =>
      app.apiService.iniciarTriagem(
        request.params.id,
        request.body.versao,
        request.user.sub,
      ),
  );

  app.post<{ Params: { id: string }; Body: { versao: number } }>(
    '/api/lots/:id/triage/complete',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao'], additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 } } },
      },
    },
    (request) =>
      app.apiService.concluirTriagem(
        request.params.id,
        request.body.versao,
        request.user.sub,
      ),
  );

  app.get<{ Querystring: { loteId?: string } }>('/api/equipment', {
    preHandler: autenticado(app),
  }, (request) => app.apiService.listarEquipamentos(request.query.loteId));

  app.post<{
    Body: EquipamentoInput & { loteId: string };
  }>(
    '/api/equipment',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        body: {
          type: 'object',
          required: ['loteId', 'tipo', 'marca', 'modelo', 'anoFabricacao', 'estadoFisico', 'pesoQuilogramas'],
          additionalProperties: false,
          properties: {
            loteId: { type: 'string', format: 'uuid' },
            tipo: { type: 'string', enum: Object.values(TipoEquipamento) },
            marca: { type: 'string', minLength: 1, maxLength: 100 },
            modelo: { type: 'string', minLength: 1, maxLength: 100 },
            anoFabricacao: { type: 'integer', minimum: 1970 },
            estadoFisico: { type: 'string', enum: Object.values(EstadoFisico) },
            pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const equipamento = await app.apiService.criarEquipamento(
        request.body,
        request.user.sub,
      );
      return reply.code(201).send(equipamento);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/equipment/:id',
    { preHandler: autenticado(app) },
    (request) => app.apiService.obterEquipamento(request.params.id),
  );

  app.patch<{
    Params: { id: string };
    Body: Partial<EquipamentoInput> & { versao: number; justificativa?: string };
  }>(
    '/api/equipment/:id',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: { type: 'object', required: ['versao'], additionalProperties: false,
          properties: {
            versao: { type: 'integer', minimum: 1 },
            justificativa: { type: 'string', maxLength: 1000 },
            tipo: { type: 'string', enum: Object.values(TipoEquipamento) },
            marca: { type: 'string', minLength: 1, maxLength: 100 },
            modelo: { type: 'string', minLength: 1, maxLength: 100 },
            anoFabricacao: { type: 'integer', minimum: 1970 },
            estadoFisico: { type: 'string', enum: Object.values(EstadoFisico) },
            pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
          } },
      },
    },
    (request) => {
      const { versao, ...alteracoes } = request.body;
      return app.apiService.atualizarEquipamento(
        request.params.id,
        versao,
        alteracoes,
        request.user.sub,
      );
    },
  );

  app.delete<{
    Params: { id: string };
    Body: { versao: number };
  }>(
    '/api/equipment/:id',
    { preHandler: [...autenticado(app), adminOuEstoque] },
    async (request, reply) => {
      await app.apiService.excluirEquipamento(
        request.params.id,
        request.body.versao,
        request.user.sub,
      );
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      versao: number;
      destino: StatusRastreamento;
      responsavel: string;
      observacao?: string;
    };
  }>(
    '/api/equipment/:id/movements',
    {
      preHandler: [...autenticado(app), adminOuEstoque],
      schema: {
        body: {
          type: 'object',
          required: ['versao', 'destino', 'responsavel'],
          additionalProperties: false,
          properties: {
            versao: { type: 'integer', minimum: 1 },
            destino: { type: 'string', enum: Object.values(StatusRastreamento) },
            responsavel: { type: 'string', minLength: 1, maxLength: 100 },
            observacao: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    (request) =>
      app.apiService.movimentarEquipamento(
        request.params.id,
        request.body.versao,
        request.body.destino,
        request.body.responsavel,
        request.body.observacao ?? '',
        request.user.sub,
      ),
  );

  app.get('/api/reports/summary', {
    preHandler: autenticado(app),
  }, () => app.apiService.resumoRelatorios());
}
