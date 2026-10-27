import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {
  EstadoFisico,
  PapelUsuario,
  Prisma,
  PrismaClient,
  StatusRastreamento,
  TipoEquipamento,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const nomeUsuario = (process.env.SEED_ADMIN_USER ?? 'admin').toLowerCase();
  const senha = process.env.SEED_ADMIN_PASSWORD;

  if (!senha || senha.length < 12) {
    throw new Error('Defina SEED_ADMIN_PASSWORD com pelo menos 12 caracteres antes de executar db:seed.');
  }

  const hashSenha = await bcrypt.hash(senha, 12);
  const resultado = await prisma.$transaction(async (tx) => {
    const administrador = await tx.usuario.upsert({
      where: { nomeUsuario },
      update: { hashSenha, papel: PapelUsuario.ADMINISTRADOR, ativo: true },
      create: { nomeUsuario, hashSenha, papel: PapelUsuario.ADMINISTRADOR },
    });

    const orgPrincipal = await tx.organizacao.upsert({
      where: { cnpj: '11222333000181' },
      update: {},
      create: {
        razaoSocial: 'Organização Exemplo GreenCode',
        cnpj: '11222333000181',
        email: 'contato@exemplo.greencode.local',
        enderecoCompleto: 'Rua de Exemplo, 100',
        telefone: '(11) 4000-0000',
      },
    });
    const orgParceira = await tx.organizacao.upsert({
      where: { cnpj: '11444777000161' },
      update: {},
      create: {
        razaoSocial: 'Parceira de Reciclagem Exemplo',
        cnpj: '11444777000161',
        email: 'contato@parceira.greencode.local',
        enderecoCompleto: 'Avenida da Reciclagem, 250',
        telefone: '(11) 4000-0001',
      },
    });

    const vencimento = new Date();
    vencimento.setUTCFullYear(vencimento.getUTCFullYear() + 1);
    await tx.contrato.upsert({
      where: { organizacaoId: orgPrincipal.id },
      update: {},
      create: {
        organizacaoId: orgPrincipal.id,
        dataVencimento: vencimento,
        clausulas: ['Coleta mensal', 'Triagem e rastreabilidade'],
        valorMensal: 1200,
        renovacaoAutomatica: true,
      },
    });
    await tx.contrato.upsert({
      where: { organizacaoId: orgParceira.id },
      update: {},
      create: {
        organizacaoId: orgParceira.id,
        dataVencimento: vencimento,
        clausulas: ['Recebimento de materiais recicláveis'],
        valorMensal: 850,
      },
    });

    const loteRecebido = await obterOuCriarLote(tx, orgPrincipal.id, 'AV2-DEMO-001', 'Lote recebido para testar cadastro e início da triagem.');
    const loteTriado = await obterOuCriarLote(tx, orgParceira.id, 'AV2-DEMO-002', 'Lote de demonstração com triagem concluída.');
    await tx.lote.updateMany({
      where: { id: loteTriado.id },
      data: { statusProcessamento: 'TRIAGEM_CONCLUIDA', triagemConcluida: true },
    });

    await tx.equipamento.upsert({
      where: { codigoBarrasInterno: 'GC-AV2-DEMO-0001' },
      update: {},
      create: {
        codigoBarrasInterno: 'GC-AV2-DEMO-0001',
        tipo: TipoEquipamento.NOTEBOOK,
        marca: 'GreenCode', modelo: 'Notebook de demonstração',
        anoFabricacao: new Date().getFullYear() - 2,
        estadoFisico: EstadoFisico.BOM_ESTADO,
        pesoQuilogramas: 2.1, loteId: loteRecebido.id, posicaoNoLote: 1,
      },
    });
    const equipamentoTriado = await tx.equipamento.upsert({
      where: { codigoBarrasInterno: 'GC-AV2-DEMO-0002' },
      update: {},
      create: {
        codigoBarrasInterno: 'GC-AV2-DEMO-0002',
        tipo: TipoEquipamento.COMPUTADOR_MESA,
        marca: 'GreenCode', modelo: 'Computador para reaproveitamento',
        anoFabricacao: new Date().getFullYear() - 5,
        estadoFisico: EstadoFisico.USADO_MODERADO,
        pesoQuilogramas: 8.4, loteId: loteTriado.id, posicaoNoLote: 1,
        statusRastreamento: StatusRastreamento.PECAS_REAPROVEITADAS,
      },
    });

    if (!(await tx.movimentacao.count({ where: { equipamentoId: equipamentoTriado.id } }))) {
      await tx.movimentacao.create({
        data: {
          equipamentoId: equipamentoTriado.id,
          origem: StatusRastreamento.EM_DESMONTE,
          destino: StatusRastreamento.PECAS_REAPROVEITADAS,
          responsavel: 'Seed AV2',
          observacao: 'Registro fictício para demonstração e rastreabilidade.',
        },
      });
    }

    return { administrador, orgPrincipal, orgParceira, loteRecebido, loteTriado };
  });

  console.log(`Seed concluído. Admin: ${resultado.administrador.nomeUsuario}; 2 organizações, 2 contratos, 2 lotes e 2 equipamentos de demonstração.`);
}

async function obterOuCriarLote(tx: Prisma.TransactionClient, organizacaoId: string, notaFiscal: string, observacoes: string) {
  const existente = await tx.lote.findFirst({ where: { organizacaoId, notaFiscal } });
  if (existente) return existente;
  return tx.lote.create({
    data: {
      dataEntrada: new Date(), organizacaoId, notaFiscal,
      transportadora: 'Transportadora Exemplo', observacoes,
    },
  });
}

main()
  .catch((erro: unknown) => {
    console.error('Falha ao carregar dados iniciais:', erro);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
