@AGENTS.md

# Síntese Clarity

Aplicação web da Síntese para projetos, tarefas, sustentação, apontamento de horas, contatos com clientes, painéis e portal do cliente. Integrada ao Odoo 19 Enterprise (Odoo.sh), que continua sendo o sistema de faturamento.

## Fonte da verdade

- `docs/historias-mvp.md`: as 50 histórias (US-01 a US-50) com critérios de aceite. Toda mudança cita a história.
- `docs/diretrizes.md`: visão, glossário, decisões registradas, time de agentes, roadmap.
- `docs/integracao-odoo.md`: mapeamento de campos e regras de sincronização.
- `docs/arquitetura.md`: stack, ambientes, segurança, decisões técnicas (ADR).
- Protótipo aprovado (V3): telas de referência visual. Não inventar outra linguagem visual.

Divergência entre código e documentos vira pergunta, nunca suposição silenciosa.

## Stack

Next.js 16 (App Router, **leia `node_modules/next/dist/docs/` antes de usar uma API**) · TypeScript · Tailwind 4 · Drizzle ORM + Postgres (Supabase em produção) · Supabase Auth e Storage · Vitest · Playwright · Vercel.

## Comandos

```bash
npm run dev            # http://localhost:3000 (login de teste em /entrar)
npm run typecheck
npm run lint
npm test               # unitários + integração (precisa de Postgres local)
npm run test:e2e       # Playwright
npm run db:generate    # gera migração a partir de src/db/schema.ts
npm run db:migrate
npm run db:seed        # dados fictícios (nunca em produção)
```

Postgres local: `postgres://postgres@localhost:5432/clarity` (banco `clarity_test` para testes).

## Organização

- `src/domain/`: regras puras e testadas (datas, feriados, faixas, 48 h, 3 dias, saúde do cliente, lançamento rápido). Sem banco, sem tela.
- `src/db/schema.ts`: modelo de dados. Mudou o schema → `npm run db:generate` e commitar a migração.
- `src/server/`: tudo que roda só no servidor (`import "server-only"`).
  - `session.ts`: login e perfis (`requireTeam`, `requireClient`, `isManager`, `isAdmin`).
  - `services/`: casos de uso com regras e permissões (ex.: `entries.ts`). Toda escrita passa por aqui, grava auditoria e, se for para o Odoo, entra na fila (`sync/enqueue.ts`).
  - `notify.ts`: central de avisos (sino + no máximo um canal externo; horário comercial).
  - `odoo/`: cliente JSON-2, Odoo falso para testes e a sincronização.
- `src/app/(time)/`: telas do time. `src/app/portal/`: portal do cliente. `src/app/tv/`: modo TV.
- `src/components/`: componentes de tela.

## Regras que não se negociam

1. Permissão é checada no servidor, nunca só na tela.
2. Nenhuma tela chama o Odoo direto: toda conversa passa pela fila de sincronização.
3. O cliente nunca vê Provisionamento, Interno, avaliações, justificativas, observações internas nem comentários do canal Interno.
4. Textos de tela em português do Brasil, frases curtas, sem jargão. Erros explicam o que fazer.
5. Visual V3: fundo #120A19, acento #F07A45, Unbounded (títulos), Hanken Grotesk (texto), JetBrains Mono (números). Sem eyebrows, sem tiles de KPI gigantes, sem glow, sem bordas laterais coloridas, sem setas unicode (use `<Arrow/>`), sem emojis. Prefira tabelas e linhas a grades de cards.
6. Toda visão de análise tem seletor de período e todo número leva ao detalhe.
7. Chaves e segredos só em variáveis de ambiente do servidor.

## Time de agentes

Ana (produto), Bruno (arquitetura), Clara (design), Diego (Odoo), Eva (desenvolvimento), Fábio (testes), Gabi (voz do cliente). Guardião técnico: Marttini até o MVP; depois, Alisson.
