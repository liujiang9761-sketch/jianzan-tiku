const API_BASE = 'https://jianzan-tiku-production.up.railway.app';

App({
  globalData: {
    apiBase: API_BASE,
    userInfo: null,
    openid: '',
  },

  onLaunch() {
    // 获取本地缓存的 openid（正式版应通过 wx.login 换取）
    const openid = wx.getStorageSync('openid');
    if (openid) {
      this.globalData.openid = openid;
    } else {
      // 开发阶段用设备标识模拟 openid
      const mockId = 'dev_' + Math.random().toString(36).slice(2, 10);
      wx.setStorageSync('openid', mockId);
      this.globalData.openid = mockId;
    }
  },

  // 封装请求方法
  request(path, options = {}) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.globalData.apiBase + path,
        method: options.method || 'GET',
        data: options.data,
        header: { 'Content-Type': 'application/json' },
        success: res => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            reject(res.data);
          }
        },
        fail: err => reject(err),
      });
    });
  },
});
