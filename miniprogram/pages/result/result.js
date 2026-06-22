const app = getApp();

Page({
  data: { stats: null },

  onLoad() {
    this.loadStats();
  },

  async loadStats() {
    const openid = app.globalData.openid;
    const stats = await app.request(`/api/records/stats?openid=${openid}`);
    this.setData({ stats });
  },

  goHome()    { wx.switchTab({ url: '/pages/index/index' }); },
  goWrong()   { wx.switchTab({ url: '/pages/wrong/wrong' }); },
});
