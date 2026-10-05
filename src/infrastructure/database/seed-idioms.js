import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DATASET = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'data',
  'moe-idioms-2020-20260929.json',
);
const LOCK_ID = 1_556_253_000;

function validateDataset(dataset) {
  if (!dataset?.sourceName || !dataset?.sourceVersion || !Array.isArray(dataset.entries)) {
    throw new Error('成語詞庫格式錯誤');
  }
  if (dataset.entries.length === 0) throw new Error('成語詞庫不可為空');
  for (const entry of dataset.entries) {
    if (!/^\p{Script=Han}{4}$/u.test(entry.idiom)) {
      throw new Error(`成語詞庫包含無效詞目：${entry.idiom}`);
    }
  }
}

export async function seedIdioms(pool, datasetPath = DEFAULT_DATASET) {
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  validateDataset(dataset);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const existing = await client.query(
      `SELECT entry_count
       FROM idiom_dictionary_imports
       WHERE source_name = $1 AND source_version = $2`,
      [dataset.sourceName, dataset.sourceVersion],
    );
    if (existing.rowCount > 0) {
      return { imported: false, entryCount: existing.rows[0].entry_count };
    }

    await client.query('BEGIN');
    await client.query(
      'UPDATE idioms SET active = false, updated_at = now() WHERE source_name = $1',
      [dataset.sourceName],
    );
    await client.query(
      `INSERT INTO idioms
         (idiom, pronunciation, category, source_name, source_version, active)
       SELECT item.idiom, item.pronunciation, item.category, $2, $3, true
       FROM jsonb_to_recordset($1::jsonb)
         AS item(idiom text, pronunciation text, category text)
       ON CONFLICT (idiom) DO UPDATE
       SET pronunciation = EXCLUDED.pronunciation,
           category = EXCLUDED.category,
           source_name = EXCLUDED.source_name,
           source_version = EXCLUDED.source_version,
           active = true,
           updated_at = now()`,
      [JSON.stringify(dataset.entries), dataset.sourceName, dataset.sourceVersion],
    );
    await client.query(
      `INSERT INTO idiom_dictionary_imports (source_name, source_version, entry_count)
       VALUES ($1, $2, $3)`,
      [dataset.sourceName, dataset.sourceVersion, dataset.entries.length],
    );
    await client.query('COMMIT');
    return { imported: true, entryCount: dataset.entries.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
