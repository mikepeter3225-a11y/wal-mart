// middleware/blockNigeriaVPN.js
//
// Blocks connections that are BOTH:
//   1. Geolocated to Nigeria (via geoip-lite, offline DB)
//   2. Using a VPN / proxy IP (via vpnapi.io)
//
// Install deps:
//   npm install geoip-lite
//
// Requires Node 18+ for native fetch. If you're on an older Node version,
// either upgrade or keep node-fetch.

const geoip = require('geoip-lite');

const VPNAPI_KEY = "2b85e642544749d8b56c5db0ed152ee0"; // set via env var, don't hardcode

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

function normalizeIp(ip) {
  if (!ip) return ip;
  return ip.replace('::ffff:', '');
}

async function isVpnOrProxy(ip) {
    console.log('checking ip')
//   if (ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('::1')) {
//     return false;
//   }

  const url = `https://vpnapi.io/api/${ip}${VPNAPI_KEY ? `?key=${VPNAPI_KEY}` : ''}`;

  try {


    const res = await fetch(url);
  

    if (!res.ok) {
      console.error(`[blockNigeriaVPN] vpnapi returned status ${res.status}`);
      return false;
    }

    const data = await res.json();
 console.log(data)
    // vpnapi.io response shape:
    // { security: { vpn: bool, proxy: bool, tor: bool, relay: bool }, ... }
    if (!data || !data.security) return false;

    return data?.security?.vpn;
  } catch (err) {
    console.error('[blockNigeriaVPN] vpn check failed:', err.message);
    // Fail-open: don't block legitimate users if the check API is down.
    return false;
  }
}

function isNigeria(ip) {
  const geo = geoip.lookup(ip);
  return  geo.country === 'NG';
}

async function blockNigeriaVPN(req, res, next) {
  try {
    const rawIp = getClientIp(req);
    const ip = normalizeIp(rawIp);

    // if (!ip) return next();
    if (!isNigeria(ip)) return next();
       
    const usingVpn = await isVpnOrProxy(ip);
    console.log(usingVpn);

    if (usingVpn) {
      console.warn(`[blockNigeriaVPN] Dropped NG VPN connection from ${ip}`);
      return req.destroy();
    }

    return next();
  } catch (err) {
    console.error('[blockNigeriaVPN] middleware error:', err.message);
    return next();
  }
}

module.exports = blockNigeriaVPN;
