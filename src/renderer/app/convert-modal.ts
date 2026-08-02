/**
 * Module conversion modal (theWord / MySword → MyBible).
 */
import { I18n } from './i18n.js';
import { Icons } from './icons.js';

export const ConvertModal = (() => {
  let overlay: HTMLDivElement | null = null;

  function close(): void {
    if (overlay) {
      overlay.remove();
      overlay = null;
      window.api.cleanupConvert();
    }
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = '',
    text = ''
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function open(): void {
    if (overlay) close();

    overlay = el('div', 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center');
    overlay.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });

    const modal = el(
      'div',
      'bg-brand-50 dark:bg-night-800 shadow-2xl w-[520px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden'
    );

    // Header
    const header = el(
      'div',
      'p-4 border-b border-brand-300 dark:border-night-600 flex items-center justify-between'
    );
    header.appendChild(el('h2', 'text-lg font-semibold', I18n.t('convertModules')));
    const closeBtn = el(
      'button',
      'px-2 py-1 rounded-sm hover:bg-brand-200 dark:hover:bg-night-700 text-brand-500 dark:text-night-400 cursor-pointer transition-colors inline-flex items-center justify-center'
    );
    closeBtn.appendChild(Icons.create('x'));
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    // Body
    const body = el('div', 'p-4 overflow-y-auto flex-1 flex flex-col gap-3');

    // Description
    body.appendChild(
      el('p', 'text-sm text-brand-600 dark:text-night-300', I18n.t('convertModulesDesc'))
    );

    // File list container
    const fileList = el('div', 'convert-file-list hidden');
    body.appendChild(fileList);

    // Status area (for progress / results)
    const statusArea = el('div', 'hidden');
    body.appendChild(statusArea);

    // Footer with buttons
    const footer = el(
      'div',
      'p-4 border-t border-brand-300 dark:border-night-600 flex gap-2 justify-end'
    );

    const selectBtn = el(
      'button',
      'px-4 py-2 rounded-sm bg-brand-600 text-white hover:bg-brand-700 dark:bg-night-500 dark:hover:bg-night-400 cursor-pointer text-sm font-medium transition-colors',
      I18n.t('selectFiles')
    );

    const selectFolderBtn = el(
      'button',
      'px-4 py-2 rounded-sm border border-brand-400 dark:border-night-500 text-brand-700 dark:text-night-300 hover:bg-brand-100 dark:hover:bg-night-700 cursor-pointer text-sm font-medium transition-colors',
      I18n.t('selectFolder')
    );

    const convertBtn = el(
      'button',
      'px-4 py-2 rounded-sm bg-brand-600 text-white hover:bg-brand-700 dark:bg-night-500 dark:hover:bg-night-400 cursor-pointer text-sm font-medium transition-colors hidden',
      I18n.t('convert')
    );

    const installBtn = el(
      'button',
      'px-4 py-2 rounded-sm bg-green-600 text-white hover:bg-green-700 cursor-pointer text-sm font-medium transition-colors hidden',
      I18n.t('installConverted')
    );

    const saveBtn = el(
      'button',
      'px-4 py-2 rounded-sm border border-brand-400 dark:border-night-500 text-brand-700 dark:text-night-300 hover:bg-brand-100 dark:hover:bg-night-700 cursor-pointer text-sm font-medium transition-colors hidden',
      I18n.t('saveAlongside')
    );

    footer.append(selectBtn, selectFolderBtn, convertBtn, installBtn, saveBtn);

    let selectedFiles: ConvertFileCandidate[] = [];
    let convertedFiles: ConvertResult[] = [];

    function renderFileList(
      files: ConvertFileCandidate[],
      results: ConvertResult[] | null = null
    ): void {
      fileList.innerHTML = '';
      fileList.classList.remove('hidden');
      for (let i = 0; i < files.length; i++) {
        const item = el(
          'div',
          'flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-100 dark:bg-night-700'
        );
        const nameSpan = el('span', 'flex-1 truncate', files[i].name);
        item.appendChild(nameSpan);
        if (results && results[i]) {
          const r = results[i];
          if (r.ok) {
            const badge = el(
              'span',
              'text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 whitespace-nowrap',
              I18n.t('convertSuccess')
            );
            item.appendChild(badge);
          } else {
            const badge = el(
              'span',
              'text-xs px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 whitespace-nowrap',
              I18n.t('convertError')
            );
            item.appendChild(badge);
            const err = el(
              'div',
              'text-xs text-red-600 dark:text-red-400 mt-0.5 break-all',
              r.error || ''
            );
            item.classList.add('flex-wrap');
            item.appendChild(err);
          }
        }
        fileList.appendChild(item);
      }
    }

    function onFilesSelected(files: ConvertFileCandidate[]): void {
      selectedFiles = files;
      renderFileList(selectedFiles);
      selectBtn.classList.add('hidden');
      selectFolderBtn.classList.add('hidden');
      convertBtn.classList.remove('hidden');
    }

    selectBtn.addEventListener('click', async () => {
      const result = await window.api.selectConvertFiles();
      if (!result || result.files.length === 0) return;
      onFilesSelected(result.files);
    });

    selectFolderBtn.addEventListener('click', async () => {
      const result = await window.api.selectConvertFolder();
      if (!result || result.files.length === 0) return;
      onFilesSelected(result.files);
    });

    convertBtn.addEventListener('click', async () => {
      convertBtn.disabled = true;
      convertBtn.classList.add('opacity-50');
      selectBtn.classList.add('hidden');

      // Show progress
      statusArea.classList.remove('hidden');
      statusArea.innerHTML = '';
      const spinner = el(
        'div',
        'flex items-center gap-2 text-sm text-brand-600 dark:text-night-300'
      );
      const spinIcon = el(
        'span',
        'inline-block w-4 h-4 border-2 border-brand-400 dark:border-night-400 border-t-transparent rounded-full convert-spinner'
      );
      const spinText = el('span', '', I18n.t('converting'));
      spinner.append(spinIcon, spinText);
      statusArea.appendChild(spinner);

      const results: ConvertResult[] = [];
      convertedFiles = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        spinText.textContent = I18n.t('convertingFile').replace('{name}', selectedFiles[i].name);
        const r = await window.api.convertSingleFile(selectedFiles[i].path);
        results.push(r);
        if (r.ok) convertedFiles.push(r);
        renderFileList(selectedFiles, results);
      }

      // Done
      statusArea.innerHTML = '';
      const successCount = results.filter((r) => r.ok).length;
      const errorCount = results.filter((r) => !r.ok).length;
      const summary = el(
        'div',
        'text-sm font-medium ' +
          (errorCount > 0
            ? 'text-yellow-700 dark:text-yellow-300'
            : 'text-green-700 dark:text-green-300'),
        I18n.t('convertDone')
          .replace('{success}', String(successCount))
          .replace('{errors}', String(errorCount))
      );
      statusArea.appendChild(summary);

      convertBtn.classList.add('hidden');
      if (convertedFiles.length > 0) {
        installBtn.classList.remove('hidden');
        saveBtn.classList.remove('hidden');
      }
    });

    installBtn.addEventListener('click', async () => {
      await window.api.finishConvert(convertedFiles, 'install');
      close();
    });

    saveBtn.addEventListener('click', async () => {
      await window.api.finishConvert(convertedFiles, 'alongside');
      close();
    });

    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  return { open, close, isOpen: () => !!overlay };
})();
