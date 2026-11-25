"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isFinished, isOverdue, type Article, type Department, type Person, type ReplyTemplate, type SlaPolicy, type Snapshot, type Ticket } from "@/lib/model";
import { api, errorText, formatDate, Icon, Modal } from "./ui-kit";

type Save = (data: FormData) => Promise<void>;

function OperationDialog({ title, button = "Salvar", onClose, onSubmit, children }: {
  title: string; button?: string; onClose: () => void; onSubmit: Save; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit(fields);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={title} onClose={onClose}><form className="form-stack modal-content" onSubmit={submit}>
    {children}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Salvando…" : button}</button></div>
  </form></Modal>;
}

export function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  return <OperationDialog title="Alterar senha" onClose={onClose} onSubmit={async (fields) => {
    if (fields.get("password") !== fields.get("confirmation")) throw new Error("As novas senhas precisam coincidir");
    await api({ action: "changePassword", current: fields.get("current"), password: fields.get("password") });
    await onDone();
  }}>
    <label>Senha atual<input name="current" type="password" autoComplete="current-password" maxLength={128} required data-dialog-focus /></label>
    <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
    <label>Confirme a nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
  </OperationDialog>;
}

export function RecoveryDialog({ onClose }: { onClose: () => void }) {
  const [sent, setSent] = useState(false);
  return sent ? <Modal title="Recuperação solicitada" onClose={onClose}><div className="modal-content">
    <p>Se houver uma conta ativa com esse e-mail, ela receberá um link para redefinir a senha.</p>
    <div className="form-actions"><button className="button primary" onClick={onClose}>Voltar</button></div>
  </div></Modal> : <OperationDialog title="Recuperar senha" button="Solicitar link" onClose={onClose} onSubmit={async (fields) => {
    await api({ action: "recover", email: fields.get("email") });
    setSent(true);
  }}>
    <label>E-mail da conta<input name="email" type="email" autoComplete="email" maxLength={254} required data-dialog-focus /></label>
  </OperationDialog>;
}

export function ResetPassword({ code }: { code: string }) {
  return <main className="main password-page"><header className="page-heading"><h1>Redefinir senha</h1></header>
    <OperationDialog title="Defina uma nova senha" button="Redefinir senha" onClose={() => window.location.replace("/")} onSubmit={async (fields) => {
      if (fields.get("password") !== fields.get("confirmation")) throw new Error("As senhas precisam coincidir");
      await api({ action: "resetPassword", code, password: fields.get("password") });
      window.location.replace("/");
    }}>
      <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required data-dialog-focus /></label>
      <label>Confirme a senha<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
    </OperationDialog>
  </main>;
}

export function AccountStatus({ account, onClose, onDone }: { account: Pick<Person, "id" | "name" | "active">; onClose: () => void; onDone: () => Promise<void> }) {
  const verb = account.active ? "Desativar" : "Reativar";
  return <OperationDialog title={`${verb} conta`} button={verb} onClose={onClose} onSubmit={async () => {
    await api({ action: "active", id: account.id, active: !account.active });
    await onDone();
  }}><p>{account.active ? <>O acesso de <b>{account.name}</b> será encerrado. Os chamados e o histórico ficam disponíveis à equipe.</> :
    <>A conta de <b>{account.name}</b> poderá entrar novamente.</>}</p></OperationDialog>;
}

export function DepartmentPanel({ departments, team, refresh }: { departments: Department[]; team: Person[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const item = editing === "new" ? undefined : editing ?? undefined;
  return <>
    <section className="panel">
      <div className="operation-heading"><h2>Departamentos e técnicos</h2><button className="button primary" onClick={() => setEditing("new")}><Icon name="plus" />Novo departamento</button></div>
      <div className="table-scroll"><table><thead><tr><th scope="col">Departamento</th><th scope="col">Técnicos vinculados</th><th scope="col">Ações</th></tr></thead>
        <tbody>{departments.map((department) => <tr key={department.id}><td><b>{department.name}</b></td>
          <td>{team.filter((person) => department.members.includes(person.id)).map((person) => person.name).join(", ") || "Sem técnicos vinculados"}</td>
          <td><button className="row-action" onClick={() => setEditing(department)} aria-label={`Editar ${department.name}`}>Editar</button></td></tr>)}</tbody>
      </table></div>
    </section>
    {editing && <OperationDialog title={item ? "Editar departamento" : "Novo departamento"} onClose={() => setEditing(null)} onSubmit={async (fields) => {
      await api({ action: "department", id: item?.id, name: fields.get("name"), members: fields.getAll("member") });
      await refresh();
      setEditing(null);
    }}>
      <label>Nome<input name="name" minLength={2} maxLength={100} defaultValue={item?.name} required data-dialog-focus /></label>
      <fieldset className="member-list"><legend>Técnicos vinculados</legend>
        {team.length ? team.map((person) => <label key={person.id}><input name="member" type="checkbox" value={person.id} defaultChecked={item?.members.includes(person.id)} />{person.name}</label>) : <p className="muted">Nenhum técnico ativo cadastrado</p>}
      </fieldset>
    </OperationDialog>}
  </>;
}

export function KnowledgePanel({ articles, admin, refresh }: { articles: Article[]; admin: boolean; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLocaleLowerCase("pt-BR");
  const found = articles.filter((article) => `${article.title} ${article.body}`.toLocaleLowerCase("pt-BR").includes(words));
  const [editing, setEditing] = useState<Article | "new" | null>(null);
  return <>
    <section className="panel">
      <div className="operation-heading">
        <label className="search"><Icon name="search" /><input aria-label="Buscar artigos" placeholder="Buscar artigos" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {admin && <button className="button primary" onClick={() => setEditing("new")}><Icon name="plus" />Novo artigo</button>}
      </div>
      {found.length ? <div className="knowledge-list">{found.map((article) => <div className="knowledge-item" key={article.id}>
        <details><summary>{article.title} {!article.published && <small>Rascunho</small>}<Icon name="down" /></summary><p>{article.body}</p></details>
        {admin && <button className="row-action" onClick={() => setEditing(article)} aria-label={`Editar ${article.title}`}>Editar</button>}
      </div>)}</div> : <p className="empty">Nenhum artigo encontrado</p>}
    </section>
    {editing && <ContentDialog kind="article" item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onDone={async () => { await refresh(); setEditing(null); }} />}
  </>;
}

export function TemplatesPanel({ items, refresh }: { items: ReplyTemplate[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<ReplyTemplate | "new" | null>(null);
  return <>
    <section className="panel">
      <div className="operation-heading"><h2>Respostas prontas</h2><button className="button primary" onClick={() => setEditing("new")}><Icon name="plus" />Nova resposta</button></div>
      {items.length ? <ul className="organization-list">{items.map((item) => <li key={item.id}><b>{item.title}</b><button className="row-action" onClick={() => setEditing(item)}>Editar</button></li>)}</ul> :
        <p className="empty">Nenhuma resposta pronta cadastrada</p>}
    </section>
    {editing && <ContentDialog kind="template" item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onDone={async () => { await refresh(); setEditing(null); }} />}
  </>;
}

function ContentDialog({ kind, item, onClose, onDone }: { kind: "article" | "template"; item?: Article | ReplyTemplate; onClose: () => void; onDone: () => Promise<void> }) {
  const article = kind === "article";
  const label = article ? item ? "Editar artigo" : "Novo artigo" : item ? "Editar resposta" : "Nova resposta";
  return <OperationDialog title={label} onClose={onClose} onSubmit={async (fields) => {
    await api({ action: kind, id: item?.id, title: fields.get("title"), body: fields.get("body"), published: fields.has("published") });
    await onDone();
  }}>
    <label>Título<input name="title" minLength={3} maxLength={100} required defaultValue={item?.title} data-dialog-focus /></label>
    <label>{article ? "Conteúdo" : "Resposta"}<textarea name="body" rows={6} minLength={8} maxLength={article ? 6000 : 2000} required defaultValue={item?.body} /></label>
    {article && <label className="check-line"><input name="published" type="checkbox" defaultChecked={item && "published" in item ? item.published : true} />Publicar artigo</label>}
  </OperationDialog>;
}

export function SlaPanel({ policies, refresh }: { policies: SlaPolicy[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  return <>
    <section className="panel">
      <div className="operation-heading"><div><h2>Metas por prioridade</h2><p>Os prazos são corridos e valem para os chamados abertos ou reabertos após a alteração.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th scope="col">Prioridade</th><th scope="col">Primeira resposta</th><th scope="col">Resolução</th><th scope="col">Ações</th></tr></thead>
        <tbody>{policies.map((policy) => <tr key={policy.priority}><td>{policy.priority === "Urgente" ? "Crítica" : policy.priority}</td>
          <td>{duration(policy.responseMinutes)}</td><td>{duration(policy.resolutionMinutes)}</td><td><button className="row-action" onClick={() => setEditing(policy)}>Editar</button></td></tr>)}</tbody>
      </table></div>
    </section>
    {editing && <OperationDialog title={`Prazos de SLA · ${editing.priority === "Urgente" ? "Crítica" : editing.priority}`} onClose={() => setEditing(null)} onSubmit={async (fields) => {
      await api({ action: "policy", priority: editing.priority, responseMinutes: fields.get("response"), resolutionMinutes: fields.get("resolution") });
      await refresh();
      setEditing(null);
    }}>
      <label>Primeira resposta, em minutos<input type="number" name="response" min={1} max={43200} required defaultValue={editing.responseMinutes} data-dialog-focus /></label>
      <label>Resolução, em minutos<input type="number" name="resolution" min={1} max={43200} required defaultValue={editing.resolutionMinutes} /></label>
    </OperationDialog>}
  </>;
}

type AuditEntry = { id: number; createdAt: string; action: string; actor: string };
export function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ entries: AuditEntry[] }>(undefined, undefined, "audit=1").then(
      (result) => { if (active) setEntries(result.entries); },
      (reason) => { if (active) setError(errorText(reason)); },
    );
    return () => { active = false; };
  }, []);
  return <section className="panel">
    {error && <p className="error" role="alert">{error}</p>}
    {!entries && !error && <p className="empty" role="status">Carregando auditoria…</p>}
    {entries && (entries.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Ação</th><th scope="col">Responsável</th><th scope="col">Data</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.action}</td><td>{entry.actor}</td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <p className="empty">Nenhuma alteração registrada</p>)}
  </section>;
}

const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short" });

function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes > 0 && minutes < 1) return "< 1 min";
  const total = Math.round(minutes);
  return total < 60 ? `${total} min` : `${Math.floor(total / 60)} h ${total % 60} min`;
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function stats(tickets: Ticket[]) {
  const responses = [];
  const resolutions = [];
  let ratingCount = 0, ratingTotal = 0;
  let completed = 0, inSla = 0, measured = 0, overdue = 0;
  for (const ticket of tickets) {
    if (isFinished(ticket.status)) completed++;
    if (isOverdue(ticket)) overdue++;
    ratingCount += ticket.ratingCount;
    ratingTotal += ticket.ratingTotal;
    if (!ticket.slaStartedAt) continue;
    const start = Date.parse(ticket.slaStartedAt);
    if (ticket.firstReplyAt) responses.push((Date.parse(ticket.firstReplyAt) - start) / 60_000);
    if (ticket.resolvedAt && ticket.resolutionDueAt && ticket.firstReplyAt && ticket.responseDueAt) {
      resolutions.push((Date.parse(ticket.resolvedAt) - start) / 60_000);
      measured++;
      if (ticket.resolvedAt <= ticket.resolutionDueAt && ticket.firstReplyAt <= ticket.responseDueAt) inSla++;
    }
  }
  return {
    count: tickets.length, pending: tickets.length - completed, completed, overdue, measured,
    response: mean(responses), resolution: mean(resolutions), rating: ratingCount ? ratingTotal / ratingCount : null, ratingCount,
    compliance: measured ? Math.round(inSla * 100 / measured) : null,
  };
}

export function ReportsPanel({ data }: { data: Snapshot }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [organization, setOrganization] = useState("");
  const rows = data.tickets.filter((ticket) => {
    const day = localDay.format(new Date(ticket.createdAt));
    return (!start || day >= start) && (!end || day <= end) && (!organization || String(ticket.organizationId) === organization);
  });
  const overall = stats(rows);
  const byDepartment = new Map<string, Ticket[]>();
  for (const ticket of rows) {
    const department = ticket.department ?? "Sem departamento";
    const group = byDepartment.get(department) ?? [];
    group.push(ticket);
    byDepartment.set(department, group);
  }
  const groups = [...byDepartment].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([name, tickets]) => ({ name, ...stats(tickets) }));
  const formatRate = (value: number | null) => value === null ? "—" : `${value}%`;

  function exportCsv() {
    const columns = ["Departamento", "Chamados", "Pendentes", "Concluídos", "Em atraso", "Resposta média (min)", "Resolução média (min)", "SLA (%)", "Avaliação média"];
    const records = groups.map((item) => [item.name, item.count, item.pending, item.completed, item.overdue, item.response?.toFixed(1), item.resolution?.toFixed(1), item.compliance, item.rating?.toFixed(2)]);
    const csv = [columns, ...records].map((line) => line.map((value) => {
      let cell = String(value ?? "");
      if (/^\s*[=+@-]/.test(cell)) cell = `'${cell}`;
      return `"${cell.replaceAll('"', '""')}"`;
    }).join(";")).join("\r\n");
    const href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = "tickethub-relatorio.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
  }

  return <div className="report-stack">
    <section className="panel report-filters" aria-label="Filtros de relatórios">
      <label>Aberto a partir de<input type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Aberto até<input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} /></label>
      <label>Organização<select value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="">Todas</option>{data.organizations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button className="button outline" onClick={exportCsv} disabled={!groups.length}>Exportar CSV</button>
    </section>
    <dl className="panel report-summary">
      <div><dt>Chamados no período</dt><dd>{overall.count}</dd><small>{overall.completed} concluídos · {overall.overdue} em atraso</small></div>
      <div><dt>Primeira resposta média</dt><dd>{duration(overall.response)}</dd></div>
      <div><dt>Resolução média</dt><dd>{duration(overall.resolution)}</dd></div>
      <div><dt>SLA cumprido</dt><dd>{formatRate(overall.compliance)}</dd><small>{overall.measured} {overall.measured === 1 ? "chamado medido" : "chamados medidos"}</small></div>
      <div><dt>Avaliação média</dt><dd>{overall.rating === null ? "—" : overall.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</dd><small>{overall.ratingCount} {overall.ratingCount === 1 ? "avaliação" : "avaliações"}</small></div>
    </dl>
    <section className="panel"><div className="operation-heading"><h2>Por departamento</h2></div>
      {groups.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Departamento</th><th scope="col">Chamados</th><th scope="col">Pendentes</th><th scope="col">Atrasados</th><th scope="col">Resposta média</th><th scope="col">Resolução média</th><th scope="col">SLA</th></tr></thead>
        <tbody>{groups.map((item) => <tr key={item.name}><td><b>{item.name}</b></td><td>{item.count}</td><td>{item.pending}</td><td>{item.overdue}</td><td>{duration(item.response)}</td><td>{duration(item.resolution)}</td><td>{formatRate(item.compliance)}</td></tr>)}</tbody>
      </table></div> : <p className="empty">Nenhum chamado no período selecionado</p>}
    </section>
  </div>;
}
