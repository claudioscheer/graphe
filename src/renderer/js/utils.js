/**
 * utils.js — Shared utility functions
 */
const Utils = (() => {
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
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
  }

  function sortCommentaryModules(modules) {
    return [...modules].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  return { escapeHtml, sortBibleModules, sortCommentaryModules };
})();
