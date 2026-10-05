import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DATASET = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'data',
  'open-book-cap-390fcf615d08.json',
);
const LOCK_ID = 1_556_253_001;
const SUBJECTS = new Set(['國文', '數學', '社會', '自然', '英語']);

function validateDataset(dataset) {
  if (!dataset?.sourceName || !dataset?.sourceVersion || !Array.isArray(dataset.questions)) {
    throw new Error('開卷有益題庫格式錯誤');
  }
  if (dataset.questions.length === 0) throw new Error('開卷有益題庫不可為空');
  const ids = new Set();
  for (const item of dataset.questions) {
    if (!item.sourceId || ids.has(item.sourceId)) throw new Error('開卷有益題號重複或缺漏');
    ids.add(item.sourceId);
    if (!SUBJECTS.has(item.subject)
      || !Array.isArray(item.options)
      || item.options.length !== 4
      || !Number.isInteger(item.answerIndex)
      || item.answerIndex < 0
      || item.answerIndex > 3) {
      throw new Error(`開卷有益題目格式錯誤：${item.sourceId}`);
    }
  }
}

export async function seedOpenBookQuestions(pool, datasetPath = DEFAULT_DATASET) {
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  validateDataset(dataset);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const existing = await client.query(
      `SELECT question_count FROM open_book_question_imports
       WHERE source_name = $1 AND source_version = $2`,
      [dataset.sourceName, dataset.sourceVersion],
    );
    if (existing.rowCount > 0) {
      return { imported: false, questionCount: existing.rows[0].question_count };
    }

    await client.query('BEGIN');
    await client.query(
      'UPDATE open_book_questions SET active = false, updated_at = now() WHERE source_name = $1',
      [dataset.sourceName],
    );
    await client.query(
      `INSERT INTO open_book_questions
         (source_id, exam_year, subject, question_number, question, options,
          answer_index, source_name, source_version, active)
       SELECT item.source_id, item.exam_year, item.subject, item.question_number,
              item.question, item.options, item.answer_index, $2, $3, true
       FROM jsonb_to_recordset($1::jsonb) AS item(
         source_id text, exam_year smallint, subject text, question_number text,
         question text, options jsonb, answer_index smallint
       )
       ON CONFLICT (source_id) DO UPDATE SET
         exam_year = EXCLUDED.exam_year,
         subject = EXCLUDED.subject,
         question_number = EXCLUDED.question_number,
         question = EXCLUDED.question,
         options = EXCLUDED.options,
         answer_index = EXCLUDED.answer_index,
         source_name = EXCLUDED.source_name,
         source_version = EXCLUDED.source_version,
         active = true,
         updated_at = now()`,
      [JSON.stringify(dataset.questions.map((item) => ({
        source_id: item.sourceId,
        exam_year: item.year,
        subject: item.subject,
        question_number: item.number,
        question: item.question,
        options: item.options,
        answer_index: item.answerIndex,
      }))), dataset.sourceName, dataset.sourceVersion],
    );
    await client.query(
      `INSERT INTO open_book_question_imports (source_name, source_version, question_count)
       VALUES ($1, $2, $3)`,
      [dataset.sourceName, dataset.sourceVersion, dataset.questions.length],
    );
    await client.query('COMMIT');
    return { imported: true, questionCount: dataset.questions.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
