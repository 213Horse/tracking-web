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
  // Mapped directly to visitorId to prevent fragmenting history into multiple 30-minute sessions.
  // It will naturally split only when the user changes device, OS, browser (which creates a new visitorId).
  const sessionId = visitorId;

  let isInitialized = false;

  const getUTMS = () => {
    const params = new URLSearchParams(window.location.search);
    const utms = {};
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    utmKeys.forEach(key => {
      const val = params.get(key);
      if (val) utms[key] = val;
    });
    return utms;
  };

  const tracker = {
    init: function(config) {
      if (config.endpoint) CONFIG.endpoint = config.endpoint;
      if (config.apiKey) CONFIG.apiKey = config.apiKey;
      isInitialized = true;
      // Auto track pageview on init with UTMs
      this.track('pageview', { 
        title: document.title,
        url: window.location.href,
        ...getUTMS()
      });
      this.startHeartbeat();
    },

    startHeartbeat: function() {
      // Ping the server every 30 seconds to update the session updatedAt timestamp
      setInterval(() => {
        if (!isInitialized) return;
        fetch(`${CONFIG.endpoint}/ping`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-api-key': CONFIG.apiKey
          },
          body: JSON.stringify({ sessionId })
        }).catch(err => { /* quiet fail */ });
      }, 30 * 1000);
    },

    track: function(name, properties) {
      if (!isInitialized) {
        console.warn('Tracker not initialized. Call tracker.init() first.');
        return;
      }
      const data = {
        visitorId,
        sessionId,
        name,
        properties,
        context: {
          url: window.location.href,
          referrer: document.referrer,
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
          screen: `${window.screen.width}x${window.screen.height}`,
          device: `${window.screen.width}x${window.screen.height}`, // Legacy compatibility
          timestamp: new Date().toISOString()
        }
      };

      fetch(`${CONFIG.endpoint}/track`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.apiKey
        },
        body: JSON.stringify(data)
      }).catch(err => console.error('Tracking failed:', err));
    },

    identify: function(userId, traits) {
      if (!isInitialized) {
        console.warn('Tracker not initialized. Call tracker.init() first.');
        return;
      }
      const data = {
        visitorId,
        userId,
        traits
      };

      fetch(`${CONFIG.endpoint}/identify`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.apiKey
        },
        body: JSON.stringify(data)
      }).catch(err => console.error('Identification failed:', err));
    }
  };

  // Heartbeat every 30 seconds to stay "active"
  setInterval(() => {
    if (isInitialized) {
      tracker.track('heartbeat', { type: 'keep_alive' });
    }
  }, 30000);

  // --- Auto Interceptor for Bookmedi API (Universal Sniffing) ---
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = (typeof args[0] === 'string') ? args[0] : (args[0] instanceof Request ? args[0].url : '');
        // We broadly sniff any API endpoint that returns JSON to catch login or profile data
        if (url.includes('/api/')) {
          const clone = response.clone();
          clone.json().then(data => {
            // Check if the response actually contains user identifying info
            const erpData = data?.data || data; // Handle { data: { erpId } } wrappers just in case
            if (erpData && erpData.erpId) {
              tracker.identify(erpData.erpId, {
                email: erpData.email,
                firstname: erpData.firstname,
                lastname: erpData.lastname,
                name: erpData.name || ((erpData.firstname || '') + ' ' + (erpData.lastname || '')).trim() || undefined,
                erpId: erpData.erpId
              });
            }
          }).catch(() => {});
        }
      } catch(e) {}
      return response;
    };
  }

  const originalXHR = window.XMLHttpRequest;
  if (originalXHR) {
    const originalOpen = originalXHR.prototype.open;
    originalXHR.prototype.open = function(method, url, ...rest) {
      if (typeof url === 'string' && url.includes('/api/')) {
        this.addEventListener('load', function() {
          try {
            const rawData = JSON.parse(this.responseText);
            const erpData = rawData?.data || rawData;
            if (erpData && erpData.erpId) {
              tracker.identify(erpData.erpId, {
                email: erpData.email,
                firstname: erpData.firstname,
                lastname: erpData.lastname,
                name: erpData.name || ((erpData.firstname || '') + ' ' + (erpData.lastname || '')).trim() || undefined,
                erpId: erpData.erpId
              });
            }
          } catch(e) {}
        });
      }
      return originalOpen.apply(this, [method, url, ...rest]);
    };
  }
  // --- End Auto Interceptor ---

  window.tracker = tracker;
})();
