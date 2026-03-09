(function () {
  const PUBLIC_PAGES = ['/login.html'];
  const INACTIVE_TIMEOUT_MS = 60 * 60 * 1000; // 1時間

  function isPublicPage() {
    return PUBLIC_PAGES.some(p => location.pathname.endsWith(p));
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('user')) || null;
    } catch {
      return null;
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('lastActive');
    location.href = '/login.html';
  }

  // 最終アクティブ時刻を更新
  function updateLastActive() {
    localStorage.setItem('lastActive', Date.now().toString());
  }

  // 非アクティブタイムアウトチェック
  function checkInactiveTimeout() {
    const last = parseInt(localStorage.getItem('lastActive') || '0', 10);
    if (last && Date.now() - last > INACTIVE_TIMEOUT_MS) {
      logout();
      return true;
    }
    return false;
  }

  // トークンの有効性をサーバーに確認
  async function validateToken() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        logout();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  if (!isPublicPage()) {
    const token = getToken();

    // トークンなし → ログインへ
    if (!token) {
      location.href = '/login.html';
    } else {
      // 非アクティブタイムアウトチェック
      if (!checkInactiveTimeout()) {
        updateLastActive();
        // トークン有効性確認
        validateToken();
        // アクティブ時刻を定期更新
        ['click', 'keydown', 'scroll', 'mousemove'].forEach(ev => {
          document.addEventListener(ev, updateLastActive, { passive: true });
        });
        // 5分ごとにタイムアウトチェック
        setInterval(() => {
          checkInactiveTimeout();
        }, 5 * 60 * 1000);
      }
    }
  }

  window.authUtils = { getToken, getUser, logout };
})();