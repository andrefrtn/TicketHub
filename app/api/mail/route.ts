import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { text } from "@/lib/assistant";
import { completeMail, leaseMail, receiveMail } from "@/lib/store";

export const runtime = "nodejs";
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const hash = (key: string) => createHash("sha256").update(key).digest();

export async function POST(request: NextRequest) {
  const key = process.env.TICKETHUB_MAIL_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!key || key.length < 32 || !timingSafeEqual(hash(`Bearer ${key}`), hash(auth))) return json({ error: "Acesso negado" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Envie os dados em JSON" }, 415);
  let data: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 16_000) return json({ error: "Mensagem longa demais" }, 413);
    data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Dados inválidos" }, 400);
  } catch {
    return json({ error: "Dados inválidos" }, 400);
  }
  if (data.action === "next") return json({ message: leaseMail() });
  if (data.action === "complete") {
    const deliveryKey = text(data.deliveryKey, 48, 48);
    const id = data.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || !deliveryKey || typeof data.sent !== "boolean") return json({ error: "Envio inválido" }, 400);
    return completeMail(id, deliveryKey, data.sent) ? json({ success: true }) : json({ error: "Reserva de envio expirada" }, 409);
  }
  if (data.action === "reply") {
    const sender = text(data.sender, 3, 254)?.toLowerCase();
    const id = data.ticketId;
    const messageId = text(data.messageId, 1, 254);
    const body = text(data.body, 1, 2000);
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || !sender || !messageId || !body) return json({ error: "Resposta inválida" }, 400);
    return receiveMail(id, sender, messageId, body) ? json({ success: true }) : json({ error: "Chamado ou remetente não autorizado" }, 404);
  }
  return json({ error: "Ação desconhecida" }, 400);
}
