export function walkBookmarkTree(node, visitor, context = { path: [] }) {
  if (!node) return;
  if (node.type === 'folder' || node.children) {
    const nextPath = node.name ? [...context.path, node.name] : [...context.path];
    if (Array.isArray(node.children)) {
      for (const child of node.children) walkBookmarkTree(child, visitor, { path: nextPath });
    }
    return;
  }
  if (node.type === 'url' || node.url) visitor(node, context.path);
}

// 支援精確路徑搜尋，例如 "書籤列/VisualBookmarks"
export function findFolderByPath(node, targetPath, currentPath = []) {
  if (!node) return null;
  const nodeName = node.name || '';
  const newPath = nodeName ? [...currentPath, nodeName] : [...currentPath];

  // 比對路徑結尾是否符合 targetPath (例如 "書籤列/我的最愛" 結尾符合 "我的最愛")
  if ((node.type === 'folder' || node.children) && newPath.join('/').endsWith(targetPath)) {
    return node;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findFolderByPath(child, targetPath, newPath);
      if (found) return found;
    }
  }
  return null;
}