const app = getApp();

Page({
  data: {
    questions: [],
    total: 0,
    page: 1,
    loading: false,
    subjects: [],
    selSubject: '',
    selSubjectName: '全部科目',
    typeLabel: { single: '单选题', multiple: '多选题', case: '案例题' },
  },

  onLoad() {
    this.loadSubjects();
    this.loadWrong();
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 1 });
    }
    // 每次进入刷新
    this.setData({ questions: [], page: 1 });
    this.loadWrong();
  },

  async loadSubjects() {
    const subjects = await app.request('/api/subjects');
    this.setData({ subjects });
  },

  async loadWrong(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const { selSubject, page } = this.data;
    const p = new URLSearchParams({ page, limit: 20 });
    if (selSubject) p.set('subject_id', selSubject);
    const openid = app.globalData.openid;
    const res = await app.request(`/api/records/wrong?openid=${openid}&${p.toString()}`);
    const newList = (res.data || []).map(q => ({
      ...q,
      options: Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]'),
      showExplain: false,
    }));
    this.setData({
      questions: append ? [...this.data.questions, ...newList] : newList,
      total: res.total || 0,
      loading: false,
    });
  },

  onSubjectChange(e) {
    const sub = this.data.subjects[e.detail.value];
    this.setData({ selSubject: sub ? sub.id : '', selSubjectName: sub ? sub.name : '全部科目', page: 1, questions: [] });
    this.loadWrong();
  },

  toggleExplain(e) {
    const idx = e.currentTarget.dataset.idx;
    const questions = [...this.data.questions];
    questions[idx].showExplain = !questions[idx].showExplain;
    this.setData({ questions });
  },

  // 下拉加载更多
  onReachBottom() {
    if (this.data.questions.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.loadWrong(true);
    }
  },

  practiceWrong() {
    if (!this.data.total) return wx.showToast({ title: '错题本是空的', icon: 'none' });
    // 跳到练习页，传入错题模式标识（需后端支持，这里简化为按已有筛选练习）
    wx.navigateTo({ url: '/pages/subject/subject?title=错题练习' });
  },
});
