import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { criarAppApi } from './app.js';

const prisma = new PrismaClient();
const app = await criarAppApi(prisma, process.env.JWT_SECRET, true);

const encerrar = async (sinal: string): Promise<void> => {
  app.log.info(`Recebido ${sinal}; encerrando a API.`);
  await app.close();
  await prisma.$disconnect();
};

process.once('SIGINT', () => void encerrar('SIGINT'));
process.once('SIGTERM', () => void encerrar('SIGTERM'));

const porta = Number(process.env.PORT ?? 3000);
await app.listen({ port: porta, host: '0.0.0.0' });
