const express = require('express');
const Referer = require('referer-parser');
const VisitorLog = require('../models/VisitorLog');
const geoip = require('geoip-lite');
const { sendVisitorLogNotification } = require('../bot');

const router = express.Router();

/**
 * Get client IP address from request
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Look up ISP/org info from ip-api.com (live lookup, more accurate than static DBs)
 */
async function checkIsp(ip) {
  try {
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,isp,org,as,query`
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'fail') {
      console.error('[checkIsp] Lookup failed:', data.message);
      return null;
    }

    return data; // { isp, org, as, query }
  } catch (err) {
    console.error('[checkIsp] error:', err.message);
    return null;
  }
}

/**
 * Get location info from IP.
 * Uses geoip-lite for fast local geo data, and ip-api.com for live ISP/org data.
 */
async function getLocationInfo(ip) {
  const fallback = {
    country: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    timezone: 'Unknown',
    isp: 'Unknown',
    org: 'Unknown',
    coordinates: 'Unknown',
  };

  try {
    const geo = geoip.lookup(ip);
    const ispData = await checkIsp(ip); // live lookup, handles rate-limit/private-IP failures internally

    return {
      country: geo?.country || fallback.country,
      city: geo?.city || fallback.city,
      region: geo?.region || fallback.region,
      timezone: geo?.timezone || fallback.timezone,
      isp: ispData?.isp || fallback.isp,
      org: ispData?.org || fallback.org,
      coordinates: geo?.ll ? `${geo.ll[0]}, ${geo.ll[1]}` : fallback.coordinates,
    };
  } catch (err) {
    console.error('[getLocationInfo] Error:', err);
    return fallback;
  }
}

/**
 * Extract device info from user agent
 */
function extractDeviceInfo(userAgent) {
  if (!userAgent) return 'Unknown';

  if (/mobile/i.test(userAgent)) {
    if (/android/i.test(userAgent)) return 'Android Mobile';
    if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS Mobile';
    return 'Mobile Device';
  }

  if (/windows/i.test(userAgent)) return 'Windows Desktop';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac Desktop';
  if (/linux/i.test(userAgent)) return 'Linux Desktop';

  return 'Unknown Device';
}

/**
 * Parse referrer using the referer-parser package.
 * referer-parser is focused on search engines, so for social platforms
 * (which it reports as medium 'unknown'), we patch in our own hostname map.
 */
function parseReferrer(referrerUrl, currentUrl) {
  const fallback = {
    engine: 'Direct',
    medium: 'unknown',
    searchTerm: null,
  };

  if (!referrerUrl || referrerUrl === 'Direct') return fallback;

  try {
    const ref = new Referer(referrerUrl, currentUrl);

    if (ref.medium === 'unknown') {
      const hostname = new URL(referrerUrl).hostname.toLowerCase();
      const socialMap = {
        'facebook.': 'Facebook',
        'twitter.': 'Twitter/X',
        'x.com': 'Twitter/X',
        'linkedin.': 'LinkedIn',
        'instagram.': 'Instagram',
        'reddit.': 'Reddit',
        'tiktok.': 'TikTok',
        'youtube.': 'YouTube',
        'whatsapp.': 'WhatsApp',
        't.me': 'Telegram',
      };

      for (const [pattern, name] of Object.entries(socialMap)) {
        if (hostname.includes(pattern)) {
          return { engine: name, medium: 'social', searchTerm: null };
        }
      }

      return { engine: hostname, medium: 'unknown', searchTerm: null };
    }

    return {
      engine: ref.referer || 'Unknown',
      medium: ref.medium || 'unknown',
      searchTerm: ref.search_term || null,
    };
  } catch (err) {
    console.error('[parseReferrer] Error parsing referrer:', err);
    return fallback;
  }
}

/**
 * POST /api/logs/visitor
 * Log a visitor/page visit
 */
router.post('/visitor', async (req, res) => {
  try {
    const { page, screen, language, url, localTime, utcTime,  referrer,
      referrerType,
      isSearchTraffic,
      searchEngine,
      searchQuery } = req.body || {};
    const clientIp = getClientIp(req);
    const locationInfo = await getLocationInfo(clientIp); // now awaited
    const userAgent = req.get('user-agent');
    const device = extractDeviceInfo(userAgent);
   
  
    

    if (!page) {
      return res.status(400).json({
        success: false,
        message: 'Page name is required.',
      });
    }

    const log = new VisitorLog({
      page: String(page).trim(),
      ip: clientIp,
      userAgent: userAgent,
      referrer: searchEngine,
      location: locationInfo,
      device: device,
      screen: screen || 'Unknown',
      language: language || 'Unknown',
      url: url || 'Unknown',
      localTime: localTime || 'Unknown',
      utcTime: utcTime || new Date().toLocaleString('en-US', { timeZone: 'UTC' }),
    });

    await log.save();

    const city = locationInfo.city || 'Unknown';
    const region = locationInfo.region || 'Unknown';
    const country = locationInfo.country || 'Unknown';
    const timezone = locationInfo.timezone || 'Unknown';
    const isp = locationInfo.isp || 'Unknown';
const notification =
  `🌐 <b>New Visitor</b>\n` +
  `━━━━━━━━━━━━━━━━━━\n\n` +

  `📍 <b>Location:</b> <code>${city}, ${region}, ${country}</code>\n` +
  `🌍 <b>IP:</b> <code>${clientIp}</code>\n` +
  `🔗 <b>ISP:</b> <code>${isp}</code>\n` +
  `⏰ <b>Timezone:</b> <code>${timezone}</code>\n` +
  `📱 <b>Device:</b> <code>${device}</code>\n` +
  `🖥️ <b>Screen:</b> <code>${screen || 'Unknown'}</code>\n\n` +

  `🌍 <b>Language:</b> <code>${language || 'Unknown'}</code>\n` +
  `🌐 <b>Referrer:</b> <a href="${searchEngine}">${searchEngine} </a>\n` +
  (searchQuery
    ? `🔍 <b>Search Term:</b> <code>${searchQuery}</code>\n`
    : ''
  ) +

  `📲 <b>User Agent:</b> <pre>${userAgent}</pre>\n` +
  `🌐 <b>URL:</b> <code>${url || 'Unknown'}</code>\n\n` +

  `⏰ <b>Local Time:</b> <code>${localTime || 'Unknown'}</code>\n` +
  `🕒 <b>UTC Time:</b> <code>${
    utcTime ||
    new Date().toLocaleString('en-US', {
      timeZone: 'UTC'
    })
  }</code>`;

    await sendVisitorLogNotification(notification, {
      ip: clientIp,
      location: locationInfo,
      userAgent: userAgent,
      page: page,
      screen,
      language,
      url,
      localTime,
      utcTime,
     
      isp,
    });

    res.status(200).json({
      success: true,
      message: 'Visitor log recorded.',
    });
  } catch (err) {
    console.error('[logs/visitor] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to log visitor.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});
/**
 * GET /api/logs/visitor
 * Get all visitor logs (admin only)
 */
router.get('/visitor', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const logs = await VisitorLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await VisitorLog.countDocuments();

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: logs,
    });
  } catch (err) {
    console.error('[logs/visitor] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visitor logs.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

/**
 * GET /api/logs/visitor/:page
 * Get logs for a specific page
 */
router.get('/visitor/:page', async (req, res) => {
  try {
    const { page } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const logs = await VisitorLog.find({ page: String(page).trim() })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (err) {
    console.error('[logs/visitor] error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visitor logs.',
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
    });
  }
});

module.exports = router;
