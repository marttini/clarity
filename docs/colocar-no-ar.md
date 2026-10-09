# Colocar o Clarity no ar (homologação)

Passos que dependem do Marttini (contas e chaves), depois o time termina sozinho.

1. **Supabase**: criar conta e projeto "clarity" (região São Paulo). Em Authentication → Providers, ligar Google (restrito a @sintesebrasil.com) e e-mail com link mágico. Em Storage, criar bucket privado "anexos".
2. **Vercel**: importar o repositório GitHub `marttini/Clarity`. Variáveis de ambiente (copiar de `.env.example`):
   - `DATABASE_URL` (Supabase → Connect → Transaction pooler), `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEAM_EMAIL_DOMAIN=sintesebrasil.com`, `APP_URL`.
   - `ODOO_MODE=real`, `ODOO_URL` (staging), `ODOO_DB`, `ODOO_API_KEY` (chave do usuário Integração Clarity).
   - `CRON_SECRET` (qualquer texto longo aleatório), `NOTIFY_MODE=dry-run` até o Slack e o e-mail estarem prontos.
3. **Banco**: rodar uma vez `npm run db:migrate` apontando para o `DATABASE_URL` do Supabase.
4. **Odoo (Diego)**: criar no staging os pré-requisitos de `docs/integracao-odoo.md` e conferir os nomes dos campos do Studio em Configurações → Integração. Depois, "Sincronizar agora" traz clientes, pessoas, projetos e tarefas.
5. **Primeiro acesso**: Marttini entra com o Google; em Configurações → Pessoas, conferir perfis (Richard e Luiz gestores; Maria e Ana Clara administrativo) e o ID do Slack de cada um.
6. **Avisos**: criar o app do Slack com permissão `chat:write`, colar `SLACK_BOT_TOKEN`; criar conta no Resend com o domínio sintesebrasil.com e colar `RESEND_API_KEY`; trocar `NOTIFY_MODE=live`.
7. **Endereço**: apontar `clarity.sintesebrasil.com` para a Vercel (CNAME).

Para uma demonstração rápida sem Supabase nem Odoo, dá para publicar com `AUTH_MODE=dev`, `ALLOW_DEV_AUTH=true`, `ODOO_MODE=fake` e um banco com `npm run db:seed` (aparece a faixa "Ambiente de teste").
