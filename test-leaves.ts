import { prisma } from './src/config/database.config';
async function main() {
  const types = await prisma.leaveRequest.findMany({ select: { type: true }, distinct: ['type'] });
  console.log('Types:', types);
}
main().finally(() => prisma.$disconnect());
