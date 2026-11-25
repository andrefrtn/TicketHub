import Link from "next/link";
import { Brand } from "../../ui-kit";

export default function TicketNotFound() {
  return <main className="main ticket-unavailable">
    <Brand />
    <h1>Chamado indisponível</h1>
    <p>Confira o número do chamado ou volte à lista para localizar uma solicitação.</p>
    <Link className="button primary" href="/?view=chamados">Voltar para chamados</Link>
  </main>;
}
