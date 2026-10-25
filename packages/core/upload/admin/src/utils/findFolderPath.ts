import type { FolderNode } from '../../../shared/contracts/folders';

/**
 * The chain of folders from the library root down to `targetId`, inclusive, or
 * `null` when the folder is not in the tree (deleted, or not loaded yet).
 */
export const findFolderPath = (nodes: FolderNode[], targetId: number): FolderNode[] | null => {
  const parents = new Map<number, FolderNode>();
  const queue: FolderNode[] = [...nodes];
  let target: FolderNode | null = null;

  while (queue.length > 0) {
    const node = queue.shift() as FolderNode;

    if (node.id === targetId) {
      target = node;
      break;
    }

    for (const child of node.children ?? []) {
      if (child.id != null && child.children?.length) {
        parents.set(child.id, node);
      }

      queue.push(child);
    }
  }

  if (target === null) {
    return null;
  }

  const trail: FolderNode[] = target.id != null ? [target] : [];
  let ancestor = target.id != null ? parents.get(target.id) : undefined;

  while (ancestor) {
    if (ancestor.id != null) {
      trail.unshift(ancestor);
    }

    ancestor = ancestor.id != null ? parents.get(ancestor.id) : undefined;
  }

  return trail;
};
