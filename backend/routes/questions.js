const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const db      = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 获取题目列表（支持筛选、分页）
router.get('/', (req, res) => {
  const { subject_id, year, type, page = 1, limit = 20, keyword } = req.query;
  let where = [];
  let params = [];

  if (subject_id) { where.push('q.subject_id = ?'); params.push(subject_id); }
  if (year)       { where.push('q.year = ?');        params.push(year); }
  if (type)       { where.push('q.type = ?');        params.push(type); }
  if (keyword)    { where.push('q.content LIKE ?');  params.push(`%${keyword}%`); }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM questions q ${whereSQL}`
  ).get(...params).cnt;

  const rows = db.prepare(
    `SELECT q.*, s.name as subject_name
     FROM questions q JOIN subjects s ON q.subject_id = s.id
     ${whereSQL}
     ORDER BY q.year DESC, q.seq ASC
     LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), offset);

  rows.forEach(r => { r.options = JSON.parse(r.options); });

  res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
});

// 获取单题
router.get('/:id', (req, res) => {
  const row = db.prepare(
    `SELECT q.*, s.name as subject_name
     FROM questions q JOIN subjects s ON q.subject_id = s.id
     WHERE q.id = ?`
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: '题目不存在' });
  row.options = JSON.parse(row.options);
  res.json(row);
});

// 新增题目
router.post('/', (req, res) => {
  const { subject_id, year, type, seq = 0, content, options = [], answer, explanation = '', score = 1 } = req.body;
  if (!subject_id || !year || !type || !content || !answer) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  const result = db.prepare(
    `INSERT INTO questions(subject_id,year,type,seq,content,options,answer,explanation,score)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(subject_id, year, type, seq, content, JSON.stringify(options), answer, explanation, score);
  res.json({ id: result.lastInsertRowid });
});

// 修改题目
router.put('/:id', (req, res) => {
  const { subject_id, year, type, seq, content, options, answer, explanation, score } = req.body;
  const q = db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '题目不存在' });

  db.prepare(
    `UPDATE questions SET
       subject_id  = COALESCE(?, subject_id),
       year        = COALESCE(?, year),
       type        = COALESCE(?, type),
       seq         = COALESCE(?, seq),
       content     = COALESCE(?, content),
       options     = COALESCE(?, options),
       answer      = COALESCE(?, answer),
       explanation = COALESCE(?, explanation),
       score       = COALESCE(?, score),
       updated_at  = datetime('now','localtime')
     WHERE id = ?`
  ).run(
    subject_id, year, type, seq, content,
    options !== undefined ? JSON.stringify(options) : undefined,
    answer, explanation, score,
    req.params.id
  );
  res.json({ ok: true });
});

// 删除题目
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 批量删除
router.post('/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '请传入ids数组' });
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM questions WHERE id IN (${placeholders})`).run(...ids);
  res.json({ ok: true, deleted: ids.length });
});

// 获取年份列表
router.get('/meta/years', (req, res) => {
  const { subject_id } = req.query;
  let sql = 'SELECT DISTINCT year FROM questions';
  const params = [];
  if (subject_id) { sql += ' WHERE subject_id = ?'; params.push(subject_id); }
  sql += ' ORDER BY year DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => r.year));
});

// Excel / JSON 批量导入
router.post('/import', upload.single('file'), (req, res) => {
  let rows;

  if (req.file) {
    // Excel 导入
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws);
  } else if (req.body.data) {
    // JSON 导入
    try { rows = JSON.parse(req.body.data); }
    catch { return res.status(400).json({ error: 'JSON 格式错误' }); }
  } else {
    return res.status(400).json({ error: '请上传 Excel 文件或传入 JSON data' });
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO questions(subject_id,year,type,seq,content,options,answer,explanation,score)
     VALUES(?,?,?,?,?,?,?,?,?)`
  );

  let ok = 0, fail = 0, errors = [];
  db.exec('BEGIN TRANSACTION');
  try {
    rows.forEach((r, i) => {
      try {
        const opts = typeof r.options === 'string' ? r.options : JSON.stringify(r.options || []);
        const result = insert.run(
          r.subject_id, r.year, r.type || 'single', r.seq || i + 1,
          r.content, opts, String(r.answer), r.explanation || '', r.score || 1
        );
        if (result.changes > 0) ok++;
      } catch (e) {
        fail++;
        errors.push({ row: i + 1, error: e.message });
      }
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }

  res.json({ ok, fail, errors });
});

module.exports = router;
