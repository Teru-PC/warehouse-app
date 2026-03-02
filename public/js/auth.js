(function () {
  const PUBLIC_PAGES = ['/login.html'];

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
    location.href = '/login.html';
  }

  if (!isPublicPage() && !getToken()) {
    location.href = '/login.html';
  }

  window.authUtils = { getToken, getUser, logout };
})();