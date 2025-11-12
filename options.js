const KEY = "ispGuard_settings";

// Validate IPv4 address format
function isValidIPv4(ip) {
  if (!ip || ip === "-") return false;
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
  if (!ip || ip === "-") return false;
  return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
}

// MV2 uses callbacks, not promises
function getSettings(callback) {
  chrome.storage.local.get(KEY, (result) => {
    const settings = Object.assign({
      protectedDomains: [],
      refIPv4: "",
      refIPv6: "",
      refISP: "",
      dynamicIP: false
    }, result[KEY] || {});
    callback(settings);
  });
}

function q(id) { return document.getElementById(id) }

function load() {
  console.log("📋 Loading settings...");
  getSettings((s) => {
    console.log("📋 Loaded settings:", s);
    
    q("domains").value = s.protectedDomains.join("\n");
    q("ipv4").textContent = s.refIPv4 || "-";
    q("ipv6").textContent = s.refIPv6 || "-";
    q("isp").textContent = s.refISP || "-";
    q("dynamic").checked = !!s.dynamicIP;
  });
}

function save() {
  console.log("💾 Saving settings...");
  
  // Split by newlines ONLY
  const domainsText = q("domains").value;
  const domains = domainsText
    .split("\n")
    .map(d => d.trim())
    .filter(d => d.length > 0);
  
  console.log("💾 Parsed domains:", domains);
  
  getSettings((s) => {
    s.protectedDomains = domains;
    s.dynamicIP = q("dynamic").checked;
    s.refIPv4 = q("ipv4").textContent;
    s.refIPv6 = q("ipv6").textContent;
    s.refISP = q("isp").textContent;
    
    console.log("💾 Settings object to save:", s);
    
    chrome.storage.local.set({ [KEY]: s }, () => {
      console.log("💾 Save operation completed");
      
      // Verify save worked
      chrome.storage.local.get(KEY, (verify) => {
        console.log("✅ Verification - stored settings:", verify[KEY]);
      });
      
      q("status").textContent = "✓ Salvo com sucesso!";
      q("status").style.color = "#3fb950";
      q("status").style.background = "rgba(63, 185, 80, 0.1)";
      setTimeout(() => {
        q("status").textContent = "";
        q("status").style.background = "";
      }, 2000);
    });
  });
}

async function detect() {
  console.log("🔍 Starting network detection...");
  
  q("detect").disabled = true;
  q("detect").textContent = "Detectando...";
  q("status").textContent = "";
  
  let ipv4 = "-";
  let ipv6 = "-";
  let isp = "-";
  
  // Try multiple APIs for better reliability
  const apis = [
    {
      url: "https://api.ipify.org?format=json",
      parse: (j) => ({
        ipv4: j.ip || "",
        ipv6: "",
        isp: ""
      })
    },
    {
      url: "https://ipwho.is/",
      parse: (j) => ({
        ipv4: j.ip || "",
        ipv6: "",
        isp: j.connection?.isp || j.connection?.org || ""
      })
    },
    {
      url: "https://ipapi.co/json/",
      parse: (j) => ({
        ipv4: j.ip || "",
        ipv6: "",
        isp: j.org || j.isp || ""
      })
    },
    {
      url: "https://ifconfig.co/json",
      parse: (j) => ({
        ipv4: j.ip_addr || j.ip || "",
        ipv6: "",
        isp: j.asn_org || ""
      })
    }
  ];
  
  // Try to get IPv4 and ISP info
  for (const api of apis) {
    try {
      const resp = await fetch(api.url, {
        cache: "no-store",
        headers: { 'Accept': 'application/json' }
      });
      if (!resp.ok) continue;
      const j = await resp.json();
      const data = api.parse(j);
      
      if (data.ipv4 && isValidIPv4(data.ipv4)) {
        ipv4 = data.ipv4;
        console.log("🔍 IPv4 detected:", ipv4);
      }
      if (data.isp) {
        isp = data.isp;
        console.log("🔍 ISP detected:", isp);
      }
      if (ipv4 !== "-" && isp !== "-") break;
    } catch (e) {
      console.log("API failed:", api.url, e);
    }
  }
  
  // Try to get IPv6
  const ipv6Methods = [
    {
      url: "https://api64.ipify.org?format=json",
      parse: (j) => j.ip && j.ip.includes(':') ? j.ip : ""
    },
    {
      url: "https://ifconfig.co/json",
      parse: (j) => j.ip && j.ip.includes(':') ? j.ip : ""
    }
  ];
  
  for (const method of ipv6Methods) {
    try {
      const resp = await fetch(method.url, {
        cache: "no-store",
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const j = await resp.json();
        const ip = method.parse(j);
        if (ip && isValidIPv6(ip)) {
          ipv6 = ip;
          console.log("🔍 IPv6 detected:", ipv6);
          break;
        }
      }
    } catch (e) {
      console.log("IPv6 method failed:", method.url, e);
    }
  }
  
  // If we still don't have ISP info, try with the detected IP
  if (isp === "-" && (ipv4 !== "-" || ipv6 !== "-")) {
    try {
      const checkIp = ipv4 !== "-" ? ipv4 : ipv6;
      const resp = await fetch(`https://ipwho.is/${checkIp}`, {
        cache: "no-store",
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const j = await resp.json();
        if (j.connection?.isp || j.connection?.org) {
          isp = j.connection.isp || j.connection.org;
          console.log("🔍 ISP detected from IP lookup:", isp);
        }
      }
    } catch (e) {
      console.log("ISP lookup with IP failed:", e);
    }
  }
  
  console.log("🔍 Final detection results:", { ipv4, ipv6, isp });
  
  q("ipv4").textContent = ipv4;
  q("ipv6").textContent = ipv6;
  q("isp").textContent = isp;
  
  if (ipv4 === "-" && ipv6 === "-") {
    q("status").textContent = "⚠️ Não foi possível detectar o endereço IP. Verifique sua conexão com a internet.";
    q("status").style.color = "#f85149";
    q("status").style.background = "rgba(248, 81, 73, 0.1)";
  } else if (isp === "-") {
    q("status").textContent = "⚠️ Não foi possível detectar as informações do ISP.";
    q("status").style.color = "#f85149";
    q("status").style.background = "rgba(248, 81, 73, 0.1)";
  } else {
    let detectionMsg = "✓ Rede detectada com sucesso!";
    if (ipv4 === "-" && ipv6 !== "-") {
      detectionMsg += " (Conexão apenas IPv6)";
    } else if (ipv4 !== "-" && ipv6 !== "-") {
      detectionMsg += " (Dual-stack IPv4/IPv6)";
    }
    q("status").textContent = detectionMsg;
    q("status").style.color = "#3fb950";
    q("status").style.background = "rgba(63, 185, 80, 0.1)";
    setTimeout(() => {
      q("status").textContent = "";
      q("status").style.background = "";
    }, 3000);
  }
  
  q("detect").disabled = false;
  q("detect").textContent = "Detectar Rede Atual";
}

q("save").addEventListener("click", save);
q("detect").addEventListener("click", detect);
load();

console.log("✅ Options page loaded");