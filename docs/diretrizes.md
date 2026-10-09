# Síntese Clarity — Diretrizes do Projeto e Time de Agentes

·

## Visão e objetivos

O Síntese Clarity é a ferramenta web da Síntese para enxergar, em um só lugar, tudo o que está em andamento com cada cliente: projetos, tarefas, sustentação e contatos. Ela roda separada do Odoo, mas conversa com ele: o Odoo continua sendo a base de clientes, funcionários e apontamento de horas.

O nome traduz o propósito: dar clareza para três públicos ao mesmo tempo.

- Gestão (CEO/líderes): visão macro de carteira, carga por consultor e saúde de cada cliente, sem depender de memória ou planilha.
- Consultores: uma fila clara do que fazer, com prazos, anexos e histórico de cada cliente.
- Clientes: transparência sobre o que está sendo feito por eles, com canal para comentar e avaliar.

Objetivos mensuráveis da primeira versão

1. Nenhuma demanda de cliente fora do sistema: toda solicitação vira tarefa, sustentação ou atividade de contato.
1. Status report para o cliente gerado em menos de 5 minutos.
1. Dashboard responde em uma tela: projetos, tarefas e clientes por consultor.
1. Avaliação do cliente coletada ao fim de cada projeto e periodicamente na sustentação.
1. Histórico de alteração de prazos com motivo, para identificar atrasos recorrentes por cliente e consultor.

O Clarity materializa a cultura da Síntese em software: clareza e transparência, não abandonar o cliente, entregar acima da promessa. É a etapa Sustentação da Metodologia Síntese tornada visível.

## Glossário e conceitos

Todo o time (humano e agentes) usa estes termos com o mesmo significado. Se um termo mudar, muda aqui primeiro.

| Termo | Definição | Origem |
|---|---|---|
| Cliente | Empresa atendida pela Síntese, com contatos (pessoas) vinculados | Odoo (somente leitura no Clarity) |
| Contato do cliente | Pessoa do cliente que acessa o portal, comenta e avalia | Odoo + convite pelo Clarity |
| Funcionário / Consultor | Membro do time Síntese, com papel e permissões | Odoo (somente leitura) |
| Projeto | No Odoo, um projeto anual por cliente, "[Cliente] [Ano]", que agrupa todos os projetos daquele ano (com escopo, datas e entregáveis) e tarefas simples. Toda hora apontada pertence a um projeto anual | Clarity ou Odoo |
| Tarefa | Unidade de trabalho com responsável, prazo e status. Pode pertencer a um projeto ou ficar avulsa vinculada ao cliente | Clarity ou Odoo |
| Sustentação | Marcador que identifica tarefas e apontamentos de sustentação da operação do cliente (suporte, orientação, treinamento), separando de desenvolvimento (rotina, dashboard etc.) | Clarity (marcador refletido no Odoo) |
| Atividade de contato | Ação agendada de relacionamento: ligar, visitar, reunião, e-mail de follow-up. Tem responsável, data e resultado | Clarity |
| Status report | Documento gerado para o cliente com projetos e tarefas de um período, mais texto livre do gestor | Clarity |
| Avaliação | Três notas do cliente: resultado, consultor e time/empresa, com comentário opcional | Clarity |
| Histórico de previsão | Registro de cada mudança de prazo: data antiga, nova data, motivo e autor | Clarity |
| Tipo de apontamento | Classificação do apontamento: Faturável, Bonificado ou Interno; novos tipos configuráveis | Clarity (refletido no Odoo) |

Status padrão (projetos e tarefas, iguais às etapas do Odoo no modelo novo): Projetos em Análise/Aprovação → Avaliação de novos projetos / estimativa de esforço → Alocação de recursos → Em andamento → Concluído. Situações como pausado ou aguardando cliente são marcadores, não etapas.

## Escopo funcional por módulo

Nove módulos cobrem tudo o que foi pedido. Os códigos (RF-xx) servem para rastrear cada requisito até o código e os testes.

M1 — Clientes e equipe

- RF-01: Importar clientes, contatos e funcionários do Odoo, com sincronização periódica.
- RF-02: Ficha 360° do cliente: projetos, tarefas, sustentações, contatos, anexos, avaliações e consultores envolvidos.
- RF-03: Campos próprios do Clarity no cliente (ex.: consultor responsável, saúde do cliente, ERP usado).

M2 — Projetos

- RF-04: Criar projeto no Clarity ou importar do Odoo, com cliente, responsável, equipe, datas e escopo.
- RF-05: Fases/marcos opcionais e percentual de avanço calculado pelas tarefas.
- RF-06: Histórico de previsão: toda mudança de prazo exige motivo.

M3 — Tarefas e atividades

- RF-07: Tarefa vinculada a projeto ou avulsa no cliente; responsável, prazo, prioridade, status, checklist.
- RF-08: Visualizações em lista, kanban e calendário; filtros por cliente, consultor, status e período.
- RF-09: Marcação de visível ao cliente ou interna.

M4 — Sustentação

- RF-10: Marcador "Sustentação" em tarefas e apontamentos, separando de desenvolvimento (rotinas, dashboards, customizações).
- RF-11: Painéis e relatórios filtráveis por sustentação x desenvolvimento.
- RF-12 (futuro, só se a operação pedir): SLA, categorias e abertura de chamado pelo portal.

M5 — Atividades de contato (relacionamento)

- RF-13: Agendar ação: tipo (ligação, visita, reunião, e-mail), cliente, contato, consultor, data/hora.
- RF-14: Registrar resultado e próximo passo; lembrete ao consultor; visão "contatos atrasados".
- RF-15: Alerta de cliente sem contato há X dias.

M6 — Anexos e comentários

- RF-16: Anexar arquivos em projetos, tarefas, sustentações e atividades, com versão e autor.
- RF-17: Comentários com menção (@), separando internos de visíveis ao cliente.

M7 — Portal do cliente e avaliações

- RF-18: Cliente vê apenas seus projetos e tarefas marcados como visíveis.
- RF-19: Cliente comenta em projetos e tarefas.
- RF-20: O cliente dá três notas de 1 a 5: resultado da entrega, consultor e time/empresa; comentário opcional.

M8 — Dashboards e status report

- RF-21: Dashboards descritos na seção Dashboards e indicadores.
- RF-22 (detalhamento adiado): Status report: selecionar cliente, período, projetos e tarefas; escrever texto livre (resumo, riscos, próximos passos); pré-visualizar; exportar PDF com a marca Síntese; enviar por e-mail ou publicar no portal.
- RF-23: Histórico dos reports enviados por cliente.

M9 — Apontamento de horas (substitui a planilha atual)

- RF-24: Apontamento feito no Clarity, sempre em uma tarefa do projeto anual: data, horas (hh:mm, valor livre), descrição. Lançamento manual, sem cronômetro.
- RF-25: Tipo do apontamento (campo próprio): Faturável, Bonificado, Interno ou Provisionamento; só Faturável aceita pedido de venda, sem obrigatoriedade por ora; o administrador cadastra novos tipos.
- RF-26: Marcador de sustentação no apontamento, herdado da tarefa e editável.
- RF-27: Cada apontamento é enviado ao Odoo; depois, o lançamento direto no Odoo será bloqueado.
- RF-28: Histórico de previsões e regras da planilha atual absorvidos pelo Clarity.
- RF-29: Painel de horas por consultor, cliente, tipo e sustentação x desenvolvimento, contra a meta mensal.
- RF-30: Só o próprio consultor lança e altera as próprias horas; ninguém lança em nome de outro.
- RF-31: Data futura só com o tipo Provisionamento, que nunca aparece ao cliente nem entra em faturamento; quando a data chega, o consultor tem 48 horas para converter em hora real. Vai para o Odoo como não faturável.
- RF-32: Edição livre até 48 horas após o lançamento; depois, só por solicitação com justificativa e novos valores, aprovada por Marttini ou Richard.
- RF-33: Sinalizador diário por cores e alerta de 3 dias úteis seguidos sem apontamento (feriados nacionais; provisionamento não conta), com justificativa registrada pela gestão.

Requisitos não funcionais

- RNF-01: Web responsiva; consultor usa bem no celular.
- RNF-02: Login com Google Workspace para o time; e-mail + senha ou link mágico para clientes.
- RNF-03: Isolamento total de dados entre clientes no portal.
- RNF-04: Trilha de auditoria (quem alterou o quê e quando).
- RNF-05: Conformidade com LGPD (consentimento, dados mínimos, exclusão).

## Perfis de acesso e portal do cliente

Quatro perfis bastam no início; a regra de ouro é que o cliente nunca vê nada interno nem de outro cliente.

| Perfil | Quem | Pode ver | Pode fazer |
|---|---|---|---|
| Administrador | CEO / diretoria | Tudo | Configurar, gerar reports, ver avaliações de todos |
| Gestor | Líder de equipe ou coordenador | Tudo (gestão à vista) | Criar e redistribuir projetos e tarefas, agendar contatos, gerar reports |
| Consultor | Time técnico | Tudo (gestão à vista) | Atualizar tarefas, anexar, comentar, registrar contatos |
| Cliente | Contato do cliente | Só itens marcados como visíveis da própria empresa | Comentar, avaliar, baixar anexos visíveis, ver reports publicados |

Regras do portal

- Acesso do cliente por convite por e-mail, com várias pessoas por empresa. Todo item nasce interno; o consultor ou gestor marca como visível ao cliente.
- Comentários têm dois canais na mesma tela: Interno e Cliente, com cor diferente para evitar vazamento.
- Avaliação com três notas: resultado, consultor e time. A aprovação de entregas pelo cliente e o momento da avaliação ficam para uma próxima etapa.
- Nota baixa (1 ou 2) gera alerta imediato ao administrador, alinhado ao inegociável "não abandonar o cliente".
- Avaliações nascem ocultas e só a gestão vê; a gestão decide, uma a uma, publicar para o time ou usar só em feedback individual.

## Dashboards e indicadores

Três painéis respondem às perguntas do dia a dia; todos com filtro de período e clique para ir ao detalhe.

Painel 1 — Carga por consultor (pergunta: quem está com o quê?)

| Indicador | Como calcula |
|---|---|
| Projetos ativos | Projetos em andamento onde o consultor é responsável ou membro |
| Tarefas abertas | Tarefas não concluídas atribuídas, separando atrasadas |
| Sustentações abertas | Tarefas de sustentação abertas |
| Clientes englobados | Clientes distintos somando projetos, tarefas e sustentações |
| Contatos agendados / atrasados | Atividades de contato da semana |
| Avaliação média | Média das notas recebidas no período |
| Horas apontadas | Apontadas no Clarity, por tipo e sustentação x desenvolvimento, contra a meta mensal |

Painel 2 — Carteira de clientes (pergunta: como está cada cliente?)

- Uma linha por cliente: projetos por status (andamento, pendente, aguardando cliente, concluído), sustentações abertas, último contato, consultor responsável, última avaliação.
- Semáforo de saúde: verde, amarelo, vermelho, calculado por atrasos, SLA estourado, dias sem contato e nota baixa.
- Filtros rápidos: só vermelhos, sem contato há mais de 30 dias, aguardando cliente.

Painel 3 — Minha fila (consultor)

- Hoje, atrasadas, esta semana; contatos a fazer; comentários de clientes não respondidos.

Indicadores de gestão (relatório mensal): prazo cumprido (%), reprogramações por motivo, tempo médio de solução na sustentação, NPS/nota média por consultor e por cliente.

## Integração com Odoo

Cada dado tem um único dono; o Clarity nunca edita o que pertence ao Odoo, só lê e referencia pelo ID.

| Entidade | Dono | Direção | Frequência |
|---|---|---|---|
| Apontamento de horas (account.analytic.line) | Clarity | Clarity → Odoo; depois o lançamento direto no Odoo é bloqueado | A cada apontamento (fase 1) |
| Tipo de apontamento e marcador de sustentação | Clarity | Clarity → Odoo (campos no apontamento) | Junto com o apontamento |
| Clientes e contatos (res.partner) | Odoo | Odoo → Clarity | A cada 15 min + botão "sincronizar agora" |
| Funcionários (hr.employee / res.users) | Odoo | Odoo → Clarity | Diária |
| Projetos (project.project) | Quem criou | Bidirecional, opcional por projeto | Ao salvar |
| Tarefas (project.task) | Quem criou | Bidirecional, opcional por tarefa | Ao salvar |
| Contatos, avaliações, reports | Clarity | Não sincroniza | — |

Diretrizes de integração

- Odoo 19 ou superior: API externa JSON-2 (/json/2/<modelo>/<método>), autenticada por chave de API de um usuário técnico com permissões mínimas. XML-RPC e JSON-RPC só se a versão for anterior, pois estão depreciados.
- Ambiente: Odoo Enterprise no Odoo.sh, com API externa disponível. Homologação num branch de staging do Odoo.sh (cópia da produção).
- O apontamento do Odoo precisa de dois campos novos: tipo de apontamento (Faturável, Bonificado, Interno) e marcador de sustentação (via Studio, incluído no Enterprise).
- Toda entidade espelhada guarda o odoo_id e a data da última sincronização.
- Conflito em projeto/tarefa bidirecional: vence a alteração mais recente, e a perdedora fica registrada no log.
- Fila de sincronização com reprocessamento; se o Odoo cair, o Clarity continua funcionando e envia os apontamentos depois.
- Integração testada primeiro numa base de homologação do Odoo, nunca na produção. Usuário técnico "Integração Clarity": usuário interno, Administrador em Projeto e Planilhas de horas, Oficial em Funcionários, sem acesso a configurações.

### Mapeamento do Odoo atual

Levantamento feito no staging em 07/10/2026, só leitura: Odoo 19.0 Enterprise, então a integração usa a API JSON-2.

| Tema | O que existe hoje | Impacto no Clarity |
|---|---|---|
| Módulos | Projeto, Planilhas de horas, Planejamento, Studio, Documentos, Vendas com faturamento por horas; sem Helpdesk | Helpdesk não é necessário para o Clarity |
| Volume | 277 projetos, 2.208 tarefas (468 subtarefas), 5.513 apontamentos, 16 funcionários | Carga inicial pequena |
| Modelo novo | 39 projetos "[Cliente] 2026" com etiqueta "Novo modelo"; projetos internos são tarefas-mãe com subtarefas | Projeto no Clarity = tarefa-mãe no Odoo; tarefa simples = tarefa sem filhas |
| Modelo antigo | Projetos mensais "[Cliente] ref. [Mês]/[Ano]" com etiquetas de mês; horas internas em "Interno Síntese ref. [Mês]/[Ano]" | Não entram no Clarity (decidido) |
| Etapas | Projetos "Novo modelo" seguem 5 etapas padrão: Projetos em Análise/Aprovação, Avaliação de novos projetos / estimativa de esforço, Alocação de recursos, Em andamento, Concluído | Status do Clarity = essas 5 etapas, convertidas pelo nome (um projeto tem o conjunto duplicado) |
| Faturamento | Apontamentos já usam o tipo de faturamento nativo do Odoo (faturável por hora, preço fixo, manual, não faturável), 2.994 ligados a pedidos de venda | Vínculo ao pedido de venda continua; campo próprio Faturável / Bonificado / Interno, com trava: Bonificado e Interno não aceitam pedido de venda |
| Campos personalizados | Só um: "Valor Total" no apontamento | Nenhum conflito |
| Clientes | 247 de 277 projetos têm cliente vinculado; alguns "2026" ainda sem cliente | Vincular cliente antes da carga |

O staging é apagado automaticamente em 07/11/2026; antes disso, criar um novo se ainda for necessário.

## Diretrizes de produto, UX e identidade

O Clarity deve parecer Síntese: claro, próximo e sem burocracia. Toda decisão de tela passa por estes princípios.

1. Três cliques até a resposta. Do dashboard ao detalhe de qualquer item em no máximo três cliques.
1. Registrar é mais rápido que esquecer. Criar tarefa ou contato em menos de 20 segundos, inclusive no celular.
1. Status sempre honesto. Prazo vencido aparece vermelho; reprogramar exige motivo. Clareza e transparência são valores, não enfeite.
1. Linguagem humana. Textos de tela e e-mails no tom da marca: próximo, direto, sem jargão ("Descomplicamos a tecnologia").
1. Interno x cliente sempre visível. Um selo claro em todo item e comentário mostra quem pode ver.
1. Do macro ao micro. Toda visão tem seletor de período e todo número é clicável: Síntese inteira → cliente ou consultor no período → projeto, tarefa e apontamento.

Identidade visual

- Paleta: roxo #582582 / #35104a (primária), azul #005884 / #014568 (informação), laranja #e8531d / #d25515 (ação e alerta).
- Tagline no portal e no rodapé dos reports: "Presente na sua gestão".
- Ordem de serviços sempre Gestão → Soluções → Sustentação, inclusive em menus e filtros.
- Status report em PDF com capa, logotipo, período e assinatura do consultor/gestor.

## Diretrizes técnicas e arquitetura

Arquitetura simples em três camadas, com o Odoo isolado atrás de uma fila: se a integração falhar, o Clarity continua no ar.

Toda conversa com o Odoo passa pela fila de sincronização; nenhuma tela chama o Odoo diretamente.

Stack sugerida (decisão final do Bruno depois de definido quem desenvolve)

| Camada | Sugestão | Por quê |
|---|---|---|
| Front-end | Next.js (React) + TypeScript + Tailwind | Produtivo, responsivo, muito bem suportado por agentes de IA |
| Back-end | API no próprio Next.js ou NestJS (Node) | Uma linguagem só no projeto inteiro |
| Banco | PostgreSQL | Relacional, robusto, bom para relatórios |
| Autenticação | Google (time) + link mágico/senha (clientes) | Aproveita o Google Workspace da Síntese |
| Anexos | Armazenamento S3 compatível | Barato e escalável |
| PDF | Geração no servidor a partir de HTML | Report fiel à identidade visual |
| Hospedagem | Nuvem gerenciada (ex.: Vercel + Supabase, ou VPS) | Depende do orçamento definido |

Padrões obrigatórios

- Código em repositório Git, com revisão antes de ir para produção.
- Ambientes separados: desenvolvimento, homologação e produção; homologação aponta para um Odoo de teste.
- Permissão checada no servidor, nunca só na tela.
- Backup diário do banco e dos anexos.
- Decisões técnicas relevantes registradas como ADR (um parágrafo: contexto, decisão, consequência).

## Time de agentes

Sete personas cobrem o ciclo completo, do requisito ao deploy. Você é o patrocinador e decide; a Ana coordena e chama os demais quando o tema exige.

| Persona | Papel | Missão | Entregáveis | Chame quando |
|---|---|---|---|---|
| Ana | Product Owner e analista de requisitos | Transformar necessidade em requisito claro e priorizado | Histórias de usuário, critérios de aceite, backlog priorizado, atas de decisão | Ideia nova, dúvida de escopo, priorização |
| Bruno | Arquiteto de software | Garantir base técnica simples, segura e escalável | Arquitetura, modelo de dados, decisões técnicas (ADR), padrões de código | Escolha de tecnologia, modelagem, performance, segurança |
| Clara | Designer UX/UI | Fazer o Clarity fácil e com cara de Síntese | Fluxos, wireframes, protótipos, guia visual | Nova tela, dashboard, portal do cliente, report em PDF |
| Diego | Especialista Odoo e integrações | Fazer Clarity e Odoo conversarem sem conflito | Mapeamento de modelos, contratos de API, regras de sincronização | Tudo que toca o Odoo |
| Eva | Desenvolvedora full-stack | Construir com qualidade e no padrão definido | Código, migrações, testes unitários, PRs | Implementar uma história |
| Fábio | QA e testes | Garantir que nada chegue quebrado ao cliente | Plano de testes, casos de teste, relatório de bugs | Antes de liberar qualquer entrega |
| Gabi | Voz do cliente (Customer Success) | Defender a experiência do cliente e da cultura Síntese | Revisão do portal e reports pelo olhar do cliente, pesquisas de avaliação | Tudo que o cliente vê, lê ou avalia |

Como o time trabalha

1. Você traz a necessidade; Ana escreve a história com critérios de aceite.
1. Clara desenha a tela; Bruno e Diego validam a viabilidade e o impacto no Odoo.
1. Gabi revisa tudo que o cliente verá.
1. Você aprova; Eva implementa; Fábio testa contra os critérios de aceite.
1. Ana registra a decisão e atualiza este documento.

Regras para todos os agentes

- Este documento é a fonte da verdade; divergência vira questão em aberto, nunca suposição silenciosa.
- Discordar é obrigatório quando houver risco: cada agente aponta riscos da sua área mesmo sem ser perguntado.
- Respostas citam os requisitos afetados (RF-xx / RNF-xx).
- Falar a verdade e não aceitar mediocridade valem para os agentes também.

Como acionar: comece a mensagem com o nome, ex.: "Ana, detalhe a história do status report" ou "Diego e Bruno, como sincronizar tarefas com o Odoo?". Sem nome, a Ana responde e chama quem precisar.

## Roadmap por fases

O time interno usa o Clarity primeiro; o cliente só entra quando a ferramenta já reflete a realidade da Síntese.

Cada fase só começa quando o portão da anterior é cumprido. Prazos serão estimados pela Ana e pelo Bruno ao fim da Fase 0, depois de respondidas as questões abaixo.

Próximos passos imediatos (Fase 0)

- [ ] Ana: histórias de usuário do MVP com critérios de aceite (concluídas em 08/10: 50 histórias, incluindo escopo, central de avisos, ranking e modo TV).
- [ ] Diego: especificação da integração campo a campo e regras de sincronização (primeira versão pronta, 08/10).
- [ ] Clara: wireframes do apontamento, Minha fila, painel por consultor e carteira de clientes.
- [ ] Bruno: stack, modelo de dados, ambientes e custo mensal estimado (proposta pronta, 08/10; aguarda aprovação).
- [ ] Marttini: validar histórias e telas; trocar a senha do usuário de integração; renovar o staging antes de 07/11/2026.
- [ ] Portão da Fase 0: protótipo aprovado; em seguida, configurar Claude Code e o repositório.

Histórias de usuário com critérios de aceite:

Especificação da integração: · Arquitetura e custos:

## Decisões registradas

| Data | Decisão |
|---|---|
| 07/10/2026 | Projeto nasce como Rascunho, só no Clarity; ao sair do rascunho, entra no Odoo em Projetos em Análise/Aprovação. Só Marttini, Richard e Luiz confirmam escopo |
| 07/10/2026 | Depois do escopo confirmado, pedidos além dele são marcados como fora do escopo, Faturáveis por padrão, e aparecem ao cliente como "Demandas adicionais"; só aceitam apontamento depois de aprovadas pelo cliente, no portal ou por e-mail/mensagem com print anexado; sem exceção para urgência. Escopo vale só para projetos; horas de montagem de escopo não são apontadas |
| 07/10/2026 | Etiquetas "Projeto" e "Tarefa" no Odoo identificam o tipo de cada tarefa |
| 07/10/2026 | Qualquer consultor cria projetos e tarefas; prazo só muda pelo responsável do item ou pela gestão. Gestores: Marttini, Richard e Luiz. Todo o time vê todos os clientes, projetos e horas (gestão à vista) |
| 07/10/2026 | Dois níveis: projeto → tarefa; subtarefa não tem subtarefa, por enquanto |
| 07/10/2026 | Na virada do ano, são criados projetos anuais novos para todos os clientes ativos (horas nos últimos 6 meses); itens pendentes são concluídos no ano antigo, com suas horas, e continuados no ano novo, ligados ao original |
| 07/10/2026 | Apontamento de horas é feito no Clarity e refletido no Odoo; depois o lançamento direto no Odoo será bloqueado |
| 07/10/2026 | Só o próprio consultor lança e altera as próprias horas; todo apontamento tem tarefa (regra do Odoo) |
| 07/10/2026 | Novo tipo Provisionamento: único aceito em data futura, invisível ao cliente e fora do faturamento; convertido em hora real quando a data chega; vai para o Odoo como não faturável |
| 07/10/2026 | Edição livre até 48 horas após o lançamento; no provisionamento, 48 horas a partir da data provisionada. Depois, pedido com justificativa aprovado por Marttini ou Richard |
| 07/10/2026 | Horas livres em hh:mm, lançamento manual, sem cronômetro |
| 07/10/2026 | Cores por dia: vermelho sem horas, amarelo abaixo de 4 h, azul de 4 h a 6 h, verde acima de 6 h; no mês, proporcional |
| 07/10/2026 | 3 dias úteis seguidos sem apontamento e sem justificativa com comprovante (liberação do gestor, férias, atestado) = perda do bônus do mês; o Clarity alerta. Provisionamento não conta como dia apontado |
| 07/10/2026 | Dias úteis consideram só feriados nacionais, por enquanto |
| 07/10/2026 | Sem exportação para Excel; análises serão dashboards dentro do Clarity, a definir no futuro |
| 07/10/2026 | Sustentação é um marcador simples em tarefas e apontamentos, para separar de desenvolvimento; sem SLA por ora |
| 07/10/2026 | Tipo de apontamento é um campo próprio: Faturável, Bonificado, Interno ou Provisionamento, com opção de novos tipos |
| 07/10/2026 | O vínculo nativo do apontamento com pedido de venda continua; só Faturável aceita pedido de venda |
| 07/10/2026 | Faturável não exige pedido de venda por ora; obrigatoriedade fica pendente para o futuro |
| 07/10/2026 | Estrutura: um projeto anual por cliente no Odoo ("[Cliente] [Ano]"), que agrupa os projetos do ano e tarefas simples; toda hora pertence a ele |
| 07/10/2026 | Só entram no Clarity os projetos com a etiqueta "Novo modelo"; o modelo antigo (mensal) fica de fora |
| 07/10/2026 | Status do Clarity = as 5 etapas padrão dos projetos "Novo modelo" |
| 07/10/2026 | Marcadores de situação = etiquetas das tarefas do Odoo (Pausado, Ag. retorno cliente, Pend. doc. cliente, Crítico, Não autorizado); novas podem ser criadas |
| 07/10/2026 | Horas do tipo Interno vão para o projeto "Síntese [Ano]", a ser criado no Odoo |
| 07/10/2026 | O Clarity substitui a planilha atual de gestão de projetos e horas |
| 07/10/2026 | Avaliação mede a satisfação do cliente com três notas: resultado, consultor e time/empresa |
| 07/10/2026 | Aprovação de entregas pelo cliente fica pendente para uma próxima etapa, para não travar faturamento e processos |
| 07/10/2026 | Acesso ao portal por convite por e-mail; várias pessoas por cliente. O portal do Odoo não será usado: o cliente acompanha tudo só pelo Clarity |
| 07/10/2026 | Odoo 19.0 Enterprise no Odoo.sh; homologação em branch de staging |
| 07/10/2026 | O Clarity será desenvolvido internamente pelo time de agentes, com o CEO como patrocinador; guardião técnico: Marttini até o MVP, depois Alisson |
| 07/10/2026 | Detalhamento do status report fica para depois. Em 08/10: direção visual aprovada, Versão 3 do protótipo (visual escuro, navegação no topo, caixa de comando, cores por cliente, lançamento de horas por texto) |

## Questões em aberto

Estas decisões destravam o detalhamento dos requisitos; as cinco primeiras são necessárias antes de codar.

- [ ] Resolvido: Odoo 19.0 Enterprise; integração via API JSON-2.
- [ ] Staging no Odoo.sh e usuário "Integração Clarity" já criados; falta informar a URL do staging.
- [ ] Pendente para o futuro: apontamento Faturável deve exigir pedido de venda? Por ora, não exige.
- [ ] Resolvido: as etiquetas das tarefas (Pausado, Ag. retorno cliente, Pend. doc. cliente, Crítico, Não autorizado) são os marcadores de situação no Clarity; novas podem ser criadas.
- [ ] Horas do tipo Interno vão para o projeto "Síntese [Ano]" (decidido); esse projeto ainda precisa ser criado no Odoo, hoje existe "Interno Síntese ref. [Mês]/[Ano]".
- [ ] Próxima etapa: o cliente aprova entregas? Em que momento ele avalia, sem travar faturamento?
- [ ] Quem do cliente avalia: qualquer convidado ou só um responsável?
- [ ] Clientes de sustentação têm banco de horas mensal contratado a controlar?
- [ ] Projetos e tarefas criados no Clarity devem ir para o Odoo sempre, nunca ou item a item?
- [ ] Resolvido: guardião técnico será o Marttini até o MVP; depois o Alisson (desenvolvedor sênior) assume a sequência.
- [ ] Onde hospedar o Clarity e qual orçamento mensal de infraestrutura?
- [ ] O histórico da planilha atual será migrado ou o Clarity começa do zero?
- [ ] Todos os convidados de um cliente veem os mesmos itens, ou há restrição por pessoa?
- [ ] Resolvido: avaliações nascem ocultas; a gestão decide publicar para o time ou usar só em feedback.
- [ ] Notificações: e-mail apenas, ou também WhatsApp?
- [ ] Futuro: definir os entregáveis de análise (dashboards e visões), o modelo do status report e o consultor responsável por cliente.
