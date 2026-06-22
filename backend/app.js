const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态托管管理后台
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// 路由
app.use('/api/questions', require('./routes/questions'));
app.use('/api/records',   require('./routes/records'));

// 科目列表
app.get('/api/subjects', (req, res) => {
  res.json(db.prepare('SELECT * FROM subjects ORDER BY sort').all());
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toLocaleString('zh-CN') });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`✅ 题库服务已启动: http://localhost:${PORT}`);
  console.log(`   管理后台: 用浏览器打开 admin/index.html`);
});
