import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sessionCookie } from "@/lib/store";
import { Brand } from "./ui-kit";
import "./globals.css";

export const metadata: Metadata = {
  title: "TicketHub — Central de suporte",
  description: "Central de chamados e atendimento técnico.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const hasSession = (await cookies()).has(sessionCookie);
  // Set the opening state before paint. Only a boolean from the request enters the script.
  const opening = `(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation ? navigation.type !== "navigate" : performance.navigation?.type > 0) return;
    const url = new URL(location.href);
    const ticket = /^\\/chamados\\/(\\d+)\\/?$/.exec(url.pathname);
    if (${hasSession} && (url.pathname === "/" || ticket) && url.searchParams.get("entrar") !== "1" && !url.searchParams.has("redefinir")) {
      document.documentElement.setAttribute("data-startup", "redirecting");
      url.pathname = "/";
      url.searchParams.set("entrar", "1");
      if (ticket) url.searchParams.set("chamado", ticket[1]);
      location.replace(url);
      return;
    }
    document.documentElement.setAttribute("data-startup", "opening");
  })();`;

  return <html lang="pt-BR" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: opening }} /></head>
    <body>
      <div className="startup-screen" aria-hidden="true"><Brand /></div>
      {children}
    </body>
  </html>;
}
