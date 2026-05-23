import type { PaneTreeNode, SplitNode } from './pane-model.js';

interface PaneTreeCandidate {
  type?: string;
  paneId?: string;
  direction?: string;
  children?: PaneTreeCandidate[];
  ratio?: number;
}

export function sanitizeTree(
  node: PaneTreeNode | PaneTreeCandidate | null | undefined,
  leafIds: string[]
): PaneTreeNode | null {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'leaf' && typeof node.paneId === 'string') {
    leafIds.push(node.paneId);
    return { type: 'leaf', paneId: node.paneId };
  }

  if (node.type !== 'split' || !Array.isArray(node.children) || node.children.length !== 2) {
    return null;
  }

  const left = sanitizeTree(node.children[0], leafIds);
  const right = sanitizeTree(node.children[1], leafIds);
  if (!left || !right) return null;

  const direction = node.direction === 'v' ? 'v' : 'h';
  if (!Number.isFinite(node.ratio)) return null;

  return {
    type: 'split',
    direction,
    children: [left, right],
    ratio: clampRatio(node.ratio),
  };
}

export function clampRatio(value: number): number {
  const ratio = Number.isFinite(value) ? Number(value) : 0.5;
  return Math.min(0.9, Math.max(0.1, ratio));
}

export function serializeTree(node: PaneTreeNode | null): PaneTreeNode | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'leaf') {
    return { type: 'leaf', paneId: node.paneId };
  }
  return {
    type: 'split',
    direction: node.direction === 'v' ? 'v' : 'h',
    ratio: clampRatio(node.ratio),
    children: [serializeTree(node.children[0]), serializeTree(node.children[1])],
  };
}

export function getFirstLeafId(node: PaneTreeNode): string {
  if (node.type === 'leaf') return node.paneId;
  return getFirstLeafId(node.children[0]);
}

export function getAllLeafIds(node: PaneTreeNode | null): string[] {
  if (!node) return [];
  if (node.type === 'leaf') return [node.paneId];
  return [...getAllLeafIds(node.children[0]), ...getAllLeafIds(node.children[1])];
}

export function findParent(node: PaneTreeNode | null, paneId: string): SplitNode | null {
  if (!node || node.type === 'leaf') return null;
  for (const child of node.children) {
    if (child.type === 'leaf' && child.paneId === paneId) return node;
    const found = findParent(child, paneId);
    if (found) return found;
  }
  return null;
}

export function findSplitChildIndex(parent: SplitNode, paneId: string): number {
  for (let i = 0; i < parent.children.length; i++) {
    if (containsPane(parent.children[i], paneId)) return i;
  }
  return 0;
}

export function containsPane(node: PaneTreeNode, paneId: string): boolean {
  if (node.type === 'leaf') return node.paneId === paneId;
  return node.children.some((child) => containsPane(child, paneId));
}

export function findParentOfNode(rootNode: PaneTreeNode, target: PaneTreeNode): SplitNode | null {
  if (rootNode.type === 'leaf') return null;
  for (const child of rootNode.children) {
    if (child === target) return rootNode;
    const found = findParentOfNode(child, target);
    if (found) return found;
  }
  return null;
}
