const app = getApp();

Page({
  data: {
    questions: [],
    current: 0,
    total: 0,
    answered: false,
    userAnswer: [],
    isCorrect: false,
    showExplain: false,
    favorited: false,
    loading: true,
    queryParams: {},
    page: 1,
    pageSize: 20,
    allLoaded: false,
    typeLabel: { single: '单选题', multiple: '多选题', case: '案例题' },
  },

  onLoad(opts) {
    const { subject_id, year, type, total } = opts;
    const queryParams = {};
    if (subject_id) queryParams.subject_id = subject_id;
    if (year)       queryParams.year = year;
    if (type)       queryParams.type = type;
    this.setData({ queryParams, total: parseInt(total) || 0 });
    this.loadQuestions();
  },

  async loadQuestions() {
    const { queryParams, page, pageSize, questions } = this.data;
    const p = new URLSearchParams({ ...queryParams, page, limit: pageSize });
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await app.request('/api/questions?' + p.toString());
      const newQ = (res.data || []).map(q => ({
        ...q,
        options: Array.isArray(q.options) ? q.options.map((o, i) => ({
          key: String.fromCharCode(65 + i),
          text: o.replace(/^[A-D]\.\s*/, ''),
        })) : [],
      }));
      this.setData({
        questions: [...questions, ...newQ],
        allLoaded: newQ.length < pageSize,
        loading: false,
      });
      this.checkFavorite();
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'error' });
      this.setData({ loading: false });
    }
    wx.hideLoading();
  },

  selectSingle(e) {
    if (this.data.answered) return;
    this.setData({ userAnswer: [e.currentTarget.dataset.key] });
  },

  selectMultiple(e) {
    if (this.data.answered) return;
    const key = e.currentTarget.dataset.key;
    let arr = [...this.data.userAnswer];
    const idx = arr.indexOf(key);
    if (idx === -1) arr.push(key); else arr.splice(idx, 1);
    arr.sort();
    this.setData({ userAnswer: arr });
  },

  async submit() {
    const { userAnswer, current, questions } = this.data;
    if (!userAnswer.length) return wx.showToast({ title: '请先选择答案', icon: 'none' });
    const q = questions[current];
    const openid = app.globalData.openid;
    try {
      const res = await app.request('/api/records', {
        method: 'POST',
        data: { openid, question_id: q.id, user_answer: userAnswer.join(',') },
      });
      this.setData({ answered: true, isCorrect: res.is_correct === 1 });
    } catch {
      wx.showToast({ title: '提交失败', icon: 'error' });
    }
  },

  submitCase() {
    const q = this.data.questions[this.data.current];
    this.setData({ answered: true, isCorrect: false });
    app.request('/api/records', {
      method: 'POST',
      data: { openid: app.globalData.openid, question_id: q.id, user_answer: '已查看答案' },
    }).catch(() => {});
  },

  toggleExplain() {
    this.setData({ showExplain: !this.data.showExplain });
  },

  next() {
    const { current, questions, allLoaded, page, pageSize, total } = this.data;
    const nextIdx = current + 1;
    if (nextIdx >= questions.length && !allLoaded) {
      this.setData({ page: page + 1 }, () => this.loadQuestions());
    }
    if (nextIdx >= total || (allLoaded && nextIdx >= questions.length)) {
      wx.redirectTo({ url: '/pages/result/result' });
      return;
    }
    this.setData({
      current: nextIdx,
      answered: false,
      userAnswer: [],
      isCorrect: false,
      showExplain: false,
    });
    this.checkFavorite();
  },

  async toggleFavorite() {
    const q = this.data.questions[this.data.current];
    const res = await app.request('/api/records/favorite', {
      method: 'POST',
      data: { openid: app.globalData.openid, question_id: q.id },
    });
    this.setData({ favorited: res.favorited });
    wx.showToast({ title: res.favorited ? '已收藏' : '已取消', icon: 'success' });
  },

  async checkFavorite() {
    const q = this.data.questions[this.data.current];
    if (!q) return;
    const res = await app.request(
      `/api/records/favorite/check?openid=${app.globalData.openid}&question_id=${q.id}`
    );
    this.setData({ favorited: res.favorited });
  },
});
