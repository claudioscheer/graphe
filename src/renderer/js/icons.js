/**
 * icons.js — Thin wrapper around the Lucide icon subset used by the renderer
 */
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Files,
  Info,
  Library,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  X,
  createElement,
} from '../../../node_modules/lucide/dist/esm/lucide.mjs';

export const Icons = (() => {
  const iconNodes = {
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'book-marked': BookMarked,
    'book-open': BookOpen,
    brain: Brain,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    ellipsis: Ellipsis,
    files: Files,
    info: Info,
    library: Library,
    'panel-left-close': PanelLeftClose,
    pin: Pin,
    'pin-off': PinOff,
    plus: Plus,
    search: Search,
    settings: Settings,
    star: Star,
    trash: Trash2,
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
