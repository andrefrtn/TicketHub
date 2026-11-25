"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { roleNames, type Person, type Ticket } from "@/lib/model";

const icons = {
  logo: "M4 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1z M13 5v2m0 3v4m0 3v2",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  inbox: "M4 4h16l2 11v5H2v-5z M2 15h6l2 2h4l2-2h6",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.6-4.2a8.5 8.5 0 1 1 15.4-4.3z M8 11h8m-8 4h4",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m19 0v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm4-4a4 4 0 0 1 0 8",
  plus: "M12 4v16M4 12h16",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  chevron: "m9 18 6-6-6-6",
  down: "m6 9 6 6 6-6",
  menu: "M4 6h16M4 12h16M4 18h16",
  bot: "M12 8V4H9m-6 9h2m14 0h2M9 13h.01m5.99 0h.01M7 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
  gear: "M9 3h6l.8 2.6 2 .9 2.5-.8 2 3.5-1.9 1.8v2.2l1.9 1.8-2 3.5-2.5-.8-2 .9L15 21H9l-.8-2.6-2-.9-2.5.8-2-3.5 1.9-1.8v-2.2L1.7 9l2-3.5 2.5.8 2-.9z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z",
  alert: "m10.3 4.9-8 13.7A1.5 1.5 0 0 0 3.6 21h16.8a1.5 1.5 0 0 0 1.3-2.4l-8-13.7a2 2 0 0 0-3.4 0zM12 10v4m0 3h.01",
  clip: "m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5L9.5 17.5a2 2 0 0 1-3-3L15 6",
  building: "M3 21h18M6 21V5h12v16M9 8h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm6-2 4 4",
  filter: "M4 7h16M7 12h10m-7 5h4",
  close: "m6 6 12 12M18 6 6 18",
  logout: "M10 17l5-5-5-5m5 5H3m11-8h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5",
  check: "m5 12 4 4L19 6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-15v5l3 2",
  send: "M12 20V4m-6 6 6-6 6 6",
  user: "M5 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m-3-12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  shield: "M12 22s7-3 7-10V5l-7-3-7 3v7c0 7 7 10 7 10z M9 12l2 2 4-4",
  tool: "m14 7 3 3 4-4a6 6 0 0 1-7.7 7.7l-7 7a2 2 0 0 1-2.8-2.8l7-7A6 6 0 0 1 18 3z",
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>;
}

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="logo" /></span><span>TicketHub</span></div>;
}

export function Avatar({ person }: { person: Pick<Person, "name"> }) {
  return <span className="avatar" aria-hidden="true">{person.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>;
}

export function Tag({ value }: { value: string }) {
  const label = value === "Urgente" ? "Crítica" : value;
  return <span className="tag" data-value={label}><i />{label}</span>;
}

export const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
}).format(new Date(date)).replace(".", "");

export function ReplyBadge({ ticket, showUnread = true, compact = false }: { ticket: Ticket; showUnread?: boolean; compact?: boolean }) {
  if (!ticket.lastReplyAt || !ticket.lastReplyRole) return null;
  const unread = showUnread && ticket.unreadReply;
  return <span className={unread ? "reply-badge unread" : "reply-badge"} title={formatDate(ticket.lastReplyAt)}>
    <Icon name="chat" />{unread ? "Nova resposta" : "Respondido"}{!compact && ` · ${roleNames[ticket.lastReplyRole]}`}
  </span>;
}

export function CopiesField() {
  return <label>Em cópia <input name="copies" inputMode="email" maxLength={2800} placeholder="pessoa@empresa.com" />
    <small className="muted">Separe os e-mails por vírgula. Essas pessoas poderão acompanhar o chamado.</small>
  </label>;
}

export class HelpdeskError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(body?: Record<string, unknown> | FormData, id?: number, query?: string): Promise<T> {
  const result = await fetch(id ? `/api/helpdesk?id=${id}` : query ? `/api/helpdesk?${query}` : "/api/helpdesk", body ? {
    method: "POST", ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  } : { cache: "no-store" });
  const data = await result.json();
  if (!result.ok) throw new HelpdeskError(data.error || "Não foi possível concluir a operação", result.status);
  return data;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado";
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-focus]")?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={element} className={wide ? "modal wide" : "modal"} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-frame">
      <header className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </div>
  </dialog>;
}
