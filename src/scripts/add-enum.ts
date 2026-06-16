import { prisma } from "../config/database.config";

async function main() {
  // Execute ALTER TYPE query to add the enum value safely
  await prisma.$executeRawUnsafe(`ALTER TYPE "CloudServiceActivityAction" ADD VALUE 'RENEWAL_CANCELLED';`);
  console.log("CloudServiceActivityAction enum updated successfully in the database");
}

main()
  .catch((err) => {
    // If it already exists, ignore the error
    if (err.message?.includes("already exists")) {
      console.log("Enum value already exists in the database");
    } else {
      console.error("Failed to update enum:", err);
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

