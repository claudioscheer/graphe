/**
 * icons.js — Minimal Lucide icon factory for vanilla DOM usage
 */
const Icons = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const ICONS = {
    'arrow-left': '<path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path>',
    'chevron-left': '<path d="m15 18-6-6 6-6"></path>',
    'chevron-right': '<path d="m9 18 6-6-6-6"></path>',
    'ellipsis': '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    'book-open': '<path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path>',
    'search': '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    'x': '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  };

  function create(name, className = 'w-4 h-4') {
    const body = ICONS[name];
    if (!body) throw new Error(`Unknown icon: ${name}`);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.className = `lucide lucide-${name} ${className}`.trim();
    svg.innerHTML = body;
    return svg;
  }

  return { create };
})();
