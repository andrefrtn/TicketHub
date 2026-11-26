"use client";

import { useRef, useState, type FormEvent } from "react";
import { attachmentLimits, categories, priorities, type Customer, type Department, type Organization, type Ticket } from "@/lib/model";
import { api, CopiesField, errorText, Icon, Modal } from "./ui-kit";

export function StaffTicketForm({ customers, organizations, departments, onCancel, onDone, onCustomer, onSubmitTicket }: {
  customers: Customer[]; organizations: Organization[]; departments: Department[]; onCancel: () => void;
  onDone: (ticket: Ticket) => Promise<void>; onCustomer: (customer: Customer) => void; onSubmitTicket: () => void;
}) {
  const [search, setSearch] = useState("");
  const [requester, setRequester] = useState("");
  const [creating, setCreating] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ fields: string; key: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const needle = search.trim().toLocaleLowerCase("pt-BR");
  const matches = customers.filter((item) => item.active && (String(item.id) === requester || [item.name, item.email, item.organization].some((value) => value?.toLocaleLowerCase("pt-BR").includes(needle))));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requester || busy) return;
    const body = new FormData(event.currentTarget);
    body.delete("uploads");
    body.set("action", "create");
    const signature = JSON.stringify([Array.from(body), files.map((file) => [file.name, file.size, file.lastModified])]);
    if (request.current?.fields !== signature) request.current = { fields: signature, key: crypto.randomUUID() };
    body.set("key", request.current.key);
    for (const file of files) body.append("attachments", file);
    setBusy(true);
    setError("");
    onSubmitTicket();
    try {
      const { ticket } = await api<{ ticket: Ticket }>(body);
      await onDone(ticket);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <header className="page-heading staff-heading"><div><h1>Novo chamado</h1><p>Registre uma solicitação em nome de um cliente.</p></div></header>
    <form className="panel staff-form" onSubmit={submit}>
      <fieldset>
        <legend>Dados principais</legend>
        <div className="staff-client">
          <label>Pesquisar cliente<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou e-mail" /></label>
          <button type="button" className="button outline" onClick={() => setCreating(true)}><Icon name="plus" />Criar cliente</button>
        </div>
        <label>Cliente<select name="requesterId" value={requester} onChange={(event) => setRequester(event.target.value)} required>
          <option value="" disabled>{matches.length ? "Selecione um cliente" : "Nenhum cliente encontrado"}</option>
          {matches.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.email}</option>)}
        </select></label>
        <div className="staff-two">
          <label>Departamento<select name="department" defaultValue="" required><option value="" disabled>Selecione um departamento</option>{departments.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
          <label>Assunto<input name="title" minLength={5} maxLength={100} required placeholder="Resumo do problema" /></label>
        </div>
        <CopiesField />
      </fieldset>
      <fieldset>
        <legend>Detalhes do chamado</legend>
        <label>Mensagem<textarea name="description" minLength={8} maxLength={3000} rows={6} required placeholder="Descreva o problema, o impacto e o que já foi tentado" /></label>
        <div className="staff-two staff-classification">
          <label>Prioridade<select name="priority" defaultValue="" required><option value="" disabled>Selecione a prioridade</option>{priorities.map((item) => <option value={item} key={item}>{item === "Urgente" ? "Crítica" : item}</option>)}</select></label>
          <details className="staff-extra"><summary>Mais opções <Icon name="down" /></summary><label>Categoria<select name="category" defaultValue="Outros">{categories.map((item) => <option key={item}>{item}</option>)}</select></label></details>
        </div>
        <div className="email-options" aria-label="Preferências de e-mail">
          <label><input type="checkbox" name="receiveEmailReplies" value="true" defaultChecked />Receber respostas do cliente por e-mail</label>
          <label><input type="checkbox" name="notifyByEmail" value="true" defaultChecked />Enviar notificações por e-mail ao cliente</label>
          <small>Chamados abertos pela equipe ficam internos. As pessoas em cópia podem acompanhar e receber atualizações.</small>
        </div>
        <div className="attachment-picker">
          <input ref={fileInput} type="file" name="uploads" multiple hidden onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            const next = [...files, ...picked];
            if (next.length > attachmentLimits.count || next.some((file) => !file.size || file.size > attachmentLimits.bytes)) {
              setError("Selecione até 3 arquivos de até 5 MB cada.");
              return;
            }
            setFiles(next);
            setError("");
          }} />
          <button type="button" className="button outline" onClick={() => fileInput.current?.click()}><Icon name="clip" />Anexar arquivos</button>
          <small>Até 3 arquivos de 5 MB cada</small>
          {files.length > 0 && <ul className="attachment-list">{files.map((file, index) => <li key={`${file.name}-${index}`}>
            <span>{file.name}</span><button type="button" className="icon-button" aria-label={`Remover ${file.name}`} onClick={() => setFiles((items) => items.filter((_, position) => position !== index))}><Icon name="close" /></button>
          </li>)}</ul>}
        </div>
      </fieldset>
      {error && <p className="error staff-error" role="alert">{error}</p>}
      <footer className="staff-actions"><button type="button" className="button outline" onClick={onCancel}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Criando…" : "Criar chamado"}</button></footer>
    </form>
    {creating && <CustomerDialog organizations={organizations} onClose={() => setCreating(false)} onDone={(item) => {
      onCustomer(item);
      setRequester(String(item.id));
      setSearch("");
      setCreating(false);
    }} />}
  </>;
}

export function CustomerDialog({ organizations, onClose, onDone, editing, onEdited, canChangeEmail = false }: { organizations: Organization[]; onClose: () => void; onDone?: (customer: Customer) => void; editing?: Customer; onEdited?: () => Promise<void>; canChangeEmail?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      if (editing) {
        await api({ ...fields, action: "editCustomer", id: editing.id });
        await onEdited?.();
      } else {
        const { customer } = await api<{ customer: Customer }>({ ...fields, action: "customer" });
        onDone?.(customer);
      }
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }
  return <Modal title={editing ? "Editar cliente" : "Novo cliente"} onClose={onClose} wide>
    <form className="staff-form customer-form" onSubmit={submit}>
      <fieldset>
        <legend>Dados principais</legend>
        <div className="staff-two">
          <label>Nome<input name="name" minLength={2} maxLength={80} autoComplete="off" defaultValue={editing?.name} required data-dialog-focus /></label>
          <label>E-mail<input name="email" type="email" maxLength={254} autoComplete="off" defaultValue={editing?.email} readOnly={Boolean(editing && !canChangeEmail)} required />
            {editing && !canChangeEmail && <small>Somente administradores alteram o e-mail de acesso.</small>}</label>
          {!editing && <label>Senha inicial<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} placeholder="Pelo menos 12 caracteres" required /></label>}
          <label>Telefone<input name="phone" type="tel" maxLength={42} autoComplete="off" defaultValue={editing?.phone ?? ""} /></label>
          <label>Organização<select name="organizationId" defaultValue={editing?.organizationId ?? ""}><option value="">Sem organização</option>{organizations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>Identificador interno<input name="externalId" maxLength={120} defaultValue={editing?.externalId ?? ""} /><small>Referência do cliente em outro sistema</small></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Campos adicionais</legend>
        <div className="staff-two">
          <label>Equipamento<input name="equipment" maxLength={140} defaultValue={editing?.equipment ?? ""} /></label>
          <label>Localidade<input name="location" maxLength={120} placeholder="Cidade ou unidade" defaultValue={editing?.location ?? ""} /></label>
        </div>
      </fieldset>
      {error && <p className="error staff-error" role="alert">{error}</p>}
      <footer className="staff-actions"><button type="button" className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Salvando…" : editing ? "Salvar cliente" : "Criar cliente"}</button></footer>
    </form>
  </Modal>;
}

export function OrganizationDialog({ onClose, onDone, editing }: { onClose: () => void; onDone: () => Promise<void>; editing?: Organization }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    setBusy(true);
    setError("");
    try {
      await api({ action: "organization", name, id: editing?.id });
      await onDone();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }
  return <Modal title={editing ? "Editar organização" : "Nova organização"} onClose={onClose}><form className="form-stack modal-content" onSubmit={submit}>
    <label>Nome da empresa<input name="name" minLength={2} maxLength={100} defaultValue={editing?.name} required data-dialog-focus /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button outline" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Salvando…" : editing ? "Salvar organização" : "Criar organização"}</button></div>
  </form></Modal>;
}
