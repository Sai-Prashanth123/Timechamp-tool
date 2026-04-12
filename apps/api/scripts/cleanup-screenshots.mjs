// One-shot cleanup script to purge all test-phase screenshots from
// Supabase Storage. Run with:
//
//   node scripts/cleanup-screenshots.mjs
//
// It walks the `screenshots` bucket recursively via storage.list() with
// pagination (1000 files per page), collects every object path, then
// calls storage.remove() in batches of 1000 (the Supabase bulk-delete
// limit). Matching Postgres metadata rows are cleaned up separately by
// the caller via a DELETE FROM screenshots statement.
//
// Safe to re-run — if the bucket is empty it exits immediately.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kbakbqilgilltgdlowuy.supabase.co';
const SUPABASE_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiYWticWlsZ2lsbHRnZGxvd3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTczODM3MCwiZXhwIjoyMDkxMzE0MzcwfQ.zAi_NgxQtClXXZO3_Xx3uWFSEqKQY6MfCue-Mer5BHg';
const BUCKET = 'screenshots';
const PAGE_SIZE = 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * Recursively walk a bucket and yield every object's full path.
 * storage.list() is non-recursive — it returns the immediate children
 * of the given prefix, with directories as entries whose `id` is null.
 */
async function* walkBucket(prefix = '') {
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // Directory — recurse into it
        yield* walkBucket(fullPath);
      } else {
        // File
        yield fullPath;
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
}

async function main() {
  console.log(`[cleanup] listing all files in bucket: ${BUCKET}`);
  const allPaths = [];
  for await (const path of walkBucket('')) {
    allPaths.push(path);
  }
  console.log(`[cleanup] found ${allPaths.length} files`);

  if (allPaths.length === 0) {
    console.log('[cleanup] bucket already empty — nothing to do');
    return;
  }

  // Delete in batches of 1000 (Supabase Storage bulk-delete limit)
  const BATCH = 1000;
  let deleted = 0;
  for (let i = 0; i < allPaths.length; i += BATCH) {
    const batch = allPaths.slice(i, i + BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error(`[cleanup] batch starting at ${i} failed:`, error.message);
      process.exit(1);
    }
    deleted += batch.length;
    console.log(`[cleanup] deleted ${deleted}/${allPaths.length}`);
  }

  console.log(`[cleanup] done — removed ${deleted} files from Storage`);
  console.log('[cleanup] next: run "DELETE FROM screenshots" via MCP to clear metadata rows');
}

main().catch((err) => {
  console.error('[cleanup] fatal:', err);
  process.exit(1);
});
