-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR');
CREATE TYPE "TipoEquipamento" AS ENUM ('COMPUTADOR_MESA', 'NOTEBOOK', 'MONITOR', 'IMPRESSORA', 'SERVIDOR', 'ROTEADOR', 'CABO_ESTRUTURADO', 'FONTE_ALIMENTACAO');
CREATE TYPE "EstadoFisico" AS ENUM ('NOVO', 'BOM_ESTADO', 'USADO_LEVE', 'USADO_MODERADO', 'DANIFICADO_LEVE', 'DANIFICADO_GRAVE', 'INSERVIVEL');
CREATE TYPE "StatusLote" AS ENUM ('RECEBIDO', 'EM_TRIAGEM', 'TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO');
CREATE TYPE "StatusRastreamento" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA');

CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "nomeUsuario" VARCHAR(32) NOT NULL,
    "hashSenha" VARCHAR(255) NOT NULL,
    "papel" "PapelUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organizacao" (
    "id" UUID NOT NULL,
    "razaoSocial" VARCHAR(200) NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "inscricaoEstadual" VARCHAR(30) NOT NULL DEFAULT '',
    "enderecoCompleto" VARCHAR(300) NOT NULL DEFAULT '',
    "telefone" VARCHAR(30) NOT NULL DEFAULT '',
    "email" VARCHAR(254) NOT NULL,
    "dataCadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contrato" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "dataAssinatura" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVencimento" DATE NOT NULL,
    "clausulas" TEXT[] NOT NULL,
    "valorMensal" DECIMAL(12,2) NOT NULL,
    "renovacaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lote" (
    "id" UUID NOT NULL,
    "dataEntrada" DATE NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "notaFiscal" VARCHAR(80) NOT NULL,
    "transportadora" VARCHAR(160) NOT NULL,
    "statusProcessamento" "StatusLote" NOT NULL DEFAULT 'RECEBIDO',
    "observacoes" VARCHAR(2000) NOT NULL DEFAULT '',
    "triagemConcluida" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Equipamento" (
    "id" UUID NOT NULL,
    "codigoBarrasInterno" VARCHAR(40) NOT NULL,
    "tipo" "TipoEquipamento" NOT NULL,
    "marca" VARCHAR(100) NOT NULL,
    "modelo" VARCHAR(100) NOT NULL,
    "anoFabricacao" INTEGER NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL,
    "pesoQuilogramas" DECIMAL(10,3) NOT NULL,
    "loteId" UUID NOT NULL,
    "posicaoNoLote" INTEGER NOT NULL,
    "statusRastreamento" "StatusRastreamento" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Equipamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Movimentacao" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "dataHora" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" "StatusRastreamento" NOT NULL,
    "destino" "StatusRastreamento" NOT NULL,
    "responsavel" VARCHAR(100) NOT NULL,
    "observacao" VARCHAR(1000) NOT NULL DEFAULT '',
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Auditoria" (
    "id" UUID NOT NULL,
    "entidade" VARCHAR(80) NOT NULL,
    "entidadeId" VARCHAR(80) NOT NULL,
    "operacao" VARCHAR(40) NOT NULL,
    "dadosAntes" JSONB,
    "dadosDepois" JSONB,
    "usuarioId" UUID,
    "ocorridoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Usuario_nomeUsuario_key" ON "Usuario"("nomeUsuario");
CREATE UNIQUE INDEX "Organizacao_cnpj_key" ON "Organizacao"("cnpj");
CREATE UNIQUE INDEX "Contrato_organizacaoId_key" ON "Contrato"("organizacaoId");
CREATE INDEX "Lote_organizacaoId_dataEntrada_idx" ON "Lote"("organizacaoId", "dataEntrada");
CREATE INDEX "Lote_statusProcessamento_idx" ON "Lote"("statusProcessamento");
CREATE UNIQUE INDEX "Equipamento_codigoBarrasInterno_key" ON "Equipamento"("codigoBarrasInterno");
CREATE INDEX "Equipamento_loteId_statusRastreamento_idx" ON "Equipamento"("loteId", "statusRastreamento");
CREATE UNIQUE INDEX "Equipamento_loteId_posicaoNoLote_key" ON "Equipamento"("loteId", "posicaoNoLote");
CREATE INDEX "Movimentacao_equipamentoId_dataHora_idx" ON "Movimentacao"("equipamentoId", "dataHora");
CREATE INDEX "Auditoria_entidade_entidadeId_ocorridoEm_idx" ON "Auditoria"("entidade", "entidadeId", "ocorridoEm");

ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Organizacao" ADD CONSTRAINT "Organizacao_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_valorMensal_nonnegative_check" CHECK ("valorMensal" >= 0);
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_peso_positive_check" CHECK ("pesoQuilogramas" > 0);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_ano_fabricacao_check" CHECK ("anoFabricacao" >= 1970);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_posicao_positive_check" CHECK ("posicaoNoLote" > 0);
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_versao_positive_check" CHECK ("versao" > 0);
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_versao_positive_check" CHECK ("versao" > 0);

CREATE FUNCTION "verificar_triagem_do_equipamento"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."statusRastreamento" IN ('EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA')
     AND NOT EXISTS (
       SELECT 1 FROM "Lote"
       WHERE "id" = NEW."loteId" AND "triagemConcluida" = true
     ) THEN
    RAISE EXCEPTION 'A triagem do lote deve estar concluída antes do desmonte ou destinação final.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Equipamento_exige_triagem_concluida"
BEFORE INSERT OR UPDATE ON "Equipamento"
FOR EACH ROW EXECUTE FUNCTION "verificar_triagem_do_equipamento"();

CREATE FUNCTION "impedir_reabrir_triagem_com_destinacao"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."triagemConcluida" = true AND NEW."triagemConcluida" = false
     AND EXISTS (
       SELECT 1 FROM "Equipamento"
       WHERE "loteId" = NEW."id"
         AND "statusRastreamento" IN ('EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA')
     ) THEN
    RAISE EXCEPTION 'Não é possível reabrir triagem após o desmonte ou destinação de equipamentos.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Lote_nao_reabre_triagem_com_destinacao"
BEFORE UPDATE OF "triagemConcluida" ON "Lote"
FOR EACH ROW EXECUTE FUNCTION "impedir_reabrir_triagem_com_destinacao"();
