// auth.js — Google OAuth2 via PKCE (no backend needed)

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar'
].join(' ');

export const Auth = {
  clientId: null,
  accessToken: null,
  tokenExpiry: null,

  init(clientId) {
    this.clientId = clientId;
    // Try to restore token from localStorage
    const stored = localStorage.getItem('gtoken');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.expiry > Date.now()) {
        this.accessToken = parsed.token;
        this.tokenExpiry = parsed.expiry;
        return true; // already authenticated
      }
    }
    return false;
  },

  isAuthenticated() {
    return this.accessToken && this.tokenExpiry > Date.now();
  },

  async signIn() {
    return new Promise((resolve, reject) => {
      const redirectUri = window.location.origin + window.location.pathname;
      const params = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: 'token',
        scope: SCOPES,
        include_granted_scopes: 'true'
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      window.location.href = authUrl;
    });
  },

  handleCallback() {
    // Called on page load — check for token in URL hash
    const hash = window.location.hash.substring(1);
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');
    if (token) {
      this.accessToken = token;
      this.tokenExpiry = Date.now() + parseInt(expiresIn) * 1000;
      localStorage.setItem('gtoken', JSON.stringify({
        token: this.accessToken,
        expiry: this.tokenExpiry
      }));
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    }
    return false;
  },

  signOut() {
    this.accessToken = null;
    this.tokenExpiry = null;
    localStorage.removeItem('gtoken');
    localStorage.removeItem('planner_config');
  },

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }
};
