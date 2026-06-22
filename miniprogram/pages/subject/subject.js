const app = getApp();

Page({
  data: {
    title: '',
    subject_id: '',
    year: '',
    subjects: [],
    years: [2020,2021,2022,2023,2024,2025],
    types: [
      { label: '全部题型', value: '' },
      { label: '单选题',   value: 'single' },
      { label: '多选题',   value: 'multiple' },
      { label: '案例题',   value: 'case' },
    ],
    selSubject: '',
    selSubjectName: '全部科目',
    selYear: '',
    selType: '',
    selTypeName: '全部题型',
    totalCount: 0,
  },

  onLoad(opts) {
    const title = opts.title ? decodeURIComponent(opts.title) : (opts.subject_name ? decodeURIComponent(opts.subject_name) : '选择练习');
    wx.setNavigationBarTitle({ title });
    this.setData({
      title,
      selSubject: opts.subject_id || '',
      selYear: opts.year || '',
    });
    this.loadSubjects();
    this.loadCount();
  },

  async loadSubjects() {
    const subjects = await app.request('/api/subjects');
    this.setData({ subjects });
  },

  async loadCount() {
    const { selSubject, selYear, selType } = this.data;
    const p = new URLSearchParams({ limit: 1 });
    if (selSubject) p.set('subject_id', selSubject);
    if (selYear)    p.set('year', selYear);
    if (selType)    p.set('type', selType);
    const res = await app.request('/api/questions?' + p.toString());
    this.setData({ totalCount: res.total || 0 });
  },

  onSubjectChange(e) {
    const sub = this.data.subjects[e.detail.value];
    this.setData({ selSubject: sub?.id || '', selSubjectName: sub?.name || '全部科目' });
    this.loadCount();
  },
  onYearChange(e) {
    this.setData({ selYear: this.data.years[e.detail.value] || '' });
    this.loadCount();
  },
  onTypeChange(e) {
    const t = this.data.types[e.detail.value];
    this.setData({ selType: t?.value || '', selTypeName: t?.label || '全部题型' });
    this.loadCount();
  },

  startPractice() {
    const { selSubject, selYear, selType, totalCount } = this.data;
    if (!totalCount) return wx.showToast({ title: '该条件下暂无题目', icon: 'none' });
    const params = new URLSearchParams();
    if (selSubject) params.set('subject_id', selSubject);
    if (selYear)    params.set('year', selYear);
    if (selType)    params.set('type', selType);
    wx.navigateTo({ url: `/pages/practice/practice?${params.toString()}&total=${totalCount}` });
  },
});
