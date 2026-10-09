# Integração com o Odoo

O Clarity conversa com o Odoo 19 Enterprise pela API JSON-2 (`POST /json/2/<modelo>/<método>`), autenticado pela chave de API do usuário "Integração Clarity" (`Authorization: bearer <chave>`, cabeçalho `X-Odoo-Database`). Só enxerga projetos anuais com a etiqueta "Novo modelo". Responsável: Diego.

## Pré-requisitos no Odoo (staging primeiro, depois produção)

| Item | Onde | Para quê |
|---|---|---|
| Etiqueta "Projeto" | Etiquetas de tarefa | Marca as tarefas-mãe que são projetos |
| Etiqueta "Tarefa" | Etiquetas de tarefa | Marca as tarefas simples do projeto anual |
| Etiqueta "Fora do escopo" | Etiquetas de tarefa | Marca as demandas adicionais |
| Campo "Tipo de apontamento" | Apontamento (account.analytic.line), via Studio | Faturável, Bonificado, Interno, Provisionamento e novos tipos |
| Campo "Sustentação" (sim/não) | Tarefa e apontamento, via Studio | Separa sustentação de desenvolvimento |
| Campo "ID Clarity" (texto) | Tarefa e apontamento, via Studio | Impede duplicidade em reenvios |
| Campo "Consultor" (sim/não) | Funcionário (hr.employee), via Studio | Quem aponta horas e entra em carga, ranking e faixas |
| Projeto "Síntese [Ano]" | Projetos, com etiqueta "Novo modelo" | Recebe as horas do tipo Interno |
| Automação da trava | Apontamento | Impede pedido de venda em Bonificado, Interno e Provisionamento enquanto o Odoo aceitar lançamento direto |
| Chave de API | Usuário "Integração Clarity" | Guardada só no servidor |

Os nomes técnicos dos campos do Studio ficam em Configurações → Integração (padrão `x_studio_tipo_de_apontamento`, `x_studio_sustentacao`, `x_studio_id_clarity`, `x_studio_consultor`) e o Diego confirma no staging.

## Mapeamento

| Clarity | Odoo | Direção | Filtro / regra |
|---|---|---|---|
| Projeto anual | project.project | Odoo → Clarity | Etiqueta "Novo modelo" |
| Projeto | project.task | Bidirecional | Etiqueta "Projeto", sem tarefa-mãe |
| Tarefa de um projeto | project.task | Bidirecional | Tarefa-mãe = o projeto |
| Tarefa simples | project.task | Bidirecional | Etiqueta "Tarefa", sem tarefa-mãe |
| Apontamento | account.analytic.line | Clarity → Odoo | Sempre com tarefa |
| Cliente | res.partner (empresa) | Odoo → Clarity | Cliente de algum projeto anual |
| Contato do cliente | res.partner (pessoa) | Odoo → Clarity | Pessoa dentro da empresa cliente |
| Funcionário | hr.employee + res.users | Odoo → Clarity | Ativos |
| Etapa | project.task.type | Odoo → Clarity | As 5 etapas, pelo nome |
| Marcadores | project.tags | Bidirecional | Pelo nome |

Tarefa: name, project_id, parent_id, user_ids, planned_date_begin, date_deadline (UTC no Odoo; o Clarity converte para Brasília), allocated_hours, stage_id (pelo nome), tag_ids, description, Sustentação, ID Clarity. effective_hours é só leitura.

Apontamento: employee_id (pelo e-mail), project_id ("Síntese [Ano]" no tipo Interno), task_id (obrigatória), date, unit_amount (hh:mm → decimal), name, so_line (só Faturável), Tipo, Sustentação, ID Clarity. Não enviamos timesheet_invoice_type nem valor total.

## Regras de sincronização

- Leitura incremental por write_date, a cada 15 minutos e pelo botão "Sincronizar agora".
- Envio pela fila, com novas tentativas automáticas e registro de erro.
- Sem duplicidade: antes de criar, procura pelo ID Clarity.
- Conflito: vale a alteração mais recente; a outra fica no log.
- Exclusão: apontamento excluído no Clarity é excluído no Odoo; projeto ou tarefa é arquivado, nunca apagado.
- Rascunho não sincroniza; Provisionamento sincroniza sem pedido de venda.
- Etiquetas e etapas são localizadas pelo nome.
- Erros do Odoo aparecem em português claro; erro de sincronização avisa o guardião técnico na hora.
- Virada do ano (testado em 08/10/2026): mover tarefa com horas leva as horas junto. Solução: o item pendente é concluído no ano antigo e o Clarity cria a continuação ligada no ano novo.
- A Síntese não valida horas no Odoo; a regra das 48 horas e as aprovações ficam no Clarity.
- O usuário "Integração Clarity" ocupa uma licença paga na produção.
