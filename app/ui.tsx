"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type FormEvent } from "react";
import { categories, isFinished, isOverdue, priorities, roleNames, roles, ticketCode, ticketHref, type Customer, type Organization, type Person, type Role, type Snapshot, type Ticket } from "@/lib/model";
import { AccountStatus, AuditPanel, DepartmentPanel, KnowledgePanel, PasswordDialog, RecoveryDialog, ReportsPanel, SlaPanel, TemplatesPanel } from "./operations";
import { CustomerDialog, OrganizationDialog, StaffTicketForm } from "./staff-forms";
import { defaultQueueFilters, QueueControls, type StatusFilter } from "./queue-controls";
import { TicketWorkspace } from "./ticket-workspace";
import { api, Avatar, Brand, CopiesField, errorText, formatDate, Icon, Modal, ReplyBadge, Tag, type IconName } from "./ui-kit";

type ManagementView = "people" | "customers" | "organizations" | "departments" | "sla" | "templates" | "reports" | "audit";
type View = "overview" | "tickets" | "assistant" | "knowledge" | ManagementView;
type Window = { name: "create" | "person" | "password" }
  | { name: "customer"; item?: Customer } | { name: "organization"; item?: Organization }
  | { name: "accountStatus"; item: Pick<Person, "id" | "name" | "active"> };
type Filter = "waitingAgent" | "open" | "mine" | "all" | "finished";
const waitingAgent = (ticket: Ticket) => ticket.assigneeId === null && !isFinished(ticket.status) && ticket.status !== "Aguardando cliente";
const queueTabs: Record<Filter, { label: string; match: (ticket: Ticket, userId: number) => boolean }> = {
  waitingAgent: { label: "Aguardando atendente", match: waitingAgent },
  open: { label: "Abertos", match: (ticket) => !isFinished(ticket.status) },
  mine: { label: "Meus chamados", match: (ticket, userId) => ticket.assigneeId === userId },
  all: { label: "Todos", match: () => true },
  finished: { label: "Finalizados", match: (ticket) => isFinished(ticket.status) },
};
const navigation: { id: Exclude<View, ManagementView>; icon: IconName; title: string }[] = [
  { id: "overview", icon: "grid", title: "Visão geral" },
  { id: "tickets", icon: "logo", title: "Chamados" },
  { id: "assistant", icon: "bot", title: "Assistente IA" },
  { id: "knowledge", icon: "inbox", title: "Base de conhecimento" },
];
const management: { id: ManagementView; icon: IconName; title: string }[] = [
  { id: "customers", icon: "people", title: "Clientes" },
  { id: "organizations", icon: "building", title: "Organizações" },
  { id: "people", icon: "shield", title: "Equipe" },
  { id: "departments", icon: "building", title: "Departamentos" },
  { id: "sla", icon: "clock", title: "Prazos de SLA" },
  { id: "templates", icon: "chat", title: "Respostas prontas" },
  { id: "reports", icon: "grid", title: "Relatórios" },
  { id: "audit", icon: "shield", title: "Auditoria" },
];
const roleIcon: Record<Role, IconName> = { admin: "shield", tecnico: "tool", cliente: "user" };

export function Login({ demo }: { demo: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);

  async function signIn(data: Record<string, unknown>, name: string) {
    setPending(name);
    setError("");
    try {
      await api(data);
      window.location.reload();
    } catch (reason) {
      setError(errorText(reason));
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void signIn({ ...fields, action: "login" }, "login");
  }

  return <main className="login">
    <section className="login-main">
      <Brand />
      <div className="login-content">
        <h1>Central de<br />suporte</h1>
        <p className="intro">Acesse sua conta para abrir e acompanhar chamados.</p>
        <form className="form-stack login-form" onSubmit={submit}>
          <label>E-mail<input type="email" name="email" placeholder="voce@empresa.com" autoComplete="username" required /></label>
          <label>Senha<input type="password" name="password" placeholder="Sua senha" autoComplete="current-password" required /></label>
          <button className="button primary" disabled={pending !== null}>{pending === "login" ? "Entrando…" : "Entrar"}<Icon name="arrow" /></button>
        </form>
        <button className="row-action forgot-password" onClick={() => setRecovering(true)}>Esqueci minha senha</button>
        {demo && <section className="demo-roles"><h2>Acessar demonstração</h2><div>{roles.map((role) =>
          <button className="button outline" key={role} disabled={pending !== null} onClick={() => void signIn({ action: "demo", role }, role)}>
            <Icon name={roleIcon[role]} />{pending === role ? "Entrando…" : roleNames[role]}
          </button>)}</div></section>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <p className="login-footer">TicketHub · Atendimento técnico</p>
    </section>
    {recovering && <RecoveryDialog onClose={() => setRecovering(false)} />}
    <section className="login-feature" aria-label="Abertura de chamados pelo assistente">
      <div className="login-feature-content">
        <div className="login-conversation"><Icon name="chat" /> A VPN cai sempre que entro em uma reunião</div>
        <div className="login-connector" aria-hidden="true" />
        <div className="login-receipt">
          <div className="receipt-top"><span className="ticket-code">TH-0001</span><Tag value="Aberto" /></div>
          <b>VPN desconecta durante reuniões</b>
          <div className="receipt-bottom"><span>Rede · Prioridade alta</span><Icon name="check" /></div>
        </div>
        <h2>Do relato<br />ao chamado.</h2>
        <p>Descreva o problema e acompanhe a resolução em um só lugar.</p>
      </div>
    </section>
  </main>;
}

export function Hub({ initial, initialView = "overview" }: { initial: Snapshot; initialView?: "overview" | "tickets" }) {
  const pathname = usePathname();
  const ticketId = Number(pathname.match(/^\/chamados\/(\d+)$/)?.[1]) || null;
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<Filter>(initial.user.role === "cliente" ? "open" : "waitingAgent");
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState(defaultQueueFilters);
  const statusFilter = queueFilter.status;
  const [page, setPage] = useState(0);
  const [activeWindow, setWindow] = useState<Window | null>(null);
  const [flash, setFlash] = useState("");
  const [shellError, setShellError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const snapshotRequest = useRef(0);
  const customer = data.user.role === "cliente";
  const admin = data.user.role === "admin";
  const staffCreate = !customer && activeWindow?.name === "create";
  const manage = management.filter((item) => item.id === "customers" || item.id === "reports" || admin);
  const people = data.people.filter((person) => person.role !== "cliente");

  const refresh = useCallback(async () => {
    const sequence = ++snapshotRequest.current;
    const next = await api<Snapshot>();
    if (sequence === snapshotRequest.current) setData(next);
  }, []);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    };
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);

  function navigate(next: View, selected: Filter = customer ? "open" : "waitingAgent", status: StatusFilter = "") {
    if (ticketId) {
      window.history.pushState(null, "", "/");
      window.scrollTo(0, 0);
    }
    setView(next);
    setFilter(selected);
    setSearch("");
    setQueueFilter({ ...defaultQueueFilters, status });
    setPage(0);
    setMenuOpen(false);
    setWindow(null);
    setFlash("");
  }

  function openTicket(id: number) {
    window.history.pushState(null, "", ticketHref(id));
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }

  function addCustomer(item: Customer) {
    setData((current) => ({ ...current, customers: [...current.customers, item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }));
  }

  async function finish(message: string) {
    setWindow(null);
    setFlash(message);
    try { await refresh(); } catch (reason) { setShellError(errorText(reason)); }
  }

  async function logout() {
    try {
      await api({ action: "logout" });
      window.location.reload();
    } catch (reason) {
      setShellError(errorText(reason));
    }
  }

  const matchFilter = queueTabs[filter].match;
  const filtered = data.tickets.filter((ticket) => {
    const query = search.trim().toLowerCase();
    const matches = [ticket.title, ticket.requester, ticket.assignee, ticket.category, ticket.department, ticketCode(ticket.id)].some((value) => value?.toLowerCase().includes(query));
    const matchesStatus = statusFilter === "overdue" ? isOverdue(ticket)
      : statusFilter === "unread" ? ticket.unreadReply : !statusFilter || ticket.status === statusFilter;
    return matches && matchFilter(ticket, data.user.id) && matchesStatus &&
      (!queueFilter.organization || String(ticket.organizationId) === queueFilter.organization) &&
      (!queueFilter.department || ticket.department === queueFilter.department) &&
      (!queueFilter.assignee || String(ticket.assigneeId) === queueFilter.assignee);
  });
  if (queueFilter.order === "old") filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (queueFilter.order === "priority") filtered.sort((a, b) => priorities.indexOf(b.priority) - priorities.indexOf(a.priority));
  const pageSize = 15;
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const screen = ticketId ? `ticket-${ticketId}` : staffCreate ? "new-ticket" : view;
  const mainTab = navigation.findIndex((item) => item.id === screen);
  const queueSelection = JSON.stringify([filter, currentPage, queueFilter]);
  const main = useRef<HTMLElement>(null);
  const queueTabsElement = useRef<HTMLDivElement>(null);
  const queueResults = useRef<HTMLDivElement>(null);
  const markerOrigin = useRef<DOMRect | null>(null);
  const previousScreen = useRef({ screen, mainTab, filter, queueSelection });

  function selectQueueTab(tab: Filter, status: StatusFilter = "") {
    markerOrigin.current = tab === filter ? null
      : queueTabsElement.current?.querySelector(".queue-tab-marker")?.getBoundingClientRect() ?? null;
    setFilter(tab);
    setQueueFilter({ ...queueFilter, status });
    setPage(0);
  }

  useLayoutEffect(() => {
    const previous = previousScreen.current;
    const changedScreen = previous.screen !== screen;
    const changedQueue = previous.queueSelection !== queueSelection;
    previousScreen.current = { screen, mainTab, filter, queueSelection };
    const markerStart = markerOrigin.current;
    markerOrigin.current = null;
    if ((!changedScreen && !changedQueue) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
    if (changedScreen) {
      const betweenMainTabs = previous.mainTab >= 0 && mainTab >= 0;
      const transform = betweenMainTabs
        ? `translateX(${mainTab > previous.mainTab ? 20 : -20}px)`
        : "translateY(10px)";
      const animation = main.current?.animate(
        [{ opacity: 0.45, transform }, { opacity: 1, transform: "none" }],
        { duration: betweenMainTabs ? 280 : 240, easing },
      );
      return () => animation?.cancel();
    }

    const changedTab = previous.filter !== filter;
    const tabEasing = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
    const tabOrder = Object.keys(queueTabs);
    const direction = Math.sign(tabOrder.indexOf(filter) - tabOrder.indexOf(previous.filter));
    const results = queueResults.current?.animate([
      { opacity: changedTab ? 0.8 : 0.45, transform: `translateX(${direction * 8}px)` },
      { opacity: 1, transform: "none" },
    ], { duration: changedTab ? 300 : 160, easing: changedTab ? tabEasing : easing });
    const activeMarker = queueTabsElement.current?.querySelector(".queue-tab-marker");
    const markerEnd = activeMarker?.getBoundingClientRect();
    let marker: Animation | undefined;
    if (changedTab && activeMarker && markerStart && markerEnd && markerEnd.width > 0) {
      const start = Math.abs(markerStart.top - markerEnd.top) < 1
        ? { transform: `translateX(${markerStart.left - markerEnd.left}px) scaleX(${markerStart.width / markerEnd.width})` }
        : { opacity: 0.35 };
      marker = activeMarker.animate([start, { opacity: 1, transform: "none" }], { duration: 320, easing: tabEasing });
    }
    return () => {
      results?.cancel();
      marker?.cancel();
    };
  }, [screen, mainTab, filter, queueSelection]);

  const critical = data.tickets.find((ticket) => ticket.priority === "Urgente" && !["Resolvido", "Fechado"].includes(ticket.status));
  const resolved = data.tickets.filter((ticket) => customer ? isFinished(ticket.status) : ticket.status === "Resolvido").length;
  const openCount = data.tickets.filter((ticket) => !isFinished(ticket.status)).length;
  const unreadCount = data.tickets.filter((ticket) => ticket.unreadReply && (!customer || !isFinished(ticket.status))).length;
  const unreadTab = customer ? "open" : "all";
  const resolvedTab = customer ? "finished" : "all";
  const resolvedStatus = customer ? "" : "Resolvido";
  const unassigned = data.tickets.filter(waitingAgent).length;
  const visibleTabs: Filter[] = customer ? ["open", "finished"]
    : admin ? ["waitingAgent", "open", "all"] : ["waitingAgent", "open", "mine", "all"];
  const titles: Record<View, string> = {
    overview: "Central de atendimento", assistant: "Assistente de chamados",
    people: "Equipe", customers: "Clientes", organizations: "Organizações",
    departments: "Departamentos", sla: "Prazos de SLA", templates: "Respostas prontas", reports: "Relatórios", knowledge: "Base de conhecimento", audit: "Auditoria",
    tickets: customer ? "Meus chamados" : "Fila de chamados",
  };
  const descriptions: Record<View, string> = {
    overview: customer ? "Acompanhe suas solicitações e abra um novo chamado." : "Organize a fila, assuma chamados e acompanhe as respostas.",
    tickets: customer ? "Seus chamados e os que você acompanha em cópia." : "Acompanhe respostas e encontre o próximo chamado para atender.",
    assistant: "Descreva o problema como você contaria para a equipe de suporte.",
    people: "Cadastre técnicos e administradores.",
    customers: "Cadastre e consulte os clientes da central de suporte.",
    organizations: "Cadastre as empresas que podem ser vinculadas aos clientes.",
    departments: "Organize a operação por área e vincule os técnicos.",
    sla: "Defina os prazos de primeira resposta e resolução da sua central.",
    templates: "Mantenha respostas que a equipe pode inserir nos chamados.",
    reports: "Acompanhe volume, tempos de atendimento, prazos e avaliações.",
    knowledge: "Consulte orientações para resolver problemas comuns.",
    audit: "Acompanhe as alterações de gestão mais recentes.",
  };
  const action = view === "people" ? { window: { name: "person" }, title: "Cadastrar pessoa" } as const
    : view === "customers" ? { window: { name: "customer" }, title: "Criar cliente" } as const
      : view === "organizations" ? { window: { name: "organization" }, title: "Criar organização" } as const
        : ["overview", "tickets", "assistant"].includes(view) ? { window: { name: "create" }, title: "Novo chamado" } as const : null;

  return <div className="shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
      <Brand />
      <nav id="main-navigation" className={menuOpen ? "nav open" : "nav"} aria-label="Navegação principal" onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}>
        {navigation.map((item) => (
          <button key={item.id} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
            <Icon name={item.icon} /><span>{item.id === "tickets" && customer ? "Meus chamados" : item.title}</span>
            {item.id === "tickets" && <small>{unassigned}</small>}
          </button>
        ))}
        {!customer && <details className="nav-menu"><summary className={manage.some((item) => item.id === view) ? "selected" : undefined}><Icon name="gear" />Gestão<Icon name="down" /></summary>
          <div className="dropdown">{manage.map((item) => <button key={item.id} onClick={(event) => {
            const menu = event.currentTarget.closest("details");
            if (menu) menu.open = false;
            navigate(item.id);
          }}><Icon name={item.icon} />{item.title}</button>)}</div>
        </details>}
      </nav>
      <div className="workspace"><span>{data.demo ? "NX" : "TH"}</span><b>{data.demo ? "Nexo Tecnologia" : "Central de suporte"}</b></div>
      {critical && !staffCreate && !ticketId && <TicketLink id={critical.id} onOpen={openTicket} className="icon-button critical-notice" aria-label="Ver chamado crítico" title="Ver chamado crítico"><Icon name="alert" /></TicketLink>}
      <details className="account"><summary aria-label={`Conta de ${data.user.name}`}><Avatar person={data.user} /><b>{data.user.name}</b><Icon name="down" /></summary>
        <div className="dropdown"><span>{roleNames[data.user.role]}</span><button onClick={(event) => {
          const account = event.currentTarget.closest("details");
          if (account) account.open = false;
          setWindow({ name: "password" });
        }}><Icon name="shield" />Alterar senha</button><button onClick={() => void logout()}><Icon name="logout" />Sair</button></div>
      </details>
    </header>
      <main className="main" ref={main}>
        {ticketId && <TicketWorkspace key={ticketId} id={ticketId} user={data.user} team={data.team} departments={data.departments} templates={data.templates}
          onBack={() => window.history.back()} backLabel={view === "assistant" ? "Voltar ao assistente" : view === "overview" ? "Voltar à visão geral" : "Voltar para chamados"} onUpdate={refresh} />}
        {staffCreate && <StaffTicketForm customers={data.customers} organizations={data.organizations} departments={data.departments}
          onCancel={() => setWindow(null)} onCustomer={addCustomer} onDone={(ticket) => {
            navigate("tickets");
            return finish(`${ticketCode(ticket.id)} aberto com sucesso`);
          }} />}
        <div className={view === "overview" ? "queue-screen overview-screen" : view === "tickets" ? "queue-screen" : undefined} hidden={staffCreate || Boolean(ticketId)}>
        <header className="page-heading">
          <div><h1>{titles[view]}</h1><p>{descriptions[view]}</p></div>
          {action && <button className="button primary" onClick={() => setWindow(action.window)}><Icon name="plus" />{action.title}</button>}
        </header>
        {shellError && <p className="error" role="alert">{shellError}</p>}
        {flash && <div className="flash" role="status"><Icon name="check" />{flash}<button className="icon-button" aria-label="Dispensar aviso" onClick={() => setFlash("")}><Icon name="close" /></button></div>}
        {view === "overview" && <section className="overview-metrics" aria-label="Resumo dos chamados">
          <OverviewMetric label="Em aberto" value={openCount} icon="inbox" selected={filter === "open" && statusFilter === ""}
            onClick={() => selectQueueTab("open")} />
          <OverviewMetric label="Novas respostas" value={unreadCount} icon="chat" detail={customer ? "Em chamados abertos" : undefined}
            selected={filter === unreadTab && statusFilter === "unread"} onClick={() => selectQueueTab(unreadTab, "unread")} />
          <OverviewMetric label={customer ? "Finalizados" : "Resolvidos"} value={resolved} icon="check"
            selected={filter === resolvedTab && statusFilter === resolvedStatus} onClick={() => selectQueueTab(resolvedTab, resolvedStatus)} />
        </section>}
        {(view === "overview" || view === "tickets") && (
          <div className={view === "overview" ? "overview-content" : undefined}>
          <section className="queue" aria-label="Fila de chamados">
            {view === "overview" && <div className="queue-heading">
              <h2>{customer ? "Meus chamados" : "Fila de chamados"}</h2>
            </div>}
            <div className="queue-filters" ref={queueTabsElement} role="group" aria-label="Filtrar chamados">
              {visibleTabs.map((tab) => <button key={tab} aria-pressed={filter === tab} onClick={() => selectQueueTab(tab)}>{customer && tab === "open" ? "Em aberto" : queueTabs[tab].label}<small>{data.tickets.filter((ticket) => queueTabs[tab].match(ticket, data.user.id)).length}</small>{filter === tab && <span className="queue-tab-marker" aria-hidden="true" />}</button>)}
            </div>
            <div className="queue-toolbar"><label className="search"><Icon name="search" /><input type="search" aria-label="Buscar chamados" placeholder="Buscar chamados" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
              {view === "tickets" && <QueueControls data={data} staff={!customer} value={queueFilter} onChange={(value) => {
                setQueueFilter(value);
                setPage(0);
              }} />}
            </div>
            <div ref={queueResults} id="queue-results" className="queue-results">
              <TicketList tickets={filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)} staff={!customer} filter={filter} onOpen={openTicket} />
            </div>
            <div className="queue-total queue-pagination"><span role="status">{filtered.length} {filtered.length === 1 ? "chamado" : "chamados"}</span>
              {lastPage > 0 && <div><button className="button outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>{currentPage + 1} de {lastPage + 1}</span><button className="button outline" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button></div>}
            </div>
          </section>
          {view === "overview" && <OverviewAside tickets={data.tickets} critical={critical} staff={!customer} onOpen={openTicket}
            onAssistant={data.aiConfigured || data.demo ? () => navigate("assistant") : undefined} />}
          </div>
        )}
        <div hidden={view !== "assistant"}><Assistant snapshot={data} onOpen={openTicket} refresh={refresh} /></div>
        {view === "knowledge" && <KnowledgePanel articles={data.articles} admin={admin} refresh={refresh} />}
        {view === "reports" && !customer && <ReportsPanel data={data} />}
        {view === "departments" && admin && <DepartmentPanel departments={data.departments} team={data.team} refresh={refresh} />}
        {view === "sla" && admin && <SlaPanel policies={data.policies} refresh={refresh} />}
        {view === "templates" && admin && <TemplatesPanel items={data.templates} refresh={refresh} />}
        {view === "audit" && admin && <AuditPanel />}
        {view === "people" && admin && <section className="panel"><div className="section-heading"><div><h2>Contas da equipe</h2></div></div>
          <div className="table-scroll"><table><thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Perfil</th><th scope="col">Conta</th><th scope="col">Ações</th></tr></thead>
            <tbody>{people.map((person) => <tr key={person.id}><td><span className="person-name"><Avatar person={person} />{person.name}</span></td><td>{person.email}</td><td>{roleNames[person.role]}</td><td>{person.active ? "Ativa" : "Inativa"}</td>
              <td>{person.id !== data.user.id && <button className="row-action" onClick={() => setWindow({ name: "accountStatus", item: person })}>{person.active ? "Desativar" : "Reativar"}</button>}</td></tr>)}</tbody>
          </table></div></section>}
        {view === "customers" && !customer && <section className="panel"><div className="section-heading"><h2>Clientes cadastrados</h2></div>
          {data.customers.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Cliente</th><th scope="col">Organização</th><th scope="col">Telefone</th><th scope="col">Equipamento</th><th scope="col">Localidade</th><th scope="col">Identificador</th><th scope="col">Conta</th><th scope="col">Ações</th></tr></thead>
            <tbody>{data.customers.map((item) => <tr key={item.id}><td><b>{item.name}</b><small className="table-subtitle customer-email">{item.email}</small></td><td>{item.organization || "—"}</td><td>{item.phone || "—"}</td><td>{item.equipment || "—"}</td><td>{item.location || "—"}</td><td>{item.externalId || "—"}</td><td>{item.active ? "Ativa" : "Inativa"}</td>
              <td><div className="row-actions"><button className="row-action" onClick={() => setWindow({ name: "customer", item })}>Editar</button>{admin && <button className="row-action" onClick={() => setWindow({ name: "accountStatus", item })}>{item.active ? "Desativar" : "Reativar"}</button>}</div></td></tr>)}</tbody>
          </table></div> : <p className="empty">Nenhum cliente cadastrado</p>}
        </section>}
        {view === "organizations" && admin && <section className="panel"><div className="section-heading"><h2>Organizações cadastradas</h2></div>
          {data.organizations.length ? <ul className="organization-list">{data.organizations.map((item) => <li key={item.id}><Icon name="building" /><b>{item.name}</b><button className="row-action" onClick={() => setWindow({ name: "organization", item })}>Editar</button></li>)}</ul>
            : <p className="empty">Nenhuma organização cadastrada</p>}
        </section>}
        </div>
      </main>
    {activeWindow?.name === "create" && customer && <CreateDialog onClose={() => setWindow(null)} onDone={(ticket) => finish(`${ticketCode(ticket.id)} aberto com sucesso`)} />}
    {activeWindow?.name === "person" && admin && <PersonDialog onClose={() => setWindow(null)} onDone={() => finish("Conta cadastrada")} />}
    {activeWindow?.name === "customer" && !customer && <CustomerDialog organizations={data.organizations} editing={activeWindow.item} canChangeEmail={admin} onEdited={() => finish("Cliente atualizado")} onClose={() => setWindow(null)} onDone={(item) => {
      addCustomer(item);
      setWindow(null);
      setFlash("Cliente cadastrado");
    }} />}
    {activeWindow?.name === "organization" && admin && <OrganizationDialog editing={activeWindow.item} onClose={() => setWindow(null)} onDone={() => finish(activeWindow.item ? "Organização atualizada" : "Organização cadastrada")} />}
    {activeWindow?.name === "accountStatus" && admin && <AccountStatus account={activeWindow.item} onClose={() => setWindow(null)} onDone={() => finish("Conta atualizada")} />}
    {activeWindow?.name === "password" && <PasswordDialog onClose={() => setWindow(null)} onDone={() => finish("Senha atualizada")} />}
  </div>;
}

function TicketLink({ id, onOpen, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "id" | "href" | "onClick"> & { id: number; onOpen: (id: number) => void }) {
  return <a {...props} href={ticketHref(id)} onClick={(event) => {
    if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    onOpen(id);
  }} />;
}

function OverviewMetric({ label, value, icon, detail, selected, onClick }: {
  label: string; value: number; icon: IconName; detail?: string; selected: boolean; onClick: () => void;
}) {
  return <button type="button" className="overview-metric" aria-pressed={selected} aria-controls="queue-results" onClick={onClick}>
    <span className="overview-metric-icon"><Icon name={icon} /></span>
    <strong>{value}</strong>
    <span className="overview-metric-label">{label}</span>
    {detail && <small>{detail}</small>}
    {selected && <Icon name="check" />}
  </button>;
}

function OverviewAside({ tickets, critical, staff, onOpen, onAssistant }: {
  tickets: Ticket[]; critical?: Ticket; staff: boolean; onOpen: (id: number) => void; onAssistant?: () => void;
}) {
  const attention = tickets.flatMap<{ ticket: Ticket; kind: "overdue" | "unread" }>((ticket) => {
    if (ticket.id === critical?.id) return [];
    if (staff && isOverdue(ticket)) return [{ ticket, kind: "overdue" }];
    return ticket.unreadReply ? [{ ticket, kind: "unread" }] : [];
  }).sort((a, b) => Number(b.kind === "overdue") - Number(a.kind === "overdue")).slice(0, critical ? 2 : 3);

  return <aside className="overview-aside" aria-label="Atalhos de atendimento">
    <section className="panel overview-attention">
      <h2>Precisa de atenção</h2>
      {critical && <div className="overview-critical">
        <span><Icon name="alert" />Prioridade crítica</span>
        <strong>{critical.title}</strong>
        <TicketLink id={critical.id} onOpen={onOpen} className="overview-critical-link">Abrir chamado<Icon name="arrow" /></TicketLink>
      </div>}
      {attention.length > 0 && <ul aria-label="Chamados em destaque">
        {attention.map(({ ticket, kind }) => <li key={ticket.id}>
          <TicketLink id={ticket.id} onOpen={onOpen} className="overview-alert-link">
            <span className="overview-alert-icon" data-kind={kind}><Icon name={kind === "overdue" ? "clock" : "chat"} /></span>
            <span><strong>{ticket.title}</strong><small>{ticketCode(ticket.id)} · {kind === "overdue" ? "SLA vencido" : "Nova resposta"}</small></span>
            <Icon name="chevron" />
          </TicketLink>
        </li>)}
      </ul>}
      {!critical && attention.length === 0 && <p className="overview-attention-empty"><Icon name="check" />Nenhum alerta no momento.</p>}
    </section>
    {onAssistant && <section className="overview-assistant">
      <span className="overview-assistant-icon"><Icon name="bot" /></span>
      <h2>Assistente de chamados</h2>
      <p>Descreva o problema para abrir um chamado por conversa.</p>
      <button className="button outline" onClick={onAssistant}>Abrir assistente<Icon name="arrow" /></button>
    </section>}
  </aside>;
}

function TicketList({ tickets, staff, filter, onOpen }: { tickets: Ticket[]; staff: boolean; filter: Filter; onOpen: (id: number) => void }) {
  if (!tickets.length) return <div className="empty"><span><Icon name="inbox" /></span><b>Nenhum chamado nesta seleção</b><p>Experimente outra aba ou ajuste os filtros.</p></div>;
  return <ul className="ticket-list" role="list" aria-label="Chamados">
    {tickets.map((ticket) => {
      const unassigned = ticket.status === "Aberto" && ticket.assigneeId === null;
      return <li key={ticket.id} className="ticket-list-item">
        <TicketLink id={ticket.id} onOpen={onOpen} className={ticket.unreadReply ? "ticket-link ticket-unread" : "ticket-link"}>
          <span className="ticket-subject">
            <strong>{ticket.title}</strong>
            <span className="ticket-meta">
              <span className="ticket-code">{ticketCode(ticket.id)}</span>
              {(!unassigned || filter !== "waitingAgent") && <span>{unassigned && staff ? "Não atribuído" : ticket.status}</span>}
              {!staff && !ticket.viewerOwns && <span>Em cópia</span>}
              {ticket.unreadReply && <ReplyBadge ticket={ticket} compact />}
              {staff && isOverdue(ticket) && <span className="ticket-overdue">SLA vencido</span>}
            </span>
          </span>
          <time className="ticket-updated" dateTime={ticket.updatedAt} title="Última atualização">{formatDate(ticket.updatedAt)}</time>
          <Icon name="chevron" />
        </TicketLink>
      </li>;
    })}
  </ul>;
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (ticket: Ticket) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ fields: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const serialized = JSON.stringify(fields);
    if (request.current?.fields !== serialized) request.current = { fields: serialized, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const { ticket } = await api<{ ticket: Ticket }>({ ...fields, action: "create", key: request.current.key });
      await onDone(ticket);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return <Modal title="Novo chamado" onClose={onClose}>
    <form className="form-stack modal-content" onSubmit={submit}>
      <label>Título<input name="title" minLength={5} maxLength={100} placeholder="Ex.: Não consigo acessar o e-mail" required autoFocus /></label>
      <label>Descrição<textarea name="description" rows={5} minLength={8} maxLength={3000} placeholder="O que aconteceu e qual sistema foi afetado?" required /></label>
      <CopiesField />
      <div className="field-row"><label>Categoria<select name="category" defaultValue="Outros">{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Prioridade<select name="priority" defaultValue="Média">{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label></div>
      <div className="email-options">
        <label className="check-line"><input name="notifyByEmail" type="checkbox" value="true" />Receber notificações por e-mail</label>
        <label className="check-line"><input name="receiveEmailReplies" type="checkbox" value="true" />Permitir responder por e-mail</label>
        <small className="muted">O envio e o recebimento dependem do provedor configurado.</small>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Abrindo…" : "Abrir chamado"}</button></div>
    </form>
  </Modal>;
}

function PersonDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api({ ...fields, action: "person" });
      await onDone();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }
  return <Modal title="Cadastrar pessoa" onClose={onClose}>
    <form className="form-stack modal-content" onSubmit={submit}>
      <label>Nome<input name="name" minLength={2} maxLength={80} required autoFocus /></label>
      <label>E-mail<input name="email" type="email" maxLength={254} required /></label>
      <div className="field-row"><label>Perfil<select name="role" defaultValue="tecnico">{roles.filter((role) => role !== "cliente").map((role) => <option value={role} key={role}>{roleNames[role]}</option>)}</select></label>
        <label>Senha inicial<input name="password" minLength={12} maxLength={128} type="password" autoComplete="new-password" placeholder="12 caracteres ou mais" required /></label></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Cadastrando…" : "Cadastrar"}</button></div>
    </form>
  </Modal>;
}

type Message = { id: number; author: "assistant" | "me"; text?: string; ticket?: Ticket };
const beginning: Message[] = [{ id: 0, author: "assistant", text: "O que aconteceu? Conte qual sistema ou equipamento foi afetado e o que você estava tentando fazer." }];

function Assistant({ snapshot, onOpen, refresh }: { snapshot: Snapshot; onOpen: (id: number) => void; refresh: () => Promise<void> }) {
  const [messages, setMessages] = useState(beginning);
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ report: string; key: string } | null>(null);
  const sequence = useRef(0);
  const area = useRef<HTMLDivElement>(null);
  const enabled = snapshot.aiConfigured || snapshot.demo;

  useEffect(() => {
    if (area.current) area.current.scrollTop = area.current.scrollHeight;
  }, [messages, busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inputText = input.trim();
    const report = context ? `${context}\n${inputText}` : inputText;
    if (!inputText || busy) return;
    if (report.length > 3000) {
      setError("O relato completo precisa ter até 3.000 caracteres. Você pode iniciar outra conversa.");
      return;
    }
    const message = { id: ++sequence.current, author: "me", text: inputText } as const;
    if (request.current?.report !== report) request.current = { report, key: crypto.randomUUID() };
    setMessages((items) => [...items, message]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ question: string } | { ticket: Ticket }>({ action: "assistant", report, key: request.current.key });
      const id = ++sequence.current;
      if ("question" in result) {
        setContext(report);
        setMessages((items) => [...items, { id, author: "assistant", text: result.question }]);
      } else {
        setContext("");
        setMessages((items) => [...items, { id, author: "assistant", ticket: result.ticket }]);
        try { await refresh(); } catch { setError("O chamado foi criado. Recarregue a página para atualizar a fila."); }
      }
      request.current = null;
    } catch (reason) {
      setMessages((items) => items.filter((item) => item.id !== message.id));
      setInput(inputText);
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="assistant-layout">
    <section className="panel chat-panel" aria-label="Conversa com o assistente">
      <div className="chat-header"><span className="chat-mark"><Icon name="chat" /></span><div><b>Assistente TicketHub</b><small>{snapshot.aiConfigured ? "Triagem com IA" : snapshot.demo ? "Triagem simulada" : "Indisponível"}</small></div>
        {messages.length > 1 && <button className="button outline" disabled={busy} onClick={() => { setMessages(beginning); setContext(""); setInput(""); setError(""); request.current = null; }}>Nova conversa</button>}</div>
      <div className="messages" ref={area} role="log" aria-label="Mensagens">
        {messages.map((message) => <div className={`message ${message.author}`} key={message.id}>
          <small>{message.author === "assistant" ? "Assistente" : "Você"}</small>
          {message.text && <p>{message.text}</p>}
          {message.ticket && <div className="chat-receipt">
            <div className="receipt-top"><span className="ticket-code">{ticketCode(message.ticket.id)}</span><Tag value={message.ticket.status} /></div>
            <div className="chat-receipt-confirmation"><Icon name="check" />Chamado registrado</div>
            <b>{message.ticket.title}</b><span>{message.ticket.category} · Prioridade {message.ticket.priority.toLowerCase()}</span>
            <TicketLink id={message.ticket.id} onOpen={onOpen} className="chat-link">Acompanhar chamado <Icon name="arrow" /></TicketLink>
          </div>}
        </div>)}
        {busy && <div className="message assistant"><small>Assistente</small><p>Organizando seu relato…</p></div>}
      </div>
      <form className="composer" onSubmit={submit}>
        {error && <p className="error" role="alert">{error}</p>}
        <div><textarea aria-label="Descreva o problema" rows={2} placeholder="Descreva o que aconteceu" maxLength={3000} value={input} disabled={!enabled || busy} onChange={(event) => setInput(event.target.value)} />
          <button className="button primary" type="submit" aria-label="Enviar relato" disabled={!enabled || busy || !input.trim()}><Icon name="send" /></button></div>
        <small>{enabled ? "O chamado é aberto assim que o relato estiver completo. Evite incluir senhas." : "Abra um chamado pelo formulário enquanto o assistente estiver indisponível."}</small>
      </form>
    </section>
    <aside className="panel chat-guide"><h2>O que incluir no relato</h2>
      <ol><li>O sistema ou equipamento afetado</li><li>O que você tentou fazer</li><li>A mensagem de erro, se houver</li></ol>
      <div className="example"><b>Exemplo</b><p>Minha VPN cai quando entro em uma reunião. Começou hoje de manhã e só acontece no notebook da empresa.</p>
        <button className="chat-link" onClick={() => setInput("Minha VPN cai quando entro em uma reunião. Começou hoje de manhã e só acontece no notebook da empresa.")} disabled={!enabled || busy}>Usar exemplo <Icon name="arrow" /></button></div>
    </aside>
  </div>;
}
