(function() {
  const CONFIG = {
    endpoint: 'http://localhost:3001/api/v1',
    apiKey: 'default_secret_key', // Replace with your key
    cookiePrefix: '_at_',
    sessionTimeout: 30 * 60 * 1000 // 30 minutes
  };

  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${CONFIG.cookiePrefix}${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  };

  const setCookie = (name, value, expiry) => {
    const d = new Date();
    d.setTime(d.getTime() + (expiry || 365 * 24 * 60 * 60 * 1000));
    document.cookie = `${CONFIG.cookiePrefix}${name}=${value};expires=${d.toUTCString()};path=/`;
  };

  const uuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // Visitor ID
  let visitorId = getCookie('visitor_id');
  if (!visitorId) {
    visitorId = uuid();
    setCookie('visitor_id', visitorId);
  }

  // Session ID
  let sessionId = getCookie('session_id');
  if (!sessionId) {
    sessionId = uuid();
    setCookie('session_id', sessionId, CONFIG.sessionTimeout);
  }

  const tracker = {
    track: function(name, properties) {
      const data = {
        visitorId,
        sessionId,
        name,
        properties,
        context: {
          url: window.location.href,
          referrer: document.referrer,
          userAgent: navigator.userAgent,
          device: `${window.screen.width}x${window.screen.height}`,
          timestamp: new Date().toISOString()
        }
      };

      fetch(`${CONFIG.endpoint}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(err => console.error('Tracking failed:', err));
    },

    identify: function(userId, traits) {
      const data = {
        visitorId,
        userId,
        traits
      };

      fetch(`${CONFIG.endpoint}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(err => console.error('Identification failed:', err));
    }
  };

  window.tracker = tracker;

  // Auto track pageview
  tracker.track('pageview', { title: document.title });

})();
