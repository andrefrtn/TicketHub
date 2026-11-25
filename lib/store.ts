import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assistantProvider } from "./assistant";
import { demoAccounts, isFinished, ticketCode, ticketCopyLimit, ticketHref, type Article, type Attachment, type Customer, type CustomerFields, type Department, type Draft, type Event, type Organization, type Person, type Priority, type ReplyTemplate, type Role, type SlaPolicy, type Snapshot, type StaffTicketFields, type Ticket, type TicketDetail } from "./model";
import { createOperationsTables, initializeOperations, operationColumns } from "./operations-schema";

export const sessionCookie = "tickethub_session";
export const sessionSeconds = 60 * 60 * 12;
export const demo = process.env.TICKETHUB_DEMO === "1" || (process.env.TICKETHUB_DEMO !== "0" && process.env.NODE_ENV === "development");
const demoPassword = "TicketHub-demo-2026";
let connection: DatabaseSync | undefined;

function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function atomic<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function database() {
  if (connection) return connection;
  const path = resolve(process.env.TICKETHUB_DB || (demo ? ".data/demo.sqlite" : ".data/tickethub.sqlite"));
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role IN ('admin','tecnico','cliente')), password TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL,
      category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Aberto', source TEXT NOT NULL,
      requester_id INTEGER NOT NULL REFERENCES people(id), assignee_id INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, request_key TEXT, UNIQUE(requester_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), actor_id INTEGER NOT NULL REFERENCES people(id),
      kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      name TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attachments_ticket ON attachments(ticket_id);
    CREATE INDEX IF NOT EXISTS tickets_requester ON tickets(requester_id);
    CREATE INDEX IF NOT EXISTS events_ticket ON events(ticket_id, id);
  `);
  atomic(db, () => {
    createOperationsTables(db);
    addColumns(db, "people", {
      organization_id: "INTEGER REFERENCES organizations(id)", phone: "TEXT", external_id: "TEXT", equipment: "TEXT", location: "TEXT",
      ...operationColumns.people,
    });
    addColumns(db, "tickets", {
      department: "TEXT", receive_email_replies: "INTEGER NOT NULL DEFAULT 0", notify_by_email: "INTEGER NOT NULL DEFAULT 0",
      ...operationColumns.tickets,
    });
    addColumns(db, "mail_outbox", operationColumns.mailOutbox);
    initializeOperations(db);
    if (demo && !db.prepare("SELECT 1 FROM people WHERE is_demo = 1 LIMIT 1").get()) seed(db);
    const password = process.env.TICKETHUB_ADMIN_PASSWORD;
    const email = process.env.TICKETHUB_ADMIN_EMAIL?.trim().toLowerCase();
    if (!demo && email && password && password.length >= 12 && !db.prepare("SELECT 1 FROM people WHERE role = 'admin' AND is_demo = 0").get()) {
      db.prepare("INSERT INTO people(name,email,role,password) VALUES(?,?,'admin',?)").run("Administrador", email, passwordHash(password));
    }
  });
  connection = db;
  return db;
}

function addColumns(db: DatabaseSync, table: "people" | "tickets" | "mail_outbox", columns: Record<string, string>) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function seed(db: DatabaseSync) {
  const insert = db.prepare("INSERT INTO people(name,email,role,password,is_demo) VALUES(?,?,?,?,1)");
  for (const person of [...demoAccounts, { name: "Bruno Nunes", email: "bruno@tickethub.test", role: "cliente" }]) {
    insert.run(person.name, person.email, person.role, passwordHash(demoPassword));
  }
  const people = db.prepare("SELECT id,email FROM people WHERE is_demo = 1").all();
  const id = (email: string) => Number(people.find((person) => person.email === email)?.id);
  const luiza = id(demoAccounts[2].email);
  const bruno = id("bruno@tickethub.test");
  const rafael = id(demoAccounts[1].email);
  const rows = [
    { title: "VPN desconecta durante reuniões", description: "A conexão com a VPN cai após alguns minutos em chamadas de vídeo no notebook corporativo.", priority: "Alta", category: "Rede", status: "Aberto", requester: luiza, assignee: null, source: "assistente" },
    { title: "Acesso bloqueado ao portal financeiro", description: "O portal informa que minha conta está bloqueada. Preciso acessar os relatórios do dia.", priority: "Urgente", category: "Acesso", status: "Em atendimento", requester: bruno, assignee: rafael, source: "manual" },
    { title: "Impressora do segundo andar sem resposta", description: "Os documentos ficam na fila de impressão e o equipamento aparece offline.", priority: "Média", category: "Equipamentos", status: "Aberto", requester: luiza, assignee: null, source: "manual" },
    { title: "Erro ao exportar relatório mensal", description: "Ao exportar o relatório mensal, o sistema retorna uma mensagem de erro.", priority: "Média", category: "Sistemas", status: "Em atendimento", requester: bruno, assignee: rafael, source: "manual" },
    { title: "Configurar e-mail no celular", description: "Configuração da conta corporativa no celular após a troca de aparelho.", priority: "Baixa", category: "Acesso", status: "Resolvido", requester: luiza, assignee: rafael, source: "manual" },
    { title: "Substituir cabo do monitor", description: "O monitor perde sinal quando o cabo é movimentado.", priority: "Baixa", category: "Equipamentos", status: "Fechado", requester: luiza, assignee: rafael, source: "manual" },
  ];
  for (const [index, item] of rows.entries()) {
    const at = new Date(Date.now() - (index * 17 + 1) * 3_600_000).toISOString();
    const result = db.prepare(`INSERT INTO tickets(title,description,priority,category,status,source,requester_id,created_by_id,assignee_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(item.title, item.description, item.priority, item.category, item.status, item.source, item.requester, item.requester, item.assignee, at, at);
    const ticketId = Number(result.lastInsertRowid);
    addEvent(db, ticketId, item.requester, "event", item.source === "assistente" ? "Abriu o chamado pelo assistente" : "Abriu o chamado", at);
    if (item.assignee) addEvent(db, ticketId, rafael, "event", `Assumiu o chamado · ${item.status}`, at);
  }
}

export function authenticate(email: string, password: string) {
  const db = database();
  const row = db.prepare("SELECT id,password FROM people WHERE email = ? AND active=1 AND (is_demo = 0 OR ? = 1)").get(email, Number(demo));
  return verifyPassword(password, row?.password) && row ? startSession(Number(row.id)) : null;
}

function verifyPassword(password: string, hash: unknown) {
  const storedHash = typeof hash === "string" && /^[\da-f]{32}:[\da-f]{128}$/.test(hash) ? hash : `${"0".repeat(32)}:${"0".repeat(128)}`;
  const [salt, stored] = storedHash.split(":");
  const candidate = passwordHash(password, salt).split(":")[1];
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(candidate, "hex"));
}

export function demoSession(role: Role) {
  if (!demo) return null;
  const db = database();
  const email = demoAccounts.find((account) => account.role === role)?.email ?? "";
  const row = db.prepare("SELECT id FROM people WHERE email = ? AND is_demo = 1 AND active=1").get(email);
  return row ? startSession(Number(row.id)) : null;
}

function startSession(personId: number) {
  const db = database();
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
  db.prepare("INSERT INTO sessions(token,person_id,expires) VALUES(?,?,?)").run(hashToken(token), personId, now + sessionSeconds * 1000);
  return token;
}

export function currentUser(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = database().prepare(`SELECT p.id,p.name,p.email,p.role FROM sessions s JOIN people p ON p.id=s.person_id
    WHERE s.token=? AND s.expires>? AND p.active=1 AND (p.is_demo=0 OR ?=1)`).get(hashToken(token), Date.now(), Number(demo));
  return row ? { ...row } as Person : null;
}

export function endSession(token?: string) {
  if (token) database().prepare("DELETE FROM sessions WHERE token=?").run(hashToken(token));
}

const ownsTicket = "t.requester_id=viewer.id AND t.created_by_id=t.requester_id";
const customerScope = `((${ownsTicket}) OR EXISTS (SELECT 1 FROM ticket_copies c WHERE c.ticket_id=t.id AND c.email=viewer.email))`;
const ticketQuery = `SELECT t.id,t.title,t.description,t.priority,t.category,t.status,t.source,
  t.requester_id requesterId,p.name requester,t.assignee_id assigneeId,a.name assignee,
  COALESCE(d.name,t.department) department,t.receive_email_replies receiveEmailReplies,t.notify_by_email notifyByEmail,
  p.organization_id organizationId,t.resolution,t.first_reply_at firstReplyAt,t.resolved_at resolvedAt,t.sla_started_at slaStartedAt,
  t.response_due_at responseDueAt,t.resolution_due_at resolutionDueAt,t.waiting_since waitingSince,t.escalated_at escalatedAt,t.rating,
  (SELECT COUNT(*) FROM ticket_ratings r WHERE r.ticket_id=t.id) ratingCount,
  (SELECT COALESCE(SUM(r.score),0) FROM ticket_ratings r WHERE r.ticket_id=t.id) ratingTotal,
  (${ownsTicket}) viewerOwns, last_reply.id lastReplyId,last_reply.created_at lastReplyAt,replier.role lastReplyRole,
  (last_reply.id > COALESCE(reply_read.seen_reply_id,0) AND last_reply.actor_id<>viewer.id) unreadReply,
  t.created_at createdAt,t.updated_at updatedAt FROM tickets t
  CROSS JOIN (SELECT ? AS id, ? AS email) viewer
  JOIN people p ON p.id=t.requester_id LEFT JOIN people a ON a.id=t.assignee_id LEFT JOIN departments d ON d.id=t.department_id
  LEFT JOIN events last_reply ON last_reply.id=(SELECT e.id FROM events e WHERE e.ticket_id=t.id AND e.kind='comment' ORDER BY e.id DESC LIMIT 1)
  LEFT JOIN people replier ON replier.id=last_reply.actor_id
  LEFT JOIN ticket_reply_reads reply_read ON reply_read.ticket_id=t.id AND reply_read.person_id=viewer.id`;

export function snapshot(user: Person): Snapshot {
  const db = database();
  const aiProvider = assistantProvider();
  if (user.role !== "cliente") escalateOverdue(db, user.id);
  const tickets = user.role === "cliente"
    ? db.prepare(`${ticketQuery} WHERE ${customerScope} ORDER BY t.updated_at DESC,t.id DESC`).all(user.id, user.email)
    : db.prepare(`${ticketQuery} ORDER BY t.updated_at DESC,t.id DESC`).all(user.id, user.email);
  const people = user.role === "admin" ? db.prepare("SELECT id,name,email,role,active FROM people WHERE is_demo=0 OR ?=1 ORDER BY name").all(Number(demo)) : [];
  const customers = user.role === "cliente" ? [] : db.prepare(`SELECT p.id,p.name,p.email,p.phone,p.external_id externalId,p.equipment,p.location,
    p.organization_id organizationId,o.name organization,p.active FROM people p LEFT JOIN organizations o ON o.id=p.organization_id
    WHERE p.role='cliente' AND (p.is_demo=0 OR ?=1) ORDER BY p.name,p.id`).all(Number(demo));
  const organizations = user.role === "cliente" ? [] : db.prepare("SELECT id,name FROM organizations ORDER BY name,id").all();
  return {
    user, tickets: tickets.map(ticketFromRow),
    ...ticketControls(user),
    people: people.map((row) => ({ ...row, active: Boolean(row.active) }) as Person),
    customers: customers.map((row) => ({ ...row, active: Boolean(row.active) }) as Customer), organizations: organizations.map((row) => ({ ...row }) as Organization),
    policies: user.role === "cliente" ? [] : listPolicies(db),
    articles: db.prepare("SELECT * FROM articles WHERE published=1 OR ?='admin' ORDER BY title").all(user.role).map((row) => ({ ...row, published: Boolean(row.published) }) as Article),
    aiConfigured: Boolean(aiProvider), aiProvider, demo,
  };
}

export function ticketControls(user: Person) {
  if (user.role === "cliente") return { team: [], departments: [], templates: [] };
  const db = database();
  return {
    team: db.prepare("SELECT id,name,email,role FROM people WHERE role='tecnico' AND active=1 AND (is_demo=0 OR ?=1) ORDER BY name").all(Number(demo)).map((row) => ({ ...row }) as Person),
    departments: listDepartments(db),
    templates: db.prepare("SELECT * FROM reply_templates ORDER BY title").all().map((row) => ({ ...row }) as ReplyTemplate),
  };
}

function ticketFromRow(row: Record<string, unknown>): Ticket {
  return { ...row, receiveEmailReplies: Boolean(row.receiveEmailReplies), notifyByEmail: Boolean(row.notifyByEmail),
    viewerOwns: Boolean(row.viewerOwns), unreadReply: Boolean(row.unreadReply) } as Ticket;
}

function readTicket(db: DatabaseSync, id: number, user: Person) {
  const row = db.prepare(`${ticketQuery} WHERE t.id=? AND (? <> 'cliente' OR ${customerScope})`).get(user.id, user.email, id, user.role);
  return row ? ticketFromRow(row) : null;
}

export function detail(user: Person, id: number): TicketDetail | null {
  const db = database();
  const ticket = readTicket(db, id, user);
  if (!ticket) return null;
  const events = db.prepare(`SELECT e.id,e.kind,e.body,CASE WHEN e.kind='system' THEN 'Sistema' ELSE p.name END author,e.created_at createdAt FROM events e
    JOIN people p ON p.id=e.actor_id WHERE e.ticket_id=? AND (e.kind NOT IN ('note','system') OR ? <> 'cliente') ORDER BY e.id`).all(id, user.role).map((row) => ({ ...row }) as Event);
  const attachments = db.prepare("SELECT id,name,size FROM attachments WHERE ticket_id=? ORDER BY id").all(id).map((row) => ({ ...row }) as Attachment);
  const contact = user.role === "cliente" ? null : db.prepare(`SELECT p.email,p.phone,o.name organization FROM people p
    LEFT JOIN organizations o ON o.id=p.organization_id WHERE p.id=?`).get(ticket.requesterId);
  const copies = user.role !== "cliente" || ticket.viewerOwns ? copyAddresses(db, id) : [];
  return { ticket, events, attachments, contact: contact ? { ...contact } as TicketDetail["contact"] : null, copies };
}

function copyAddresses(db: DatabaseSync, id: number) {
  return db.prepare("SELECT email FROM ticket_copies WHERE ticket_id=? ORDER BY email").all(id).map((item) => String(item.email));
}

export function changeTicketCopy(user: Person, id: number, email: string, add: boolean) {
  const db = database();
  return atomic(db, () => {
    const ticket = readTicket(db, id, user);
    if (!ticket) return "missing";
    if (user.role === "cliente" && !ticket.viewerOwns) return "forbidden";
    if (!add) {
      const removed = db.prepare("DELETE FROM ticket_copies WHERE ticket_id=? AND email=?").run(id, email);
      if (Number(removed.changes)) db.prepare("DELETE FROM mail_outbox WHERE ticket_id=? AND recipient=? AND delivered_at IS NULL").run(id, email);
      return "ok";
    }
    const requester = db.prepare("SELECT p.email FROM tickets t JOIN people p ON p.id=t.requester_id WHERE t.id=? AND t.created_by_id=t.requester_id").get(id);
    if (email === requester?.email) return "requester";
    if (db.prepare("SELECT 1 FROM ticket_copies WHERE ticket_id=? AND email=?").get(id, email)) return "ok";
    if (Number(db.prepare("SELECT COUNT(*) count FROM ticket_copies WHERE ticket_id=?").get(id)?.count) >= ticketCopyLimit) return "limit";
    db.prepare("INSERT INTO ticket_copies VALUES(?,?)").run(id, email);
    queueCopyMail(db, id, email, "Você foi incluído em cópia", ticket.title);
    return "ok";
  });
}

export function markTicketRead(user: Person, id: number, replyId: number) {
  const db = database();
  return atomic(db, () => {
    if (!readTicket(db, id, user) || !db.prepare("SELECT 1 FROM events WHERE id=? AND ticket_id=? AND kind='comment'").get(replyId, id)) return false;
    db.prepare(`INSERT INTO ticket_reply_reads(ticket_id,person_id,seen_reply_id) VALUES(?,?,?)
      ON CONFLICT(ticket_id,person_id) DO UPDATE SET seen_reply_id=MAX(seen_reply_id,excluded.seen_reply_id)`).run(id, user.id, replyId);
    return true;
  });
}

export function readAttachment(user: Person, id: number, attachmentId: number) {
  const db = database();
  if (!readTicket(db, id, user)) return null;
  const row = db.prepare("SELECT name,content FROM attachments WHERE ticket_id=? AND id=?").get(id, attachmentId);
  return row as { name: string; content: Uint8Array } | undefined;
}

function addEvent(db: DatabaseSync, id: number, actor: number, kind: Event["kind"], body: string, at: string) {
  db.prepare("INSERT INTO events(ticket_id,actor_id,kind,body,created_at) VALUES(?,?,?,?,?)").run(id, actor, kind, body, at);
}

type Upload = { name: string; content: Uint8Array };
type TicketEmailOptions = Pick<StaffTicketFields, "receiveEmailReplies" | "notifyByEmail">;
type OwnTicketOptions = { email?: TicketEmailOptions; copies?: string[] };
type StaffTicketOptions = { staff: StaffTicketFields; uploads: Upload[]; copies?: string[] };

export function createTicket(user: Person, draft: Draft, source: Ticket["source"], key: string, options?: OwnTicketOptions): Ticket;
export function createTicket(user: Person, draft: Draft, source: "manual", key: string, options: StaffTicketOptions): Ticket | null;
export function createTicket(user: Person, draft: Draft, source: Ticket["source"], key: string, options: OwnTicketOptions | StaffTicketOptions = {}) {
  const db = database();
  const staff = "staff" in options ? options.staff : null;
  const uploads = "uploads" in options ? options.uploads : [];
  const email = "email" in options ? options.email : staff;
  return atomic(db, () => {
    const requesterId = staff?.requesterId ?? user.id;
    if (staff && (user.role === "cliente" || !db.prepare("SELECT id FROM people WHERE id=? AND role='cliente' AND active=1 AND (is_demo=0 OR ?=1)").get(requesterId, Number(demo)))) return null;
    const department = staff ? db.prepare("SELECT id FROM departments WHERE name=?").get(staff.department) : null;
    if (staff && !department) return null;
    const scopedKey = staff ? `staff:${user.id}:${key}` : key;
    const saved = db.prepare("SELECT id FROM tickets WHERE requester_id=? AND request_key=?").get(requesterId, scopedKey);
    if (saved) return readTicket(db, Number(saved.id), user)!;
    const at = new Date().toISOString();
    const due = deadlines(db, draft.priority, at);
    const result = db.prepare(`INSERT INTO tickets(title,description,priority,category,source,requester_id,created_by_id,created_at,updated_at,request_key,department_id,
      receive_email_replies,notify_by_email,sla_started_at,response_due_at,resolution_due_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(draft.title, draft.description, draft.priority, draft.category, source, requesterId, user.id,
      at, at, scopedKey, department ? Number(department.id) : null, Number(email?.receiveEmailReplies ?? false), Number(email?.notifyByEmail ?? false),
      at, due.response, due.resolution);
    const id = Number(result.lastInsertRowid);
    addEvent(db, id, user.id, "event", staff ? "Abriu o chamado em nome do cliente" : source === "assistente" ? "Abriu o chamado pelo assistente" : "Abriu o chamado", at);
    for (const upload of uploads) {
      db.prepare("INSERT INTO attachments(ticket_id,name,size,content) VALUES(?,?,?,?)").run(id, upload.name, upload.content.byteLength, upload.content);
    }
    const copy = db.prepare("INSERT INTO ticket_copies(ticket_id,email) VALUES(?,?)");
    for (const email of new Set(options.copies ?? [])) {
      if (staff || email !== user.email.toLowerCase()) copy.run(id, email);
    }
    queueTicketMail(db, id, "Chamado aberto", draft.title);
    return readTicket(db, id, user)!;
  });
}

export function createOrganization(name: string, actor: Person) {
  const db = database();
  return atomic(db, () => {
    const changed = Number(db.prepare("INSERT INTO organizations(name) VALUES(?) ON CONFLICT(name) DO NOTHING").run(name).changes) === 1;
    if (changed) recordAudit(db, actor.id, `Cadastrou a organização ${name}`);
    return changed;
  });
}

export function createCustomer(account: Pick<Person, "name" | "email">, password: string, fields: CustomerFields, actor: Person) {
  const db = database();
  const hash = passwordHash(password);
  return atomic(db, () => {
    const organization = fields.organizationId === null ? null : db.prepare("SELECT name FROM organizations WHERE id=?").get(fields.organizationId);
    if (fields.organizationId !== null && !organization) return "organization";
    const result = db.prepare(`INSERT INTO people(name,email,role,password,organization_id,phone,external_id,equipment,location)
      VALUES(?,?,'cliente',?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING`)
      .run(account.name, account.email, hash, fields.organizationId, fields.phone, fields.externalId, fields.equipment, fields.location);
    if (!Number(result.changes)) return "duplicate";
    recordAudit(db, actor.id, `Cadastrou o cliente ${account.name}`);
    return { ...account, ...fields, id: Number(result.lastInsertRowid), organization: organization ? String(organization.name) : null, active: true };
  });
}

export function existingTicket(user: Person, key: string) {
  const db = database();
  const saved = db.prepare("SELECT id FROM tickets WHERE requester_id=? AND request_key=?").get(user.id, key);
  return saved ? readTicket(db, Number(saved.id), user) : null;
}

export function comment(user: Person, id: number, body: string, internal = false) {
  const db = database();
  return atomic(db, () => {
    if (internal && user.role === "cliente") return false;
    const ticket = readTicket(db, id, user);
    if (!ticket || (user.role === "cliente" && !ticket.viewerOwns)) return false;
    const at = new Date().toISOString();
    if (internal) {
      addEvent(db, id, user.id, "note", body, at);
    } else {
      addEvent(db, id, user.id, "comment", body, at);
      if (user.role === "cliente") {
        updateAfterCustomerReply(db, ticket, user.id, at);
        for (const email of copyAddresses(db, id)) queueCopyMail(db, id, email, "Nova resposta do cliente", body);
      }
      else {
        db.prepare("UPDATE tickets SET updated_at=?,first_reply_at=COALESCE(first_reply_at,?) WHERE id=?").run(at, at, id);
        queueTicketMail(db, id, "Nova resposta", body);
      }
    }
    return true;
  });
}

function updateAfterCustomerReply(db: DatabaseSync, ticket: Ticket, actor: number, at: string) {
  if (ticket.status !== "Aguardando cliente") {
    db.prepare("UPDATE tickets SET updated_at=? WHERE id=?").run(at, ticket.id);
    return;
  }
  const due = extendDeadline(ticket, at);
  db.prepare("UPDATE tickets SET status='Em atendimento',updated_at=?,waiting_since=NULL,resolution_due_at=? WHERE id=?").run(at, due, ticket.id);
  addEvent(db, ticket.id, actor, "event", "Retomou o atendimento após a resposta do cliente", at);
}

function extendDeadline(ticket: Ticket, at: string) {
  return ticket.resolutionDueAt && ticket.waitingSince
    ? new Date(Date.parse(ticket.resolutionDueAt) + Math.max(0, Date.parse(at) - Date.parse(ticket.waitingSince))).toISOString()
    : ticket.resolutionDueAt;
}

type TicketChanges = Pick<Ticket, "priority" | "status" | "assigneeId"> & { resolution?: string; department?: string | null };

export function updateTicket(user: Person, id: number, patch: TicketChanges | { finalize: true; resolution?: string }) {
  const db = database();
  return atomic(db, () => {
    const current = readTicket(db, id, user);
    if (!current) return "missing";
    const finalizing = "finalize" in patch;
    const changes: TicketChanges = finalizing ? {
      status: "Fechado", priority: current.priority, assigneeId: current.assigneeId ?? (user.role === "tecnico" ? user.id : null),
      resolution: patch.resolution,
    } : patch;
    if (user.role === "cliente" || (user.role === "tecnico" && (
      (current.assigneeId !== null && current.assigneeId !== user.id) ||
      (changes.assigneeId !== null && changes.assigneeId !== user.id) ||
      (current.assigneeId === null && changes.assigneeId !== user.id)
    ))) return "forbidden";
    if (finalizing && isFinished(current.status)) return current.status === "Fechado" ? "ok" : "finished";
    const assignee = changes.assigneeId === null ? null : db.prepare("SELECT name,active FROM people WHERE id=? AND role='tecnico' AND (is_demo=0 OR ?=1)").get(changes.assigneeId, Number(demo));
    if (changes.assigneeId !== null && (!assignee || (!assignee.active && changes.assigneeId !== current.assigneeId))) return "invalid";
    const changingDepartment = changes.department !== undefined && changes.department !== current.department;
    if (changingDepartment && user.role !== "admin") return "forbidden";
    const department = changingDepartment && changes.department ? db.prepare("SELECT id FROM departments WHERE name=?").get(changes.department) : null;
    if (changingDepartment && changes.department && !department) return "department";
    const finished = isFinished(changes.status);
    const wasFinished = isFinished(current.status);
    if (wasFinished && !finished) return "reopen";
    if (finished && !wasFinished && !changes.resolution) return "solution";
    const newSolution = finished && !current.resolution ? changes.resolution : undefined;

    const log = [];
    if (current.status !== changes.status) log.push(`Status: ${current.status} → ${changes.status}`);
    if (current.priority !== changes.priority) log.push(`Prioridade: ${current.priority} → ${changes.priority}`);
    if (current.assigneeId !== changes.assigneeId) log.push(assignee ? `Responsável: ${assignee.name}` : "Removeu o responsável");
    if (changingDepartment) log.push(`Departamento: ${changes.department || "Sem departamento"}`);
    if (!log.length) return "ok";
    const at = new Date().toISOString();
    const waiting = changes.status === "Aguardando cliente" ? current.waitingSince ?? at : null;
    const resolutionDue = waiting ? current.resolutionDueAt : extendDeadline(current, at);
    db.prepare(`UPDATE tickets SET status=?,priority=?,assignee_id=?,updated_at=?,waiting_since=?,resolution_due_at=?,
      resolution=?,resolved_at=?,first_reply_at=? WHERE id=?`).run(changes.status, changes.priority, changes.assigneeId, at, waiting, resolutionDue,
      newSolution ?? current.resolution,
      finished && !wasFinished ? at : current.resolvedAt,
      finished && !wasFinished ? current.firstReplyAt ?? at : current.firstReplyAt, id);
    if (changingDepartment) db.prepare("UPDATE tickets SET department_id=?,department=NULL WHERE id=?").run(department ? Number(department.id) : null, id);
    addEvent(db, id, user.id, "event", log.join(" · "), at);
    if (newSolution) {
      addEvent(db, id, user.id, "comment", `Solução: ${newSolution}`, at);
      queueTicketMail(db, id, changes.status === "Fechado" ? "Chamado finalizado" : "Chamado resolvido", newSolution);
    } else if (current.status !== changes.status) queueTicketMail(db, id, "Status atualizado", `O chamado está com status: ${changes.status}.`);
    return "ok";
  });
}

export function reopenTicket(user: Person, id: number, reason: string) {
  const db = database();
  return atomic(db, () => {
    const ticket = readTicket(db, id, user);
    if (!ticket) return "missing";
    if (user.role === "cliente" && !ticket.viewerOwns) return "forbidden";
    if (user.role === "tecnico" && ticket.assigneeId !== user.id) return "forbidden";
    if (!isFinished(ticket.status)) return "state";
    const at = new Date().toISOString();
    const due = deadlines(db, ticket.priority, at);
    const nextStatus = ticket.assigneeId ? "Em atendimento" : "Aberto";
    db.prepare(`UPDATE tickets SET status=?,updated_at=?,resolution=NULL,resolved_at=NULL,first_reply_at=NULL,sla_started_at=?,
      response_due_at=?,resolution_due_at=?,waiting_since=NULL,escalated_at=NULL,rating=NULL,rating_comment=NULL WHERE id=?`)
      .run(nextStatus, at, at, due.response, due.resolution, id);
    addEvent(db, id, user.id, "event", `Reabriu o chamado: ${reason}`, at);
    queueTicketMail(db, id, "Chamado reaberto", reason);
    return "ok";
  });
}

export function rateTicket(user: Person, id: number, score: number, feedback: string | null) {
  if (user.role !== "cliente") return false;
  const db = database();
  return atomic(db, () => {
    const updated = db.prepare(`UPDATE tickets SET rating=?,rating_comment=? WHERE id=? AND requester_id=? AND created_by_id=requester_id
      AND status IN ('Resolvido','Fechado') AND rating IS NULL`).run(score, feedback, id, user.id);
    if (!Number(updated.changes)) return false;
    db.prepare("INSERT INTO ticket_ratings(ticket_id,score,feedback,created_at) VALUES(?,?,?,?)").run(id, score, feedback, new Date().toISOString());
    return true;
  });
}

export function confirmResolution(user: Person, id: number) {
  if (user.role !== "cliente") return false;
  const db = database();
  return atomic(db, () => {
    const at = new Date().toISOString();
    const result = db.prepare(`UPDATE tickets SET status='Fechado',updated_at=? WHERE id=? AND requester_id=?
      AND created_by_id=requester_id AND status='Resolvido'`).run(at, id, user.id);
    if (!Number(result.changes)) return false;
    addEvent(db, id, user.id, "event", "Confirmou a solução e fechou o chamado", at);
    return true;
  });
}

function listDepartments(db: DatabaseSync): Department[] {
  const members = db.prepare(`SELECT m.department_id departmentId,m.person_id personId FROM department_members m
    JOIN people p ON p.id=m.person_id WHERE p.active=1`).all();
  return db.prepare("SELECT id,name FROM departments ORDER BY name").all().map((row) => ({
    id: Number(row.id), name: String(row.name), members: members.filter((item) => item.departmentId === row.id).map((item) => Number(item.personId)),
  }));
}

function listPolicies(db: DatabaseSync) {
  return db.prepare("SELECT priority,response_minutes responseMinutes,resolution_minutes resolutionMinutes FROM sla_policies").all().map((row) => ({ ...row }) as SlaPolicy);
}

function deadlines(db: DatabaseSync, priority: Priority, started: string) {
  const policy = db.prepare("SELECT response_minutes response,resolution_minutes resolution FROM sla_policies WHERE priority=?").get(priority)!;
  const start = Date.parse(started);
  return { response: new Date(start + Number(policy.response) * 60_000).toISOString(), resolution: new Date(start + Number(policy.resolution) * 60_000).toISOString() };
}

function escalateOverdue(db: DatabaseSync, actor: number) {
  const at = new Date().toISOString();
  const overdue = () => db.prepare(`SELECT id FROM tickets WHERE escalated_at IS NULL AND status NOT IN ('Resolvido','Fechado')
    AND ((first_reply_at IS NULL AND response_due_at < ?) OR resolution_due_at < COALESCE(waiting_since,?))`).all(at, at);
  if (!overdue().length) return;
  atomic(db, () => {
    for (const row of overdue()) {
      const id = Number(row.id);
      db.prepare("UPDATE tickets SET escalated_at=? WHERE id=?").run(at, id);
      addEvent(db, id, actor, "system", "Prazo de SLA vencido. Chamado escalonado para a fila de atrasados.", at);
    }
  });
}

function queueTicketMail(db: DatabaseSync, id: number, subject: string, body: string) {
  const row = db.prepare(`SELECT p.email,t.receive_email_replies allowReply FROM tickets t JOIN people p ON p.id=t.requester_id
    WHERE t.id=? AND t.created_by_id=t.requester_id AND t.notify_by_email=1 AND p.active=1`).get(id);
  if (row) putMail(db, String(row.email), `[${ticketCode(id)}] ${subject}`, body, row.allowReply ? id : null, null, id);
  for (const email of copyAddresses(db, id)) queueCopyMail(db, id, email, subject, body);
}

function queueCopyMail(db: DatabaseSync, id: number, email: string, subject: string, body: string) {
  let footer = "";
  try {
    const base = new URL(process.env.TICKETHUB_BASE_URL ?? "");
    if (base.protocol === "https:" || (demo && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
      const link = new URL(ticketHref(id), base.origin);
      footer = `\n\nAcompanhe com sua conta do TicketHub: ${link.href}`;
    }
  } catch { /* A ponte também pode entregar mensagens sem link configurado. */ }
  putMail(db, email, `[${ticketCode(id)}] ${subject}`, body + footer, null, null, id);
}

function putMail(db: DatabaseSync, email: string, subject: string, body: string, replyId: number | null, expiresAt: number | null = null, ticketId: number | null = null) {
  db.prepare("INSERT INTO mail_outbox(recipient,subject,body,reply_ticket,available_at,expires_at,ticket_id) VALUES(?,?,?,?,?,?,?)")
    .run(email, subject, body, replyId, Date.now(), expiresAt, ticketId);
}

export function createPerson(person: Omit<Person, "id">, password: string, actor: Person) {
  const db = database();
  const hash = passwordHash(password);
  return atomic(db, () => {
    const result = db.prepare("INSERT INTO people(name,email,role,password) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING")
      .run(person.name, person.email, person.role, hash);
    if (!Number(result.changes)) return false;
    recordAudit(db, actor.id, `Cadastrou a conta de ${person.name}`);
    return true;
  });
}

function recordAudit(db: DatabaseSync, actor: number, action: string) {
  db.prepare("INSERT INTO admin_audit(actor_id,action,created_at) VALUES(?,?,?)").run(actor, action, new Date().toISOString());
}

export function auditLog() {
  return database().prepare(`SELECT l.id,l.action,l.created_at createdAt,p.name actor FROM admin_audit l
    JOIN people p ON p.id=l.actor_id ORDER BY l.id DESC LIMIT 100`).all();
}

export function saveDepartment(actor: Person, id: number | null, name: string, members: number[]) {
  const db = database();
  return atomic(db, () => {
    const tech = db.prepare("SELECT 1 FROM people WHERE id=? AND role='tecnico' AND active=1 AND (is_demo=0 OR ?=1)");
    if (members.some((member) => !tech.get(member, Number(demo)))) return "members";
    if (db.prepare("SELECT id FROM departments WHERE name=? AND id<>?").get(name, id ?? 0)) return "duplicate";
    if (id && !db.prepare("SELECT 1 FROM departments WHERE id=?").get(id)) return "missing";
    const departmentId = id ?? Number(db.prepare("INSERT INTO departments(name) VALUES(?)").run(name).lastInsertRowid);
    if (id) db.prepare("UPDATE departments SET name=? WHERE id=?").run(name, id);
    db.prepare("DELETE FROM department_members WHERE department_id=?").run(departmentId);
    const insert = db.prepare("INSERT INTO department_members VALUES(?,?)");
    for (const member of members) insert.run(departmentId, member);
    recordAudit(db, actor.id, `Salvou o departamento ${name}`);
    return "ok";
  });
}

export function editOrganization(actor: Person, id: number, name: string) {
  const db = database();
  return atomic(db, () => {
    if (db.prepare("SELECT 1 FROM organizations WHERE name=? AND id<>?").get(name, id)) return "duplicate";
    if (!Number(db.prepare("UPDATE organizations SET name=? WHERE id=?").run(name, id).changes)) return "missing";
    recordAudit(db, actor.id, `Atualizou a organização ${name}`);
    return "ok";
  });
}

export function editCustomer(actor: Person, id: number, account: Pick<Person, "name" | "email">, fields: CustomerFields) {
  const db = database();
  return atomic(db, () => {
    const current = db.prepare("SELECT email FROM people WHERE id=? AND role='cliente' AND (is_demo=0 OR ?=1)").get(id, Number(demo));
    if (!current) return "missing";
    if (account.email !== current.email && actor.role !== "admin") return "email";
    if (fields.organizationId !== null && !db.prepare("SELECT 1 FROM organizations WHERE id=?").get(fields.organizationId)) return "organization";
    if (db.prepare("SELECT 1 FROM people WHERE email=? AND id<>?").get(account.email, id)) return "duplicate";
    const result = db.prepare(`UPDATE people SET name=?,email=?,organization_id=?,phone=?,external_id=?,equipment=?,location=?
      WHERE id=? AND role='cliente' AND (is_demo=0 OR ?=1)`).run(account.name, account.email, fields.organizationId,
      fields.phone, fields.externalId, fields.equipment, fields.location, id, Number(demo));
    if (!Number(result.changes)) return "missing";
    if (account.email !== current.email) {
      db.prepare("DELETE FROM password_resets WHERE person_id=?").run(id);
      db.prepare("DELETE FROM sessions WHERE person_id=?").run(id);
    }
    recordAudit(db, actor.id, `Atualizou o cliente ${account.name}`);
    return "ok";
  });
}

export function setAccountActive(actor: Person, id: number, active: boolean) {
  if (id === actor.id) return false;
  const db = database();
  return atomic(db, () => {
    const person = db.prepare("SELECT name FROM people WHERE id=? AND (is_demo=0 OR ?=1)").get(id, Number(demo));
    if (!person) return false;
    db.prepare("UPDATE people SET active=? WHERE id=?").run(Number(active), id);
    if (!active) {
      db.prepare("DELETE FROM sessions WHERE person_id=?").run(id);
      db.prepare("DELETE FROM password_resets WHERE person_id=?").run(id);
      const at = new Date().toISOString();
      const assigned = db.prepare("SELECT id FROM tickets WHERE assignee_id=? AND status NOT IN ('Resolvido','Fechado')").all(id);
      db.prepare("UPDATE tickets SET assignee_id=NULL,updated_at=? WHERE assignee_id=? AND status NOT IN ('Resolvido','Fechado')").run(at, id);
      for (const row of assigned) addEvent(db, Number(row.id), actor.id, "system", "Responsável removido após a desativação da conta.", at);
    }
    recordAudit(db, actor.id, `${active ? "Reativou" : "Desativou"} a conta de ${person.name}`);
    return true;
  });
}

export function savePolicy(actor: Person, policy: SlaPolicy) {
  const db = database();
  atomic(db, () => {
    db.prepare("UPDATE sla_policies SET response_minutes=?,resolution_minutes=? WHERE priority=?")
      .run(policy.responseMinutes, policy.resolutionMinutes, policy.priority);
    recordAudit(db, actor.id, `Atualizou os prazos de SLA para prioridade ${policy.priority}`);
  });
}

export function saveContent(actor: Person, kind: "article" | "template", id: number | null, title: string, body: string, published: boolean) {
  const db = database();
  return atomic(db, () => {
    const table = kind === "article" ? "articles" : "reply_templates";
    const result = kind === "article"
      ? id ? db.prepare("UPDATE articles SET title=?,body=?,published=? WHERE id=?").run(title, body, Number(published), id)
        : db.prepare("INSERT INTO articles(title,body,published) VALUES(?,?,?)").run(title, body, Number(published))
      : id ? db.prepare("UPDATE reply_templates SET title=?,body=? WHERE id=?").run(title, body, id)
        : db.prepare("INSERT INTO reply_templates(title,body) VALUES(?,?)").run(title, body);
    if (!Number(result.changes)) return false;
    recordAudit(db, actor.id, `Salvou ${table === "articles" ? "o artigo" : "a resposta pronta"} ${title}`);
    return true;
  });
}

export function changePassword(user: Person, current: string, next: string, session: string) {
  const db = database();
  return atomic(db, () => {
    const account = db.prepare("SELECT password FROM people WHERE id=? AND active=1").get(user.id);
    if (!account || !verifyPassword(current, account.password)) return false;
    db.prepare("UPDATE people SET password=? WHERE id=?").run(passwordHash(next), user.id);
    db.prepare("DELETE FROM sessions WHERE person_id=? AND token<>?").run(user.id, hashToken(session));
    db.prepare("DELETE FROM password_resets WHERE person_id=?").run(user.id);
    return true;
  });
}

export function requestPasswordReset(email: string, appOrigin: string) {
  const db = database();
  atomic(db, () => {
    const account = db.prepare("SELECT id,email FROM people WHERE email=? AND active=1 AND is_demo=0").get(email);
    if (!account) return;
    const id = Number(account.id);
    const token = randomBytes(32).toString("hex");
    const expires = Date.now() + 30 * 60_000;
    db.prepare("DELETE FROM password_resets WHERE person_id=? OR expires_at<=?").run(id, Date.now());
    db.prepare("INSERT INTO password_resets VALUES(?,?,?)").run(hashToken(token), id, expires);
    const reset = new URL("/", appOrigin);
    reset.searchParams.set("redefinir", token);
    putMail(db, String(account.email), "Redefina sua senha do TicketHub", `Use este endereço em até 30 minutos:\n${reset.href}`, null, expires);
  });
}

export function resetPassword(token: string, password: string) {
  const db = database();
  return atomic(db, () => {
    const row = db.prepare(`SELECT r.person_id id FROM password_resets r JOIN people p ON p.id=r.person_id
      WHERE r.token=? AND r.expires_at>? AND p.active=1`).get(hashToken(token), Date.now());
    if (!row) return false;
    const id = Number(row.id);
    db.prepare("UPDATE people SET password=? WHERE id=?").run(passwordHash(password), id);
    db.prepare("DELETE FROM sessions WHERE person_id=?").run(id);
    db.prepare("DELETE FROM password_resets WHERE person_id=?").run(id);
    return true;
  });
}

export function leaseMail() {
  const db = database();
  return atomic(db, () => {
    const now = Date.now();
    db.prepare("DELETE FROM mail_outbox WHERE expires_at IS NOT NULL AND expires_at<=?").run(now);
    const row = db.prepare(`SELECT o.id,o.recipient,o.subject,o.body,o.reply_ticket replyTicket FROM mail_outbox o WHERE o.delivered_at IS NULL
      AND ((o.ticket_id IS NULL AND substr(o.subject,1,4)<>'[TH-'
          AND EXISTS(SELECT 1 FROM people p WHERE p.email=o.recipient AND p.active=1))
        OR EXISTS(SELECT 1 FROM tickets t JOIN people p ON p.id=t.requester_id
          WHERE t.id=o.ticket_id AND t.created_by_id=t.requester_id AND p.email=o.recipient AND p.active=1)
        OR EXISTS(SELECT 1 FROM ticket_copies c WHERE c.ticket_id=o.ticket_id AND c.email=o.recipient))
      AND o.available_at<=? AND (o.expires_at IS NULL OR o.expires_at>?) AND (o.lease_until IS NULL OR o.lease_until<=?) ORDER BY o.id LIMIT 1`).get(now, now, now);
    if (!row) return null;
    const deliveryKey = randomBytes(24).toString("hex");
    db.prepare("UPDATE mail_outbox SET lease_until=?,delivery_key=? WHERE id=?").run(now + 120_000, deliveryKey, Number(row.id));
    return { ...row, deliveryKey };
  });
}

export function completeMail(id: number, key: string, sent: boolean) {
  const now = Date.now();
  return Number(database().prepare(`UPDATE mail_outbox SET delivered_at=?,available_at=?,lease_until=NULL,delivery_key=NULL,
    body=CASE WHEN expires_at IS NOT NULL AND ?=1 THEN '' ELSE body END
    WHERE id=? AND delivery_key=? AND lease_until>? AND delivered_at IS NULL`).run(sent ? now : null, now + 60_000, Number(sent), id, key, now).changes) === 1;
}

export function receiveMail(ticketId: number, sender: string, messageId: string, body: string) {
  const db = database();
  return atomic(db, () => {
    const row = db.prepare(`SELECT p.id FROM tickets t JOIN people p ON p.id=t.requester_id
      WHERE t.id=? AND p.email=? AND t.created_by_id=t.requester_id AND t.receive_email_replies=1 AND p.active=1`).get(ticketId, sender);
    if (!row) return false;
    if (!Number(db.prepare("INSERT OR IGNORE INTO mail_received VALUES(?)").run(messageId).changes)) return true;
    const at = new Date().toISOString();
    addEvent(db, ticketId, Number(row.id), "comment", body, at);
    const ticket = readTicket(db, ticketId, { id: Number(row.id), role: "cliente", name: "", email: sender })!;
    updateAfterCustomerReply(db, ticket, Number(row.id), at);
    for (const email of copyAddresses(db, ticketId)) queueCopyMail(db, ticketId, email, "Nova resposta do cliente", body);
    return true;
  });
}
