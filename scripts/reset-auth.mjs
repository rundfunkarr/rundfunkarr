import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";

if (!process.argv.includes("--confirm")) {
  console.error("This disables authentication, clears the administrator password, revokes all sessions and rotates the integration key. Run with --confirm from a trusted server terminal.");
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  await prisma.$transaction([
    prisma.authSession.deleteMany({}),
    prisma.authConfig.upsert({ where: { id: 1 }, create: { id: 1, apiKey: randomBytes(32).toString("hex"), revision: randomUUID() }, update: {
      enabled: false, username: "", passwordHash: "", apiKey: randomBytes(32).toString("hex"), revision: randomUUID(), failedLogins: 0, loginBlockedUntil: null,
    } }),
  ]);
  console.log("Authentication reset. Configure a new account in Settings > General > Security before exposing the server again.");
} finally { await prisma.$disconnect(); }
