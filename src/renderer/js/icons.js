/**
 * icons.js — Thin wrapper around the Lucide icon subset used by the renderer
 */
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Info,
  Pin,
  PinOff,
  Search,
  Star,
  X,
  createElement,
} from '../../../node_modules/lucide/dist/esm/lucide.js';

export const Icons = (() => {
  const iconNodes = {
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'book-open': BookOpen,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    ellipsis: Ellipsis,
    info: Info,
    pin: Pin,
    'pin-off': PinOff,
    search: Search,
    star: Star,
    x: X,
  };

  function create(name, className = 'w-4 h-4') {
    const iconNode = iconNodes[name];
    if (!iconNode) throw new Error(`Unknown icon: ${name}`);
    const svg = createElement(iconNode);
    svg.setAttribute('class', `lucide lucide-${name} ${className}`.trim());
    return svg;
  }

  return { create };
})();
