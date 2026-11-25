import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const portProbe = createServer().listen(0, "127.0.0.1");
await once(portProbe, "listening");
const { port } = portProbe.address();
await new Promise((done, fail) => portProbe.close((error) => error ? fail(error) : done()));

const base = `http://127.0.0.1:${port}`;
const fixtures = resolve(root, ".data", "test");
mkdirSync(fixtures, { recursive: true });
const database = resolve(fixtures, `helpdesk-${process.pid}-${Date.now()}.sqlite`);
const legacy = new DatabaseSync(database);
const legacySalt = "0".repeat(32);
const legacyPassword = `${legacySalt}:${scryptSync("SenhaLegado-123", legacySalt, 64).toString("hex")}`;
legacy.exec(`
  CREATE TABLE people (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK(role IN ('admin','tecnico','cliente')), password TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL,
    category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Aberto', source TEXT NOT NULL,
    requester_id INTEGER NOT NULL REFERENCES people(id), assignee_id INTEGER REFERENCES people(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, request_key TEXT, UNIQUE(requester_id, request_key)
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), actor_id INTEGER NOT NULL REFERENCES people(id),
    kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE mail_outbox (
    id INTEGER PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    reply_ticket INTEGER, available_at INTEGER NOT NULL, lease_until INTEGER, delivery_key TEXT, delivered_at INTEGER, expires_at INTEGER
  );
  INSERT INTO people(name,email,role,password) VALUES('Cliente Legado','legado@tickethub.test','cliente','');
  INSERT INTO people(name,email,role,password) VALUES('Atendente Legado','atendente-legado@tickethub.test','tecnico','');
  INSERT INTO tickets(title,description,priority,category,status,source,requester_id,created_at,updated_at)
  VALUES('Chamado anterior à migração','Registro persistido no formato anterior.','Baixa','Outros','Fechado','manual',1,'2024-01-01T00:00:00Z','2024-01-01T00:00:00Z'),
  ('Legado aberto pelo cliente','Criado pelo próprio cliente.','Baixa','Outros','Fechado','manual',1,'2024-01-01T00:00:00Z','2024-01-01T00:00:00Z'),
  ('Legado aberto pela equipe','Criado em nome do cliente.','Baixa','Outros','Fechado','manual',1,'2024-01-01T00:00:00Z','2024-01-01T00:00:00Z');
  INSERT INTO events(ticket_id,actor_id,kind,body,created_at)
  VALUES(2,1,'event','Abriu o chamado','2024-01-01T00:00:00Z'),
  (3,2,'event','Abriu o chamado em nome do cliente','2024-01-01T00:00:00Z');
  INSERT INTO mail_outbox(recipient,subject,body,available_at)
  VALUES('legado@tickethub.test','[TH-0002] Mensagem legítima','Notificação antiga permitida.',0),
  ('legado@tickethub.test','[TH-0003] Notificação da equipe','Informação que não deve sair.',0);
`);
legacy.prepare("UPDATE people SET password=? WHERE id=1").run(legacyPassword);
legacy.close();

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  OPENAI_API_KEY: "",
  TICKETHUB_DEMO: "1",
  TICKETHUB_DB: database,
  TICKETHUB_BASE_URL: base,
  TICKETHUB_MAIL_SECRET: "test-only-tickethub-email-connection-123456",
};
const run = (entry, args = []) => spawn(process.execPath, [resolve(root, entry), ...args], {
  cwd: root, env, stdio: "inherit", windowsHide: true,
});
const server = run("node_modules/next/dist/bin/next", ["start", "--hostname", "127.0.0.1", "--port", String(port)]);
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      if (server.exitCode !== null) throw new Error("O servidor de teste encerrou antes de iniciar");
    }
    await delay(250);
  }
  if (!ready) throw new Error("O servidor de teste não iniciou");
  const [code] = await once(run("scripts/test-api.mjs"), "exit");
  if (code !== 0) process.exitCode = 1;
} finally {
  if (server.pid && server.exitCode === null) {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      server.kill();
    }
  }
}
