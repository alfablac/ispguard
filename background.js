const SETTINGS_KEY = "ispGuard_settings";
const DEFAULT_SETTINGS = {
  protectedDomains: [],
  refIPv4: "",
  refIPv6: "",
  refISP: "",
  dynamicIP: false
};

const IP_APIS = [
  "https://ipapi.co/json/",
  "https://ipwho.is/"
];

// Validate IPv4 address format
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

// Validate IPv6 address format
function isValidIPv6(ip) {
  if (!ip) return false;
  // Simple IPv6 validation - contains colons and hex characters
  return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
}

async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

async function saveSettings(obj) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: obj });
}

async function fetchIPData() {
  let ipv4 = "";
  let ipv6 = "";
  let isp = "";
  
  // Try IPv4/ISP detection APIs
  const ipv4Apis = [
    {
      url: "https://api.ipify.org?format=json",
      parse: (j) => ({
        ipv4: j.ip || "",
        isp: ""
      })
    },
    {
      url: "https://ipwho.is/",
      parse: (j) => ({
        ipv4: j.ip || "",
        isp: j.connection?.isp || j.connection?.org || ""
      })
    },
    {
      url: "https://ipapi.co/json/",
      parse: (j) => ({
        ipv4: j.ip || "",
        isp: j.org || j.isp || ""
      })
    },
    {
      url: "https://ifconfig.co/json",
      parse: (j) => ({
        ipv4: j.ip_addr || j.ip || "",
        isp: j.asn_org || ""
      })
    }
  ];
  
  for (const api of ipv4Apis) {
    try {
      const res = await fetch(api.url, { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      const data = api.parse(j);
      
      // Validate that we got actual IPv4, not IPv6 in IPv4 field
      if (data.ipv4 && isValidIPv4(data.ipv4)) {
        ipv4 = data.ipv4;
      }
      if (data.isp) isp = data.isp;
      if (ipv4 && isp) break;
    } catch(e) {
      console.log("IPv4 API failed:", api.url, e);
    }
  }
  
  // Try IPv6 detection
  const ipv6Apis = [
    "https://api64.ipify.org?format=json",
    "https://ifconfig.co/json",
    "https://api.ipify.org?format=json"
  ];
  
  for (const url of ipv6Apis) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      
      // Validate that we got actual IPv6
      if (j.ip && isValidIPv6(j.ip)) {
        ipv6 = j.ip;
        break;
      }
    } catch(e) {
      console.log("IPv6 API failed:", url, e);
    }
  }
  
  // If we have an IP but no ISP, try to get ISP info
  if (!isp && (ipv4 || ipv6)) {
    try {
      const checkIp = ipv4 || ipv6;
      const res = await fetch(`https://ipwho.is/${checkIp}`, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (j.connection?.isp || j.connection?.org) {
          isp = j.connection.isp || j.connection.org;
        }
      }
    } catch(e) {
      console.log("ISP lookup failed:", e);
    }
  }
  
  if (!ipv4 && !ipv6) {
    throw new Error("IP check failed - no IP detected");
  }
  
  return { ipv4, ipv6, isp };
}

function hostnameMatches(entry, hostname) {
  entry = entry.toLowerCase();
  hostname = hostname.toLowerCase();
  return hostname === entry || hostname.endsWith("." + entry);
}

async function checkNetwork() {
  const settings = await getSettings();
  const info = await fetchIPData();
  let ok = false;

  if (settings.dynamicIP) {
    // Dynamic IP mode: only check ISP
    ok = info.isp.toLowerCase() === settings.refISP.toLowerCase();
  } else {
    // Static IP mode: check both ISP and IP address
    const ispOk = info.isp.toLowerCase() === settings.refISP.toLowerCase();
    
    // Get reference IPs, excluding "-" placeholders
    const refIPv4 = settings.refIPv4 && settings.refIPv4 !== "-" ? settings.refIPv4 : "";
    const refIPv6 = settings.refIPv6 && settings.refIPv6 !== "-" ? settings.refIPv6 : "";
    
    // Get current IPs, excluding empty values
    const currentIPv4 = info.ipv4 || "";
    const currentIPv6 = info.ipv6 || "";
    
    let ipOk = false;
    
    // If we have both reference IPv4 and IPv6, at least one must match
    if (refIPv4 && refIPv6) {
      ipOk = (currentIPv4 === refIPv4) || (currentIPv6 === refIPv6);
    }
    // If we only have reference IPv4, it must match (ignore current IPv6)
    else if (refIPv4 && !refIPv6) {
      ipOk = currentIPv4 === refIPv4;
    }
    // If we only have reference IPv6, it must match (ignore current IPv4)
    else if (!refIPv4 && refIPv6) {
      ipOk = currentIPv6 === refIPv6;
    }
    // If we have no reference IPs saved, deny access
    else {
      ipOk = false;
    }
    
    ok = ispOk && ipOk;
  }
  
  return { info, ok, ref: settings };
}

function isProtectedDomain(url, settings) {
  try {
    const u = new URL(url);
    return settings.protectedDomains.some(d => hostnameMatches(d, u.hostname));
  } catch {
    return false;
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(
  async details => {
    if (!details.frameId === 0) return; // Only main frame
    
    const settings = await getSettings();
    if (!isProtectedDomain(details.url, settings)) return;

    try {
      const { info, ok, ref } = await checkNetwork();
      if (ok) return;

      // Encode the data to avoid exposing IPs in URL
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
      const redirect = chrome.runtime.getURL("blocked.html?data=" + encodeURIComponent(encoded));
      
      chrome.tabs.update(details.tabId, { url: redirect });
    } catch(e) {
      console.error("ISP Guard check failed:", e);
    }
  }
);

// Handle extension icon click - open options page
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
