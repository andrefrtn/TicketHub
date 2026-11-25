import type { DatabaseSync } from "node:sqlite";
import { departments, priorities, type Priority } from "./model";

export const operationColumns = {
  people: { active: "INTEGER NOT NULL DEFAULT 1" },
  tickets: {
    created_by_id: "INTEGER REFERENCES people(id)",
    department_id: "INTEGER REFERENCES departments(id)", resolution: "TEXT", first_reply_at: "TEXT",
    resolved_at: "TEXT", sla_started_at: "TEXT", response_due_at: "TEXT", resolution_due_at: "TEXT",
    waiting_since: "TEXT", escalated_at: "TEXT", rating: "INTEGER", rating_comment: "TEXT",
  },
  mailOutbox: { ticket_id: "INTEGER REFERENCES tickets(id)" },
};

export function createOperationsTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE IF NOT EXISTS department_members (
      department_id INTEGER NOT NULL REFERENCES departments(id), person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY(department_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS sla_policies (
      priority TEXT PRIMARY KEY, response_minutes INTEGER NOT NULL, resolution_minutes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ticket_ratings (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), feedback TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_ratings_ticket ON ticket_ratings(ticket_id);
    CREATE TABLE IF NOT EXISTS ticket_copies (
      ticket_id INTEGER NOT NULL REFERENCES tickets(id), email TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY(ticket_id,email)
    );
    CREATE INDEX IF NOT EXISTS ticket_copies_email ON ticket_copies(email,ticket_id);
    CREATE TABLE IF NOT EXISTS ticket_reply_reads (
      ticket_id INTEGER NOT NULL REFERENCES tickets(id), person_id INTEGER NOT NULL REFERENCES people(id),
      seen_reply_id INTEGER NOT NULL REFERENCES events(id), PRIMARY KEY(ticket_id,person_id)
    );
    CREATE INDEX IF NOT EXISTS events_last_reply ON events(ticket_id,kind,id);
    CREATE TABLE IF NOT EXISTS reply_templates (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES people(id), action TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id INTEGER PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      reply_ticket INTEGER, available_at INTEGER NOT NULL, lease_until INTEGER, delivery_key TEXT, delivered_at INTEGER, expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS mail_received (message_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), expires_at INTEGER NOT NULL
    );
  `);
}

export function initializeOperations(db: DatabaseSync) {
  if (!db.prepare("SELECT 1 FROM departments LIMIT 1").get()) {
    const insert = db.prepare("INSERT INTO departments(name) VALUES(?)");
    for (const name of departments) insert.run(name);
  }
  db.exec(`UPDATE tickets SET department_id=(SELECT d.id FROM departments d WHERE d.name=tickets.department)
    WHERE department_id IS NULL AND department IS NOT NULL`);
  db.exec(`
    UPDATE tickets AS t SET created_by_id=(
      SELECT e.actor_id FROM events e WHERE e.ticket_id=t.id ORDER BY e.id LIMIT 1
    )
    WHERE t.created_by_id IS NULL AND (
      SELECT e.kind='event' AND e.body IN ('Abriu o chamado','Abriu o chamado pelo assistente','Abriu o chamado em nome do cliente')
        AND (e.body <> 'Abriu o chamado em nome do cliente' OR e.actor_id <> t.requester_id)
      FROM events e WHERE e.ticket_id=t.id ORDER BY e.id LIMIT 1
    );
    UPDATE mail_outbox AS o SET ticket_id=COALESCE(o.reply_ticket,(
      SELECT t.id FROM tickets t WHERE t.id=CAST(substr(o.subject,5,instr(o.subject,']')-5) AS INTEGER)
    ))
    WHERE o.ticket_id IS NULL AND substr(o.subject,1,4)='[TH-' AND instr(o.subject,']') > 5;
  `);
  const defaults: Record<Priority, [number, number]> = { Urgente: [30, 240], Alta: [120, 480], Média: [240, 1440], Baixa: [480, 2880] };
  const put = db.prepare("INSERT OR IGNORE INTO sla_policies VALUES(?,?,?)");
  for (const priority of priorities) put.run(priority, ...defaults[priority]);
}
