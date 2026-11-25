declare module "node:sqlite" {
  type Value = string | number | bigint | Uint8Array | null;
  type Row = Record<string, unknown>;
  interface Statement {
    run(...values: Value[]): { lastInsertRowid: number | bigint; changes: number | bigint };
    get(...values: Value[]): Row | undefined;
    all(...values: Value[]): Row[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }
}
