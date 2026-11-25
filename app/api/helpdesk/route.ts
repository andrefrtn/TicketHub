import { NextRequest, NextResponse } from "next/server";
import { field, interpret, parseDraft, text } from "@/lib/assistant";
import { attachmentLimits, categories, priorities, roles, statuses, ticketCopyLimit } from "@/lib/model";
import { authenticate, auditLog, changePassword, changeTicketCopy, comment, confirmResolution, createCustomer, createOrganization, createPerson, createTicket, currentUser, demo, demoSession, detail, editCustomer, editOrganization, endSession, existingTicket, markTicketRead, rateTicket, readAttachment, reopenTicket, requestPasswordReset, resetPassword, saveContent, saveDepartment, savePolicy, sessionCookie, sessionSeconds, setAccountActive, snapshot, updateTicket } from "@/lib/store";

export const runtime = "nodejs";

const attempts = new Map<string, { hits: number; until: number }>();

function rateLimited(key: string, limit: number) {
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.until > now) return ++record.hits > limit;
  if (attempts.size >= 1024) {
    for (const [entry, attempt] of attempts) if (attempt.until <= now) attempts.delete(entry);
    if (attempts.size >= 1024) return true;
  }
  attempts.set(key, { hits: 1, until: now + 60_000 });
  return false;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (data: object) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });

function ticketId(value: unknown) {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function GET(request: NextRequest) {
  const user = currentUser(request.cookies.get(sessionCookie)?.value);
  if (!user) return fail("Entre para acessar a central", 401);
  if (request.nextUrl.searchParams.get("audit") === "1") {
    return user.role === "admin" ? ok({ entries: auditLog() }) : fail("Apenas administradores podem consultar a auditoria", 403);
  }
  const rawId = request.nextUrl.searchParams.get("id");
  const download = request.nextUrl.searchParams.get("attachment");
  if (download !== null) {
    const id = ticketId(rawId);
    const attachmentId = ticketId(download);
    const attachment = id && attachmentId ? readAttachment(user, id, attachmentId) : null;
    if (!attachment) return fail("Anexo não encontrado", 404);
    const encoded = encodeURIComponent(attachment.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
    return new NextResponse(Buffer.from(attachment.content), { headers: {
      "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  }
  if (rawId === null) return ok(snapshot(user));
  const id = ticketId(rawId);
  const result = id ? detail(user, id) : null;
  return result ? ok(result) : fail("Chamado não encontrado", 404);
}

function identity(data: Record<string, unknown>) {
  const name = text(data.name, 2, 80);
  const email = text(data.email, 3, 254)?.toLowerCase();
  return name && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { name, email } : null;
}

function accountFields(data: Record<string, unknown>) {
  const account = identity(data);
  const password = text(data.password, 12, 128);
  return account && password ? { ...account, password } : null;
}

function emailOption(value: unknown) {
  return value === true || value === "true";
}

function copyAddress(value: unknown) {
  const email = text(value, 3, 254)?.toLowerCase();
  return email && /^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/.test(email) ? email : null;
}

function copyList(value: unknown) {
  if (value == null || value === "") return [];
  if (typeof value !== "string" || value.length > 2800) return null;
  const copies = [...new Set(value.split(/[,;\n]+/).filter((item) => item.trim()).map(copyAddress))];
  return copies.length <= ticketCopyLimit && !copies.includes(null) ? copies as string[] : null;
}

function attachmentName(name: string) {
  return Array.from(name, (char) => {
    const code = char.codePointAt(0)!;
    return char === "/" || char === "\\" || code < 32 || code === 127 ? "_" : char;
  }).slice(0, 180).join("").trim() || "anexo";
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) return fail("Origem inválida", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail("Origem inválida", 403);
  const contentType = request.headers.get("content-type") ?? "";
  const token = request.cookies.get(sessionCookie)?.value;
  const multipart = contentType.startsWith("multipart/form-data;");
  if (!multipart && !contentType.startsWith("application/json")) return fail("Formato de envio inválido", 415);

  let data: Record<string, unknown>;
  let files: File[] = [];
  try {
    if (multipart) {
      const actor = currentUser(token);
      if (!actor) return fail("Sua sessão expirou. Entre novamente", 401);
      if (actor.role === "cliente") return fail("Anexos neste formulário são enviados pela equipe de suporte", 403);
      const length = Number(request.headers.get("content-length"));
      if (!Number.isSafeInteger(length) || length <= 0 || length > attachmentLimits.bytes * attachmentLimits.count + 24_000) return fail("Envio acima do limite de anexos", 413);
      const form = await request.formData();
      files = form.getAll("attachments").filter((item): item is File => typeof item !== "string" && item.size > 0);
      if (files.length > attachmentLimits.count || files.some((file) => file.size > attachmentLimits.bytes)) return fail("Anexe até 3 arquivos de até 5 MB cada", 413);
      form.delete("attachments");
      data = Object.fromEntries(form);
      if (data.action !== "create") return fail("Envio de anexos fora do formulário de chamado");
    } else {
      const raw = await request.text();
      if (raw.length > 20_000) return fail("Solicitação longa demais", 413);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Dados inválidos");
      data = parsed as Record<string, unknown>;
    }
  } catch {
    return fail("Dados inválidos");
  }

  const setSession = (value: string, maxAge: number) => {
    const response = ok({ success: true });
    response.cookies.set(sessionCookie, value, {
      httpOnly: true, secure: !demo || origin?.startsWith("https:") === true, sameSite: "lax", path: "/", maxAge,
    });
    return response;
  };

  if (data.action === "login") {
    const email = text(data.email, 3, 254)?.toLowerCase();
    const password = text(data.password, 1, 128);
    if (!email || !password) return fail("Informe seu e-mail e sua senha");
    if (rateLimited("login", 60) || rateLimited(`login:${email}`, 8)) return fail("Aguarde um minuto para tentar novamente", 429);
    const next = authenticate(email, password);
    if (!next) return fail("E-mail ou senha inválidos", 401);
    endSession(token);
    return setSession(next, sessionSeconds);
  }
  if (data.action === "demo") {
    if (!demo || !field(data.role, roles)) return fail("Acesso demonstrativo indisponível", 403);
    if (rateLimited("demo", 60)) return fail("Aguarde um minuto para tentar novamente", 429);
    const next = demoSession(data.role);
    if (!next) return fail("Conta de demonstração indisponível", 503);
    endSession(token);
    return setSession(next, sessionSeconds);
  }
  if (data.action === "logout") {
    endSession(token);
    return setSession("", 0);
  }
  if (data.action === "recover") {
    const base = process.env.TICKETHUB_BASE_URL;
    if (!base || (process.env.TICKETHUB_MAIL_SECRET?.length ?? 0) < 32) return fail("A recuperação por e-mail não está configurada", 503);
    let link: URL;
    try {
      link = new URL(base);
      if (link.protocol !== "https:" && !(demo && link.protocol === "http:" && ["localhost", "127.0.0.1"].includes(link.hostname))) throw new Error();
    } catch {
      return fail("A recuperação por e-mail não está configurada", 503);
    }
    const email = text(data.email, 3, 254)?.toLowerCase();
    if (!email) return fail("Informe o seu e-mail");
    if (!rateLimited("recover", 30) && !rateLimited(`recover:${email}`, 2)) requestPasswordReset(email, link.origin);
    return ok({ success: true });
  }
  if (data.action === "resetPassword") {
    const code = text(data.code, 64, 64);
    const password = text(data.password, 12, 128);
    if (rateLimited("resetPassword", 30)) return fail("Aguarde um minuto para tentar novamente", 429);
    if (!code || !/^[a-f0-9]{64}$/.test(code) || !password || !resetPassword(code, password)) return fail("Confira a senha e use um link de recuperação válido");
    return setSession("", 0);
  }

  const user = currentUser(token);
  if (!user) return fail("Sua sessão expirou. Entre novamente", 401);

  switch (data.action) {
    case "create": {
      const draft = parseDraft({ ...data, category: data.category ?? (user.role === "cliente" ? null : categories[4]) });
      const key = text(data.key, 16, 64);
      const copies = copyList(data.copies);
      if (!draft || !key) return fail("Revise o assunto, a mensagem e a prioridade do chamado");
      if (!copies) return fail(`Informe até ${ticketCopyLimit} e-mails válidos em cópia`);
      if (user.role === "cliente") {
        if (data.requesterId != null) return fail("Você só pode abrir chamados na sua conta", 403);
        return ok({ ticket: createTicket(user, draft, "manual", key, { email: {
          receiveEmailReplies: emailOption(data.receiveEmailReplies), notifyByEmail: emailOption(data.notifyByEmail),
        }, copies }) });
      }
      const requesterId = ticketId(data.requesterId);
      const department = text(data.department, 2, 100);
      if (!requesterId || !department) return fail("Selecione um cliente e um departamento");
      const uploads = await Promise.all(files.map(async (file) => ({
        name: attachmentName(file.name),
        content: new Uint8Array(await file.arrayBuffer()),
      })));
      const ticket = createTicket(user, draft, "manual", key, {
        staff: { requesterId, department, receiveEmailReplies: emailOption(data.receiveEmailReplies), notifyByEmail: emailOption(data.notifyByEmail) },
        uploads, copies,
      });
      return ticket ? ok({ ticket }) : fail("Selecione um cliente ativo e um departamento cadastrado");
    }
    case "assistant": {
      const report = text(data.report, 1, 3000);
      const key = text(data.key, 16, 64);
      if (!report || !key) return fail("Escreva um relato de até 3.000 caracteres");
      const saved = existingTicket(user, key);
      if (saved) return ok({ ticket: saved });
      if (!process.env.OPENAI_API_KEY && !demo) return fail("Assistente indisponível. Abra um chamado pelo formulário", 503);
      if (rateLimited(`assistant:${user.id}`, 8)) return fail("Aguarde um minuto para enviar outro relato", 429);
      try {
        const result = await interpret(report, process.env.OPENAI_API_KEY);
        if ("question" in result) return ok(result);
        return ok({ ticket: createTicket(user, result.draft, "assistente", key) });
      } catch {
        return fail("O assistente está indisponível no momento. Tente novamente ou use o formulário", 502);
      }
    }
    case "comment": {
      const id = ticketId(data.id);
      const body = text(data.body, 1, 2000);
      if (!id || !body) return fail("Escreva um comentário de até 2.000 caracteres");
      const internal = data.internal === true;
      if (internal && user.role === "cliente") return fail("Somente a equipe pode registrar notas internas", 403);
      return comment(user, id, body, internal) ? ok({ success: true }) : fail("Chamado não encontrado", 404);
    }
    case "copyAdd":
    case "copyRemove": {
      const id = ticketId(data.id);
      const email = copyAddress(data.email);
      if (!id || !email) return fail("Informe um e-mail válido");
      const result = changeTicketCopy(user, id, email, data.action === "copyAdd");
      if (result === "missing") return fail("Chamado não encontrado", 404);
      if (result === "forbidden") return fail("Seu acesso a este chamado é somente para acompanhamento", 403);
      if (result === "requester") return fail("O solicitante já acompanha este chamado", 409);
      if (result === "limit") return fail(`Este chamado já tem ${ticketCopyLimit} e-mails em cópia`, 409);
      return ok({ success: true });
    }
    case "markRead": {
      const id = ticketId(data.id);
      const replyId = ticketId(data.replyId);
      return id && replyId && markTicketRead(user, id, replyId) ? ok({ success: true }) : fail("Resposta não encontrada", 404);
    }
    case "update": {
      const id = ticketId(data.id);
      const assigneeId = data.assigneeId === null ? null : ticketId(data.assigneeId);
      if (!id || (data.assigneeId !== null && assigneeId === null) || !field(data.status, statuses) || !field(data.priority, priorities)) return fail("Confira os dados do chamado");
      const department = data.department === undefined ? undefined : data.department === null ? null : text(data.department, 2, 100);
      if (data.department != null && department === null) return fail("Departamento inválido");
      const result = updateTicket(user, id, { status: data.status, priority: data.priority, assigneeId, department, resolution: text(data.resolution, 8, 2000) ?? undefined });
      if (result === "missing") return fail("Chamado não encontrado", 404);
      if (result === "forbidden") return fail("Você não pode alterar este chamado", 403);
      if (result === "invalid") return fail("Selecione um técnico disponível");
      if (result === "department") return fail("Selecione um departamento cadastrado");
      if (result === "solution") return fail("Registre a solução em pelo menos 8 caracteres");
      if (result === "reopen") return fail("Use a ação Reabrir chamado para registrar o motivo");
      return ok({ success: true });
    }
    case "finalize": {
      const id = ticketId(data.id);
      if (!id) return fail("Chamado inválido");
      if (user.role === "cliente") return fail("Somente a equipe de suporte pode finalizar chamados", 403);
      const result = updateTicket(user, id, { finalize: true, resolution: text(data.resolution, 8, 2000) ?? undefined });
      if (result === "missing") return fail("Chamado não encontrado", 404);
      if (result === "forbidden") return fail("O chamado está atribuído a outro técnico", 403);
      if (result === "solution") return fail("Registre a solução em pelo menos 8 caracteres");
      return result === "ok" ? ok({ success: true }) : fail("Não foi possível finalizar o chamado");
    }
    case "reopen": {
      const id = ticketId(data.id);
      const reason = text(data.reason, 5, 1000);
      if (!id || !reason) return fail("Explique por que o chamado precisa ser reaberto");
      const result = reopenTicket(user, id, reason);
      if (result === "missing") return fail("Chamado não encontrado", 404);
      if (result === "forbidden") return fail("Você não pode reabrir este chamado", 403);
      if (result === "state") return fail("O chamado já está aberto", 409);
      return ok({ success: true });
    }
    case "rate": {
      const id = ticketId(data.id);
      const score = ticketId(data.score);
      if (user.role !== "cliente") return fail("Somente o solicitante pode avaliar o atendimento", 403);
      if (!id || !score || score > 5 || (data.feedback && !text(data.feedback, 1, 500))) return fail("Selecione uma nota de 1 a 5");
      return rateTicket(user, id, score, text(data.feedback, 1, 500)) ? ok({ success: true }) : fail("Chamado indisponível para avaliação", 409);
    }
    case "confirmResolution": {
      const id = ticketId(data.id);
      if (user.role !== "cliente") return fail("Somente o solicitante pode confirmar a solução", 403);
      return id && confirmResolution(user, id) ? ok({ success: true }) : fail("Chamado indisponível para confirmação", 409);
    }
    case "changePassword": {
      const current = text(data.current, 1, 128);
      const password = text(data.password, 12, 128);
      if (rateLimited(`password:${user.id}`, 8)) return fail("Aguarde um minuto para tentar novamente", 429);
      if (!token || !current || !password || current === password) return fail("Use uma nova senha com pelo menos 12 caracteres");
      return changePassword(user, current, password, token) ? ok({ success: true }) : fail("Senha atual incorreta");
    }
    case "person": {
      if (user.role !== "admin") return fail("Apenas administradores podem cadastrar pessoas", 403);
      const account = accountFields(data);
      if (!account || !field(data.role, roles)) return fail("Confira os dados. A senha precisa ter pelo menos 12 caracteres");
      return createPerson({ name: account.name, email: account.email, role: data.role }, account.password, user) ? ok({ success: true }) : fail("Já existe uma conta com esse e-mail", 409);
    }
    case "customer":
    case "editCustomer": {
      if (user.role === "cliente") return fail("Apenas a equipe de suporte pode cadastrar clientes", 403);
      const editing = data.action === "editCustomer";
      const id = editing ? ticketId(data.id) : null;
      const account = identity(data);
      const password = text(data.password, 12, 128);
      if (!account || (editing ? !id : !password)) return fail(editing ? "Confira o nome e o e-mail do cliente" : "Confira os dados. A senha precisa ter pelo menos 12 caracteres");
      const organizationId = data.organizationId ? ticketId(data.organizationId) : null;
      if (data.organizationId && !organizationId) return fail("Selecione uma organização cadastrada");
      const limits = { phone: 42, externalId: 120, equipment: 140, location: 120 } as const;
      const fields = { phone: null, externalId: null, equipment: null, location: null, organizationId } as Parameters<typeof createCustomer>[2];
      for (const name of Object.keys(limits) as (keyof typeof limits)[]) {
        const value = data[name];
        if (value == null || value === "") continue;
        if (typeof value !== "string" || value.trim().length > limits[name]) return fail("Um dos campos do cliente está inválido");
        fields[name] = value.trim() || null;
      }
      if (id) {
        const result = editCustomer(user, id, account, fields);
        if (result === "missing") return fail("Cliente não encontrado", 404);
        if (result === "email") return fail("Somente administradores alteram o e-mail de acesso", 403);
        if (result === "organization") return fail("Selecione uma organização cadastrada");
        if (result === "duplicate") return fail("Já existe uma conta com esse e-mail", 409);
        return ok({ success: true });
      }
      const customer = createCustomer(account, password!, fields, user);
      if (customer === "organization") return fail("Selecione uma organização cadastrada");
      if (customer === "duplicate") return fail("Já existe uma conta com esse e-mail", 409);
      return ok({ customer });
    }
    case "organization": {
      if (user.role !== "admin") return fail("Apenas administradores podem cadastrar organizações", 403);
      const name = text(data.name, 2, 100);
      if (!name) return fail("Informe o nome da organização");
      if (data.id != null) {
        const id = ticketId(data.id);
        if (!id) return fail("Organização inválida");
        const result = editOrganization(user, id, name);
        if (result === "missing") return fail("Organização não encontrada", 404);
        if (result === "duplicate") return fail("Já existe uma organização com esse nome", 409);
        return ok({ success: true });
      }
      return createOrganization(name, user) ? ok({ success: true }) : fail("Já existe uma organização com esse nome", 409);
    }
    case "department": {
      if (user.role !== "admin") return fail("Somente administradores podem gerenciar departamentos", 403);
      const id = data.id == null ? null : ticketId(data.id);
      const name = text(data.name, 2, 100);
      if ((data.id != null && !id) || !name || !Array.isArray(data.members) || data.members.length > 500) return fail("Confira os dados do departamento");
      const members = [...new Set(data.members.map(ticketId))];
      if (members.includes(null)) return fail("Selecione técnicos válidos");
      const result = saveDepartment(user, id, name, members as number[]);
      if (result === "members") return fail("Selecione técnicos ativos");
      if (result === "duplicate") return fail("Já existe um departamento com esse nome", 409);
      return result === "ok" ? ok({ success: true }) : fail("Departamento não encontrado", 404);
    }
    case "active": {
      if (user.role !== "admin") return fail("Somente administradores podem ativar ou desativar contas", 403);
      const id = ticketId(data.id);
      if (!id || typeof data.active !== "boolean" || !setAccountActive(user, id, data.active)) return fail("Não foi possível alterar a conta");
      return ok({ success: true });
    }
    case "policy": {
      if (user.role !== "admin") return fail("Somente administradores podem definir prazos de SLA", 403);
      const responseMinutes = ticketId(data.responseMinutes);
      const resolutionMinutes = ticketId(data.resolutionMinutes);
      if (!field(data.priority, priorities) || !responseMinutes || !resolutionMinutes || resolutionMinutes < responseMinutes || resolutionMinutes > 43200) return fail("Informe prazos em minutos. A resolução deve ser igual ou posterior à primeira resposta");
      savePolicy(user, { priority: data.priority, responseMinutes, resolutionMinutes });
      return ok({ success: true });
    }
    case "article":
    case "template": {
      if (user.role !== "admin") return fail("Somente administradores podem gerenciar o conteúdo", 403);
      const id = data.id == null ? null : ticketId(data.id);
      const title = text(data.title, 3, 100);
      const body = text(data.body, 8, data.action === "article" ? 6000 : 2000);
      if ((data.id != null && !id) || !title || !body) return fail("Informe título e conteúdo");
      return saveContent(user, data.action, id, title, body, data.published === true) ? ok({ success: true }) : fail("Conteúdo não encontrado", 404);
    }
    default:
      return fail("Ação desconhecida");
  }
}
