# Histórias do MVP

Histórias de usuário da Fase 1, com critérios de aceite. Cada história cita o requisito (RF) que atende; o Fábio testa contra estes critérios.

## M9 — Apontamento de horas

Doze histórias cobrem o apontamento de ponta a ponta, do lançamento ao Odoo; são as primeiras a construir porque aposentam a planilha.

| ID | História | Quem | RF |
|---|---|---|---|
| US-01 | Lançar um apontamento | Consultor | RF-24, RF-30, RF-31 |
| US-02 | Escolher o tipo, com a trava do pedido de venda | Consultor | RF-25 |
| US-03 | Marcar sustentação | Consultor | RF-26 |
| US-04 | Editar ou excluir um apontamento em até 48 horas | Consultor | RF-32 |
| US-05 | Enviar o apontamento ao Odoo | Sistema | RF-27 |
| US-06 | Ver meus apontamentos, com cores por dia | Consultor | RF-33 |
| US-07 | Acompanhar as horas da equipe | Gestor, administrador | RF-29 |
| US-08 | Cadastrar tipos de apontamento | Administrador | RF-25 |
| US-09 | Solicitar alteração depois de 48 horas | Consultor | RF-32 |
| US-10 | Aprovar alterações de apontamento | Marttini, Richard | RF-32 |
| US-11 | Alerta de dias sem apontamento | Consultor, gestão | RF-33 |
| US-12 | Converter provisionamento em hora real | Consultor | RF-31 |

### US-01 — Lançar um apontamento

Como consultor, quero lançar as horas que trabalhei, para registrar meu trabalho uma única vez e ele chegar ao Odoo sozinho.

- Campos: data, cliente, projeto anual, tarefa, horas, descrição, tipo, sustentação e pedido de venda.
- Data vem preenchida com hoje; datas passadas são aceitas com qualquer tipo, e datas futuras só com o tipo Provisionamento.
- Ao escolher o cliente, o projeto anual "[Cliente] [Ano]" vem sugerido; só aparecem projetos com a etiqueta "Novo modelo".
- Tarefa obrigatória: tarefa-mãe, subtarefa ou tarefa simples do projeto anual. Não existe apontamento sem tarefa (regra do Odoo).
- Horas em hh:mm, valor livre e maior que zero; descrição e tipo obrigatórios.
- O apontamento é sempre do consultor logado; ninguém lança horas em nome de outra pessoa.
- Lançamento manual, sem cronômetro; um apontamento completo leva menos de 20 segundos, inclusive no celular.

### US-02 — Escolher o tipo, com a trava do pedido de venda

Como consultor, quero classificar cada apontamento, para separar o que é cobrado, bonificado e interno.

- Tipos disponíveis: Faturável, Bonificado, Interno, Provisionamento e os tipos ativos cadastrados (US-08).
- Bonificado, Interno e Provisionamento: o campo de pedido de venda fica bloqueado. Se o tipo mudar para um deles, o pedido já escolhido é removido, com aviso.
- Faturável: pedido de venda opcional; só aparecem pedidos do cliente do projeto.
- Interno: o projeto passa a ser "Síntese [Ano]" e o campo de cliente some.
- Provisionamento: único tipo aceito em data futura. Nunca aparece para o cliente e nunca entra em faturamento ou relatório de horas do cliente.
- A mesma trava vale se o apontamento chegar por qualquer outro caminho, como uma importação.

### US-03 — Marcar sustentação

Como consultor, quero indicar se a hora foi de sustentação ou de desenvolvimento, para a Síntese medir cada frente.

- O marcador vem da tarefa: se a tarefa é de sustentação, o apontamento já nasce marcado.
- O consultor pode mudar o marcador em cada apontamento.
- Sem marcação, o apontamento conta como desenvolvimento.

### US-04 — Editar ou excluir um apontamento em até 48 horas

Como consultor, quero corrigir um lançamento errado, para que as horas reflitam a realidade.

- Só o próprio consultor edita ou exclui seus apontamentos; gestor e administrador não alteram horas de outra pessoa.
- Edição e exclusão são livres por 48 horas, contadas do momento do lançamento, não da data trabalhada.
- Depois de 48 horas, editar e excluir dão lugar ao botão "Solicitar alteração" (US-09).
- Toda edição e exclusão é refletida no Odoo (US-05) e registrada na trilha de auditoria, com os valores antigos.
- Exclusão pede confirmação.

### US-05 — Enviar o apontamento ao Odoo

Como Síntese, quero que todo apontamento chegue ao Odoo sem ação manual, para o faturamento continuar funcionando.

- Ao salvar, o apontamento entra na fila de sincronização e mostra a situação: Pendente, Enviado ou Erro.
- No Odoo são gravados: funcionário, projeto, tarefa, data, horas, descrição, pedido de venda, tipo e marcador de sustentação.
- Se o Odoo estiver fora do ar, o apontamento fica salvo no Clarity e é reenviado automaticamente depois.
- Em caso de erro, o motivo aparece em português claro e o gestor pode reenviar.
- Nenhum apontamento é perdido nem duplicado no Odoo, mesmo com reenvio.

### US-06 — Ver meus apontamentos

Como consultor, quero ver o que já lancei, para conferir minhas horas e não esquecer nenhum dia.

- Visão por dia e por semana, com total de horas por dia, por semana e por tipo.
- Cada dia útil ganha uma cor: vermelho sem horas; amarelo acima de 0 e abaixo de 4 h; azul de 4 h a 6 h; verde acima de 6 h.
- Horas de Provisionamento não entram nas cores; aparecem à parte, identificadas como provisionadas.
- Filtros por período, cliente e tipo.
- A situação no Odoo (US-05) aparece em cada linha.

### US-07 — Acompanhar as horas da equipe

Como gestor, quero ver as horas de todos, para acompanhar produtividade e faturamento sem planilha.

- Totais por consultor, cliente, tipo e sustentação x desenvolvimento, em qualquer período.
- Na visão mensal, cada consultor recebe a mesma escala de cores aplicada à sua média de horas por dia útil.
- Comparativo com a meta mensal de horas, configurável pelo administrador.
- Clique em qualquer total abre os apontamentos que o compõem.
- Horas provisionadas aparecem separadas das realizadas e não somam na meta.

### US-08 — Cadastrar tipos de apontamento

Como administrador, quero criar novos tipos, para acompanhar a evolução da operação sem depender de desenvolvimento.

- Criar, renomear e desativar tipos; um tipo já usado não pode ser excluído, só desativado.
- Cada tipo define se aceita pedido de venda; Bonificado, Interno e Provisionamento já vêm sem aceitar.
- Faturável, Bonificado, Interno e Provisionamento não podem ser excluídos.
- Novos tipos também passam a existir como opção do campo no Odoo.

### US-09 — Solicitar alteração depois de 48 horas

Como consultor, quero pedir a correção de um apontamento antigo, para ajustar minhas horas dentro da regra.

- Disponível só para apontamentos lançados há mais de 48 horas, e só pelo próprio consultor.
- O consultor informa os novos valores, ou pede a exclusão, e uma justificativa obrigatória.
- O apontamento original continua valendo até a decisão, marcado como "Alteração pendente".
- O consultor acompanha a situação: Pendente, Aprovada ou Recusada, com o motivo.

### US-10 — Aprovar alterações de apontamento

Como aprovador (Marttini ou Richard), quero aprovar ou recusar os pedidos de alteração numa única tela, para controlar ajustes fora do prazo.

- Tela com todos os pedidos pendentes: consultor, cliente, valores atuais e pedidos lado a lado, e a justificativa.
- Aprovar aplica a alteração, sincroniza com o Odoo e registra quem aprovou e quando.
- Recusar exige um motivo, que o consultor vê.
- Só Marttini e Richard aprovam; o painel deles mostra quantos pedidos estão pendentes.

### US-11 — Alerta de dias sem apontamento

Como gestão, quero ser avisada quando alguém ficar dias úteis sem lançar horas, para agir antes do fechamento e aplicar a regra do bônus com justiça.

- Dias úteis = segunda a sexta, exceto feriados nacionais.
- Horas de Provisionamento não contam como dia apontado.
- O consultor vê o aviso no próprio painel a partir do primeiro dia útil sem lançamento.
- Ao completar 3 dias úteis seguidos sem apontamento, consultor e gestão recebem alerta.
- O consultor registra a justificativa do dia sem apontamento: motivo (Liberação do gestor, Férias, Atestado ou outros cadastrados) e anexo obrigatório que comprove a autorização, como o print da conversa com o gestor.
- Não há aprovação: justificativa com comprovante anexado já tira o dia da regra dos 3 dias.
- Motivo e anexo ficam visíveis só para o próprio consultor e para a gestão; o time vê apenas "dia justificado".
- Relatório mensal por consultor: dias sem apontamento, dias justificados e a situação do bônus pela regra dos 3 dias.

### US-12 — Converter provisionamento em hora real

Como consultor, quero transformar uma hora provisionada em hora trabalhada quando a data chega, para que só horas reais sejam faturadas.

- Quando a data de um provisionamento chega, o consultor vê o aviso "Provisionamento a converter" no próprio painel.
- Converter = trocar o tipo para Faturável, Bonificado ou Interno, revisando horas e descrição.
- Provisionamentos vencidos e não convertidos aparecem para a gestão, por consultor.
- O consultor tem 48 horas a partir da data provisionada para converter; depois disso, só com pedido aprovado (US-09 e US-10). O provisionamento vai para o Odoo como não faturável, com o tipo Provisionamento, e é atualizado lá quando convertido.

### Perguntas para o Marttini

- [x] Resolvido: no provisionamento, as 48 horas contam a partir da data provisionada.
- [x] Resolvido: o provisionamento vai para o Odoo.
- [ ] Pendente para o futuro: definir os entregáveis de análise (dashboards e visões) que substituem planilhas.

## M2 e M3 — Projetos e tarefas

Nove histórias organizam o trabalho dentro do projeto anual do cliente, espelhando a estrutura que o Odoo já usa.

| Clarity | Odoo |
|---|---|
| Projeto anual | Projeto "[Cliente] [Ano]" com a etiqueta "Novo modelo" |
| Projeto | Tarefa-mãe dentro do projeto anual |
| Tarefa | Subtarefa de um projeto, ou tarefa simples do projeto anual |
| Status | As 5 etapas do projeto anual |
| Marcadores de situação | Etiquetas da tarefa |

| ID | História | Quem | RF |
|---|---|---|---|
| US-13 | Navegar pela estrutura do cliente | Todos do time | RF-02, RF-07 |
| US-14 | Criar um projeto | Consultor, gestor | RF-04 |
| US-15 | Criar uma tarefa | Consultor, gestor | RF-07 |
| US-16 | Mover pelas etapas e concluir | Consultor, gestor | RF-05, RF-07 |
| US-17 | Alterar prazo com motivo | Consultor, gestor | RF-06 |
| US-18 | Sinalizar situação e sustentação | Consultor, gestor | RF-07, RF-10 |
| US-19 | Definir o que o cliente vê | Consultor, gestor | RF-09 |
| US-20 | Ver em lista, kanban e calendário | Todos do time | RF-08 |
| US-21 | Manter Clarity e Odoo iguais | Sistema | RF-04, RF-07 |

### US-13 — Navegar pela estrutura do cliente

Como membro do time, quero ver tudo de um cliente organizado por ano, para entender rapidamente o que está em andamento.

- O cliente mostra seus projetos anuais; o do ano atual vem aberto.
- Dentro do projeto anual: projetos com suas tarefas, e as tarefas simples.
- Cada projeto mostra status, responsáveis, prazo, percentual de tarefas concluídas e horas apontadas x previstas.
- Busca por nome em todos os níveis.

### US-14 — Criar um projeto

Como consultor ou gestor, quero criar um projeto dentro do projeto anual do cliente, para organizar uma entrega maior em tarefas.

- Qualquer consultor pode criar projetos.
- Campos: nome, escopo, responsáveis, data de início, prazo, horas previstas, sustentação, etiquetas e visibilidade ao cliente.
- Nome, responsável e prazo obrigatórios.
- Todo projeto nasce como Rascunho e só vai para o Odoo quando o escopo é confirmado (US-22 e US-23).
- No Odoo, vira tarefa-mãe do projeto anual com a etiqueta "Projeto".

### US-15 — Criar uma tarefa

Como consultor ou gestor, quero criar tarefas dentro de um projeto ou direto no projeto anual, para registrar cada demanda do cliente.

- Qualquer consultor pode criar tarefas; mesmos campos do projeto, mais checklist. Subtarefa não tem subtarefa: o limite é projeto → tarefa.
- Dentro de um projeto, vira subtarefa no Odoo; fora, vira tarefa simples do projeto anual, com a etiqueta "Tarefa".
- Tarefa de um projeto herda dele cliente, sustentação e visibilidade, todos editáveis.
- Toda solicitação de cliente vira tarefa: é o objetivo nº 1 do Clarity.

### US-16 — Mover pelas etapas e concluir

Como consultor, quero mover projetos e tarefas pelas etapas, para todos saberem em que pé está cada coisa.

- Etapas: Projetos em Análise/Aprovação, Avaliação de novos projetos / estimativa de esforço, Alocação de recursos, Em andamento, Concluído.
- No kanban, arrastar o cartão muda a etapa; no detalhe, um seletor faz o mesmo.
- O percentual do projeto é calculado pelas tarefas concluídas.
- Projeto concluído com tarefas abertas gera um aviso antes de confirmar.
- Toda mudança de etapa fica no histórico com autor e data.

### US-17 — Alterar prazo com motivo

Como gestão, quero saber por que cada prazo mudou, para identificar atrasos recorrentes por cliente e por consultor.

- Só o responsável pelo item ou a gestão mudam o prazo, sempre com um motivo digitado na hora.
- O histórico guarda prazo antigo, prazo novo, motivo, autor e data, e fica visível no item.
- Prazo vencido e não concluído aparece em vermelho em todas as visões.
- Relatório de reprogramações por cliente, consultor e motivo, substituindo a aba Histórico de Previsões da planilha.

### US-18 — Sinalizar situação e sustentação

Como consultor, quero marcar a situação de um item, para deixar claro quando o atraso não depende da Síntese.

- Marcadores: Pausado, Ag. retorno cliente, Pend. doc. cliente, Crítico, Não autorizado, mais os que forem criados.
- Um item pode ter mais de um marcador; cada um tem cor própria e aparece no cartão.
- O marcador de sustentação é herdado pelos apontamentos do item (US-03).
- Filtros por marcador em todas as visões.

### US-19 — Definir o que o cliente vê

Como consultor, quero escolher quais projetos e tarefas aparecem no portal, para mostrar o trabalho sem expor o que é interno.

- Todo item nasce interno; um selo "Interno" ou "Visível ao cliente" aparece em toda visão.
- Tornar um projeto visível pergunta se as tarefas dele também devem ficar visíveis.
- Horas de Provisionamento nunca aparecem ao cliente, mesmo em item visível.

### US-20 — Ver em lista, kanban e calendário

Como membro do time, quero alternar entre visões, para trabalhar do jeito que fizer mais sentido no momento.

- Lista, kanban por etapa e calendário por prazo.
- Filtros por cliente, responsável, etapa, marcador, sustentação e período; o filtro escolhido é lembrado.
- Atalho "Meus itens" mostra só o que está com o usuário logado.

### US-21 — Manter Clarity e Odoo iguais

Como Síntese, quero que projetos e tarefas existam nos dois sistemas, para que as horas sempre tenham onde ser apontadas no Odoo.

- Tudo que é criado ou alterado no Clarity vai para o Odoo pela fila de sincronização, exceto projetos em Rascunho.
- Enquanto o Odoo não for bloqueado, o que mudar lá também aparece no Clarity.
- Conflito: vale a alteração mais recente, e a outra fica registrada no log.
- Só projetos anuais com a etiqueta "Novo modelo" são sincronizados.

### Perguntas para o Marttini

- [x] Resolvido: etiquetas "Projeto" e "Tarefa" no Odoo identificam o tipo de cada tarefa.
- [x] Resolvido: tudo criado no Clarity vai para o Odoo, exceto projetos em Rascunho.
- [x] Resolvido: qualquer consultor cria projetos e tarefas.
- [x] Resolvido: prazo só muda pelo responsável do item ou pela gestão.
- [x] Resolvido: subtarefa não tem subtarefa, por enquanto.
- [x] Resolvido: na virada do ano, são criados projetos anuais novos para todos os clientes ativos.
- [ ] Resolvido: na virada do ano, itens pendentes são movidos para o projeto anual novo. Testado: o item é concluído no ano antigo, com suas horas, e o Clarity cria a continuação ligada no ano novo.

## Escopo e mudanças (proposta)

Um projeto só vale depois que o escopo é confirmado; a partir daí, tudo que o cliente pedir além dele fica marcado e visível como fora do escopo.

| Fase | Onde existe | O que acontece |
|---|---|---|
| Rascunho | Só no Clarity | Escopo em construção, editável à vontade; sem apontamento de horas |
| Confirmado | Clarity e Odoo, a partir da etapa Projetos em Análise/Aprovação | Escopo versão 1 congelado; toda demanda nova sem entregável é demanda adicional |
| Demanda adicional | Clarity e Odoo | Marcada como fora do escopo, visível ao cliente; só aceita horas depois que o cliente aprova |
| Nova versão | Clarity | Gestão incorpora mudanças ao escopo, com motivo; versão anterior preservada |

### US-22 — Montar o escopo em rascunho

Como gestor, quero documentar todo o escopo antes de começar, para ter uma referência clara do que foi combinado.

- Documento de escopo com: objetivo, entregáveis numerados, o que não está incluído, premissas e responsabilidades do cliente, e estimativa de horas.
- Histórico de reuniões: data, participantes e resumo de cada uma.
- Anexos: atas, e-mails, documentos do cliente.
- Tarefas planejadas podem ser criadas ainda no rascunho, cada uma ligada a um entregável.
- Nada do rascunho vai ao Odoo, e não é possível apontar horas nele. Horas de montagem de escopo não são apontadas.

### US-23 — Confirmar o escopo

Como gestor, quero dar o ok no escopo, para congelar o que foi combinado e liberar a execução.

- Só Marttini, Richard e Luiz podem tirar um projeto do rascunho e confirmar o escopo.
- Exige ao menos um entregável e a estimativa de horas.
- Ao confirmar, o escopo vira a versão 1, com data e autor, e fica congelado. O projeto e suas tarefas são criados no Odoo na etapa Projetos em Análise/Aprovação.
- A partir da confirmação, toda demanda nova sem entregável correspondente é demanda adicional (US-24); o escopo só muda por nova versão (US-26).
- Se o projeto for visível, o cliente vê o escopo no portal, só para leitura.

### US-24 — Classificar cada demanda nova

Como consultor, quero registrar se uma demanda está ou não no escopo, para nunca mais fazer trabalho extra sem registro.

- Toda tarefa criada num projeto confirmado pergunta: a qual entregável ela atende?
- Sem entregável correspondente, a tarefa recebe o marcador "Fora do escopo".
- Campos de origem: quem pediu (contato do cliente), quando e por qual canal.
- A gestão pode reclassificar, sempre com motivo registrado.
- Demanda adicional só aceita apontamento depois de aprovada pelo cliente (US-27). Suas horas são somadas à parte, por projeto, e nascem com o tipo Faturável; mudar para Bonificado é manual.

### US-25 — Mostrar ao cliente as demandas adicionais

Como Síntese, quero que o cliente acompanhe as demandas fora do escopo, para que ele veja, em tempo real, o que está sendo feito além do combinado.

- No portal, cada projeto tem uma seção "Demandas adicionais" (internamente, "Fora do escopo"): demanda, data do pedido, quem pediu, status e horas.
- O cliente aprova ou recusa cada demanda adicional no portal (US-27) e pode comentar.
- Total de horas das demandas adicionais aparece junto do total do projeto.

### US-26 — Gerar uma nova versão do escopo

Como gestor, quero incorporar mudanças ao escopo de forma rastreável, para formalizar aditivos.

- Nova versão exige motivo e pode incorporar demandas que estavam fora do escopo.
- Todas as versões ficam salvas e podem ser comparadas lado a lado.
- Tarefas incorporadas deixam de ser fora do escopo a partir da nova versão, mantendo o histórico.

### US-27 — Cliente aprova a demanda adicional

Como cliente, quero aprovar cada demanda adicional antes de ela ser executada, para saber exatamente o que estou contratando além do escopo.

- A demanda adicional nasce "Aguardando aprovação do cliente" e não aceita apontamento de horas. Não há exceção para urgência.
- O cliente recebe aviso e vê, no portal, as demandas pendentes: descrição, quem pediu e quando. Não aprova estimativa de horas.
- Aprovar libera o apontamento e registra quem aprovou e quando; recusar exige motivo e cancela a demanda.
- Aprovação recebida fora do portal (e-mail, mensagem) pode ser registrada pela equipe da Síntese, com anexo obrigatório da evidência.
- Qualquer contato do cliente com acesso ao portal pode aprovar.
- O consultor e a gestão veem as demandas paradas aguardando o cliente, com há quantos dias. Quem executou antes da aprovação é quem deve correr atrás dela, pois só aponta as horas depois.

### Perguntas para o Marttini

- [x] Resolvido: rascunho fica só no Clarity; ao sair dele, o projeto entra no Odoo em Projetos em Análise/Aprovação, e todas as 5 etapas existem nos dois sistemas.
- [x] Resolvido: horas de montagem de escopo não são apontadas.
- [x] Resolvido: só Marttini, Richard e Luiz confirmam escopo.
- [x] Resolvido: demanda fora do escopo é Faturável por padrão; Bonificado só por mudança manual.
- [x] Resolvido: escopo vale só para projetos.
- [x] Resolvido: o escopo congela na confirmação; tudo que vier depois sem entregável é demanda adicional.
- [x] Resolvido: sem exceção para urgência; quem executar antes da aprovação corre atrás dela.
- [x] Resolvido: aprovação por e-mail ou mensagem vale, com print anexado obrigatoriamente.
- [x] Resolvido: o cliente não aprova estimativa de horas.
- [x] Resolvido: qualquer contato do cliente com acesso pode aprovar.

## M1 — Clientes e equipe

Seis histórias trazem do Odoo quem são os clientes e quem é o time, e dão a cada um uma ficha completa no Clarity.

| ID | História | Quem | RF |
|---|---|---|---|
| US-28 | Trazer os clientes do Odoo | Sistema | RF-01 |
| US-29 | Ver a ficha 360° do cliente | Todos do time | RF-02 |
| US-30 | Completar o cliente com dados do Clarity | Gestor, administrador | RF-03 |
| US-31 | Gerenciar os contatos e o acesso ao portal | Consultor, gestor | RF-01, RF-18 |
| US-32 | Trazer a equipe e definir permissões | Administrador | RF-01, RNF-02 |
| US-33 | Ver a ficha do consultor | Todo o time | RF-21 |

### US-28 — Trazer os clientes do Odoo

Como Síntese, quero que os clientes venham do Odoo, para cadastrar cada empresa uma única vez.

- Cliente = empresa vinculada a pelo menos um projeto anual com a etiqueta "Novo modelo".
- Dados trazidos: nome, CNPJ, endereço, cidade, UF, telefone e e-mail; no Clarity são só leitura.
- Sincronização a cada 15 minutos e pelo botão "Sincronizar agora".
- Projetos anuais sem cliente vinculado no Odoo aparecem numa lista de pendências para correção.

### US-29 — Ver a ficha 360° do cliente

Como membro do time, quero ver tudo de um cliente em uma tela, para chegar a uma reunião ou ligação sabendo exatamente onde estamos.

- Cabeçalho: dados do cliente e situação (Ativo, ou Inativo há X meses).
- Seções: projetos por ano, tarefas abertas, demandas adicionais aguardando aprovação, horas do mês por tipo, contatos agendados e realizados, anexos e avaliações.
- Consultores envolvidos: quem é responsável por itens ou apontou horas no cliente no período.
- Histórico de mudanças de prazo do cliente, com motivos.

### US-30 — Completar o cliente com dados do Clarity

Como gestor, quero registrar informações que o Odoo não tem, para conhecer melhor cada cliente.

- Situação calculada automaticamente: Ativo = cliente com horas reais apontadas nos últimos 6 meses (Provisionamento não conta).
- Cliente sem horas há mais de 6 meses recebe o marcador "Inativo há X meses", atualizado todo dia.
- A situação Ativo define para quem são criados os projetos anuais na virada do ano.
- Campos próprios: ERP utilizado e observações internas; ficam só no Clarity e nunca aparecem no portal.
- Consultor responsável pelo cliente fica para uma segunda etapa.

### US-31 — Gerenciar os contatos e o acesso ao portal

Como consultor, quero saber quem são as pessoas de cada cliente e quem acessa o portal, para falar com a pessoa certa.

- Contatos vêm do Odoo: as pessoas cadastradas dentro da empresa cliente. Contato novo é criado obrigatoriamente no Odoo; o Clarity não cria contatos.
- Convidar para o portal envia um e-mail de acesso; o contato entra sem precisar criar senha complexa.
- É possível revogar o acesso a qualquer momento, e a ficha mostra o último acesso de cada contato.
- O contato é usado em "quem pediu" das demandas e nas aprovações.

### US-32 — Trazer a equipe e definir permissões

Como administrador, quero que o time venha do Odoo e entre com o e-mail da Síntese, para não administrar senhas.

- Funcionários vêm do Odoo: nome, e-mail, cargo, foto e vínculo com o usuário.
- Login com a conta Google Workspace da Síntese.
- Perfil de cada pessoa: Administrador, Gestor, Consultor ou Administrativo. Um marcador no funcionário do Odoo diz quem é consultor: só consultores apontam horas e entram em carga do time, ranking, faixas e regra dos 3 dias. Não são consultores: Marttini (CEO), Maria e Ana Clara (administrativo). Richard e Luiz são consultores e gestores. O Administrativo não aponta horas, mas recebe e registra contatos e tarefas de follow-up com clientes. Gestores hoje: Marttini, Richard e Luiz. Todo o time vê todos os clientes, projetos e horas (gestão à vista).
- Permissões especiais: aprovar alterações de apontamento (Marttini e Richard) e confirmar escopo (Marttini, Richard e Luiz).
- Funcionário desligado perde o acesso na hora; o histórico dele é preservado.

### US-33 — Ver a ficha do consultor

Como gestor, quero ver a situação de cada consultor numa tela, para acompanhar carga e desempenho.

- Ficha do consultor no período: horas por dia (régua) e faixa; horas por cliente e por tipo; tarefas concluídas, abertas e atrasadas; prazos reprogramados e motivos; contatos feitos e atrasados; dias sem apontamento, justificados ou não; avaliações (só gestão). Cada número compara o mês atual com o mês anterior e com as médias dos últimos 3, 6 e 12 meses.
- Horas do mês com as cores por dia, e dias sem apontamento justificados ou não.
- Avaliações recebidas: nascem ocultas e só a gestão vê; a gestão decide, uma a uma, publicar para o time ou usar só em feedback individual.
- Todo o time vê a ficha de todos: a transparência estimula a competição saudável e mostra rapidamente quem está sobrecarregado ou parado.

### Perguntas para o Marttini

- [x] Resolvido: consultor responsável pelo cliente fica para uma segunda etapa.
- [x] Resolvido: Ativo = horas apontadas nos últimos 6 meses; depois disso, marcador "Inativo há X meses".
- [x] Resolvido: contato novo só é criado no Odoo.
- [x] Resolvido: gestores são Marttini, Richard e Luiz; todo o time vê tudo.
- [x] Resolvido: avaliações nascem ocultas; a gestão decide publicar ou usar só em feedback.
- [x] Resolvido: justificativa de ausência registrada pelo consultor, com motivo e comprovante obrigatório.
- [ ] Resolvido: a justificativa vale com o comprovante anexado, sem aprovação da gestão.

## M5 — Contatos com o cliente

Cinco histórias transformam o relacionamento com o cliente em agenda: cada ligação, visita ou reunião tem responsável, data e resultado registrado. Os contatos ficam só no Clarity, não vão para o Odoo e não aparecem no portal.

| ID | História | Quem | RF |
|---|---|---|---|
| US-34 | Agendar um contato | Consultor, gestor | RF-13 |
| US-35 | Ver minha agenda de contatos | Consultor | RF-14 |
| US-36 | Registrar o resultado do contato | Consultor | RF-14 |
| US-37 | Alerta de cliente sem contato | Gestão | RF-15 |
| US-38 | Histórico de contatos do cliente | Todo o time | RF-02 |

### US-34 — Agendar um contato

Como gestor, quero agendar uma ação de relacionamento para um consultor, por exemplo "Ligar para o cliente na quinta", para que nenhum combinado dependa de memória.

- Campos: tipo, cliente, contato do cliente (opcional), responsável, data e hora, objetivo e item relacionado (opcional).
- Tipos: Ligação, Visita presencial, Reunião online, E-mail e WhatsApp.
- O responsável recebe o aviso no Clarity, e o contato vira automaticamente um evento na agenda Google dele, com lembrete no celular; remarcar ou cancelar atualiza o evento.
- Qualquer consultor pode agendar contato para outro. Contato agendado pode ser remarcado pelo responsável ou pela gestão, sempre com motivo.

### US-35 — Ver minha agenda de contatos

Como consultor, quero ver os contatos que tenho que fazer, para cumprir cada combinado no dia certo.

- Três grupos: atrasados, hoje e próximos 7 dias.
- Contato atrasado aparece em vermelho, no painel do consultor e no da gestão.
- A agenda também aparece em Minha fila (M8), junto com tarefas e apontamentos.

### US-36 — Registrar o resultado do contato

Como consultor, quero registrar o que aconteceu em cada contato, para que o time inteiro saiba o que foi conversado.

- Resultado: Realizado, Não atendeu ou Remarcado.
- Realizado exige um resumo do que foi conversado.
- Do resultado, o consultor pode criar na hora o próximo passo: um novo contato ou uma tarefa no projeto anual do cliente.
- Remarcado exige a nova data e o motivo.

### US-37 — Alerta de cliente sem contato

Como gestão, quero saber quais clientes estão há muito tempo sem contato, para agir antes que o relacionamento esfrie.

- Conta como contato um registro com resultado Realizado. Contato é relacionamento (saber se está tudo bem, entender necessidades), não atendimento: horas apontadas não contam como contato. Vale para todos os clientes ativos, mesmo sem nada em andamento.
- Cliente ativo sem contato há 5 dias úteis recebe o alerta "Sem contato há X dias", na carteira de clientes e na ficha 360°.
- O prazo padrão de 5 dias úteis pode ser ajustado pelo administrador.

### US-38 — Histórico de contatos do cliente

Como membro do time, quero ver todos os contatos já feitos com um cliente, para chegar à próxima conversa sabendo o que foi combinado.

- Linha do tempo na ficha 360°: data, tipo, quem fez, com quem, resumo e próximo passo.
- Filtros por período, tipo e consultor.
- Visível a todo o time; nunca ao cliente.

### Perguntas para o Marttini

- [x] Resolvido: qualquer consultor pode agendar contato para outro.
- [x] Resolvido: tipos Ligação, Visita presencial, Reunião online, E-mail e WhatsApp.
- [x] Resolvido: alerta após 5 dias úteis sem contato.
- [x] Resolvido: contato agendado vira evento na agenda Google do consultor.
- [ ] Resolvido: o alerta vale para todos os clientes ativos, inclusive sem projeto ou demanda em andamento.

## M6 — Anexos e comentários

Quatro histórias guardam a documentação junto do trabalho e separam, sem risco de erro, a conversa interna da conversa com o cliente.

| ID | História | Quem | RF |
|---|---|---|---|
| US-39 | Anexar arquivos | Todo o time | RF-16 |
| US-40 | Comentar internamente | Todo o time | RF-17 |
| US-41 | Conversar com o cliente no item | Time e cliente | RF-17, RF-19 |
| US-42 | Cliente envia arquivos | Cliente | RF-16, RF-19 |

### US-39 — Anexar arquivos

Como consultor, quero anexar documentos a projetos, tarefas, escopos e contatos, para que tudo fique no lugar onde o trabalho acontece.

- Arrastar e soltar vários arquivos de uma vez; pré-visualização de PDF e imagens.
- Cada anexo guarda autor e data; enviar um arquivo com o mesmo nome cria uma nova versão, sem apagar a anterior.
- O anexo herda a visibilidade do item e pode ser marcado como interno mesmo num item visível ao cliente. Todo anexo de projeto ou tarefa também vai para o Odoo, anexado à tarefa correspondente. Limite de 25 MB por arquivo.
- Comprovantes de justificativa e de aprovação usam o mesmo mecanismo, sempre internos.

### US-40 — Comentar internamente

Como consultor, quero discutir um item com o time ali mesmo, para não perder decisões em conversas soltas.

- Canal Interno em todo projeto, tarefa e contato.
- Menção com @ avisa a pessoa no Clarity e no Slack (ver Central de avisos).
- Cada um edita ou exclui os próprios comentários; comentário editado mostra a marca "editado".

### US-41 — Conversar com o cliente no item

Como consultor, quero responder o cliente dentro do projeto ou da tarefa, para que a conversa fique registrada junto do trabalho.

- Canal Cliente separado do Interno, com cor e selo diferentes.
- Antes de publicar no canal Cliente, o Clarity confirma: "Este comentário será visto pelo cliente".
- O cliente comenta pelo portal nos itens visíveis; os responsáveis pelo item são avisados.
- Comentário do cliente sem resposta aparece em Minha fila e no painel da gestão, com há quanto tempo está esperando; depois de 1 dia útil sem resposta, vira alerta.

### US-42 — Cliente envia arquivos

Como cliente, quero anexar arquivos no meu comentário, por exemplo um print de erro, para explicar o problema sem precisar de e-mail.

- Anexos enviados pelo cliente ficam no item e são visíveis ao time e ao cliente.
- Tipos aceitos: documentos, planilhas, PDF e imagens; arquivos executáveis são bloqueados.

### Perguntas para o Marttini

- [x] Resolvido: anexos também vão para o Odoo.
- [x] Resolvido: limite de 25 MB por arquivo, inicialmente.
- [x] Resolvido: comentário do cliente sem resposta vira alerta em 1 dia útil.
- [x] Resolvido: só vai ao Odoo o anexo de item que existe lá; anexos de rascunho sobem na confirmação do escopo; contatos e comprovantes ficam só no Clarity.
- [x] Resolvido: avisos do time pelo Clarity e pelo Slack; clientes por e-mail na Fase 1 e por WhatsApp na Fase 2.

## Central de avisos

Todo aviso aparece no sino do Clarity e sai por no máximo um canal externo: Slack para o time, e-mail para o cliente (WhatsApp para o cliente na Fase 2).

### US-43 — Receber o aviso certo, no canal certo, sem excesso

Como membro do time, quero receber só os avisos que exigem ação, num único canal, para não passar a ignorar todos.

| Evento | Quem recebe | Canal externo | Como |
|---|---|---|---|
| Menção (@) num comentário | Pessoa mencionada | Slack | Mensagem direta, na hora |
| Comentário do cliente num item | Responsáveis pelo item | Slack | Mensagem direta, na hora |
| Comentário do cliente sem resposta há 1 dia útil | Responsáveis e gestão | Slack | Direta ao responsável; no resumo diário da gestão |
| Contato agendado para você | Responsável | Agenda Google | Evento com lembrete no celular |
| Contato atrasado | Responsável | Slack | Mensagem direta, uma vez por dia |
| Cliente ativo sem contato há 5 dias úteis | Gestão | Slack | Resumo diário da gestão |
| Dia útil sem apontamento | Consultor | Slack | Lembrete no fim do dia |
| 3 dias úteis seguidos sem apontamento | Consultor e gestão | Slack | Direta ao consultor; no resumo diário da gestão |
| Provisionamento a converter | Consultor | Slack | Mensagem direta no dia da data provisionada |
| Prazo vence amanhã ou venceu | Responsável | Slack | Mensagem direta, uma vez por dia |
| Pedido de alteração de apontamento | Marttini e Richard | Slack | Mensagem direta, na hora |
| Pedido de alteração aprovado ou recusado | Consultor | Slack | Mensagem direta, na hora |
| Demanda adicional aprovada ou recusada pelo cliente | Responsável | Slack | Mensagem direta, na hora |
| Demanda adicional aguardando o cliente | Gestão | Slack | Resumo diário da gestão |
| Avaliação recebida | Gestão | Slack | Mensagem direta aos gestores |
| Erro de sincronização com o Odoo | Guardião técnico | Slack | Mensagem direta, na hora |
| Convite ao portal | Contato do cliente | E-mail | Na hora |
| Demanda adicional aguardando aprovação | Contatos do cliente | E-mail (WhatsApp na Fase 2) | Na hora e lembrete a cada 2 dias úteis |
| Resposta da Síntese a um comentário | Contato que comentou | E-mail | Na hora |

Regras contra excesso

- Um aviso sai no sino do Clarity e em no máximo um canal externo; nunca em dois.
- Alertas de gestão são agrupados num resumo diário, às 8h, no canal de gestão do Slack, em vez de um por um.
- Lembretes de pendência repetem no máximo uma vez por dia.
- Avisos externos só saem em dias úteis, das 8h às 18h; fora disso, ficam para o próximo horário comercial. Exceção: erro de sincronização.
- Cada pessoa pode silenciar avisos informativos; avisos de aprovação, prazo e a regra dos 3 dias não podem ser silenciados.

### Perguntas para o Marttini

- [x] Resolvido: resumo diário da gestão no canal #clarity-gestao; erros técnicos vão por mensagem direta ao guardião técnico.
- [x] Resolvido: resumo às 8h; avisos externos em dias úteis, das 8h às 18h.
- [x] Resolvido: o time recebe avisos só pelo Slack, nunca por e-mail.

## M8 — Painéis

Sete histórias de painéis respondem, cada uma numa tela, às perguntas do dia a dia; todos com filtro de período e clique para chegar ao detalhe. Análises mais profundas ficam para os entregáveis de análise, a definir no futuro.

| ID | História | Quem | RF |
|---|---|---|---|
| US-44 | Ver a carga de cada consultor | Todo o time | RF-21 |
| US-45 | Ver a carteira de clientes | Todo o time | RF-21 |
| US-46 | Ver Minha fila | Consultor | RF-21 |
| US-47 | Ver o resumo da gestão | Gestão | RF-21 |
| US-48 | Ranking dos consultores | Todo o time | RF-21, RF-29 |
| US-49 | Modo TV | Gestão | RF-21 |
| US-50 | Acompanhar metas e faixas de bônus | Todo o time | RF-29 |

### US-44 — Ver a carga de cada consultor

Como gestor, quero ver numa tela quantos clientes, projetos e tarefas cada consultor tem, para redistribuir trabalho e saber quem está parado.

- Um cartão por consultor: projetos ativos, tarefas abertas (atrasadas em destaque), clientes englobados, demandas aguardando cliente e contatos da semana (agendados e atrasados).
- Horas do mês com a cor do desempenho e o percentual da meta.
- Ordenação por qualquer indicador; clique no cartão abre a ficha do consultor.
- Visível a todo o time (gestão à vista).

### US-45 — Ver a carteira de clientes

Como gestor, quero ver todos os clientes e a situação de cada um, para saber onde agir primeiro.

- Uma linha por cliente: projetos por etapa, tarefas abertas, demandas adicionais pendentes, horas do mês por tipo, dias desde o último contato, situação Ativo ou Inativo.
- Semáforo de saúde: vermelho com prazo vencido, comentário do cliente sem resposta há 1 dia útil ou 5 dias úteis sem contato; amarelo com demanda aguardando o cliente ou prazo vencendo em até 3 dias; verde nos demais casos.
- Filtros rápidos: só vermelhos, sem contato, aguardando cliente, inativos.
- Clique na linha abre a ficha 360° do cliente.

### US-46 — Ver Minha fila

Como consultor, quero abrir o Clarity e ver tudo o que é meu para hoje, para começar o dia sem procurar nada.

- Tarefas atrasadas e com prazo hoje; contatos do dia; comentários de clientes sem resposta.
- Provisionamentos a converter, dias sem apontamento e pedidos de alteração em andamento.
- Para Marttini e Richard, também os pedidos de alteração aguardando aprovação.
- É a tela inicial do consultor.

### US-47 — Ver o resumo da gestão

Como gestor, quero uma tela inicial com os números da operação, para saber como está a Síntese em um minuto.

- Projetos por etapa, horas do mês da equipe contra a meta, por tipo e por sustentação x desenvolvimento.
- Aprovações pendentes e os mesmos alertas do resumo diário do Slack.
- É a tela inicial de Marttini, Richard e Luiz.

### Perguntas para o Marttini

- [x] Resolvido: metas da equipe e cotas dos consultores definidas (US-50).
- [x] Resolvido: regras do semáforo de saúde aprovadas.
- [x] Resolvido: ranking dos consultores, bem estilizado (US-48).
- [x] Resolvido: modo TV (US-49).

### US-48 — Ranking dos consultores

Como Síntese, quero um ranking visual de horas do mês, para estimular a competição saudável e reconhecer quem mais entrega.

- Pódio destacado para os três primeiros, com foto; demais em lista.
- Cada consultor mostra horas do mês, faixa atingida e quanto falta para a próxima faixa, com barra de progresso.
- Comparação com o mês anterior (subiu ou desceu posições).
- Visual caprichado, na identidade Síntese, desenhado pela Clara.
- Visível a todo o time.

### US-49 — Modo TV

Como gestão, quero deixar os painéis numa TV do escritório, para que a gestão à vista esteja sempre na frente de todos.

- Tela cheia, sem menus, legível a distância.
- Alternância automática entre: ranking, termômetro da meta da equipe, carga por consultor e carteira de clientes.
- Atualiza sozinho, sem ninguém mexer.
- Acesso por um link próprio de TV, só de leitura, que a gestão pode revogar.

### US-50 — Acompanhar metas e faixas de bônus

Como gestão, quero ver o avanço da equipe e de cada consultor contra as metas, para que todos saibam onde estão e quanto falta.

Metas da equipe (acompanhadas por Richard e Luiz)

| Faixa | Horas no mês |
|---|---|
| Cota (mínimo obrigatório) | 1.280 |
| Meta | 1.500 |
| MetaMonkey | 1.725 |
| MetaCrazyMonkey | 2.000 |

Faixas dos consultores

| Horas Faturáveis no mês | Faixa |
|---|---|
| Abaixo de 60 | Abaixo da cota mínima |
| De 60 a menos de 90 | Cota atingida, sem bônus |
| De 90 a menos de 140 | R$ 6 × total de horas |
| De 140 a menos de 175 | R$ 9 × total de horas |
| 175 ou mais | R$ 12 × total de horas |
| Acima de 240 | Mais R$ 300 |

- Só horas do tipo Faturável contam para cotas, metas e faixas.
- Atingida a faixa, o valor vale para o total de horas do mês (ex.: 150 h × R$ 9).
- O limite inferior pertence à faixa de cima: 140 h já entra em R$ 9.
- Termômetro da equipe mostra as quatro faixas e quanto falta para a próxima; o bônus dessas faixas é de Richard e Luiz e não é calculado no Clarity.
- Cada consultor vê horas e faixa atingida; valores em reais não aparecem para ninguém por enquanto.
- Quem cai na regra dos 3 dias aparece marcado como sem bônus no mês.
- Faixas e valores são cadastrados pelo administrador, para mudar sem desenvolvimento.

### Perguntas para o Marttini

- [x] Resolvido: só horas Faturáveis contam.
- [x] Resolvido: atingida a faixa, total de horas × valor da faixa.
- [x] Resolvido: 140 h já entra em R$ 9 (limite inferior pertence à faixa de cima).
- [x] Resolvido: bônus das metas da equipe é de Richard e Luiz, fora do Clarity; o time vê o termômetro.
- [x] Resolvido: valores em reais não são exibidos por enquanto.
- [x] Resolvido: modo TV mostra clientes e time.
