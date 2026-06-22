const express = require('express');
const db = require('../db');
const router = express.Router();

// 提交答题记录
router.post('/', (req, res) => {
  const { openid, question_id, user_answer } = req.body;
  if (!openid || !question_id || user_answer === undefined) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const q = db.prepare('SELECT answer, type FROM questions WHERE id = ?').get(question_id);
  if (!q) return res.status(404).json({ error: '题目不存在' });

  let is_correct = 0;
  if (q.type === 'single') {
    is_correct = String(user_answer).trim().toUpperCase() === String(q.answer).trim().toUpperCase() ? 1 : 0;
  } else if (q.type === 'multiple') {
    const ua = (Array.isArray(user_answer) ? user_answer : String(user_answer).split(',')).map(s => s.trim().toUpperCase()).sort().join(',');
    const ca = String(q.answer).split(',').map(s => s.trim().toUpperCase()).sort().join(',');
    is_correct = ua === ca ? 1 : 0;
  } else {
    // 案例题由老师批改，默认记录，is_correct=-1代表待批改
    is_correct = -1;
  }

  const result = db.prepare(
    `INSERT INTO records(openid, question_id, user_answer, is_correct)
     VALUES(?,?,?,?)`
  ).run(openid, question_id, Array.isArray(user_answer) ? user_answer.join(',') : String(user_answer), is_correct);

  res.json({ id: result.lastInsertRowid, is_correct, correct_answer: q.answer });
});

// 获取用户做题统计
router.get('/stats', (req, res) => {
  const { openid } = req.query;
  if (!openid) return res.status(400).json({ error: '缺少openid' });

  const total  = db.prepare('SELECT COUNT(DISTINCT question_id) as cnt FROM records WHERE openid=?').get(openid).cnt;
  const correct= db.prepare('SELECT COUNT(*) as cnt FROM records WHERE openid=? AND is_correct=1').get(openid).cnt;
  const wrong  = db.prepare('SELECT COUNT(DISTINCT question_id) as cnt FROM records WHERE openid=? AND is_correct=0').get(openid).cnt;

  // 各科做题数
  const bySubject = db.prepare(
    `SELECT s.name, s.id as subject_id,
            COUNT(DISTINCT r.question_id) as done,
            SUM(r.is_correct) as correct_cnt
     FROM records r
     JOIN questions q ON r.question_id = q.id
     JOIN subjects  s ON q.subject_id  = s.id
     WHERE r.openid = ?
     GROUP BY s.id`
  ).all(openid);

  res.json({ total, correct, wrong, accuracy: total ? Math.round(correct / total * 100) : 0, bySubject });
});

// 获取错题列表（每题取最近一次答错的记录）
router.get('/wrong', (req, res) => {
  const { openid, subject_id, page = 1, limit = 20 } = req.query;
  if (!openid) return res.status(400).json({ error: '缺少openid' });

  let where = 'r.openid = ? AND r.is_correct = 0';
  const params = [openid];
  if (subject_id) { where += ' AND q.subject_id = ?'; params.push(subject_id); }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(
    `SELECT COUNT(DISTINCT r.question_id) as cnt
     FROM records r JOIN questions q ON r.question_id = q.id
     WHERE ${where}`
  ).get(...params).cnt;

  const rows = db.prepare(
    `SELECT q.*, s.name as subject_name,
            r.user_answer as my_answer,
            MAX(r.created_at) as last_wrong_at
     FROM records r
     JOIN questions q ON r.question_id = q.id
     JOIN subjects  s ON q.subject_id  = s.id
     WHERE ${where}
     GROUP BY r.question_id
     ORDER BY last_wrong_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), offset);

  rows.forEach(r => { r.options = JSON.parse(r.options); });
  res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
});

// 收藏 / 取消收藏
router.post('/favorite', (req, res) => {
  const { openid, question_id } = req.body;
  if (!openid || !question_id) return res.status(400).json({ error: '缺少参数' });

  const exists = db.prepare('SELECT id FROM favorites WHERE openid=? AND question_id=?').get(openid, question_id);
  if (exists) {
    db.prepare('DELETE FROM favorites WHERE openid=? AND question_id=?').run(openid, question_id);
    res.json({ favorited: false });
  } else {
    db.prepare('INSERT INTO favorites(openid, question_id) VALUES(?,?)').run(openid, question_id);
    res.json({ favorited: true });
  }
});

// 获取收藏列表
router.get('/favorites', (req, res) => {
  const { openid, page = 1, limit = 20 } = req.query;
  if (!openid) return res.status(400).json({ error: '缺少openid' });

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM favorites WHERE openid=?').get(openid).cnt;

  const rows = db.prepare(
    `SELECT q.*, s.name as subject_name, f.created_at as fav_at
     FROM favorites f
     JOIN questions q ON f.question_id = q.id
     JOIN subjects  s ON q.subject_id  = s.id
     WHERE f.openid = ?
     ORDER BY f.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(openid, parseInt(limit), offset);

  rows.forEach(r => { r.options = JSON.parse(r.options); });
  res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
});

// 检查是否已收藏
router.get('/favorite/check', (req, res) => {
  const { openid, question_id } = req.query;
  const exists = db.prepare('SELECT id FROM favorites WHERE openid=? AND question_id=?').get(openid, question_id);
  res.json({ favorited: !!exists });
});

module.exports = router;
