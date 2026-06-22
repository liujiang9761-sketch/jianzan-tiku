const app = getApp();

Page({
  data: { stats: null, favorites: [], favTotal: 0 },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 2 });
    }
    this.loadStats();
    this.loadFavorites();
  },

  async loadStats() {
    const openid = app.globalData.openid;
    try {
      const stats = await app.request(`/api/records/stats?openid=${openid}`);
      this.setData({ stats });
    } catch {}
  },

  async loadFavorites() {
    const openid = app.globalData.openid;
    try {
      const res = await app.request(`/api/records/favorites?openid=${openid}&limit=5`);
      this.setData({ favorites: res.data || [], favTotal: res.total || 0 });
    } catch {}
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  clearCache() {
    wx.showModal({
      title: '确认',
      content: '清除本地缓存不会删除做题记录，只会重置设备标识。确定继续？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  },
});
