# Arquitetura

Aprovada pelo Marttini em 08/10/2026.

| Camada | Escolha |
|---|---|
| Aplicação | Next.js + TypeScript na Vercel |
| Visual | Tailwind CSS, linguagem V3 do protótipo |
| Banco | PostgreSQL no Supabase, acesso pelo servidor com Drizzle ORM |
| Login | Supabase Auth: Google restrito ao domínio da Síntese para o time; link por e-mail para clientes |
| Arquivos | Supabase Storage (bucket privado "anexos"), limite de 25 MB |
| Rotinas e fila | Fila no próprio banco + Vercel Cron (sincronização, avisos, resumo diário às 8h) |
| Avisos | Slack para o time; e-mail transacional para clientes; WhatsApp na Fase 2 |
| Código | GitHub privado + Claude Code |
| Testes | Vitest (regras e serviços com Postgres real) e Playwright (fluxos de tela) |

## Ambientes

| Ambiente | Banco | Odoo |
|---|---|---|
| Desenvolvimento | Postgres local | Odoo falso (ODOO_MODE=fake) ou staging |
| Homologação | Supabase (projeto 2) | Staging |
| Produção | Supabase (projeto 1) | Produção |

## Segurança

- Toda leitura e escrita passa pelo servidor, que checa perfil e dono do dado. O navegador nunca recebe a chave do banco nem do Odoo.
- O contato do cliente só lê dados da própria empresa e itens visíveis; nunca vê Provisionamento, Interno, avaliações, justificativas ou observações internas.
- Login de teste (AUTH_MODE=dev) só funciona fora de produção ou com ALLOW_DEV_AUTH=true explícito, e mostra uma faixa de aviso.
- Backup diário do banco (Supabase Pro, 7 dias).

## Decisões técnicas (ADR)

1. **Acesso ao banco pelo servidor com Drizzle, sem expor o banco ao navegador.** Contexto: regras de permissão complexas (perfis, gestão à vista, portal). Decisão: Server Components e Server Actions consultam o Postgres com uma conexão do servidor; as regras ficam em `src/server/services`. Consequência: o Supabase é usado para banco, login e arquivos, mas não pela API pública dele; RLS fica como segunda barreira para o portal.
2. **Fila de sincronização no Postgres.** Contexto: o Odoo pode ficar fora do ar. Decisão: toda escrita destinada ao Odoo vira uma linha em `sync_queue`, processada pelo cron com novas tentativas. Consequência: o Clarity nunca trava por causa do Odoo.
3. **Odoo falso para desenvolvimento e testes.** Contexto: o staging é compartilhado e pode sumir. Decisão: `src/server/odoo/fake.ts` implementa os modelos usados com o mesmo contrato do JSON-2. Consequência: os testes rodam sem rede; a validação final é no staging.
4. **Fontes servidas pelo próprio app (@fontsource).** Evita depender do Google Fonts no build.
