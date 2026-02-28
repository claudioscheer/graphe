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
      noModules: 'Nenhum módulo bíblico encontrado. Coloque arquivos .SQLite3 em ~/.graphe/modules/',
      splitH: 'Dividir horizontalmente',
      splitV: 'Dividir verticalmente',
      closePane: 'Fechar painel',
      prevChapter: 'Capítulo anterior',
      nextChapter: 'Próximo capítulo',
      toggleTheme: 'Alternar tema',
      settings: 'Configurações',
      theme: 'Tema',
      language: 'Idioma',
      light: 'Claro',
      dark: 'Escuro',
      bookUnavailable: 'Este livro não está disponível nesta tradução.',
      chapterUnavailable: 'Este capítulo não está disponível nesta tradução.',
      search: 'Pesquisar',
      searchPlaceholder: 'Buscar por palavra...',
      searchNoResults: 'Nenhum resultado encontrado.',
      searchMinChars: 'Digite pelo menos 2 caracteres.',
      searchResultCount: '{count} resultados',
      strongsSearchOccurrences: 'Pesquisar ocorrências',
      strongsDictionaryLookup: 'Ver no dicionário Strong',
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
      language: 'Language',
      light: 'Light',
      dark: 'Dark',
      bookUnavailable: 'This book is not available in this translation.',
      chapterUnavailable: 'This chapter is not available in this translation.',
      search: 'Search',
      searchPlaceholder: 'Search by word...',
      searchNoResults: 'No results found.',
      searchMinChars: 'Type at least 2 characters.',
      searchResultCount: '{count} results',
      strongsSearchOccurrences: 'Search occurrences',
      strongsDictionaryLookup: "Look up in Strong's dictionary",
    },
    es: {
      oldTestament: 'Antiguo Testamento',
      newTestament: 'Nuevo Testamento',
      navPlaceholder: 'Escriba una referencia, ej: Gn 1:3 o Mt 5',
      back: 'Volver',
      close: 'Cerrar',
      noModules: 'No se encontraron módulos bíblicos. Coloque archivos .SQLite3 en ~/.graphe/modules/',
      splitH: 'Dividir horizontalmente',
      splitV: 'Dividir verticalmente',
      closePane: 'Cerrar panel',
      prevChapter: 'Capítulo anterior',
      nextChapter: 'Capítulo siguiente',
      toggleTheme: 'Cambiar tema',
      settings: 'Ajustes',
      theme: 'Tema',
      language: 'Idioma',
      light: 'Claro',
      dark: 'Oscuro',
      bookUnavailable: 'Este libro no está disponible en esta traducción.',
      chapterUnavailable: 'Este capítulo no está disponible en esta traducción.',
      search: 'Buscar',
      searchPlaceholder: 'Buscar por palabra...',
      searchNoResults: 'No se encontraron resultados.',
      searchMinChars: 'Escriba al menos 2 caracteres.',
      searchResultCount: '{count} resultados',
      strongsSearchOccurrences: 'Buscar ocurrencias',
      strongsDictionaryLookup: 'Ver en el diccionario Strong',
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
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = t(key);
    });
  }

  return { getCurrentLang, setLang, t, updateAll };
})();
