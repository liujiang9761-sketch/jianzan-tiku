const app = getApp();

Page({
  data: {
    subjects: [],
    years: [],
    banner: [
      { title: '2020–2025 历年真题', sub: '四科全覆盖，随时刷随时练' },
      { title: '错题智能收录', sub: '自动归档，专项突破薄弱点' },
    ],
  },

  onLoad() {
    this.loadSubjects();
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  async loadSubjects() {
    try {
      const subjects = await app.request('/api/subjects');
      const years = [2025, 2024, 2023, 2022, 2021, 2020];
      this.setData({ subjects, years });
    } catch (e) {
      wx.showToast({ title: '无法连接服务器', icon: 'error' });
    }
  },

  goSubject(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/subject/subject?subject_id=${id}&subject_name=${encodeURIComponent(name)}`,
    });
  },

  goYearPractice(e) {
    const { year } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/subject/subject?year=${year}&title=${year}年真题`,
    });
  },
});
