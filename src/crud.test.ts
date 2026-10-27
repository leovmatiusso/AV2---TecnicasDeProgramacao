import { strict as assert } from 'node:assert';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ServicoDominio } from './services.js';
import { RepositorioArquivo } from './storage.js';

const criarOrganizacao = async (servico: ServicoDominio) =>
  servico.cadastrarOrganizacao(
    {
      razaoSocial: 'Organização de Teste',
      cnpj: '11444777000161',
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Rua de Teste, 10',
      telefone: '11999990000',
      email: 'teste@example.com',
    },
    'admin.teste',
  );

test('CRUD de organização, lote e equipamento mantém os vínculos', async () => {
  const diretorio = await mkdtemp(join(process.cwd(), '.crud-test-'));

  try {
    const chave = Buffer.alloc(32, 7).toString('hex');
    const repositorio = new RepositorioArquivo(diretorio, chave);
    await repositorio.inicializar();

    const servico = new ServicoDominio(repositorio);
    const organizacao = await criarOrganizacao(servico);

    const organizacaoAtualizada = await servico.atualizarOrganizacao(
      organizacao.id,
      { razaoSocial: 'Organização Atualizada', telefone: '11888880000' },
      'admin.teste',
    );

    assert.equal(organizacaoAtualizada.razaoSocial, 'Organização Atualizada');
    assert.equal(servico.estado().organizacoes[0]?.telefone, '11888880000');

    const lote = await servico.criarLote(
      organizacao.id,
      'NF-001',
      'Transporte Teste',
      new Date().toISOString(),
      'admin.teste',
    );

    const loteAtualizado = await servico.atualizarLote(
      lote.id,
      { notaFiscal: 'NF-002', observacoes: 'Conferido na chegada' },
      'admin.teste',
    );

    assert.equal(loteAtualizado.notaFiscal, 'NF-002');
    assert.equal(loteAtualizado.observacoes, 'Conferido na chegada');

    const equipamento = await servico.criarEquipamento(
      {
        loteId: lote.id,
        tipo: 'NOTEBOOK',
        marca: 'Marca A',
        modelo: 'Modelo A',
        anoFabricacao: 2022,
        estadoFisico: 'BOM_ESTADO',
        pesoQuilogramas: 2,
      },
      'admin.teste',
    );

    assert.deepEqual(servico.estado().lotes[0]?.equipamentoIds, [equipamento.id]);

    const equipamentoAtualizado = await servico.atualizarEquipamento(
      equipamento.codigoBarrasInterno,
      { marca: 'Marca B', pesoQuilogramas: 2.4 },
      'admin.teste',
    );

    assert.equal(equipamentoAtualizado.marca, 'Marca B');
    assert.equal(equipamentoAtualizado.pesoQuilogramas, 2.4);

    await assert.rejects(
      () => servico.excluirLote(lote.id, 'admin.teste'),
      /possui equipamentos/,
    );

    await servico.excluirEquipamento(equipamento.id, 'admin.teste');

    assert.equal(servico.estado().equipamentos.length, 0);
    assert.deepEqual(servico.estado().lotes[0]?.equipamentoIds, []);

    await servico.excluirLote(lote.id, 'admin.teste');

    assert.equal(servico.estado().lotes.length, 0);
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
});

test('CRUD de contrato permite consulta, renovação e cancelamento auditável', async () => {
  const diretorio = await mkdtemp(join(process.cwd(), '.crud-test-'));

  try {
    const chave = Buffer.alloc(32, 13).toString('hex');
    const repositorio = new RepositorioArquivo(diretorio, chave);
    await repositorio.inicializar();

    const servico = new ServicoDominio(repositorio);
    const organizacao = await criarOrganizacao(servico);

    await servico.criarContrato(
      organizacao.id,
      '2035-12-31',
      1500,
      'admin.teste',
    );

    const primeiroContrato = servico.estado().organizacoes[0]?.contratoVigente;
    assert.equal(primeiroContrato?.ativo, true);

    await servico.renovarContrato(
      organizacao.id,
      '2036-12-31',
      'admin.teste',
    );

    assert.equal(
      servico.estado().organizacoes[0]?.contratoVigente?.dataVencimento,
      new Date('2036-12-31').toISOString(),
    );

    await servico.cancelarContrato(organizacao.id, 'admin.teste');

    const contratoCancelado = servico.estado().organizacoes[0]?.contratoVigente;
    assert.equal(contratoCancelado?.ativo, false);
    assert.equal(servico.estado().contratos.length, 1);

    await servico.criarContrato(
      organizacao.id,
      '2037-12-31',
      1700,
      'admin.teste',
    );

    assert.equal(servico.estado().contratos.length, 2);
    assert.equal(
      servico.estado().organizacoes[0]?.contratoVigente?.ativo,
      true,
    );
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
});

test('CRUD de usuário cria, altera papel e desativa acesso', async () => {
  const diretorio = await mkdtemp(join(process.cwd(), '.crud-test-'));

  try {
    const chave = Buffer.alloc(32, 15).toString('hex');
    const repositorio = new RepositorioArquivo(diretorio, chave);
    await repositorio.inicializar();

    const servico = new ServicoDominio(repositorio);

    await servico.criarUsuario(
      'auditor.teste',
      'SenhaSegura#2026',
      'OPERADOR_CADASTRO',
      'admin.teste',
    );

    await servico.alterarPapel(
      'auditor.teste',
      'AUDITOR',
      'admin.teste',
    );

    assert.equal(servico.estado().credenciais[0]?.papel, 'AUDITOR');
    assert.equal((await servico.login('auditor.teste', 'SenhaSegura#2026')).papel, 'AUDITOR');

    await servico.alterarAcesso('auditor.teste', false, 'admin.teste');

    await assert.rejects(
      () => servico.login('auditor.teste', 'SenhaSegura#2026'),
      /inválidos/,
    );

    await servico.alterarAcesso('auditor.teste', true, 'admin.teste');

    assert.equal((await servico.login('auditor.teste', 'SenhaSegura#2026')).papel, 'AUDITOR');
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
});

test('replay do journal restaura a associação entre lote e equipamento', async () => {
  const diretorio = await mkdtemp(join(process.cwd(), '.crud-test-'));

  try {
    const chave = Buffer.alloc(32, 9).toString('hex');
    const repositorio = new RepositorioArquivo(diretorio, chave);
    await repositorio.inicializar();

    const servico = new ServicoDominio(repositorio);
    const organizacao = await criarOrganizacao(servico);
    const lote = await servico.criarLote(
      organizacao.id,
      'NF-003',
      'Transporte Teste',
      new Date().toISOString(),
      'admin.teste',
    );
    const equipamento = await servico.criarEquipamento(
      {
        loteId: lote.id,
        tipo: 'NOTEBOOK',
        marca: 'Marca A',
        modelo: 'Modelo A',
        anoFabricacao: 2022,
        estadoFisico: 'BOM_ESTADO',
        pesoQuilogramas: 2,
      },
      'admin.teste',
    );

    for (const nome of [
      'credenciais.enc',
      'organizacoes.enc',
      'contratos.enc',
      'lotes.enc',
      'equipamentos.enc',
    ]) {
      await unlink(join(diretorio, nome));
    }

    const repositorioRecuperado = new RepositorioArquivo(diretorio, chave);
    await repositorioRecuperado.inicializar();

    const estado = repositorioRecuperado.obterEstado();
    const equipamentoRecuperado = estado.equipamentos.find(
      (item) => item.id === equipamento.id,
    );
    const loteRecuperado = estado.lotes.find((item) => item.id === lote.id);

    assert.equal(equipamentoRecuperado?.id, equipamento.id);
    assert.deepEqual(loteRecuperado?.equipamentoIds, [equipamento.id]);
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
});

test('equipamento com movimentação não pode ser excluído', async () => {
  const diretorio = await mkdtemp(join(process.cwd(), '.crud-test-'));

  try {
    const chave = Buffer.alloc(32, 11).toString('hex');
    const repositorio = new RepositorioArquivo(diretorio, chave);
    await repositorio.inicializar();

    const servico = new ServicoDominio(repositorio);
    const organizacao = await criarOrganizacao(servico);
    const lote = await servico.criarLote(
      organizacao.id,
      'NF-004',
      'Transporte Teste',
      new Date().toISOString(),
      'admin.teste',
    );
    const equipamento = await servico.criarEquipamento(
      {
        loteId: lote.id,
        tipo: 'NOTEBOOK',
        marca: 'Marca A',
        modelo: 'Modelo A',
        anoFabricacao: 2022,
        estadoFisico: 'BOM_ESTADO',
        pesoQuilogramas: 2,
      },
      'admin.teste',
    );

    await servico.iniciarTriagem(lote.id, 'admin.teste');
    await servico.registrarTriagem(lote.id, 'admin.teste');
    await servico.movimentar(
      equipamento.id,
      'EM_TRIAGEM',
      'Técnico',
      'Início da análise',
      'admin.teste',
    );

    await assert.rejects(
      () => servico.excluirEquipamento(equipamento.id, 'admin.teste'),
      /movimentações registradas/,
    );
  } finally {
    await rm(diretorio, { recursive: true, force: true });
  }
});
