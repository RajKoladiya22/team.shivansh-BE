import { prisma } from './src/config/database.config';
async function main() {
  const regions = await prisma.analyticsSession.groupBy({
    by: ['countryCode', 'region'],
    _count: { id: true },
    where: { countryCode: 'IN' }
  });
  console.log('Regions in IN:', regions);
}
main().finally(() => prisma.$disconnect());
