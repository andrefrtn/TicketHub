"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { isFinished, isOverdue, priorities, statuses, ticketCode, type Department, type Person, type ReplyTemplate, type Status, type Ticket, type TicketDetail } from "@/lib/model";
import { api, Avatar, Brand, errorText, formatDate, HelpdeskError, Icon, ReplyBadge, Tag } from "./ui-kit";

type Controls = { user: Person; team: Person[]; departments: Department[]; templates: ReplyTemplate[] };

export function TicketPage({ initial, ...controls }: Controls & { initial: TicketDetail }) {
  return <div className="shell">
    <header className="topbar ticket-route-header">
      <Link className="ticket-home" href="/?view=chamados"><Brand /></Link>
      <Link className="row-action" href="/?view=chamados">Chamados</Link>
      <span className="person-name ticket-route-user"><Avatar person={controls.user} />{controls.user.name}</span>
    </header>
    <main className="main"><TicketWorkspace id={initial.ticket.id} initial={initial} {...controls} /></main>
  </div>;
}

export function TicketWorkspace({ id, initial, user, team, departments, templates, onBack, backLabel = "Voltar para chamados", onUpdate }: Controls & {
  id: number; initial?: TicketDetail; onBack?: () => void; backLabel?: string; onUpdate?: () => Promise<void>;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ticketAction, setTicketAction] = useState<"finalize" | "reopen" | null>(null);
  const [internal, setInternal] = useState(false);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const solutionField = useRef<HTMLTextAreaElement>(null);
  const reopenField = useRef<HTMLTextAreaElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailRequest = useRef(0);
  const seenReply = useRef(0);
  const message = internal ? note : reply;
  const setMessage = internal ? setNote : setReply;

  const refreshDetail = useCallback(async () => {
    const request = ++detailRequest.current;
    try {
      const next = await api<TicketDetail>(undefined, id);
      if (request === detailRequest.current) setData(next);
    } catch (reason) {
      if (request === detailRequest.current && reason instanceof HelpdeskError && [401, 404].includes(reason.status)) setData(undefined);
      throw reason;
    }
  }, [id]);

  useEffect(() => {
    if (!initial) void refreshDetail().catch((reason) => setError(errorText(reason)));
    const update = () => {
      if (document.visibilityState !== "visible") return;
      void refreshDetail().catch((reason) => {
        if (reason instanceof HelpdeskError && [401, 404].includes(reason.status)) setError(errorText(reason));
      });
    };
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [initial, refreshDetail]);

  const lastReplyId = data?.ticket.lastReplyId;
  const hasUnread = data?.ticket.unreadReply;
  useEffect(() => {
    if (!lastReplyId || !hasUnread) return;
    const markVisible = () => {
      if (document.visibilityState !== "visible" || lastReplyId <= seenReply.current) return;
      seenReply.current = lastReplyId;
      void api({ action: "markRead", id, replyId: lastReplyId }).then(() => onUpdate?.()).catch(() => {
        if (seenReply.current === lastReplyId) seenReply.current = 0;
      });
    };
    markVisible();
    document.addEventListener("visibilitychange", markVisible);
    return () => document.removeEventListener("visibilitychange", markVisible);
  }, [id, lastReplyId, hasUnread, onUpdate]);

  const ready = Boolean(data);
  useEffect(() => { if (ready) heading.current?.focus({ preventScroll: true }); }, [ready]);
  useEffect(() => {
    if (ticketAction === "finalize") solutionField.current?.focus();
    if (ticketAction === "reopen") reopenField.current?.focus();
  }, [ticketAction]);

  async function change(action: string, fields: Record<string, unknown>, form?: HTMLFormElement) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api({ ...fields, action, id });
      form?.reset();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
      return false;
    }
    try {
      await refreshDetail();
      await onUpdate?.();
    } catch (reason) {
      setError(`Alteração salva. ${errorText(reason)}`);
    } finally { setBusy(false); }
    return true;
  }

  function finalize(resolution?: FormDataEntryValue | null) {
    void change("finalize", { resolution }).then((saved) => {
      if (saved) {
        setTicketAction(null);
        setNotice("Chamado finalizado");
      }
    });
  }

  const ticket = data?.ticket;
  const finished = Boolean(ticket && isFinished(ticket.status));
  const staff = user.role !== "cliente";
  const participates = Boolean(staff || ticket?.viewerOwns);
  const canEdit = ticket && (user.role === "admin" || (staff && ticket.assigneeId === user.id));
  const canClaim = ticket && !finished && user.role === "tecnico" && ticket.assigneeId === null;
  const canFinalize = ticket && !finished && (canEdit || canClaim);
  const canReopen = finished && (canEdit || (!staff && participates));

  return <article className="ticket-workspace">
    <Link href="/?view=chamados" className="ticket-back" onClick={onBack ? (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault();
        onBack();
      }
    } : undefined}><span aria-hidden="true"><Icon name="arrow" /></span>{backLabel}</Link>
    <header className="ticket-workspace-heading">
      <div><div className="detail-tags"><span className="ticket-code">{ticketCode(id)}</span>{ticket && <><Tag value={ticket.status} /><Tag value={ticket.priority} />{!participates && <Tag value="Em cópia" />}</>}</div>
        <h1 ref={heading} tabIndex={-1}>{ticket?.title ?? "Detalhes do chamado"}</h1></div>
      {ticket && <div className="ticket-workspace-actions">
        {canFinalize && <button className="button primary ticket-finalize" disabled={busy || ticketAction === "finalize"} onClick={() => {
          setError("");
          setTicketAction("finalize");
        }}><Icon name="check" />Finalizar chamado</button>}
        {canClaim && <button className="button outline" disabled={busy} onClick={() => void change("update", { status: "Em atendimento", priority: ticket.priority, assigneeId: user.id })}>Assumir chamado</button>}
        {canReopen && <button ref={reopenButton} className="button primary" disabled={busy} aria-expanded={ticketAction === "reopen"} onClick={() => {
          setError("");
          setTicketAction("reopen");
          reopenField.current?.focus();
        }}>Reabrir chamado</button>}
      </div>}
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="flash ticket-notice" role="status"><Icon name="check" />{notice}</p>}
    {!data && !error && <p role="status" className="muted">Carregando chamado…</p>}
    {ticket && <TicketProgress status={ticket.status} />}
    {data && ticket && <div className="ticket-workspace-grid">
      <div className="ticket-thread">
        {ticketAction === "finalize" && canFinalize && <section className="panel ticket-box ticket-finalization">
          <h2>Finalizar atendimento</h2>
          {ticket.assigneeId === null && user.role === "tecnico" && <p>Ao finalizar, você ficará como responsável pelo chamado.</p>}
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); finalize(new FormData(event.currentTarget).get("resolution")); }}>
            <label>Solução<textarea ref={solutionField} name="resolution" rows={4} minLength={8} maxLength={2000} required placeholder="Descreva o que resolveu o problema" /></label>
            <div className="form-actions"><button type="button" className="button outline" disabled={busy} onClick={() => setTicketAction(null)}>Cancelar</button>
              <button className="button primary ticket-finalize" disabled={busy}>{busy ? "Finalizando…" : "Confirmar finalização"}</button></div>
          </form>
        </section>}
        {ticketAction === "reopen" && canReopen && <section className="panel ticket-box ticket-reopen">
          <h2>Reabrir atendimento</h2>
          <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            const reason = new FormData(event.currentTarget).get("reason");
            void change("reopen", { reason }).then((saved) => {
              if (!saved) return;
              setTicketAction(null);
              setNotice("Chamado reaberto");
              heading.current?.focus({ preventScroll: true });
            });
          }}>
            <label>Motivo<textarea ref={reopenField} name="reason" rows={3} minLength={5} maxLength={1000} required /></label>
            <div className="form-actions">
              <button type="button" className="button outline" disabled={busy} onClick={() => {
                setTicketAction(null);
                reopenButton.current?.focus();
              }}>Cancelar</button>
              <button className="button primary" disabled={busy}>{busy ? "Reabrindo…" : "Confirmar reabertura"}</button>
            </div>
          </form>
        </section>}
        <section className="panel ticket-conversation">
          <div className="ticket-box ticket-report"><h2>Relato inicial</h2><p>{ticket.description}</p></div>
          {ticket.resolution && <div className="ticket-box ticket-resolved-copy"><h2><Icon name="check" />Solução registrada</h2><p>{ticket.resolution}</p></div>}
          {participates && <div className="ticket-box">
            <div className="ticket-section-title"><h2>Conversa</h2><ReplyBadge ticket={ticket} showUnread={false} /></div>
            <form className="form-stack comment-form" onSubmit={(event) => {
              event.preventDefault();
              void change("comment", { body: message, internal }).then((saved) => { if (saved) setMessage(""); });
            }}>
              {staff && <div className="compose-tools"><div className="compose-tabs" aria-label="Visibilidade da mensagem" role="group">
                <button type="button" aria-pressed={!internal} disabled={busy} onClick={() => setInternal(false)}>Resposta pública</button>
                <button type="button" aria-pressed={internal} disabled={busy} onClick={() => setInternal(true)}>Nota interna</button>
              </div>
                {!internal && templates.length > 0 && <select aria-label="Inserir resposta pronta" value="" onChange={(event) => {
                  const template = templates.find((item) => String(item.id) === event.target.value);
                  if (template) setReply([reply, template.body].filter(Boolean).join("\n\n").slice(0, 2000));
                }}><option value="">Inserir resposta pronta</option>{templates.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}
              </div>}
              <label>{internal ? "Nota interna" : "Comentário"}<textarea disabled={busy} name="body" rows={3} maxLength={2000} required value={message}
                onChange={(event) => setMessage(event.target.value)} placeholder={internal ? "Visível somente para a equipe de suporte" : "Compartilhe uma atualização"} /></label>
              <button className="button primary" disabled={busy}>{internal ? "Salvar nota interna" : "Enviar comentário"}</button>
            </form>
          </div>}
          {!participates && <div className="ticket-box copy-readonly"><Icon name="people" /><p>Você acompanha este chamado em cópia, com acesso de leitura.</p></div>}
          <section className="history ticket-history"><div className="ticket-section-title"><h2>Histórico</h2>{!participates && <ReplyBadge ticket={ticket} showUnread={false} />}</div><ol aria-label="Eventos mais recentes primeiro">{[...data.events].reverse().map((item) => <li key={item.id} data-kind={item.kind}>
            <span className="history-icon"><Icon name={item.kind === "note" || item.kind === "system" ? "shield" : item.kind === "comment" ? "chat" : "clock"} /></span>
            <div><div className="event-meta"><b>{item.author}</b><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>{(item.kind === "note" || item.kind === "system") && <span className="note-label">Interno</span>}</div><p>{item.body}</p></div>
          </li>)}</ol></section>
        </section>
        {finished && !staff && participates && <section className="panel ticket-box"><h2>Avaliação do atendimento</h2>
          {ticket.rating !== null ? <p>Nota registrada: <b>{ticket.rating}/5</b></p> :
            <form className="form-stack detail-action" onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const fields = new FormData(form);
              void change("rate", { score: fields.get("score"), feedback: fields.get("feedback") }, form);
            }}>
              <label>Sua nota<select name="score" defaultValue="" required><option value="" disabled>Escolha uma nota</option>
                {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} de 5</option>)}</select></label>
              <label>Comentário opcional<textarea name="feedback" rows={2} maxLength={500} /></label>
              <button className="button outline" disabled={busy}>Enviar avaliação</button>
            </form>}
        </section>}
      </div>
      <aside className="ticket-sidebar" aria-label="Informações do chamado">
        <section className="panel ticket-box">
          <h2>Cliente</h2>
          <div className="ticket-contact-name"><Avatar person={{ name: ticket.requester }} /><strong>{ticket.requester}</strong></div>
          {data.contact && <dl className="ticket-facts">
            <Fact label="Organização" value={data.contact.organization ?? "—"} />
            <Fact label="E-mail" value={data.contact.email} />
            <Fact label="Telefone" value={data.contact.phone ?? "—"} />
          </dl>}
        </section>
        {participates && <section className="panel ticket-box">
          <h2>Em cópia</h2>
          {data.copies.length ? <ul className="copy-list">{data.copies.map((email) => <li key={email}><span>{email}</span>
            <button className="icon-button" aria-label={`Remover ${email} da cópia`} disabled={busy} onClick={() => void change("copyRemove", { email }).then((saved) => {
              if (saved) setNotice("E-mail removido da cópia");
            })}><Icon name="close" /></button>
          </li>)}</ul> : <p className="muted">Ninguém em cópia</p>}
          <form className="form-stack copy-form" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void change("copyAdd", { email: new FormData(form).get("email") }, form).then((saved) => {
              if (saved) setNotice("E-mail incluído em cópia");
            });
          }}><label>E-mail da pessoa<input name="email" type="email" maxLength={254} placeholder="pessoa@empresa.com" required /></label>
            <button className="button outline" disabled={busy}><Icon name="plus" />Adicionar em cópia</button></form>
        </section>}
        <section className="panel ticket-box">
          <h2>Dados do chamado</h2>
          <dl className="ticket-facts">
            <Fact label="Responsável" value={ticket.assignee ?? "Sem responsável"} />
            <Fact label="Departamento" value={ticket.department ?? "—"} />
            <Fact label="Categoria" value={ticket.category} />
            <Fact label="Origem" value={ticket.source === "assistente" ? "Assistente" : "Formulário"} />
            <Fact label="Abertura" value={formatDate(ticket.createdAt)} />
            <Fact label="Última atualização" value={formatDate(ticket.updatedAt)} />
          </dl>
          {canEdit && <details className="ticket-properties"><summary>Editar atendimento <Icon name="down" /></summary>
            <TicketProperties key={ticket.updatedAt} ticket={ticket} user={user} team={team} departments={departments} busy={busy} onSave={(fields) => void change("update", fields)} />
          </details>}
        </section>
        {staff && ticket.slaStartedAt && <section className="panel ticket-box">
          <div className="ticket-section-title"><h2>Metas de SLA</h2>{isOverdue(ticket) && <Tag value="SLA vencido" />}</div>
          <dl className="ticket-facts">
            <Fact label="Primeira resposta até" value={ticket.responseDueAt ? formatDate(ticket.responseDueAt) : "—"} />
            {ticket.firstReplyAt && <Fact label="Respondido em" value={formatDate(ticket.firstReplyAt)} />}
            <Fact label="Resolução até" value={ticket.waitingSince ? "Prazo pausado" : ticket.resolutionDueAt ? formatDate(ticket.resolutionDueAt) : "—"} />
            {ticket.resolvedAt && <Fact label="Resolvido em" value={formatDate(ticket.resolvedAt)} />}
          </dl>
        </section>}
        {staff && (ticket.department || ticket.receiveEmailReplies || ticket.notifyByEmail) && <section className="panel ticket-box">
          <h2>Preferências de e-mail</h2>
          <dl className="ticket-facts"><Fact label="Receber respostas" value={ticket.receiveEmailReplies ? "Sim" : "Não"} /><Fact label="Notificar cliente" value={ticket.notifyByEmail ? "Sim" : "Não"} /></dl>
        </section>}
        {data.attachments.length > 0 && <section className="panel ticket-box"><h2>Anexos</h2><ul className="attachment-list">
          {data.attachments.map((item) => <li key={item.id}><a href={`/api/helpdesk?id=${id}&attachment=${item.id}`} download><Icon name="clip" />{item.name}</a></li>)}
        </ul></section>}
      </aside>
    </div>}
  </article>;
}

function TicketProgress({ status }: { status: Status }) {
  const current = isFinished(status) ? 2 : status === "Aberto" ? 0 : 1;
  const steps = [
    "Recebido",
    status === "Aguardando cliente" ? "Aguardando cliente" : "Em atendimento",
    "Finalizado",
  ];
  return <ol className="ticket-progress" role="list" aria-label="Etapas do chamado">
    {steps.map((label, index) => <li key={index} aria-current={index === current ? "step" : undefined} data-complete={index < current || undefined}>
      <span className="ticket-progress-marker" aria-hidden="true">
        {index < current || (index === 2 && current === 2) ? <Icon name="check" /> : <span />}
      </span>
      <span>{label}</span>
    </li>)}
  </ol>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function TicketProperties({ ticket, user, team, departments, busy, onSave }: {
  ticket: Ticket; user: Person; team: Person[]; departments: Department[]; busy: boolean; onSave: (fields: Record<string, unknown>) => void;
}) {
  const [status, setStatus] = useState(ticket.status);
  const finished = isFinished(ticket.status);
  return <form className="edit-ticket" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const assignee = fields.get("assigneeId");
    onSave({
      status, priority: fields.get("priority"), assigneeId: user.role === "admin" ? (assignee ? Number(assignee) : null) : user.id,
      department: user.role === "admin" ? fields.get("department") || null : undefined, resolution: fields.get("resolution"),
    });
  }}>
    {!finished && <label>Status<select name="status" value={status} onChange={(event) => setStatus(event.target.value as Status)}>
      {statuses.map((item) => <option key={item}>{item}</option>)}</select></label>}
    <label>Prioridade<select name="priority" defaultValue={ticket.priority}>{priorities.map((item) => <option key={item} value={item}>{item === "Urgente" ? "Crítica" : item}</option>)}</select></label>
    {user.role === "admin" && <>
      <label>Responsável<select name="assigneeId" defaultValue={ticket.assigneeId ?? ""}><option value="">Sem responsável</option>
        {ticket.assigneeId && !team.some((person) => person.id === ticket.assigneeId) && <option value={ticket.assigneeId}>{ticket.assignee}</option>}
        {team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label>Departamento<select name="department" defaultValue={ticket.department ?? ""}><option value="">Sem departamento</option>
        {departments.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
    </>}
    {!finished && isFinished(status) && <label className="ticket-solution">Solução<textarea name="resolution" rows={3} minLength={8} maxLength={2000} required placeholder="Descreva o que resolveu o problema" /></label>}
    <button className="button outline" disabled={busy}>Salvar atendimento</button>
  </form>;
}
