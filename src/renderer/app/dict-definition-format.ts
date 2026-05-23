interface DefinitionIndex {
  label: string;
  start: number;
  contentStart: number;
}

interface DefinitionItem {
  label: string;
  text: string;
}

type AnchorRestorer = (value: string) => string;

export function formatDefinition(html: string): string {
  let text = html.replace(/^\s*<b>[^<]*<\/b>\s*<p\s*\/?>\s*/i, '');

  const anchors: string[] = [];
  text = text.replace(/<a\b[^>]*>.*?<\/a>/gi, (match: string) => {
    anchors.push(match);
    return `\x00LINK${anchors.length - 1}\x00`;
  });

  function restoreAnchors(value: string): string {
    return value.replace(
      /\x00LINK(\d+)\x00/g,
      (_placeholder: string, idx: string) => anchors[parseInt(idx, 10)] || ''
    );
  }

  const defStartRegex = /(?:^|\s)(1)\s+([a-z])/;
  const defStartMatch = defStartRegex.exec(text);

  if (!defStartMatch) {
    return '<div class="dict-def-preamble">' + restoreAnchors(text.trim()) + '</div>';
  }

  const preamble = text.substring(0, defStartMatch.index).trim();
  const defText = text.substring(defStartMatch.index).trim();

  const itemRegex = /(?:^|\s)(\d+[a-z]?\d?)\s+(?=[a-z\x00])/g;
  const rawIndices: DefinitionIndex[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(defText)) !== null) {
    rawIndices.push({
      label: match[1],
      start: match.index,
      contentStart: match.index + match[0].length - 1,
    });
  }

  const indices: DefinitionIndex[] = [];
  let lastTopNum = 0;

  for (const idx of rawIndices) {
    const topNum = parseInt(idx.label, 10);
    const level = getLevel(idx.label);

    if (level === 0) {
      if (topNum <= lastTopNum + 1) {
        indices.push(idx);
        lastTopNum = topNum;
      }
    } else if (topNum === lastTopNum) {
      indices.push(idx);
    }
  }

  const items: DefinitionItem[] = [];
  for (let i = 0; i < indices.length; i++) {
    const end = i + 1 < indices.length ? indices[i + 1].start : defText.length;
    items.push({
      label: indices[i].label,
      text: defText.substring(indices[i].contentStart, end).trim(),
    });
  }

  let out = '';

  if (preamble) {
    out += '<div class="dict-def-preamble">' + restoreAnchors(preamble) + '</div>';
  }

  if (items.length > 0) {
    out += buildNestedList(items, restoreAnchors);
  }

  return out;
}

export function buildNestedList(items: DefinitionItem[], restoreAnchors: AnchorRestorer): string {
  let html = '<ol class="dict-def-list">';
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    const level = getLevel(item.label);

    if (level === 0) {
      html +=
        '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

      const subItems: DefinitionItem[] = [];
      let j = i + 1;
      while (j < items.length && getLevel(items[j].label) > 0) {
        subItems.push(items[j]);
        j++;
      }

      if (subItems.length > 0) {
        html += buildSubList(subItems, restoreAnchors);
      }

      html += '</li>';
      i = j;
    } else {
      html +=
        '<li><span class="dict-def-label">' +
        item.label +
        '</span> ' +
        restoreAnchors(item.text) +
        '</li>';
      i++;
    }
  }

  html += '</ol>';
  return html;
}

export function buildSubList(items: DefinitionItem[], restoreAnchors: AnchorRestorer): string {
  let html = '<ol class="dict-def-sublist">';
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    html +=
      '<li><span class="dict-def-label">' + item.label + '</span> ' + restoreAnchors(item.text);

    const deepItems: DefinitionItem[] = [];
    let j = i + 1;
    while (j < items.length && getLevel(items[j].label) > getLevel(item.label)) {
      deepItems.push(items[j]);
      j++;
    }

    if (deepItems.length > 0) {
      html += '<ol class="dict-def-sublist">';
      for (const di of deepItems) {
        html +=
          '<li><span class="dict-def-label">' +
          di.label +
          '</span> ' +
          restoreAnchors(di.text) +
          '</li>';
      }
      html += '</ol>';
    }

    html += '</li>';
    i = j > i + 1 ? j : i + 1;
  }

  html += '</ol>';
  return html;
}

export function getLevel(label: string): number {
  if (/^\d+[a-z]\d+$/.test(label)) return 2;
  if (/^\d+[a-z]$/.test(label)) return 1;
  return 0;
}
