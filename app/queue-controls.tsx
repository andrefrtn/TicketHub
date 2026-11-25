"use client";

import { useRef, useState } from "react";
import { Drawer } from "vaul";
import { statuses, type Snapshot, type Status } from "@/lib/model";
import { Icon } from "./ui-kit";

export type StatusFilter = "" | Status | "overdue" | "unread";
export const defaultQueueFilters = {
  organization: "",
  department: "",
  assignee: "",
  order: "recent",
  status: "" as StatusFilter,
};

type Props = {
  data: Pick<Snapshot, "organizations" | "departments" | "team">;
  staff: boolean;
  value: typeof defaultQueueFilters;
  onChange: (value: typeof defaultQueueFilters) => void;
};

function FilterFields({ data, staff, value, onChange }: Props) {
  return <>
    {staff && <>
      <label><span>Empresa</span>
        <select value={value.organization} onChange={(event) => onChange({ ...value, organization: event.target.value })}>
          <option value="">Todas as empresas</option>
          {data.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label><span>Departamento</span>
        <select value={value.department} onChange={(event) => onChange({ ...value, department: event.target.value })}>
          <option value="">Todos os departamentos</option>
          {data.departments.map((item) => <option key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label><span>Técnico</span>
        <select value={value.assignee} onChange={(event) => onChange({ ...value, assignee: event.target.value })}>
          <option value="">Todos os técnicos</option>
          {data.team.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </>}
    <label><span>Status</span>
      <select value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as StatusFilter })}>
        <option value="">Todos os status</option>
        <option value="unread">Novas respostas</option>
        {statuses.map((item) => <option key={item}>{item}</option>)}
        {staff && <option value="overdue">SLA em atraso</option>}
      </select>
    </label>
    <label><span>Ordenação</span>
      <select value={value.order} onChange={(event) => onChange({ ...value, order: event.target.value })}>
        <option value="recent">Atualizados primeiro</option>
        <option value="old">Mais antigos</option>
        <option value="priority">Maior prioridade</option>
      </select>
    </label>
  </>;
}

export function QueueControls({ data, staff, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = [value.status, value.organization, value.department, value.assignee].filter(Boolean).length
    + Number(value.order !== defaultQueueFilters.order);

  return <Drawer.Root open={open} onOpenChange={(next) => {
      if (next) setDraft(value);
      setOpen(next);
    }} autoFocus handleOnly closeThreshold={0.35}>
      <Drawer.Trigger asChild>
        <button ref={trigger} type="button" className="button outline queue-filter-trigger" data-filtered={count > 0 || undefined} aria-label={count ? `Filtros (${count} ${count === 1 ? "ativo" : "ativos"})` : "Filtros"}>
          <Icon name="filter" /> Filtros {count > 0 && <span aria-hidden="true">{count}</span>}
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="filter-sheet-overlay" />
        <Drawer.Content className="filter-sheet" aria-describedby={undefined} onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}>
          <Drawer.Handle className="filter-sheet-handle" />
          <header className="filter-sheet-heading">
            <Drawer.Title>Filtros de chamados</Drawer.Title>
            <Drawer.Close asChild><button type="button" className="icon-button" aria-label="Fechar filtros"><Icon name="close" /></button></Drawer.Close>
          </header>
          <form onSubmit={(event) => {
            event.preventDefault();
            onChange(draft);
            setOpen(false);
          }}>
            <div className="filter-sheet-fields"><FilterFields data={data} staff={staff} value={draft} onChange={setDraft} /></div>
            <footer className="filter-sheet-actions">
              <button type="button" className="button outline" onClick={() => setDraft(defaultQueueFilters)}>Limpar</button>
              <button type="submit" className="button primary">Aplicar filtros</button>
            </footer>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>;
}
