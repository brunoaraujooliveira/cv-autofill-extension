import type { Messages } from './en';

export const pt: Messages = {
  'app.name': 'CV Autofill',

  'options.title': 'CV Autofill — Opções',
  'options.close': 'Fechar',
  'options.saved': 'Salvo.',
  'options.error': 'Não foi possível salvar: {detail}',

  'settings.heading': 'Provedor LLM',
  'settings.apiKey': 'Chave da API',
  'settings.apiKey.stored': 'Há uma chave guardada. Digite outra para substituir.',
  'settings.apiKey.missing': 'Nenhuma chave guardada ainda.',
  'settings.apiKey.remove': 'Remover chave',
  'settings.model': 'Modelo',
  'settings.behavior': 'Comportamento',
  'settings.language': 'Idioma',
  'settings.language.auto': 'O mesmo do navegador',
  'settings.fillDelay': 'Intervalo entre campos (ms)',
  'settings.autoAdvance':
    'Avançar automaticamente quando a confiança for alta e não houver pendências',
  'settings.save': 'Salvar configurações',

  'resume.heading': 'CV (JSON Resume)',
  'resume.hint':
    'Cole o seu CV no formato JSON Resume. Use "x-extra" para o que o padrão não cobre.',
  'resume.loadExample': 'Carregar exemplo',
  'resume.format': 'Formatar',
  'resume.save': 'Validar e salvar',
  'resume.valid': 'CV válido e salvo.',
  'resume.invalid': 'Corrija os problemas abaixo antes de salvar:',
  'resume.empty': 'Nenhum CV guardado ainda.',

  'validation.invalidJson': 'JSON inválido: {detail}',
  'validation.dateFormat': 'Use AAAA, AAAA-MM ou AAAA-MM-DD',
  'validation.root': '(raiz)',

  'sidepanel.setup.apiKey': 'Adicione a chave da API nas opções.',
  'sidepanel.setup.resume': 'Adicione o seu CV nas opções.',
  'run.start': 'Preencher esta página',
  'run.restart': 'Ler e preencher de novo',
  'run.noTab': 'Abra o formulário de candidatura numa aba e clique no ícone da extensão nela.',
  'run.phase.IDLE': 'Nada em execução nesta aba.',
  'run.phase.EXTRACTING': 'Lendo o formulário…',
  'run.phase.MAPPING': 'Decidindo o que vai em cada campo…',
  'run.phase.FILLING': 'Preenchendo os campos…',
  'run.phase.VALIDATING': 'Procurando erros…',
  'run.phase.WAITING_USER_REVIEW': 'Pronto. Revise os campos abaixo antes de continuar.',
  'run.phase.ADVANCING': 'Indo para a próxima etapa…',
  'run.phase.FINAL_REVIEW': 'Revisão final. O envio é com você.',
  'run.phase.DONE': 'Concluído.',
  'run.phase.ERROR': 'Algo deu errado.',
  'run.error.missing_api_key': 'Adicione primeiro a chave da API nas opções.',
  'run.error.missing_resume': 'Adicione primeiro o seu CV nas opções.',
  'run.error.injection_failed':
    'Sem acesso a esta aba. Clique no ícone da extensão com o formulário aberto e tente de novo.',
  'run.error.no_fields': 'Nenhum campo de formulário foi encontrado nesta página.',
  'run.error.llm_auth': 'O provedor LLM recusou a chave da API.',
  'run.error.llm_rate_limit':
    'O provedor LLM está limitando as requisições. Tente de novo em instantes.',
  'run.error.llm_unavailable':
    'O provedor LLM está indisponível agora. Tente de novo em instantes.',
  'run.error.llm_network': 'Não foi possível contactar o provedor LLM. Verifique a conexão.',
  'run.error.llm_refusal': 'O modelo recusou-se a processar este formulário.',
  'run.error.llm_invalid_response': 'O modelo respondeu num formato inesperado.',
  'run.error.llm_bad_request': 'O provedor LLM rejeitou a requisição.',
  'run.error.unexpected': 'Erro inesperado.',
  'run.summary': '{filled} preenchidos · {pending} dependem de você · {skipped} ignorados',
  'field.status.filled': 'Preenchido',
  'field.status.failed': 'Não foi possível preencher',
  'field.status.pending_manual': 'Faça manualmente',
  'field.status.ask_user': 'Precisa da sua resposta',
  'field.status.skip': 'Ignorado',
  'field.needsReview': 'Revisar',
  'field.required': 'obrigatório',
  'field.confidence': 'confiança {percent}%',
  'field.unlabeled': '(sem label)',
  'field.yes': 'Sim',
  'field.no': 'Não',

  'run.next': 'Avançar',
  'run.finish': 'Marcar como concluído',
  'run.diagnostics': 'Copiar diagnóstico',
  'run.diagnostics.copied': 'Copiado. Cole onde estiver relatando o problema.',
  'run.restart.hint': 'Esquece o que foi preenchido e revisado nesta etapa e decide tudo de novo.',
  'run.fresh': 'Recomeçar do zero',
  'run.step': 'Etapa {number}',
  'run.jobDescription': 'Descrição da vaga (opcional)',
  'run.jobDescription.hint':
    'Cole o anúncio para embasar respostas geradas, como cartas de apresentação.',
  'run.actionFailed': 'Não funcionou: {detail}',
  'run.notice.next_disabled': 'O formulário ainda não deixa avançar a etapa.',
  'run.notice.next_disabled.missing': 'Provavelmente falta: {fields}',
  'run.notice.step_unchanged':
    'O botão foi clicado mas a etapa não mudou. Veja se a página mostra erros.',
  'run.notice.no_next_button':
    'Nenhum botão para a próxima etapa foi encontrado. Avance na página e leia de novo.',
  'run.notice.page_reloaded':
    'A página foi recarregada. Leia de novo para restaurar o que foi preenchido.',
  'run.shortfall':
    'Não foi possível adicionar mais {missing} bloco(s) com “{button}”. Adicione na página e leia de novo.',
  'run.blocked':
    'Parte deste formulário está num frame de {origin}, que a extensão ainda não pode ler.',
  'run.blocked.allow': 'Permitir acesso a {origin}',
  'field.origin.cache': 'do cache',
  'field.origin.user': 'sua resposta',
  'field.answer': 'Sua resposta',
  'field.answer.save': 'Preencher',
  'field.answer.choose': 'Escolha…',

  'file.heading': 'Arquivo do CV',
  'file.hint': 'Anexado aos campos de upload que pedem o CV. PDF, até 4 MB.',
  'file.none': 'Nenhum arquivo guardado.',
  'file.stored': '{name} ({size} KB)',
  'file.choose': 'Escolher arquivo',
  'file.remove': 'Remover arquivo',
  'file.tooLarge': 'O arquivo tem mais de 4 MB.',

  'answers.heading': 'Banco de respostas',
  'answers.hint':
    'Respostas que você deu a perguntas que o CV não cobre. São reutilizadas quando um formulário pergunta a mesma coisa.',
  'answers.empty': 'Nenhuma resposta guardada ainda.',
  'answers.save': 'Salvar',
  'answers.remove': 'Remover',

  'cache.heading': 'Mapeamentos aprendidos',
  'cache.hint': 'Campos já mapeados em cada site são preenchidos sem consultar o modelo de novo.',
  'cache.empty': 'Nada aprendido ainda.',
  'cache.entry': '{domain}: {fields} campos em {steps} etapas',
  'cache.clear': 'Limpar',

  'sidepanel.openOptions': 'Abrir opções',
};
