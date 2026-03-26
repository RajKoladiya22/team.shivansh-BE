import bcrypt from "bcrypt";
import { prisma } from "../src/config/database.config";
import { config } from "dotenv";
config();

// ── Existing IDs — already in DB, do not recreate ──────────────────────────
const ADMIN_ROLE_ID = "24311261-2ec2-4a3c-82bf-6b96b9dab800";
const ALL_PERMISSION_ID = "548d3b5b-15e6-4e5c-82fd-87a20b480876";

// ── New user details — edit these before running ───────────────────────────
const NEW_USER = {
  firstName: "Raj",
  lastName: "Koladiya",
  contactEmail: "koladiyaraj22@gmail.com",
  contactPhone: "+91 9913423994",
  designation: "Developer",
  registerNumber: "SI00000",
  username: "raj@developer",
  password: "Admin@123", // will be hashed 
};

async function main() {
  console.log("🌱 Seeding new admin user...\n");

  // ── 1. Verify role + permission exist ─────────────────────────────────────
  const role = await prisma.role.findUnique({ where: { id: ADMIN_ROLE_ID } });
  if (!role) throw new Error(`❌ Role not found: ${ADMIN_ROLE_ID}`);
  console.log("✅ Role found:", role.name);

  const permission = await prisma.permission.findUnique({
    where: { id: ALL_PERMISSION_ID },
  });
  if (!permission)
    throw new Error(`❌ Permission not found: ${ALL_PERMISSION_ID}`);
  console.log("✅ Permission found:", permission.key);

  // ── 2. Account ─────────────────────────────────────────────────────────────
  const account = await prisma.account.upsert({
    where: { contactEmail: NEW_USER.contactEmail },
    update: {},
    create: {
      firstName: NEW_USER.firstName,
      lastName: NEW_USER.lastName,
      contactEmail: NEW_USER.contactEmail,
      contactPhone: NEW_USER.contactPhone,
      designation: NEW_USER.designation,
      registerNumber: NEW_USER.registerNumber,
      isActive: true,
      joinedAt: new Date(),
    },
  });
  console.log("✅ Account:", account.contactEmail, `(${account.id})`);

  // ── 3. User (auth credentials) ─────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(NEW_USER.password, 12);
  const user = await prisma.user.upsert({
    where: { accountId: account.id },
    update: {},
    create: {
      accountId: account.id,
      username: NEW_USER.username,
      passwordHash,
    },
  });
  console.log("✅ User:", user.username, `(${user.id})`);

  // ── 4. Assign ADMIN role ───────────────────────────────────────────────────
  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: user.id, roleId: ADMIN_ROLE_ID },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: ADMIN_ROLE_ID,
    },
  });
  console.log("✅ ADMIN role assigned");

  // ── 5. Assign ALL permission directly to user (optional belt-and-suspenders)
  // Only needed if your auth checks userPermissions in addition to role permissions.
  // Remove this block if permissions are resolved solely through roles.
  //   await prisma.rolePermission.upsert({
  //     where: {
  //       userId_permissionId: { userId: user.id, permissionId: ALL_PERMISSION_ID },
  //     },
  //     update: {},
  //     create: {
  //       userId:       user.id,
  //       permissionId: ALL_PERMISSION_ID,
  //     },
  //   });
  //   console.log("✅ ALL permission assigned");

  console.log("\n──────────────────────────────────────");
  console.log("🎉 New admin ready:");
  console.log("   Email   :", NEW_USER.contactEmail);
  console.log("   Username:", NEW_USER.username);
  console.log("   Password:", NEW_USER.password, " ← change after first login");
  console.log("──────────────────────────────────────\n");
}

main()
  .then(() => console.log("🌱 Seed completed"))
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
