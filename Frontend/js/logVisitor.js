/**
 * logVisitor.js - Log visitor activity on the login page
 * Collects browser, device, system information, and referrer classification
 * Includes comprehensive search engine detection
 */

// Search engine patterns and query parameters
const SEARCH_ENGINES = [
  // Google (all regional TLDs, and google's "News/Images" surfaces)
  { name: 'Google', pattern: /^(https?:\/\/)?([a-z0-9-]+\.)*google\.[a-z.]+\// , queryParam: 'q' },
  // Bing
  { name: 'Bing', pattern: /^(https?:\/\/)?([a-z0-9-]+\.)*bing\.com\// , queryParam: 'q' },
  // Yahoo
  { name: 'Yahoo', pattern: /^(https?:\/\/)?([a-z0-9-]+\.)*(search\.)?yahoo\.[a-z.]+\// , queryParam: 'p' },
  // DuckDuckGo
  { name: 'DuckDuckGo', pattern: /^(https?:\/\/)?(www\.)?duckduckgo\.com\// , queryParam: 'q' },
  // Yandex
  { name: 'Yandex', pattern: /^(https?:\/\/)?([a-z0-9-]+\.)*yandex\.[a-z.]+\// , queryParam: 'text' },
  // Baidu
  { name: 'Baidu', pattern: /^(https?:\/\/)?([a-z0-9-]+\.)*baidu\.com\// , queryParam: 'wd' },
  // Ecosia
  { name: 'Ecosia', pattern: /^(https?:\/\/)?(www\.)?ecosia\.org\// , queryParam: 'q' },
  // Brave Search
  { name: 'Brave', pattern: /^(https?:\/\/)?search\.brave\.com\// , queryParam: 'q' },
  // Naver (Korea)
  { name: 'Naver', pattern: /^(https?:\/\/)?(www\.|search\.)?naver\.com\// , queryParam: 'query' },
  // AOL
  { name: 'AOL', pattern: /^(https?:\/\/)?(search\.)?aol\.com\// , queryParam: 'q' },
  // Startpage
  { name: 'Startpage', pattern: /^(https?:\/\/)?(www\.)?startpage\.com\// , queryParam: 'query' },
  // Ask.com
  { name: 'Ask', pattern: /^(https?:\/\/)?(www\.)?ask\.com\// , queryParam: 'q' },
  // Perplexity (AI search)
  { name: 'Perplexity', pattern: /^(https?:\/\/)?(www\.)?perplexity\.ai\// , queryParam: 'q' },
];

/**
 * Returns the name of the search engine that referred the visitor,
 * or null if the referrer is empty / not a recognized search engine.
 */
function getSearchEngine(referrer = document.referrer) {
  if (!referrer) return null;

  for (const engine of SEARCH_ENGINES) {
    if (engine.pattern.test(referrer)) {
      return engine.name;
    }
  }
  return null;
}

/**
 * Attempts to extract the search query from the referrer URL.
 * Returns null if unavailable (very common now — most engines strip this).
 */
function getSearchQuery(referrer = document.referrer) {
  if (!referrer) return null;

  const engine = SEARCH_ENGINES.find(e => e.pattern.test(referrer));
  if (!engine) return null;

  try {
    const url = new URL(referrer);
    return url.searchParams.get(engine.queryParam) || null;
  } catch {
    return null;
  }
}

/**
 * Infer the default search engine based on browser type.
 * Used as a fallback when referrer is not available or stripped.
 */
function getDefaultSearchByBrowser() {
  const ua = navigator.userAgent;
  let defaultSearch = "unknown";

  if (ua.includes("Chrome") && !ua.includes("Edg") && !ua.includes("OPR")) {
    defaultSearch = "www.google.com/";
  } else if (ua.includes("Edg")) {
    defaultSearch = "www.bing.com/";
  } else if (ua.includes("Firefox")) {
    defaultSearch = "www.google.com/";
  } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
    defaultSearch = "www.google.com/";
  } else if (ua.includes("Brave")) {
    defaultSearch = "www.brave.com/";
  }

  return defaultSearch;
}

/**
 * Convenience helper: returns a full classification object
 * Combines explicit referrer detection with browser-based inference
 */
function classifyReferrer(referrer = document.referrer) {
  const isDirect = !referrer;
  const searchEngine = getDefaultSearchByBrowser();
  
  return {
    referrer: referrer || null,
    searchEngine: searchEngine,// || (isDirect ? getDefaultSearchByBrowser() : null),
    searchQuery: getSearchQuery(referrer),
    isSearchTraffic: searchEngine !== null || isDirect,
    isDirect: isDirect,
    inferredDefaultSearch: isDirect ? getDefaultSearchByBrowser() : null,
  };
}

class VisitorLogger {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl || window.metlife_API_BASE || 'http://localhost:5000';
  }

  /**
   * Get browser and OS information from user agent
   */
  getBrowserInfo() {
    const ua = navigator.userAgent;
    let os = 'Unknown';
    let browser = 'Unknown';

    // Detect OS
    if (ua.indexOf('Win') > -1) os = 'Windows';
    else if (ua.indexOf('Mac') > -1) os = 'MacOS';
    else if (ua.indexOf('Linux') > -1) os = 'Linux';
    else if (ua.indexOf('Android') > -1) os = 'Android';
    else if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) os = 'iOS';

    // Detect browser
    if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (ua.indexOf('Safari') > -1) browser = 'Safari';
    else if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (ua.indexOf('Edge') > -1) browser = 'Edge';
    else if (ua.indexOf('Opera') > -1) browser = 'Opera';

    return { os, browser };
  }

  /**
   * Get device type
   */
  getDevice() {
    const ua = navigator.userAgent;
    if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase())) {
      if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) return 'iPhone/iPad';
      if (ua.indexOf('Android') > -1) return 'Android Phone';
      return 'Mobile Device';
    }
    if (/tablet/i.test(ua.toLowerCase())) return 'Tablet';
    return 'Desktop/Laptop';
  }

  /**
   * Get screen resolution
   */
  getScreenResolution() {
    return `${window.screen.width}x${window.screen.height}`;
  }

  /**
   * Get language preference
   */
  getLanguage() {
    return navigator.language || navigator.userLanguage || 'Unknown';
  }

  /**
   * Get timezone
   */
  getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
      return 'Unknown';
    }
  }

  /**
   * Get local time
   */
  getLocalTime() {
    return new Date().toLocaleString();
  }

  /**
   * Get current page information
   */
  getPageInfo() {
    return {
      url: window.location.href,
      page: 'login',
      referrer: document.referrer || 'direct',
    };
  }

  /**
   * Get classified referrer information with search engine detection and browser-based inference
   */
  getReferrerInfo() {
    return classifyReferrer();
  }

  /**
   * Collect all visitor information
   */
  collectData() {
    const browserInfo = this.getBrowserInfo();
    const referrerInfo = this.getReferrerInfo();

    return {
      // Browser & OS info
      os: browserInfo.os,
      browser: browserInfo.browser,
      device: this.getDevice(),
      userAgent: navigator.userAgent,
      
      // Screen & locale info
      screen: this.getScreenResolution(),
      language: this.getLanguage(),
      timezone: this.getTimezone(),
      
      // Timestamps
      localTime: this.getLocalTime(),
      utcTime: new Date().toLocaleString('en-US', { timeZone: 'UTC' }),
      timestamp: new Date().toISOString(),
      
      // Page info
      url: window.location.href,
      page: 'login',
      
      // Referrer classification
      referrer: referrerInfo.referrer,
      referrerType: referrerInfo.isDirect ? 'direct' : 'referral',
      isSearchTraffic: referrerInfo.isSearchTraffic,
      searchEngine: referrerInfo.searchEngine,
      searchQuery: referrerInfo.searchQuery,
      inferredDefaultSearch: referrerInfo.inferredDefaultSearch,
    };
  }

  /**
   * Send visitor log to backend
   */
  async logVisit() {
    try {
      const data = this.collectData();

      const response = await fetch(`${this.apiBaseUrl}/api/logs/visitor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[VisitorLogger] ✅ Visit logged successfully:', result.logId);
        return result;
      } else {
        const error = await response.json();
        console.warn('[VisitorLogger] ⚠️ Failed to log visit:', error.message);
        return null;
      }
    } catch (err) {
      console.warn('[VisitorLogger] ⚠️ Failed to send visitor log:', err.message);
      return null;
    }
  }
}

// Initialize and log visitor when page loads
document.addEventListener('DOMContentLoaded', function() {
  try {
    const logger = new VisitorLogger(window.metlife_API_BASE);
    logger.logVisit().catch(err => {
      console.warn('[VisitorLogger] Error during page load:', err);
    });
  } catch (err) {
    console.warn('[VisitorLogger] Failed to initialize:', err.message);
  }
});

// Export functions for use in other modules (if using ES modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VisitorLogger, getSearchEngine, getSearchQuery, classifyReferrer, getDefaultSearchByBrowser };
}
