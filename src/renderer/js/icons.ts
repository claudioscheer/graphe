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
} from 'lucide';
import type { IconNode } from 'lucide';

type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'book-marked'
  | 'book-open'
  | 'brain'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'ellipsis'
  | 'files'
  | 'info'
  | 'library'
  | 'panel-left-close'
  | 'pin'
  | 'pin-off'
  | 'plus'
  | 'search'
  | 'settings'
  | 'star'
  | 'trash'
  | 'x';

interface IconsApi {
  create(name: IconName, className?: string): SVGElement;
}

export const Icons = (() => {
  const iconNodes: Record<IconName, IconNode> = {
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

  function create(name: IconName, className: string = 'w-4 h-4'): SVGElement {
    const iconNode = iconNodes[name];
    if (!iconNode) throw new Error(`Unknown icon: ${name}`);
    const svg = createElement(iconNode);
    svg.setAttribute('class', `lucide lucide-${name} ${className}`.trim());
    return svg;
  }

  return { create };
})() satisfies IconsApi;
