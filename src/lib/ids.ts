export function generateId(prefix: string, existingIds: string[]): string {
  let maxNum = 0;
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  for (const id of existingIds) {
    const match = id.match(re);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `${prefix}_${String(maxNum + 1).padStart(3, '0')}`;
}
