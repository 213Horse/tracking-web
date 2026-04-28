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

  const isBookmediApiUrl = (url) => typeof url === 'string' && url.indexOf('bookmedi.io.vn') !== -1;
  const isThanhToanPage = () => {
    try {
      return (window.location.pathname || '').indexOf('thanh-toan') !== -1;
    } catch (e) { return false; }
  };
  const unwrapPayload = (data) => {
    if (!data || typeof data !== 'object') return null;
    return data.data !== undefined ? data.data : data;
  };
  const cartItemNamesFromPayload = (payload) => {
    const items = payload && (payload.cartItems || payload.cart_items);
    if (!Array.isArray(items)) return [];
    return items.map(function(i) { return i && i.name; }).filter(Boolean);
  };
  const lineItemName = (item) => {
    if (!item || typeof item !== 'object') return null;
    var n = item.name || item.productName || item.product_name || item.title;
    if (n) return n;
    if (item.product && typeof item.product === 'object') {
      return item.product.name || item.product.title || null;
    }
    return null;
  };
  const productNamesFromOrderPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return [];
    var keys = ['cartItems', 'cart_items', 'items', 'orderItems', 'order_items', 'lines', 'orderDetails', 'details'];
    for (var i = 0; i < keys.length; i++) {
      var arr = payload[keys[i]];
      if (Array.isArray(arr)) {
        var names = arr.map(lineItemName).filter(Boolean);
        if (names.length) return names;
      }
    }
    return [];
  };
  const orderNoFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    var n = payload.orderNo != null ? payload.orderNo : payload.order_no;
    if (n == null || n === '') return null;
    return String(n);
  };
  const customerGroupNameFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return undefined;
    if (typeof payload.customerGroupName === 'string' && payload.customerGroupName.trim()) return payload.customerGroupName;
    if (typeof payload.customer_group_name === 'string' && payload.customer_group_name.trim()) return payload.customer_group_name;
    if (payload.customerGroup && typeof payload.customerGroup === 'object') {
      if (typeof payload.customerGroup.name === 'string' && payload.customerGroup.name.trim()) return payload.customerGroup.name;
      if (typeof payload.customerGroup.groupName === 'string' && payload.customerGroup.groupName.trim()) return payload.customerGroup.groupName;
    }
    if (payload.customer_group && typeof payload.customer_group === 'object') {
      if (typeof payload.customer_group.name === 'string' && payload.customer_group.name.trim()) return payload.customer_group.name;
      if (typeof payload.customer_group.group_name === 'string' && payload.customer_group.group_name.trim()) return payload.customer_group.group_name;
    }
    return undefined;
  };
  const identifyTraitsFromErpPayload = (erpData) => {
    if (!erpData || typeof erpData !== 'object' || !erpData.erpId) return null;
    var fullName = erpData.name || ((erpData.firstname || '') + ' ' + (erpData.lastname || '')).trim() || undefined;
    var phoneNumber = erpData.phoneNumber || erpData.phone || erpData.mobile || erpData.phone_number;
    var customerGroupName = customerGroupNameFromPayload(erpData);
    return {
      email: erpData.email,
      firstname: erpData.firstname,
      lastname: erpData.lastname,
      name: fullName,
      erpId: erpData.erpId,
      phoneNumber: phoneNumber ? String(phoneNumber) : undefined,
      customerGroupName: customerGroupName
    };
  };
  const handleBookmediCommerceResponse = (url, ok, data) => {
    if (!isInitialized || !ok || !isBookmediApiUrl(url)) return;
    if (url.indexOf('preview-orders') !== -1 && isThanhToanPage()) {
      var inner = unwrapPayload(data);
      var names = cartItemNamesFromPayload(inner || data);
      if (names.length) {
        tracker.track('checkout_preview', {
          productNames: names,
          pagePath: window.location.pathname
        });
      }
    }
    if (url.indexOf('/api/checkout') !== -1) {
      var inner2 = unwrapPayload(data);
      var orderNo = orderNoFromPayload(inner2) || orderNoFromPayload(data);
      if (orderNo) {
        var boughtNames = productNamesFromOrderPayload(inner2);
        if (!boughtNames.length) boughtNames = productNamesFromOrderPayload(data);
        tracker.track('checkout_success', {
          orderNo: orderNo,
          productNames: boughtNames
        });
      }
    }
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

  // Chỉ dùng POST /ping (startHeartbeat) để cập nhật "đang online" — không gửi thêm event heartbeat
  // để giảm ~50% tải ghi DB so với ping + track('heartbeat').

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
            var identifyTraits = identifyTraitsFromErpPayload(erpData);
            if (identifyTraits) tracker.identify(erpData.erpId, identifyTraits);
            handleBookmediCommerceResponse(url, response.ok, data);
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
      this._bm_track_url = typeof url === 'string' ? url : '';
      if (typeof url === 'string' && url.includes('/api/')) {
        this.addEventListener('load', function() {
          try {
            const rawData = JSON.parse(this.responseText);
            const erpData = rawData?.data || rawData;
            var identifyTraits2 = identifyTraitsFromErpPayload(erpData);
            if (identifyTraits2) tracker.identify(erpData.erpId, identifyTraits2);
            var xhrUrl = this._bm_track_url || '';
            var ok = this.status >= 200 && this.status < 300;
            handleBookmediCommerceResponse(xhrUrl, ok, rawData);
          } catch(e) {}
        });
      }
      return originalOpen.apply(this, [method, url, ...rest]);
    };
  }
  // --- End Auto Interceptor ---

  window.tracker = tracker;
})();
