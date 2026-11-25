# TicketHub

Central de suporte em português, feita com Next.js, TypeScript e SQLite. O atendimento pode começar pelo formulário ou pela conversa com o assistente.

## Rodar localmente

Use Node.js 22.15 ou superior.

```powershell
npm ci
npm run dev
```

Abra [localhost:3000](http://localhost:3000). Na tela de entrada, escolha um dos perfis da demonstração. O banco inicial contém chamados fictícios e os dados ficam em `.data/demo.sqlite`.

| Perfil | Acesso |
| --- | --- |
| Cliente | Abre e comenta seus chamados. Também pode acompanhar os chamados em que seu e-mail está em cópia. |
| Técnico | Cadastra clientes, abre chamados em nome deles, assume chamados disponíveis e atualiza os que estão sob sua responsabilidade. |
| Administrador | Cadastra organizações, clientes e equipe, abre chamados em nome de clientes, atribui chamados e altera status e prioridade. |

O servidor verifica a sessão e o perfil para cada operação. O histórico registra criação, comentários, atribuição e mudanças de status ou prioridade.

Chamados abertos pela equipe em nome do cliente ficam visíveis à equipe e às pessoas incluídas em cópia. O e-mail da conta deve corresponder ao endereço informado. Quem acompanha em cópia tem acesso de leitura ao relato, às respostas públicas e aos anexos. A equipe e o cliente que abriu o chamado podem gerenciar os e-mails em cópia. Nos registros antigos, a autoria é recuperada pelo primeiro evento de abertura.

Em **Gestão**, a equipe pode cadastrar e editar clientes. Administradores gerenciam empresas, departamentos, vínculos de técnicos, contas, prazos de SLA, respostas prontas, artigos e auditoria. Somente administradores alteram o e-mail de acesso de um cliente e podem desativar contas. A desativação encerra sessões ativas e desatribui chamados pendentes da equipe.

## Operação da central

1. Em **Novo chamado**, selecione o cliente e o departamento e informe assunto, mensagem e prioridade. É possível anexar até três arquivos de 5 MB. O download exige acesso ao chamado.
2. A fila da equipe abre em **Aguardando atendente**. Depois vêm **Abertos**, **Meus chamados** (para o técnico) e **Todos**. Use os filtros da fila para combinar status, SLA, empresa, departamento e técnico.
3. Cada chamado abre em uma página própria com links diretos. Use **Nota interna** para informações visíveis à equipe. Uma **Resposta pública** gera um sinal de nova resposta na fila para os demais participantes. O aviso é marcado como lido quando a pessoa abre o chamado. No portal do cliente, a aba **Em aberto** vem antes de **Finalizados**.
4. Use **Finalizar chamado** no topo da página e registre a solução. Técnicos podem finalizar chamados que já atendem ou assumir e finalizar um chamado sem responsável na mesma operação. O cliente pode confirmar a solução, avaliar o atendimento ou reabrir o chamado informando o motivo.

Os prazos de SLA usam minutos corridos. A primeira resposta conta a partir da primeira mensagem pública da equipe ou da resolução. O prazo de resolução pausa enquanto o status é **Aguardando cliente** e retoma quando o solicitante responde ou a equipe altera o status. Quando a equipe consulta a fila, chamados vencidos são marcados para acompanhamento e um evento interno é registrado uma vez por ciclo. A fila também se atualiza a cada minuto enquanto está aberta. As regras alteradas valem para novos ciclos e chamados antigos sem medição não entram nos indicadores de SLA. **Gestão → Relatórios** permite exportar um resumo por departamento em CSV. As médias de tempo usam o ciclo mais recente do chamado. As avaliações de ciclos anteriores continuam no cálculo de satisfação.

## Ponte de e-mail

O TicketHub registra notificações pendentes no SQLite para os solicitantes que habilitaram essa opção em seus chamados e para os e-mails incluídos em cópia. Para entrega real, conecte um serviço que faça a ponte com o seu provedor e defina `TICKETHUB_MAIL_SECRET` e `TICKETHUB_BASE_URL`. Use HTTPS em produção. A mesma ponte entrega links de recuperação de senha de uso único. Contas de demonstração ficam fora da recuperação.

Use `POST /api/mail` com JSON e o cabeçalho `Authorization: Bearer <segredo>`.

| Ação | Campos e comportamento |
| --- | --- |
| `next` | Devolve `message` com `id`, `recipient`, `subject`, `body`, `replyTicket` e `deliveryKey`. Se houver mensagem, a ponte tem dois minutos para confirmar. Use o ID como chave de idempotência se o provedor oferecer esse recurso. |
| `complete` | Envie `id`, `deliveryKey` e `sent`. Uma falha permite outra tentativa após um minuto. |
| `reply` | Envie `ticketId`, `sender`, `messageId` e `body`. A ponte deve encaminhar apenas mensagens cujo remetente o provedor tenha autenticado. O solicitante precisa corresponder ao remetente e o chamado precisa aceitar respostas por e-mail. |

A ponte e a entrega real dependem do provedor escolhido. As notas internas não entram na caixa de saída.

## Assistente

Em **Assistente**, descreva o ocorrido. A triagem pode pedir mais detalhes. Quando o relato está completo, o servidor grava o chamado com título, categoria, prioridade e descrição e devolve o número para acompanhamento.

Por padrão, a demonstração oferece triagem simulada por regras locais. Para usar o GPT-OSS 20B na nuvem, crie uma chave no [console da Groq](https://console.groq.com/keys) e configure o arquivo `.env.local` na raiz do projeto.

```env
TICKETHUB_AI_PROVIDER=groq
GROQ_API_KEY=sua_chave
```

Reinicie o servidor Next.js. O Assistente IA exibe **GroqCloud**. O servidor envia o texto do relato à Groq para classificação. Para demonstrar o projeto, use relatos fictícios. Consulte os [limites do plano gratuito](https://console.groq.com/docs/rate-limits).

Para usar o Qwen3 com o Ollama, instale e abra o Ollama na mesma máquina que executa o TicketHub. Baixe o modelo com:

```powershell
ollama pull qwen3:4b-instruct
```

Configure o arquivo `.env.local` na raiz do projeto e reinicie o servidor Next.js.

```env
TICKETHUB_AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3:4b-instruct
```

O Assistente IA exibe **Modelo local** e envia os relatos ao Ollama em `127.0.0.1:11434`. Esse modo usa apenas o Ollama, mesmo se houver uma chave da OpenAI disponível.

Para usar a API da OpenAI, deixe `TICKETHUB_AI_PROVIDER` sem valor e configure `OPENAI_API_KEY`. A chave fica no servidor, e `OPENAI_MODEL` permite trocar o modelo. Nesse modo, o relato é enviado à OpenAI para classificação.

## Usar contas próprias

Defina `TICKETHUB_DEMO=0`, `TICKETHUB_ADMIN_EMAIL` e `TICKETHUB_ADMIN_PASSWORD` em `.env.local` antes da primeira execução nesse modo. Use uma senha de pelo menos 12 caracteres. Após entrar com o administrador inicial, use **Pessoas** para cadastrar os demais perfis. Os dados dessa instalação ficam em `.data/tickethub.sqlite` por padrão. Para hospedar o projeto, use HTTPS e um volume persistente compatível com SQLite.

```powershell
npm run lint
npm run build
npm test
```

O teste de integração usa um banco separado em `.data/test` e um provedor de e-mail simulado. Ele cobre migração de banco anterior, permissões dos perfis, acesso a anexos, notas internas, resolução e reabertura, SLA, avaliações e recuperação de senha.

Direção visual desenvolvida com a skill [Unslop, de Damir Sokolovsky](https://heydamir.design/unslop).
