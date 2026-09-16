import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function getPrismaModelNames(schema: string): string[] {
  return Array.from(schema.matchAll(/^model\s+(\w+)\s+\{/gm), (match) => match[1]);
}

function getInitDbTableNames(sql: string): Set<string> {
  return new Set(
    Array.from(
      sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gim),
      (match) => match[1]
    )
  );
}

describe("database bootstrap schema", () => {
  it("creates every Prisma model table in init-db.sql", () => {
    const root = process.cwd();
    const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf-8");
    const initDbSql = readFileSync(path.join(root, "init-db.sql"), "utf-8");

    const initDbTables = getInitDbTableNames(initDbSql);
    const missingTables = getPrismaModelNames(schema).filter((model) => !initDbTables.has(model));

    expect(missingTables).toEqual([]);
  });
});
