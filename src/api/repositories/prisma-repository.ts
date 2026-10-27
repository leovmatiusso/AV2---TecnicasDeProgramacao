import { Prisma, PrismaClient } from '@prisma/client';

export class PrismaRepository {
  constructor(readonly client: PrismaClient) {}

  transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  async registrarAuditoria(
    transaction: Prisma.TransactionClient,
    registro: {
      entidade: string;
      entidadeId: string;
      operacao: string;
      dadosAntes?: unknown;
      dadosDepois?: unknown;
      usuarioId?: string;
    },
  ): Promise<void> {
    await transaction.auditoria.create({
      data: {
        entidade: registro.entidade,
        entidadeId: registro.entidadeId,
        operacao: registro.operacao,
        dadosAntes: registro.dadosAntes === undefined
          ? Prisma.JsonNull
          : (serializarJson(registro.dadosAntes) as Prisma.InputJsonValue),
        dadosDepois: registro.dadosDepois === undefined
          ? Prisma.JsonNull
          : (serializarJson(registro.dadosDepois) as Prisma.InputJsonValue),
        ...(registro.usuarioId ? { usuarioId: registro.usuarioId } : {}),
      },
    });
  }
}

const serializarJson = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));
