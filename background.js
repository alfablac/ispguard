// STARTUP LOG - THIS SHOULD APPEAR IMMEDIATELY
console.log("========================================");
console.log("ISP Guard v2 - Background script LOADED");
console.log("========================================");

const SETTINGS_KEY = "ispGuard_settings";
const DEFAULT_SETTINGS = {
  protectedDomains: [],
  refIPv4: "",
  refIPv6: "",
  refISP: "",
  dynamicIP: false
};

const pendingChecks = new Set();

function isValidIPv4(ip) {
  if (!ip) return false;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

function isValidIPv6(ip) {
  if (!ip) return false;
  return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
}

function getSettings(callback) {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    callback(settings);
  });
}

// HELPER FUNCTION - Call this from console to test
window.testSetProtectedDomain = function(domain) {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    if (!settings.protectedDomains.includes(domain)) {
      settings.protectedDomains.push(domain);
    }
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
      console.log("✓ Test domain added:", domain);
      console.log("✓ New settings:", settings);
    });
  });
};

// HELPER FUNCTION - View current settings
window.viewSettings = function() {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    console.log("Current settings:", result[SETTINGS_KEY] || "No settings saved");
  });
};

console.log("🛠️ Test helpers available:");
console.log("  viewSettings() - View current settings");
console.log("  testSetProtectedDomain('globo.com') - Add a protected domain");

async function fetchFromAPI(api, timeout = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(api.url, { 
      cache: "no-store",
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) return null;
    const j = await res.json();
    return api.parse(j);
  } catch(e) {
    clearTimeout(timeoutId);
    return null;
  }
}

// COMPREHENSIVE IP DETECTION - Same as options.js
async function fetchIPData() {
  console.log("🔍 Fetching IP data from multiple sources...");
  
  const apis = [
    {
      name: "ipify",
      url: "https://api.ipify.org?format=json",
      parse: (j) => ({
        ipv4: j.ip && isValidIPv4(j.ip) ? j.ip : "",
        ipv6: "",
        isp: ""
      })
    },
    {
      name: "ipwho",
      url: "https://ipwho.is/",
      parse: (j) => ({
        ipv4: j.ip && isValidIPv4(j.ip) ? j.ip : "",
        ipv6: j.ip && isValidIPv6(j.ip) ? j.ip : "",
        isp: j.connection?.isp || j.connection?.org || ""
      })
    },
    {
      name: "ipapi",
      url: "https://ipapi.co/json/",
      parse: (j) => ({
        ipv4: j.ip && isValidIPv4(j.ip) ? j.ip : "",
        ipv6: "",
        isp: j.org || j.isp || ""
      })
    },
    {
      name: "ifconfig",
      url: "https://ifconfig.co/json",
      parse: (j) => ({
        ipv4: j.ip_addr && isValidIPv4(j.ip_addr) ? j.ip_addr : (j.ip && isValidIPv4(j.ip) ? j.ip : ""),
        ipv6: j.ip && isValidIPv6(j.ip) ? j.ip : "",
        isp: j.asn_org || ""
      })
    }
  ];
  
  const promises = apis.map(api => fetchFromAPI(api));
  
  let ipv4 = "";
  let ipv6 = "";
  let isp = "";
  let successCount = 0;
  
  for (const promise of promises) {
    try {
      const result = await promise;
      
      if (result) {
        successCount++;
        
        if (result.ipv4 && !ipv4) ipv4 = result.ipv4;
        if (result.ipv6 && !ipv6) ipv6 = result.ipv6;
        if (result.isp && !isp) isp = result.isp;
        
        if (successCount >= 2 && (ipv4 || ipv6)) {
          break;
        }
      }
    } catch(e) {
      // Continue
    }
  }
  
  // Try IPv6 detection if we don't have it yet
  if (!ipv6) {
    try {
      const ipv6Result = await fetchFromAPI({
        name: "ipify64",
        url: "https://api64.ipify.org?format=json",
        parse: (j) => ({
          ipv4: "",
          ipv6: j.ip && isValidIPv6(j.ip) ? j.ip : "",
          isp: ""
        })
      }, 2000);
      
      if (ipv6Result && ipv6Result.ipv6) {
        ipv6 = ipv6Result.ipv6;
      }
    } catch(e) {
      // Continue
    }
  }
  
  if (!isp && (ipv4 || ipv6)) {
    try {
      const checkIp = ipv4 || ipv6;
      const ispResult = await fetchFromAPI({
        name: "ipwho-isp",
        url: `https://ipwho.is/${checkIp}`,
        parse: (j) => ({
          ipv4: "",
          ipv6: "",
          isp: j.connection?.isp || j.connection?.org || ""
        })
      }, 2000);
      
      if (ispResult && ispResult.isp) {
        isp = ispResult.isp;
      }
    } catch(e) {
      // Continue
    }
  }
  
  if (!ipv4 && !ipv6) {
    throw new Error("IP check failed - no valid IP detected");
  }
  
  console.log("✓ IP data fetched:", { ipv4, ipv6, isp, successCount });
  return { ipv4, ipv6, isp };
}

function hostnameMatches(entry, hostname) {
  entry = entry.toLowerCase();
  hostname = hostname.toLowerCase();
  return hostname === entry || hostname.endsWith("." + entry);
}

function checkNetwork(callback) {
  getSettings((settings) => {
    fetchIPData().then((info) => {
      let ok = false;

      if (settings.dynamicIP) {
        ok = info.isp.toLowerCase() === settings.refISP.toLowerCase();
      } else {
        const ispOk = info.isp.toLowerCase() === settings.refISP.toLowerCase();
        
        const refIPv4 = settings.refIPv4 && settings.refIPv4 !== "-" ? settings.refIPv4 : "";
        const refIPv6 = settings.refIPv6 && settings.refIPv6 !== "-" ? settings.refIPv6 : "";
        
        const currentIPv4 = info.ipv4 || "";
        const currentIPv6 = info.ipv6 || "";
        
        let ipOk = false;
        
        if (refIPv4 && refIPv6) {
          ipOk = (currentIPv4 === refIPv4) || (currentIPv6 === refIPv6);
        } else if (refIPv4 && !refIPv6) {
          ipOk = currentIPv4 === refIPv4;
        } else if (!refIPv4 && refIPv6) {
          ipOk = currentIPv6 === refIPv6;
        } else {
          ipOk = false;
        }
        
        ok = ispOk && ipOk;
      }
      
      console.log("🔍 Network check result:", { 
        ok, 
        currentIP: info, 
        refIPv4: settings.refIPv4,
        refIPv6: settings.refIPv6,
        refISP: settings.refISP 
      });
      
      callback({ info, ok, ref: settings });
    }).catch((e) => {
      callback({ error: e });
    });
  });
}

function isProtectedDomain(url, settings) {
  try {
    const u = new URL(url);
    const isProtected = settings.protectedDomains.some(d => hostnameMatches(d, u.hostname));
    console.log(`🔍 Domain check: ${u.hostname} → Protected: ${isProtected}`);
    if (isProtected) {
      console.log(`   Protected domains list:`, settings.protectedDomains);
    }
    return isProtected;
  } catch {
    return false;
  }
}

// ============================================
// LISTENER: webRequest.onBeforeRequest
// ============================================
console.log("Registering webRequest.onBeforeRequest listener...");

chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    console.log(">>> webRequest.onBeforeRequest FIRED:", details.url, "type:", details.type);
    
    // Only handle main frame
    if (details.type !== "main_frame") {
      return;
    }
    
    // Don't check extension pages
    if (details.url.startsWith("chrome-extension://") || details.url.startsWith("chrome://")) {
      return;
    }
    
    const checkKey = `${details.tabId}-${details.url}`;
    
    if (pendingChecks.has(checkKey)) {
      console.log("    Skipping: already checking");
      return;
    }
    
    pendingChecks.add(checkKey);
    console.log("    ✓ Added to pending checks");
    
    // Get settings and check
    getSettings((settings) => {
      console.log("    → Settings loaded");
      
      const isProtected = isProtectedDomain(details.url, settings);
      
      if (!isProtected) {
        console.log("    ✓ Not protected, allowing");
        pendingChecks.delete(checkKey);
        return;
      }

      console.log("    🔒 PROTECTED DOMAIN - Performing IP check...");
      
      checkNetwork((result) => {
        if (result.error) {
          console.error("    ❌ ERROR during check:", result.error);
          const blockedUrl = chrome.runtime.getURL("blocked.html?error=check_failed");
          chrome.tabs.update(details.tabId, { url: blockedUrl });
          pendingChecks.delete(checkKey);
          return;
        }
        
        const { info, ok, ref } = result;
        
        if (ok) {
          console.log("    ✓✓✓ IP CHECK PASSED - ACCESS ALLOWED");
          console.log("    → Current:", info);
          console.log("    → Reference:", { ipv4: ref.refIPv4, ipv6: ref.refIPv6, isp: ref.refISP });
          pendingChecks.delete(checkKey);
          return;
        }
        
        console.log("    ✗✗✗ IP CHECK FAILED - BLOCKING ACCESS");
        console.log("    → Current:", info);
        console.log("    → Reference:", { ipv4: ref.refIPv4, ipv6: ref.refIPv6, isp: ref.refISP });
        
        const data = {
          url: details.url,
          ipv4: info.ipv4 || "-",
          ipv6: info.ipv6 || "-",
          isp: info.isp || "-",
          refIPv4: ref.refIPv4 || "-",
          refIPv6: ref.refIPv6 || "-",
          refISP: ref.refISP || "-"
        };
        
        const encoded = btoa(JSON.stringify(data));
        const blockedUrl = chrome.runtime.getURL("blocked.html?data=" + encodeURIComponent(encoded));
        
        console.log("    → Redirecting to blocked page");
        chrome.tabs.update(details.tabId, { url: blockedUrl });
        pendingChecks.delete(checkKey);
      });
    });
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

console.log("✓ webRequest listener registered");

// Clean up
setInterval(() => {
  if (pendingChecks.size > 0) {
    console.log("Clearing", pendingChecks.size, "pending checks");
  }
  pendingChecks.clear();
}, 30000);

// Handle icon click
chrome.browserAction.onClicked.addListener(() => {
  console.log("Extension icon clicked - opening options");
  chrome.runtime.openOptionsPage();
});

console.log("========================================");
console.log("ISP Guard v2 - Ready!");
console.log("========================================");