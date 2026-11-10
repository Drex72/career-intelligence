const simpleRead = new Set(['metrics','jobs','people','applications','knowledge','outreach','conversations','operations']);
const dailyBatch = /^batches\/\d{4}-\d{2}-\d{2}$/;
const simplePost = new Set(['applications','outreach/drafts','conversations','discover']);
export function safePath(parts, method) {
  const path = parts.join('/');
  if (method === 'GET' && (simpleRead.has(path) || dailyBatch.test(path) || /^jobs\/[0-9a-f-]{36}\/evidence$/i.test(path))) return path;
  if (method === 'POST' && simplePost.has(path)) return path;
  return null;
}
