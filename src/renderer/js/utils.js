/**
 * utils.js — Shared utility functions
 */
export const Utils = (() => {
  function truncateText(text, maxLength = 50) {
    const value = String(text ?? '');
    if (maxLength <= 0) return '';
    return value.slice(0, maxLength);
  }

  function getModuleDisplayName(module) {
    return module.listLabel || module.displayName || module.shortTitle || module.description || module.id;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sortBibleModules(modules) {
    return [...modules]
      .filter((m) => m.type === 'bible')
      .sort((a, b) =>
        getModuleDisplayName(a).localeCompare(getModuleDisplayName(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      );
  }

  function sortCommentaryModules(modules) {
    return [...modules].sort((a, b) =>
      getModuleDisplayName(a).localeCompare(getModuleDisplayName(b), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
  }

  return {
    escapeHtml,
    getModuleDisplayName,
    sortBibleModules,
    sortCommentaryModules,
    truncateText,
  };
})();
