/**
 * utils.js — Shared utility functions
 */
interface DisplayModule {
  id: string;
  type?: string;
  listLabel?: string;
  displayName?: string;
  shortTitle?: string;
  description?: string;
}

interface UtilsApi {
  escapeHtml(str: string): string;
  getModuleDisplayName(module: DisplayModule): string;
  sortBibleModules<T extends DisplayModule>(modules: T[]): T[];
  sortCommentaryModules<T extends DisplayModule>(modules: T[]): T[];
  truncateText(text: string | number | boolean | null | undefined, maxLength?: number): string;
}

export const Utils = (() => {
  function truncateText(
    text: string | number | boolean | null | undefined,
    maxLength: number = 50
  ): string {
    const value = String(text ?? '');
    if (maxLength <= 0) return '';
    return value.slice(0, maxLength);
  }

  function getModuleDisplayName(module: DisplayModule): string {
    return (
      module.listLabel || module.displayName || module.shortTitle || module.description || module.id
    );
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sortBibleModules<T extends DisplayModule>(modules: T[]): T[] {
    return [...modules]
      .filter((m) => m.type === 'bible')
      .sort((a, b) =>
        getModuleDisplayName(a).localeCompare(getModuleDisplayName(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      );
  }

  function sortCommentaryModules<T extends DisplayModule>(modules: T[]): T[] {
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
})() satisfies UtilsApi;
