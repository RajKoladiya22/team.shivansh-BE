// import path from "node:path";
// import "dotenv/config";
// import { defineConfig } from "prisma/config";

// import { config } from "dotenv";
// config();

// export const env = process.env;
// const databaseUrl = env.DATABASE_URL || "postgresql://postgres:raj24315@localhost:5432/shivansh-admin";

// if (!databaseUrl) {
//   console.error("❌ DATABASE_URL is not set");
//   process.exit(1);
// }


// export default defineConfig({
//   schema: path.join("prisma", "schema.prisma"),
//   migrations: {
//     path: path.join("prisma", "migrations"),
//   },
//   datasource: {
//     url: databaseUrl,
//   },
// });





//prisma.config.ts
import { envConfiguration } from "./src/config/env.config";
import { validatedEnv } from "./src/config/validate-env";
import "dotenv/config";               
import path from "node:path";
import { defineConfig } from "prisma/config";
envConfiguration();
const env = validatedEnv;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: env.DATABASE_URL,
  },
});



























// // prisma.config.ts

// import { config } from "dotenv";
// config();

// export const env = process.env;
// const databaseUrl = env.DATABASE_URL || "postgresql://postgres:raj24315@localhost:5432/shivansh-admin";

// if (!databaseUrl) {
//   console.error("❌ DATABASE_URL is not set");
//   process.exit(1);
// }



// console.log("\n\ndatabaseUrl---------->", databaseUrl);


// export default {
//   schema: "prisma/schema.prisma",
//   migrations: { path: "prisma/migrations" },
//   datasource: {
//     url: databaseUrl,
//   },
// };
