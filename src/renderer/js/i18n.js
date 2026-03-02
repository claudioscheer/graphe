/**
 * i18n.js — UI translation support (PT, EN, ES)
 */
const I18n = (() => {
  const translations = {
    pt: {
      oldTestament: 'Antigo Testamento',
      newTestament: 'Novo Testamento',
      navPlaceholder: 'Digite uma referência, ex: Gn 1:3 ou Mt 5',
      back: 'Voltar',
      close: 'Fechar',
      noModules:
        'Nenhum módulo bíblico encontrado. Coloque arquivos .SQLite3 em ~/.graphe/modules/',
      splitH: 'Dividir horizontalmente',
      splitV: 'Dividir verticalmente',
      closePane: 'Fechar painel',
      prevChapter: 'Capítulo anterior',
      nextChapter: 'Próximo capítulo',
      toggleTheme: 'Alternar tema',
      settings: 'Configurações',
      theme: 'Tema',
      themeHint: 'Escolha entre tema claro e escuro para leitura confortável.',
      fontSize: 'Tamanho da fonte',
      fontSizeHint: 'Ajusta o tamanho do texto da Bíblia e das janelas laterais.',
      language: 'Idioma',
      languageHint: 'Muda os textos da interface sem alterar a tradução bíblica ativa.',
      light: 'Claro',
      dark: 'Escuro',
      bookUnavailable: 'Este livro não está disponível nesta tradução.',
      chapterUnavailable: 'Este capítulo não está disponível nesta tradução.',
      search: 'Pesquisar',
      searchPlaceholder: 'Buscar por palavra...',
      searchHint: 'Digite sua pesquisa e pressione Enter.',
      searchNoResults: 'Nenhum resultado encontrado.',
      searchMinChars: 'Digite pelo menos 2 caracteres.',
      searchResultCount: '{count} resultados',
      searching: 'Pesquisando...',
      strongsSearchOccurrences: 'Pesquisar ocorrências',
      strongsDictionaryLookup: 'Ver no dicionário Strong',
      dictionary: 'Dicionário',
      dictNoEntry: 'Entrada não encontrada.',
      dictSelectTopic: 'Digite um tema ou clique em um número Strong.',
      dictSearchPlaceholder: 'Buscar tema...',
      dictCognates: 'Palavras relacionadas',
      strongsDictionaries: 'Dicionários Strong',
      strongsDictsHint: 'Escolha quais dicionários consultar ao clicar em um número Strong.',
      dictNoDictsConfigured: 'Nenhum dicionário configurado. Selecione em',
      crossReferences: 'Referências cruzadas',
      crossRefModulesHint: 'Escolha quais módulos usar para exibir referências cruzadas.',
      crossRefBackTooltip: 'Voltar à referência anterior',
      pinLinkTarget: 'Fixar como destino de links',
      unpinLinkTarget: 'Desafixar destino de links',
      crossRefPinnedModal: 'Abrir em modal apenas referências clicadas no painel fixado',
      crossRefPinnedModalHint:
        'Cliques de outros painéis continuam navegando no painel fixado normalmente. Apenas referências clicadas no painel fixado abrem prévia em modal.',
      refUnavailable: 'Referência indisponível nesta tradução',
      commentary: 'Comentário',
      commentaries: 'Comentários',
      splitHBible: 'Bíblia',
      splitVBible: 'Bíblia',
      splitHCommentary: 'Comentário',
      splitVCommentary: 'Comentário',
      commentarySyncHint: 'Escolha qual visualização bíblica atualiza esta janela de comentário.',
      commentarySyncSelectLabel: 'Qual Bíblia vincular a este comentário',
      commentarySyncBiblePrefix: 'Bíblia',
      commentarySyncNone: 'Nenhum',
      noCommentaryModules: 'Nenhum módulo de comentário encontrado.',
      commentaryUnavailable: 'Comentário indisponível para este capítulo.',
      aboutTitle: 'Sobre o Graphe',
      aboutOpenSource: 'Graphe é gratuito e de código aberto. Contribuições são bem-vindas!',
      reportIssue: 'Reportar problema',
    },
    en: {
      oldTestament: 'Old Testament',
      newTestament: 'New Testament',
      navPlaceholder: 'Type a reference, e.g. Gn 1:3 or Mt 5',
      back: 'Back',
      close: 'Close',
      noModules: 'No Bible modules found. Place .SQLite3 files in ~/.graphe/modules/',
      splitH: 'Split horizontally',
      splitV: 'Split vertically',
      closePane: 'Close pane',
      prevChapter: 'Previous chapter',
      nextChapter: 'Next chapter',
      toggleTheme: 'Toggle theme',
      settings: 'Settings',
      theme: 'Theme',
      themeHint: 'Choose light or dark theme for comfortable reading.',
      fontSize: 'Font size',
      fontSizeHint: 'Adjusts text size in Bible content and side panels.',
      language: 'Language',
      languageHint: 'Changes interface language without changing Bible translation.',
      light: 'Light',
      dark: 'Dark',
      bookUnavailable: 'This book is not available in this translation.',
      chapterUnavailable: 'This chapter is not available in this translation.',
      search: 'Search',
      searchPlaceholder: 'Search by word...',
      searchHint: 'Type your search and press Enter.',
      searchNoResults: 'No results found.',
      searchMinChars: 'Type at least 2 characters.',
      searchResultCount: '{count} results',
      searching: 'Searching...',
      strongsSearchOccurrences: 'Search occurrences',
      strongsDictionaryLookup: "Look up in Strong's dictionary",
      dictionary: 'Dictionary',
      dictNoEntry: 'Entry not found.',
      dictSelectTopic: "Type a topic or click a Strong's number.",
      dictSearchPlaceholder: 'Search topic...',
      dictCognates: 'Related words',
      strongsDictionaries: "Strong's Dictionaries",
      strongsDictsHint: "Choose which dictionaries to query when clicking a Strong's number.",
      dictNoDictsConfigured: 'No dictionaries configured. Select in',
      crossReferences: 'Cross-references',
      crossRefModulesHint: 'Choose which modules to use for displaying cross-references.',
      crossRefBackTooltip: 'Go back to previous reference',
      pinLinkTarget: 'Pin as link target',
      unpinLinkTarget: 'Unpin link target',
      crossRefPinnedModal: 'Only open references clicked inside the pinned panel in a modal',
      crossRefPinnedModalHint:
        'Clicks from other panes still navigate the pinned pane normally. Only cross-references clicked in the pinned pane open a modal preview.',
      refUnavailable: 'Reference unavailable in this translation',
      commentary: 'Commentary',
      commentaries: 'Commentaries',
      splitHBible: 'Bible View',
      splitVBible: 'Bible View',
      splitHCommentary: 'Commentary View',
      splitVCommentary: 'Commentary View',
      commentarySyncHint: 'Choose which Bible view updates this commentary window.',
      commentarySyncSelectLabel: 'Which Bible to link this commentary view',
      commentarySyncBiblePrefix: 'Bible',
      commentarySyncNone: 'None',
      noCommentaryModules: 'No commentary modules found.',
      commentaryUnavailable: 'Commentary unavailable for this chapter.',
      aboutTitle: 'About Graphe',
      aboutOpenSource: 'Graphe is free and open-source. Contributions are welcome!',
      reportIssue: 'Report Issue',
    },
    es: {
      oldTestament: 'Antiguo Testamento',
      newTestament: 'Nuevo Testamento',
      navPlaceholder: 'Escriba una referencia, ej: Gn 1:3 o Mt 5',
      back: 'Volver',
      close: 'Cerrar',
      noModules:
        'No se encontraron módulos bíblicos. Coloque archivos .SQLite3 en ~/.graphe/modules/',
      splitH: 'Dividir horizontalmente',
      splitV: 'Dividir verticalmente',
      closePane: 'Cerrar panel',
      prevChapter: 'Capítulo anterior',
      nextChapter: 'Capítulo siguiente',
      toggleTheme: 'Cambiar tema',
      settings: 'Ajustes',
      theme: 'Tema',
      themeHint: 'Elija entre tema claro y oscuro para una lectura cómoda.',
      fontSize: 'Tamaño de fuente',
      fontSizeHint: 'Ajusta el tamaño del texto en la Biblia y paneles laterales.',
      language: 'Idioma',
      languageHint: 'Cambia el idioma de la interfaz sin alterar la traducción bíblica.',
      light: 'Claro',
      dark: 'Oscuro',
      bookUnavailable: 'Este libro no está disponible en esta traducción.',
      chapterUnavailable: 'Este capítulo no está disponible en esta traducción.',
      search: 'Buscar',
      searchPlaceholder: 'Buscar por palabra...',
      searchHint: 'Escriba su búsqueda y presione Enter.',
      searchNoResults: 'No se encontraron resultados.',
      searchMinChars: 'Escriba al menos 2 caracteres.',
      searchResultCount: '{count} resultados',
      searching: 'Buscando...',
      strongsSearchOccurrences: 'Buscar ocurrencias',
      strongsDictionaryLookup: 'Ver en el diccionario Strong',
      dictionary: 'Diccionario',
      dictNoEntry: 'Entrada no encontrada.',
      dictSelectTopic: 'Escriba un tema o haga clic en un número Strong.',
      dictSearchPlaceholder: 'Buscar tema...',
      dictCognates: 'Palabras relacionadas',
      strongsDictionaries: 'Diccionarios Strong',
      strongsDictsHint: 'Elija qué diccionarios consultar al hacer clic en un número Strong.',
      dictNoDictsConfigured: 'No hay diccionarios configurados. Seleccione en',
      crossReferences: 'Referencias cruzadas',
      crossRefModulesHint: 'Elija qué módulos usar para mostrar referencias cruzadas.',
      crossRefBackTooltip: 'Volver a la referencia anterior',
      pinLinkTarget: 'Fijar como destino de enlaces',
      unpinLinkTarget: 'Desfijar destino de enlaces',
      crossRefPinnedModal: 'Abrir en modal solo referencias clicadas en el panel fijado',
      crossRefPinnedModalHint:
        'Los clics desde otros paneles siguen navegando el panel fijado normalmente. Solo las referencias clicadas en el panel fijado abren una vista modal.',
      refUnavailable: 'Referencia no disponible en esta traducción',
      commentary: 'Comentario',
      commentaries: 'Comentarios',
      splitHBible: 'Biblia',
      splitVBible: 'Biblia',
      splitHCommentary: 'Comentario',
      splitVCommentary: 'Comentario',
      commentarySyncHint: 'Elija qué vista bíblica actualiza esta ventana de comentario.',
      commentarySyncSelectLabel: 'Qué Biblia vincular a esta vista de comentario',
      commentarySyncBiblePrefix: 'Biblia',
      commentarySyncNone: 'Ninguno',
      noCommentaryModules: 'No se encontraron módulos de comentario.',
      commentaryUnavailable: 'Comentario no disponible para este capítulo.',
      aboutTitle: 'Acerca de Graphe',
      aboutOpenSource:
        'Graphe es gratuito y de código abierto. ¡Las contribuciones son bienvenidas!',
      reportIssue: 'Reportar problema',
    },
  };

  function getCurrentLang() {
    return localStorage.getItem('graphe-lang') || 'pt';
  }

  function setLang(lang) {
    localStorage.setItem('graphe-lang', lang);
    updateAll();
  }

  function t(key) {
    const lang = getCurrentLang();
    return (translations[lang] && translations[lang][key]) || translations.en[key] || key;
  }

  function updateAll() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      el.title = t(key);
    });
  }

  return { getCurrentLang, setLang, t, updateAll };
})();
