import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';

const baseUrl = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const nomeUsuario = process.env.SEED_ADMIN_USER ?? 'admin';
const senha = process.env.SEED_ADMIN_PASSWORD;

if (!senha) {
  throw new Error('Configure SEED_ADMIN_PASSWORD no .env antes de executar a jornada da API.');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const resultado: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} retornou ${response.status}: ${text}`);
  }
  return resultado as T;
}

function gerarCnpj(): string {
  const base = `${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(0, 8)}0001`;
  const digito = (valor: string, pesos: number[]): number => {
    const soma = [...valor].reduce((total, char, index) => total + Number(char) * pesos[index]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const parcial = `${base}${primeiro}`;
  const segundo = digito(parcial, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${parcial}${segundo}`;
}

function dataLocal(): string {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

type RecursoComVersao = { id: string; versao: number; [chave: string]: unknown };

async function main(): Promise<void> {
  console.log('=== Jornada de teste da API GreenCode ===');
  await request('GET', '/health');
  console.log('[1/8] Servidor responde em /health.');

  const login = await request<{ token: string }>('POST', '/api/auth/login', { nomeUsuario, senha });
  const token = login.token;
  console.log('[2/8] Login administrativo e emissão de JWT concluídos.');

  const organizacao = await request<RecursoComVersao>('POST', '/api/organizations', {
    razaoSocial: 'Organização Jornada API',
    cnpj: gerarCnpj(),
    email: 'jornada.api@exemplo.greencode.local',
  }, token);
  console.log(`[3/8] Organização criada: ${organizacao.id}.`);

  const vencimento = new Date();
  vencimento.setFullYear(vencimento.getFullYear() + 1);
  const contrato = await request<RecursoComVersao>('POST', `/api/organizations/${organizacao.id}/contract`, {
    dataVencimento: vencimento.toISOString().slice(0, 10),
    clausulas: ['Contrato criado pela jornada automatizada da API'],
    valorMensal: 1000,
  }, token);
  console.log(`[4/8] Contrato criado: ${contrato.id}.`);

  const lote = await request<RecursoComVersao & { equipamentos: RecursoComVersao[] }>(
    'POST', '/api/lots', {
      dataEntrada: dataLocal(),
      organizacaoId: organizacao.id,
      notaFiscal: `JORNADA-${Date.now()}`,
      transportadora: 'Transportadora da Jornada',
      equipamentos: [{
        tipo: 'NOTEBOOK', marca: 'GreenCode', modelo: 'Equipamento de teste',
        anoFabricacao: new Date().getFullYear() - 2,
        estadoFisico: 'BOM_ESTADO', pesoQuilogramas: 2.5,
      }],
    }, token,
  );
  console.log(`[5/8] Lote ${lote.id} e equipamento ${lote.equipamentos[0]!.id} criados em uma requisição.`);

  let loteAtual = await request<RecursoComVersao>('POST', `/api/lots/${lote.id}/triage/start`, { versao: lote.versao }, token);
  loteAtual = await request<RecursoComVersao>('POST', `/api/lots/${lote.id}/triage/complete`, { versao: loteAtual.versao }, token);
  console.log('[6/8] Triagem iniciada e concluída.');

  const equipamentoId = lote.equipamentos[0]!.id;
  let equipamentoAtual = lote.equipamentos[0]!;
  for (const destino of ['EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'MATERIAL_RECICLAVEL'] as const) {
    const resultado = await request<{ equipamento: RecursoComVersao }>(
      'POST', `/api/equipment/${equipamentoId}/movements`,
      { versao: equipamentoAtual.versao, destino, responsavel: nomeUsuario, observacao: 'Teste automatizado da AV2' },
      token,
    );
    equipamentoAtual = resultado.equipamento;
  }
  console.log('[7/8] Quatro movimentações registradas; versão otimista aceita as atualizações.');

  const resumo = await request<{ organizacoes: number; lotes: number; equipamentos: number }>(
    'GET', '/api/reports/summary', undefined, token,
  );
  console.log(`[8/8] Relatório consultado (${resumo.organizacoes} organizações, ${resumo.lotes} lotes, ${resumo.equipamentos} equipamentos).`);
  console.log('Jornada da API concluída. Os registros de teste permanecem no banco para consulta.');
}

main().catch((erro: unknown) => {
  console.error('Jornada da API não concluída:', erro);
  process.exitCode = 1;
});
