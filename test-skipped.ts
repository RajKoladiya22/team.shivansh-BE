import { prisma } from './src/config/database.config';
async function main() {
  const skipped = await prisma.task.findMany({
    where: { title: { startsWith: '[SKIPPED - LEAVE]' } },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent skipped tasks:', skipped);
}
main().finally(() => prisma.$disconnect());
