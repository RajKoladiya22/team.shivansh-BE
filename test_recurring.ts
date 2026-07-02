import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({
    where: { title: { contains: "SKIPPED - LEAVE" } },
    select: { id: true, title: true, status: true, startDate: true, recurrenceChildren: true }
  });
  console.log("Skipped tasks:", JSON.stringify(tasks, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
