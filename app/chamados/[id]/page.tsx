import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentUser, detail, sessionCookie, ticketControls } from "@/lib/store";
import { TicketPage } from "../../ticket-workspace";

export default async function TicketDetailsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id: segment } = await params;
  const id = Number(segment);
  if (!/^\d+$/.test(segment) || !Number.isSafeInteger(id) || id < 1) notFound();

  const user = currentUser((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect(`/?chamado=${id}`);

  const ticket = detail(user, id);
  if (!ticket) notFound();
  return <TicketPage initial={ticket} user={user} {...ticketControls(user)} />;
}
