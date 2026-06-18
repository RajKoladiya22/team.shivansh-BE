import prisma from './src/lib/prisma';
async function main() {
  const q = await prisma.quotation.findMany({
    where: { quotationNumber: { in: ['QT-2026-03-0003', 'QT-2026-03-0002', 'QT-2026-03-0001'] } }
  });
  console.log(q);
}
main();
