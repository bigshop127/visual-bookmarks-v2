import path from 'node:path';
import { readJson, writeJson } from '../utils/io.js';
import { validateAgainstSchema } from '../utils/schema.js';

export async function run() {
  const raw = await readJson(path.resolve('output/raw/bookmarks.raw.json'));
  const validItems = [], invalidItems = [];

  for (const item of raw.items) {
    const result = await validateAgainstSchema(path.resolve('schemas/bookmark.schema.json'), item);
    if (result.valid) validItems.push(item);
    else invalidItems.push({ item, errors: result.errors });
  }

  await writeJson(path.resolve('output/validated/bookmarks.validated.json'), { count: validItems.length, items: validItems });
  if (invalidItems.length > 0) {
    await writeJson(path.resolve('output/reports/validation-errors.json'), invalidItems);
    console.warn(`[Warning] ${invalidItems.length} items failed validation. Check reports.`);
  }
  return validItems.length;
}