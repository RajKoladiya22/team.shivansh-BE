import bcrypt from "bcrypt";
import { prisma } from "../src/config/database.config";
import { config } from "dotenv";
config();

export const env = process.env;

async function main() {

  console.log("🌱 \n\n ENV ->>DATABASE_URL", env.DATABASE_URL);
  

  const allPermission = await prisma.permission.upsert({
    where: { key: "ALL" },
    update: {},
    create: {
      key: "ALL",
      description: "Wildcard permission that grants access to everything",
    },
  });
  console.log("Permission:", allPermission.key);

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {},
    create: { name: "ADMIN", description: "Administrator role" },
  });
  console.log("Role:", adminRole.name);

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: adminRole.id,
        permissionId: allPermission.id,
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      permissionId: allPermission.id,
    },
  });

  const adminEmail = "koladiyaraj22@gmail.com";
  const adminAccount = await prisma.account.upsert({
    where: { contactEmail: adminEmail },
    update: {},
    create: {
      firstName: "Admin",
      lastName: "User",
      contactEmail: adminEmail,
      contactPhone: "9999999999",
      isActive: true,
      designation: "Administrator",
      joinedAt: new Date(),
    },
  });

  console.log("Admin account:", adminAccount.contactEmail);

  const passwordHash = await bcrypt.hash("Admin@123", 12);
  const adminUser = await prisma.user.upsert({
    where: { accountId: adminAccount.id },
    update: {},
    create: {
      accountId: adminAccount.id,
      username: "admin",
      passwordHash,
    },
  });

  console.log("Admin user:", adminUser.username);

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });
  console.log("Role assignment complete");
}

main()
  .then(() => {
    console.log("🌱 Seed completed");
  })
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
