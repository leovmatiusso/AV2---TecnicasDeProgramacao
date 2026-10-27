import bcrypt from 'bcryptjs';
import {
  EstadoFisico,
  PapelUsuario,
  Prisma,
  PrismaClient,
  StatusLote,
  StatusRastreamento,
  TipoEquipamento,
} from '@prisma/client';
import { ValidadorCNPJ, ValidadorDataEntrada } from '../../validators.js';
import { PrismaRepository } from '../repositories/prisma-repository.js';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UsuarioAutenticado {
  id: string;
  nomeUsuario: string;
  papel: PapelUsuario;
}

type OrganizacaoInput = {
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual?: string;
  enderecoCompleto?: string;
  telefone?: string;
  email: string;
};

type ContratoInput = {
  dataVencimento: string;
  clausulas?: string[];
  valorMensal: number;
  renovacaoAutomatica?: boolean;
};

type EquipamentoInput = {
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
};

type LoteInput = {
  dataEntrada: string;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
  equipamentos?: EquipamentoInput[];
};

const transicoesPermitidas: Record<StatusRastreamento, StatusRastreamento[]> = {
  AGUARDANDO_TRIAGEM: ['EM_TRIAGEM'],
  EM_TRIAGEM: ['AGUARDANDO_DESMONTE'],
  AGUARDANDO_DESMONTE: ['EM_DESMONTE'],
  EM_DESMONTE: [
    'PECAS_REAPROVEITADAS',
    'MATERIAL_RECICLAVEL',
    'DESCARTE_SEGURO',
  ],
  PECAS_REAPROVEITADAS: ['BAIXA_DEFINITIVA'],
  MATERIAL_RECICLAVEL: ['BAIXA_DEFINITIVA'],
  DESCARTE_SEGURO: ['BAIXA_DEFINITIVA'],
  BAIXA_DEFINITIVA: [],
};

const dataValida = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
};

const dataEntradaValida = (value: string): Date | null => {
  const date = dataValida(value);
  return date && new ValidadorDataEntrada().validar(date.toISOString()) ? date : null;
};

export class ApiService {
  constructor(private readonly repository: PrismaRepository) {}

  private get db(): PrismaClient {
    return this.repository.client;
  }

  async login(nomeUsuario: string, senha: string): Promise<UsuarioAutenticado> {
    const usuario = await this.db.usuario.findUnique({
      where: { nomeUsuario: nomeUsuario.toLowerCase() },
    });

    if (
      !usuario ||
      !usuario.ativo ||
      !(await bcrypt.compare(senha, usuario.hashSenha))
    ) {
      throw new ApiError(401, 'Usuário ou senha inválidos.');
    }

    return {
      id: usuario.id,
      nomeUsuario: usuario.nomeUsuario,
      papel: usuario.papel,
    };
  }

  async criarUsuario(
    input: { nomeUsuario: string; senha: string; papel: PapelUsuario },
    responsavelId: string,
  ) {
    if (!/^[a-z0-9._-]{3,32}$/i.test(input.nomeUsuario)) {
      throw new ApiError(400, 'Nome de usuário deve ter de 3 a 32 caracteres válidos.');
    }

    if (input.senha.length < 12) {
      throw new ApiError(400, 'Senha deve ter pelo menos 12 caracteres.');
    }

    const hashSenha = await bcrypt.hash(input.senha, 12);

    return this.repository.transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nomeUsuario: input.nomeUsuario.toLowerCase(),
          hashSenha,
          papel: input.papel,
        },
        select: {
          id: true,
          nomeUsuario: true,
          papel: true,
          ativo: true,
          versao: true,
          criadoEm: true,
        },
      });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Usuario',
        entidadeId: usuario.id,
        operacao: 'CRIAR',
        dadosDepois: usuario,
        usuarioId: responsavelId,
      });

      return usuario;
    });
  }

  listarUsuarios() {
    return this.db.usuario.findMany({
      select: {
        id: true,
        nomeUsuario: true,
        papel: true,
        ativo: true,
        versao: true,
        criadoEm: true,
      },
      orderBy: { nomeUsuario: 'asc' },
    });
  }

  async obterUsuario(id: string) {
    const usuario = await this.db.usuario.findUnique({
      where: { id },
      select: { id: true, nomeUsuario: true, papel: true, ativo: true, versao: true, criadoEm: true },
    });
    if (!usuario) throw new ApiError(404, 'Usuário não encontrado.');
    return usuario;
  }

  async atualizarUsuario(
    id: string,
    versao: number,
    alteracoes: { papel?: PapelUsuario; ativo?: boolean },
    responsavelId: string,
  ) {
    const antes = await this.db.usuario.findUnique({ where: { id } });
    if (!antes) throw new ApiError(404, 'Usuário não encontrado.');

    if (
      antes.papel === PapelUsuario.ADMINISTRADOR &&
      antes.ativo &&
      ((alteracoes.ativo === false) ||
        (alteracoes.papel !== undefined &&
          alteracoes.papel !== PapelUsuario.ADMINISTRADOR))
    ) {
      const administradoresAtivos = await this.db.usuario.count({
        where: { ativo: true, papel: PapelUsuario.ADMINISTRADOR },
      });

      if (administradoresAtivos <= 1) {
        throw new ApiError(409, 'Não é possível remover o último administrador ativo.');
      }
    }

    return this.repository.transaction(async (tx) => {
      const resultado = await tx.usuario.updateMany({
        where: { id, versao },
        data: { ...alteracoes, versao: { increment: 1 } },
      });

      if (resultado.count !== 1) {
        throw new ApiError(409, 'Usuário alterado por outra requisição; atualize e tente novamente.');
      }

      const depois = await tx.usuario.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          nomeUsuario: true,
          papel: true,
          ativo: true,
          versao: true,
          criadoEm: true,
        },
      });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Usuario',
        entidadeId: id,
        operacao: 'ATUALIZAR',
        dadosAntes: { papel: antes.papel, ativo: antes.ativo, versao: antes.versao },
        dadosDepois: depois,
        usuarioId: responsavelId,
      });

      return depois;
    });
  }

  async criarOrganizacao(input: OrganizacaoInput, usuarioId: string) {
    const cnpj = input.cnpj.replace(/\D/g, '');
    if (!new ValidadorCNPJ().validar(cnpj)) {
      throw new ApiError(400, 'CNPJ inválido.');
    }
    if (!input.razaoSocial.trim() || !/^\S+@\S+\.\S+$/.test(input.email)) {
      throw new ApiError(400, 'Razão social e e-mail válidos são obrigatórios.');
    }

    return this.repository.transaction(async (tx) => {
      const organizacao = await tx.organizacao.create({
        data: {
          ...input,
          cnpj,
          inscricaoEstadual: input.inscricaoEstadual ?? '',
          enderecoCompleto: input.enderecoCompleto ?? '',
          telefone: input.telefone ?? '',
        },
      });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Organizacao',
        entidadeId: organizacao.id,
        operacao: 'CRIAR',
        dadosDepois: organizacao,
        usuarioId,
      });

      return organizacao;
    });
  }

  listarOrganizacoes() {
    return this.db.organizacao.findMany({
      include: {
        contratoVigente: true,
        _count: { select: { lotes: true } },
      },
      orderBy: { razaoSocial: 'asc' },
    });
  }

  obterOrganizacao(id: string) {
    return this.db.organizacao.findUnique({
      where: { id },
      include: { contratoVigente: true, lotes: true },
    }).then((item) => {
      if (!item) throw new ApiError(404, 'Organização não encontrada.');
      return item;
    });
  }

  async atualizarOrganizacao(
    id: string,
    versao: number,
    alteracoes: Partial<OrganizacaoInput>,
    usuarioId: string,
  ) {
    const antes = await this.db.organizacao.findUnique({ where: { id } });
    if (!antes) throw new ApiError(404, 'Organização não encontrada.');

    const dados: Prisma.OrganizacaoUpdateManyMutationInput = { ...alteracoes };
    if (alteracoes.cnpj !== undefined) {
      const cnpj = alteracoes.cnpj.replace(/\D/g, '');
      if (!new ValidadorCNPJ().validar(cnpj)) throw new ApiError(400, 'CNPJ inválido.');
      dados.cnpj = cnpj;
    }
    if (alteracoes.email !== undefined && !/^\S+@\S+\.\S+$/.test(alteracoes.email)) {
      throw new ApiError(400, 'E-mail inválido.');
    }
    if (alteracoes.razaoSocial !== undefined && !alteracoes.razaoSocial.trim()) {
      throw new ApiError(400, 'Razão social é obrigatória.');
    }

    return this.repository.transaction(async (tx) => {
      const resultado = await tx.organizacao.updateMany({
        where: { id, versao },
        data: { ...dados, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) {
        throw new ApiError(409, 'Organização alterada por outra requisição; atualize e tente novamente.');
      }

      const depois = await tx.organizacao.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Organizacao',
        entidadeId: id,
        operacao: 'ATUALIZAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async desativarOrganizacao(id: string, versao: number, usuarioId: string) {
    const antes = await this.db.organizacao.findUnique({ where: { id } });
    if (!antes) throw new ApiError(404, 'Organização não encontrada.');

    return this.repository.transaction(async (tx) => {
      const resultado = await tx.organizacao.updateMany({
        where: { id, versao },
        data: { ativo: false, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) {
        throw new ApiError(409, 'Organização alterada por outra requisição; atualize e tente novamente.');
      }
      const depois = await tx.organizacao.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Organizacao',
        entidadeId: id,
        operacao: 'DESATIVAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async criarContrato(organizacaoId: string, input: ContratoInput, usuarioId: string) {
    const vencimento = dataValida(input.dataVencimento);
    if (!vencimento || vencimento.getTime() <= Date.now()) {
      throw new ApiError(400, 'Informe uma data de vencimento futura.');
    }
    if (!Number.isFinite(input.valorMensal) || input.valorMensal < 0 || input.valorMensal > 9999999999.99) {
      throw new ApiError(400, 'Valor mensal inválido.');
    }

    return this.repository.transaction(async (tx) => {
      const organizacao = await tx.organizacao.findUnique({ where: { id: organizacaoId } });
      if (!organizacao || !organizacao.ativo) {
        throw new ApiError(404, 'Organização inexistente ou inativa.');
      }
      const contratoAtual = await tx.contrato.findUnique({ where: { organizacaoId } });
      if (contratoAtual?.ativo) {
        throw new ApiError(409, 'A organização já possui um contrato ativo.');
      }

      const contrato = contratoAtual
        ? await tx.contrato.update({
            where: { id: contratoAtual.id },
            data: {
              dataAssinatura: new Date(),
              dataVencimento: vencimento,
              clausulas: input.clausulas ?? [],
              valorMensal: new Prisma.Decimal(input.valorMensal),
              renovacaoAutomatica: input.renovacaoAutomatica ?? false,
              ativo: true,
              versao: { increment: 1 },
            },
          })
        : await tx.contrato.create({
            data: {
              organizacaoId,
              dataVencimento: vencimento,
              clausulas: input.clausulas ?? [],
              valorMensal: new Prisma.Decimal(input.valorMensal),
              renovacaoAutomatica: input.renovacaoAutomatica ?? false,
            },
          });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Contrato',
        entidadeId: contrato.id,
        operacao: contratoAtual ? 'REATIVAR' : 'CRIAR',
        dadosAntes: contratoAtual,
        dadosDepois: contrato,
        usuarioId,
      });

      return contrato;
    });
  }

  async renovarContrato(organizacaoId: string, versao: number, novoVencimento: string, usuarioId: string) {
    const vencimento = dataValida(novoVencimento);
    if (!vencimento) throw new ApiError(400, 'Data inválida.');

    return this.repository.transaction(async (tx) => {
      const antes = await tx.contrato.findUnique({ where: { organizacaoId } });
      if (!antes || !antes.ativo) throw new ApiError(404, 'Contrato ativo não encontrado.');
      if (vencimento.getTime() <= antes.dataVencimento.getTime()) {
        throw new ApiError(400, 'A nova data deve ser posterior ao vencimento atual.');
      }

      const resultado = await tx.contrato.updateMany({
        where: { organizacaoId, versao },
        data: { dataVencimento: vencimento, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Contrato alterado por outra requisição.');

      const depois = await tx.contrato.findUniqueOrThrow({ where: { organizacaoId } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Contrato',
        entidadeId: depois.id,
        operacao: 'RENOVAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async cancelarContrato(organizacaoId: string, versao: number, usuarioId: string) {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.contrato.findUnique({ where: { organizacaoId } });
      if (!antes || !antes.ativo) throw new ApiError(404, 'Contrato ativo não encontrado.');

      const resultado = await tx.contrato.updateMany({
        where: { organizacaoId, versao },
        data: { ativo: false, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Contrato alterado por outra requisição.');

      const depois = await tx.contrato.findUniqueOrThrow({ where: { organizacaoId } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Contrato',
        entidadeId: depois.id,
        operacao: 'CANCELAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async criarLote(input: LoteInput, usuarioId: string) {
    const dataEntrada = dataEntradaValida(input.dataEntrada);
    if (!dataEntrada) {
      throw new ApiError(400, 'Data de entrada deve estar entre hoje e os últimos 90 dias.');
    }
    if (!input.notaFiscal.trim() || !input.transportadora.trim()) {
      throw new ApiError(400, 'Nota fiscal e transportadora são obrigatórias.');
    }

    return this.repository.transaction(async (tx) => {
      const organizacao = await tx.organizacao.findUnique({ where: { id: input.organizacaoId } });
      if (!organizacao || !organizacao.ativo) {
        throw new ApiError(404, 'Organização inexistente ou inativa.');
      }

      const lote = await tx.lote.create({
        data: {
          dataEntrada,
          organizacaoId: input.organizacaoId,
          notaFiscal: input.notaFiscal,
          transportadora: input.transportadora,
          observacoes: input.observacoes ?? '',
          ...(input.equipamentos?.length
            ? { equipamentos: {
                create: input.equipamentos.map((equipamento, indice) => ({
                  ...this.validarEquipamento(equipamento),
                  codigoBarrasInterno: this.novoCodigoBarras(),
                  posicaoNoLote: indice + 1,
                })),
              } }
            : {}),
        },
        include: { equipamentos: true },
      });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Lote',
        entidadeId: lote.id,
        operacao: 'CRIAR',
        dadosDepois: lote,
        usuarioId,
      });
      return lote;
    });
  }

  listarLotes() {
    return this.db.lote.findMany({
      include: { organizacao: true, _count: { select: { equipamentos: true } } },
      orderBy: { dataEntrada: 'desc' },
    });
  }

  obterLote(id: string) {
    return this.db.lote.findUnique({
      where: { id },
      include: { organizacao: true, equipamentos: true },
    }).then((lote) => {
      if (!lote) throw new ApiError(404, 'Lote não encontrado.');
      return lote;
    });
  }

  async atualizarLote(
    id: string,
    versao: number,
    alteracoes: Partial<Pick<LoteInput, 'dataEntrada' | 'notaFiscal' | 'transportadora' | 'observacoes'>>,
    usuarioId: string,
  ) {
    const antes = await this.db.lote.findUnique({ where: { id } });
    if (!antes) throw new ApiError(404, 'Lote não encontrado.');
    if (antes.statusProcessamento !== StatusLote.RECEBIDO) {
      throw new ApiError(409, 'Só é possível atualizar o lote antes da triagem.');
    }

    const data: Prisma.LoteUpdateManyMutationInput = { ...alteracoes };
    if (alteracoes.notaFiscal !== undefined && !alteracoes.notaFiscal.trim()) {
      throw new ApiError(400, 'Nota fiscal é obrigatória.');
    }
    if (alteracoes.transportadora !== undefined && !alteracoes.transportadora.trim()) {
      throw new ApiError(400, 'Transportadora é obrigatória.');
    }
    if (alteracoes.dataEntrada !== undefined) {
      const dataEntrada = dataEntradaValida(alteracoes.dataEntrada);
      if (!dataEntrada) {
        throw new ApiError(400, 'Data de entrada inválida.');
      }
      data.dataEntrada = dataEntrada;
    }

    return this.repository.transaction(async (tx) => {
      const resultado = await tx.lote.updateMany({
        where: { id, versao },
        data: { ...data, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Lote alterado por outra requisição.');
      const depois = await tx.lote.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Lote',
        entidadeId: id,
        operacao: 'ATUALIZAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async excluirLote(id: string, versao: number, usuarioId: string): Promise<void> {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.lote.findUnique({
        where: { id },
        include: { _count: { select: { equipamentos: true } } },
      });
      if (!antes) throw new ApiError(404, 'Lote não encontrado.');
      if (antes._count.equipamentos || antes.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new ApiError(409, 'Só é possível excluir lote recebido sem equipamentos.');
      }

      const resultado = await tx.lote.deleteMany({ where: { id, versao } });
      if (resultado.count !== 1) throw new ApiError(409, 'Lote alterado por outra requisição.');
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Lote',
        entidadeId: id,
        operacao: 'EXCLUIR',
        dadosAntes: antes,
        usuarioId,
      });
    });
  }

  async iniciarTriagem(id: string, versao: number, usuarioId: string) {
    return this.alterarStatusLote(id, versao, StatusLote.EM_TRIAGEM, false, usuarioId, true);
  }

  async concluirTriagem(id: string, versao: number, usuarioId: string) {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.lote.findUnique({
        where: { id },
        include: { _count: { select: { equipamentos: true } } },
      });
      if (!antes) throw new ApiError(404, 'Lote não encontrado.');
      if (antes.statusProcessamento !== StatusLote.EM_TRIAGEM || !antes._count.equipamentos) {
        throw new ApiError(409, 'Inicie a triagem e cadastre equipamentos antes de concluí-la.');
      }

      const resultado = await tx.lote.updateMany({
        where: { id, versao },
        data: {
          statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA,
          triagemConcluida: true,
          versao: { increment: 1 },
        },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Lote alterado por outra requisição.');

      const depois = await tx.lote.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Lote',
        entidadeId: id,
        operacao: 'TRIAGEM_CONCLUIDA',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  private async alterarStatusLote(
    id: string,
    versao: number,
    status: StatusLote,
    triagemConcluida: boolean,
    usuarioId: string,
    exigirEquipamentos = false,
  ) {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.lote.findUnique({ where: { id } });
      if (!antes) throw new ApiError(404, 'Lote não encontrado.');
      if (status === StatusLote.EM_TRIAGEM && antes.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new ApiError(409, 'Só é possível iniciar triagem em lote recebido.');
      }
      if (exigirEquipamentos && !(await tx.equipamento.count({ where: { loteId: id } }))) {
        throw new ApiError(409, 'Adicione ao menos um equipamento antes de iniciar a triagem.');
      }

      const resultado = await tx.lote.updateMany({
        where: { id, versao },
        data: { statusProcessamento: status, triagemConcluida, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Lote alterado por outra requisição.');
      const depois = await tx.lote.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Lote',
        entidadeId: id,
        operacao: 'INICIAR_TRIAGEM',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async criarEquipamento(input: EquipamentoInput & { loteId: string }, usuarioId: string) {
    const dados = this.validarEquipamento(input);

    return this.repository.transaction(async (tx) => {
      const lote = await tx.lote.findUnique({ where: { id: input.loteId } });
      if (!lote || lote.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new ApiError(409, 'Equipamentos só podem ser adicionados a lote recebido.');
      }
      const quantidade = await tx.equipamento.count({ where: { loteId: input.loteId } });

      const equipamento = await tx.equipamento.create({
        data: {
          ...dados,
          codigoBarrasInterno: this.novoCodigoBarras(),
          loteId: input.loteId,
          posicaoNoLote: quantidade + 1,
        },
      });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Equipamento',
        entidadeId: equipamento.id,
        operacao: 'CRIAR',
        dadosDepois: equipamento,
        usuarioId,
      });
      return equipamento;
    });
  }

  listarEquipamentos(loteId?: string) {
    return this.db.equipamento.findMany({
      ...(loteId ? { where: { loteId } } : {}),
      include: { lote: true },
      orderBy: [{ loteId: 'asc' }, { posicaoNoLote: 'asc' }],
    });
  }

  obterEquipamento(id: string) {
    return this.db.equipamento.findUnique({
      where: { id },
      include: { lote: true, movimentacoes: { orderBy: { dataHora: 'asc' } } },
    }).then((item) => {
      if (!item) throw new ApiError(404, 'Equipamento não encontrado.');
      return item;
    });
  }

  async atualizarEquipamento(
    id: string,
    versao: number,
    alteracoes: Partial<EquipamentoInput> & { justificativa?: string },
    usuarioId: string,
  ) {
    const antes = await this.db.equipamento.findUnique({ where: { id } });
    if (!antes) throw new ApiError(404, 'Equipamento não encontrado.');

    const dados: Prisma.EquipamentoUpdateManyMutationInput = {};
    if (alteracoes.tipo !== undefined) dados.tipo = alteracoes.tipo;
    if (alteracoes.marca !== undefined) dados.marca = alteracoes.marca;
    if (alteracoes.modelo !== undefined) dados.modelo = alteracoes.modelo;
    if (alteracoes.anoFabricacao !== undefined) dados.anoFabricacao = alteracoes.anoFabricacao;
    if (alteracoes.pesoQuilogramas !== undefined) {
      dados.pesoQuilogramas = new Prisma.Decimal(alteracoes.pesoQuilogramas);
    }
    if (alteracoes.estadoFisico !== undefined) {
      const estados = Object.values(EstadoFisico);
      if (!estados.includes(alteracoes.estadoFisico)) throw new ApiError(400, 'Estado físico inválido.');
      this.validarDegradacao(antes.estadoFisico, alteracoes.estadoFisico, alteracoes.justificativa ?? '');
      dados.estadoFisico = alteracoes.estadoFisico;
    }

    const merged = {
      tipo: alteracoes.tipo ?? antes.tipo,
      marca: alteracoes.marca ?? antes.marca,
      modelo: alteracoes.modelo ?? antes.modelo,
      anoFabricacao: alteracoes.anoFabricacao ?? antes.anoFabricacao,
      estadoFisico: alteracoes.estadoFisico ?? antes.estadoFisico,
      pesoQuilogramas: alteracoes.pesoQuilogramas ?? Number(antes.pesoQuilogramas),
    };
    this.validarEquipamento(merged);

    return this.repository.transaction(async (tx) => {
      const resultado = await tx.equipamento.updateMany({
        where: { id, versao },
        data: { ...dados, versao: { increment: 1 } },
      });
      if (resultado.count !== 1) throw new ApiError(409, 'Equipamento alterado por outra requisição.');
      const depois = await tx.equipamento.findUniqueOrThrow({ where: { id } });
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Equipamento',
        entidadeId: id,
        operacao: 'ATUALIZAR',
        dadosAntes: antes,
        dadosDepois: depois,
        usuarioId,
      });
      return depois;
    });
  }

  async excluirEquipamento(id: string, versao: number, usuarioId: string): Promise<void> {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.equipamento.findUnique({
        where: { id },
        include: { _count: { select: { movimentacoes: true } } },
      });
      if (!antes) throw new ApiError(404, 'Equipamento não encontrado.');
      if (antes._count.movimentacoes || antes.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM) {
        throw new ApiError(409, 'Só é possível excluir equipamento sem movimentações e antes da triagem.');
      }

      const resultado = await tx.equipamento.deleteMany({ where: { id, versao } });
      if (resultado.count !== 1) throw new ApiError(409, 'Equipamento alterado por outra requisição.');
      await this.repository.registrarAuditoria(tx, {
        entidade: 'Equipamento',
        entidadeId: id,
        operacao: 'EXCLUIR',
        dadosAntes: antes,
        usuarioId,
      });
    });
  }

  async movimentarEquipamento(
    id: string,
    versao: number,
    destino: StatusRastreamento,
    responsavel: string,
    observacao: string,
    usuarioId: string,
  ) {
    return this.repository.transaction(async (tx) => {
      const antes = await tx.equipamento.findUnique({
        where: { id },
        include: { lote: true },
      });
      if (!antes) throw new ApiError(404, 'Equipamento não encontrado.');
      if (!transicoesPermitidas[antes.statusRastreamento].includes(destino)) {
        throw new ApiError(409, 'Transição de status não permitida.');
      }
      if (
        destino === StatusRastreamento.EM_DESMONTE &&
        !antes.lote.triagemConcluida
      ) {
        throw new ApiError(409, 'Triagem do lote deve ser concluída antes do desmonte.');
      }

      const atualizacao = await tx.equipamento.updateMany({
        where: { id, versao },
        data: { statusRastreamento: destino, versao: { increment: 1 } },
      });
      if (atualizacao.count !== 1) throw new ApiError(409, 'Equipamento alterado por outra requisição.');

      const movimentacao = await tx.movimentacao.create({
        data: {
          equipamentoId: id,
          origem: antes.statusRastreamento,
          destino,
          responsavel,
          observacao,
        },
      });
      const depois = await tx.equipamento.findUniqueOrThrow({ where: { id } });

      await this.repository.registrarAuditoria(tx, {
        entidade: 'Equipamento',
        entidadeId: id,
        operacao: 'MOVIMENTAR',
        dadosAntes: antes,
        dadosDepois: { equipamento: depois, movimentacao },
        usuarioId,
      });

      return { equipamento: depois, movimentacao };
    });
  }

  async resumoRelatorios() {
    const [organizacoes, lotes, equipamentos, contratos] = await Promise.all([
      this.db.organizacao.count({ where: { ativo: true } }),
      this.db.lote.count(),
      this.db.equipamento.findMany({ select: { statusRastreamento: true, pesoQuilogramas: true } }),
      this.db.contrato.findMany({ where: { ativo: true }, select: { valorMensal: true } }),
    ]);
    const porStatus = Object.fromEntries(
      Object.values(StatusRastreamento).map((status) => [
        status,
        equipamentos.filter((item) => item.statusRastreamento === status).length,
      ]),
    );

    return {
      organizacoes,
      lotes,
      equipamentos: equipamentos.length,
      pesoTotalKg: equipamentos.reduce((soma, item) => soma + Number(item.pesoQuilogramas), 0),
      contratosAtivos: contratos.length,
      receitaMensalPrevista: contratos.reduce((soma, item) => soma + Number(item.valorMensal), 0),
      porStatus,
    };
  }

  private validarEquipamento(input: EquipamentoInput) {
    if (!Object.values(TipoEquipamento).includes(input.tipo)) {
      throw new ApiError(400, 'Tipo de equipamento inválido.');
    }
    if (!Object.values(EstadoFisico).includes(input.estadoFisico)) {
      throw new ApiError(400, 'Estado físico inválido.');
    }
    if (!input.marca.trim() || !input.modelo.trim()) {
      throw new ApiError(400, 'Marca e modelo são obrigatórios.');
    }
    if (input.marca.length > 100 || input.modelo.length > 100) {
      throw new ApiError(400, 'Marca e modelo devem ter no máximo 100 caracteres.');
    }
    if (!Number.isInteger(input.anoFabricacao) || input.anoFabricacao < 1970 || input.anoFabricacao > new Date().getFullYear()) {
      throw new ApiError(400, 'Ano de fabricação inválido.');
    }
    if (!Number.isFinite(input.pesoQuilogramas) || input.pesoQuilogramas <= 0) {
      throw new ApiError(400, 'Peso deve ser maior que zero.');
    }

    return {
      tipo: input.tipo,
      marca: input.marca,
      modelo: input.modelo,
      anoFabricacao: input.anoFabricacao,
      estadoFisico: input.estadoFisico,
      pesoQuilogramas: new Prisma.Decimal(input.pesoQuilogramas),
    };
  }

  private validarDegradacao(
    antes: EstadoFisico,
    depois: EstadoFisico,
    justificativa: string,
  ): void {
    const escala = Object.values(EstadoFisico);
    const diferenca = escala.indexOf(depois) - escala.indexOf(antes);
    if (diferenca >= 2 && !justificativa.trim()) {
      throw new ApiError(400, 'Informe justificativa para queda de duas ou mais categorias físicas.');
    }
  }

  private novoCodigoBarras(): string {
    return `GC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }
}
