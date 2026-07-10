import { prisma } from './src/config/database.config';
async function main() {
  const accounts = await prisma.account.findMany({
    where: { firstName: 'Raj' }
  });
  console.log('Accounts:', accounts);
}
main().finally(() => prisma.$disconnect());
