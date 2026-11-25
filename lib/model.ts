export const roles = ["admin", "tecnico", "cliente"] as const;
export const statuses = ["Aberto", "Em atendimento", "Aguardando cliente", "Resolvido", "Fechado"] as const;
export const priorities = ["Baixa", "Média", "Alta", "Urgente"] as const;
export const categories = ["Acesso", "Equipamentos", "Sistemas", "Rede", "Outros"] as const;
export const departments = ["Suporte técnico", "Infraestrutura", "Sistemas", "Administrativo"] as const;
export const attachmentLimits = { count: 3, bytes: 5 * 1024 * 1024 };
export const ticketCopyLimit = 10;

export type Role = (typeof roles)[number];
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Category = (typeof categories)[number];
export type Department = { id: number; name: string; members: number[] };
export const roleNames: Record<Role, string> = { admin: "Administrador", tecnico: "Técnico", cliente: "Cliente" };

export type Person = { id: number; name: string; email: string; role: Role; active?: boolean };
export type Organization = { id: number; name: string };
export type CustomerFields = { phone: string | null; organizationId: number | null; externalId: string | null; equipment: string | null; location: string | null };
export type Customer = Pick<Person, "id" | "name" | "email"> & CustomerFields & { organization: string | null; active: boolean };
export type StaffTicketFields = { requesterId: number; department: string; receiveEmailReplies: boolean; notifyByEmail: boolean };
export type Attachment = { id: number; name: string; size: number };
export type Draft = { title: string; description: string; priority: Priority; category: Category };
export type Ticket = Draft & {
  id: number;
  status: Status;
  source: "manual" | "assistente";
  requesterId: number;
  requester: string;
  department: string | null;
  receiveEmailReplies: boolean;
  notifyByEmail: boolean;
  assigneeId: number | null;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  organizationId: number | null;
  resolution: string | null;
  firstReplyAt: string | null;
  resolvedAt: string | null;
  slaStartedAt: string | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  waitingSince: string | null;
  escalatedAt: string | null;
  rating: number | null;
  ratingCount: number;
  ratingTotal: number;
  viewerOwns: boolean;
  lastReplyId: number | null;
  lastReplyAt: string | null;
  lastReplyRole: Role | null;
  unreadReply: boolean;
};
export type Event = { id: number; kind: "event" | "comment" | "note" | "system"; body: string; author: string; createdAt: string };
export type TicketDetail = {
  ticket: Ticket; events: Event[]; attachments: Attachment[];
  contact: { email: string; phone: string | null; organization: string | null } | null;
  copies: string[];
};
export type Article = { id: number; title: string; body: string; published: boolean };
export type ReplyTemplate = { id: number; title: string; body: string };
export type SlaPolicy = { priority: Priority; responseMinutes: number; resolutionMinutes: number };
export type Snapshot = {
  user: Person; tickets: Ticket[]; team: Person[]; people: Person[]; customers: Customer[]; organizations: Organization[];
  departments: Department[]; articles: Article[]; templates: ReplyTemplate[]; policies: SlaPolicy[]; aiConfigured: boolean; demo: boolean;
};

export function isFinished(status: Status) {
  return status === "Resolvido" || status === "Fechado";
}

export function isOverdue(ticket: Ticket, now = Date.now()) {
  if (isFinished(ticket.status)) return false;
  return Boolean(
    (!ticket.firstReplyAt && ticket.responseDueAt && Date.parse(ticket.responseDueAt) < now) ||
    (ticket.resolutionDueAt && Date.parse(ticket.resolutionDueAt) < (ticket.waitingSince ? Date.parse(ticket.waitingSince) : now)),
  );
}

export const demoAccounts = [
  { name: "Marina Costa", email: "marina@tickethub.test", role: "admin" },
  { name: "Rafael Lima", email: "rafael@tickethub.test", role: "tecnico" },
  { name: "Luiza Martins", email: "luiza@tickethub.test", role: "cliente" },
] as const;

export function ticketCode(id: number) {
  return `TH-${String(id).padStart(4, "0")}`;
}

export function ticketHref(id: number) {
  return `/chamados/${id}`;
}
