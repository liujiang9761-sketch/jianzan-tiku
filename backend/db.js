const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const db = new DatabaseSync(path.join(__dirname, 'tiku.db'));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS subjects (
    id   INTEGER PRIMARY KEY,
    code TEXT    NOT NULL UNIQUE,
    name TEXT    NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id),
    year        INTEGER NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('single','multiple','case')),
    seq         INTEGER NOT NULL DEFAULT 0,
    content     TEXT    NOT NULL,
    options     TEXT    NOT NULL DEFAULT '[]',
    answer      TEXT    NOT NULL,
    explanation TEXT    NOT NULL DEFAULT '',
    score       REAL    NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    openid      TEXT    NOT NULL,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_answer TEXT    NOT NULL,
    is_correct  INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    openid      TEXT    NOT NULL,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(openid, question_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_unique ON questions(subject_id,year,type,seq);
  CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
  CREATE INDEX IF NOT EXISTS idx_questions_year    ON questions(year);
  CREATE INDEX IF NOT EXISTS idx_records_openid    ON records(openid);
  CREATE INDEX IF NOT EXISTS idx_favorites_openid  ON favorites(openid);
`);

// 初始化科目
const insertSubject = db.prepare(
  'INSERT OR IGNORE INTO subjects(id,code,name,sort) VALUES(?,?,?,?)'
);
[
  [1, 'jzgl',  '建筑工程管理与实务',     1],
  [2, 'jjjs',  '建设工程经济',            2],
  [3, 'xmll',  '建设工程项目管理',        3],
  [4, 'fagui', '建设工程法规及相关知识',  4],
].forEach(row => insertSubject.run(...row));

// 启动时自动导种（Railway 等无持久存储环境）
const qCount = db.prepare('SELECT COUNT(*) as cnt FROM questions').get().cnt;
if (qCount === 0) {
  const seedFile = path.join(__dirname, 'scripts/parsed_questions.json');
  if (fs.existsSync(seedFile)) {
    console.log('⏳ 题库为空，正在从种子文件导入...');
    const rows = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
    const ins = db.prepare(
      `INSERT OR IGNORE INTO questions(subject_id,year,type,seq,content,options,answer,explanation,score)
       VALUES(?,?,?,?,?,?,?,?,?)`
    );
    db.exec('BEGIN');
    rows.forEach(r => ins.run(
      r.subject_id, r.year, r.type, r.seq, r.content,
      JSON.stringify(r.options || []), String(r.answer), r.explanation || '', r.score || 1
    ));
    db.exec('COMMIT');
    console.log(`✅ 已导入 ${rows.length} 道题目`);
  }
}

module.exports = db;
