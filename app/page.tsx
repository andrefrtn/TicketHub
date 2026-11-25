import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Hub, Login } from "./ui";
import { ResetPassword } from "./operations";
import { ticketHref } from "@/lib/model";
import { currentUser, demo, sessionCookie, snapshot } from "@/lib/store";

export default async function Home({ searchParams }: { searchParams: Promise<{ redefinir?: string; view?: string; chamado?: string }> }) {
  const { redefinir: code, view, chamado } = await searchParams;
  if (typeof code === "string" && /^[a-f0-9]{64}$/.test(code)) return <ResetPassword code={code} />;
  const user = currentUser((await cookies()).get(sessionCookie)?.value);
  if (user && typeof chamado === "string" && /^\d+$/.test(chamado) && Number.isSafeInteger(Number(chamado)) && Number(chamado) > 0) redirect(ticketHref(Number(chamado)));
  return user ? <Hub initial={snapshot(user)} initialView={view === "chamados" ? "tickets" : "overview"} /> : <Login demo={demo} />;
}
