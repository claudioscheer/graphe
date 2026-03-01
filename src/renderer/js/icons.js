/**
 * icons.js — Thin wrapper around the Lucide UMD bundle
 */
const Icons = (() => {
  function toPascalCase(name) {
    return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  }

  function create(name, className = 'w-4 h-4') {
    const pascalName = toPascalCase(name);
    const iconNode = lucide.icons[pascalName];
    if (!iconNode) throw new Error(`Unknown icon: ${name}`);
    const svg = lucide.createElement(iconNode);
    svg.setAttribute('class', `lucide lucide-${name} ${className}`.trim());
    return svg;
  }

  return { create };
})();
