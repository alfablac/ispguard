const KEY="ispGuard_settings";

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
  // Simple IPv6 validation - contains colons and hex characters
  return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
}

async function getSettings(){
  const s=await chrome.storage.local.get(KEY);
  return Object.assign({
    protectedDomains:[],
    refIPv4:"",
    refIPv6:"",
    refISP:"",
    dynamicIP:false
  },s[KEY]||{});
}

function q(id){return document.getElementById(id)}

async function load(){
  const s=await getSettings();
  q("domains").value=s.protectedDomains.join("\n");
  q("ipv4").textContent=s.refIPv4||"-";
  q("ipv6").textContent=s.refIPv6||"-";
  q("isp").textContent=s.refISP||"-";
  q("dynamic").checked=!!s.dynamicIP;
}

async function save(){
  const domains=q("domains").value.split(/\s+/).filter(Boolean);
  const s=await getSettings();
  s.protectedDomains=domains;
  s.dynamicIP=q("dynamic").checked;
  s.refIPv4=q("ipv4").textContent;
  s.refIPv6=q("ipv6").textContent;
  s.refISP=q("isp").textContent;
  await chrome.storage.local.set({[KEY]:s});
  q("status").textContent="Salvo.";
  q("status").style.color = "#3fb950";
  setTimeout(()=>{
    q("status").textContent="";
    q("status").style.color = "";
  },2000);
}

async function detect(){
  q("detect").disabled=true;
  q("detect").textContent="Detectando...";
  q("status").textContent="";
  
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
        ipv6: "", // ipwho.is returns IPv4 in main response
        isp: j.connection?.isp || j.connection?.org || ""
      })
    },
    {
      url: "https://ipapi.co/json/",
      parse: (j) => ({
        ipv4: j.ip || "",
        ipv6: "", // Will need separate call
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
      
      // Validate that we got actual IPv4, not IPv6 in IPv4 field
      if (data.ipv4 && isValidIPv4(data.ipv4)) {
        ipv4 = data.ipv4;
      }
      if (data.isp) isp = data.isp;
      if (ipv4 !== "-" && isp !== "-") break;
    } catch(e) {
      console.log("API failed:", api.url, e);
    }
  }
  
  // Try to get IPv6 using multiple methods
  const ipv6Methods = [
    {
      url: "https://api64.ipify.org?format=json",
      parse: (j) => j.ip && j.ip.includes(':') ? j.ip : ""
    },
    {
      url: "https://ifconfig.co/json",
      parse: (j) => j.ip && j.ip.includes(':') ? j.ip : ""
    },
    {
      url: "https://api.ipify.org?format=json",
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
        // Validate that we got actual IPv6
        if (ip && isValidIPv6(ip)) {
          ipv6 = ip;
          // If we got IPv6 but no IPv4, the IPv6 might be our primary IP
          if (ipv4 === "-") {
            console.log("IPv6-only connection detected");
          }
          break;
        }
      }
    } catch(e) {
      console.log("IPv6 method failed:", method.url, e);
    }
  }
  
  // If we still don't have ISP info and we have an IP, try to get ISP from ipwho.is with the IP
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
        }
      }
    } catch(e) {
      console.log("ISP lookup with IP failed:", e);
    }
  }
  
  q("ipv4").textContent = ipv4;
  q("ipv6").textContent = ipv6;
  q("isp").textContent = isp;
  
  if (ipv4 === "-" && ipv6 === "-") {
    q("status").textContent = "⚠️ Não foi possível detectar o endereço IP. Verifique sua conexão com a internet.";
    q("status").style.color = "#f85149";
  } else if (isp === "-") {
    q("status").textContent = "⚠️ Não foi possível detectar as informações do ISP.";
    q("status").style.color = "#f85149";
  } else {
    let detectionMsg = "✓ Rede detectada com sucesso!";
    if (ipv4 === "-" && ipv6 !== "-") {
      detectionMsg += " (Conexão apenas IPv6)";
    } else if (ipv4 !== "-" && ipv6 !== "-") {
      detectionMsg += " (Dual-stack IPv4/IPv6)";
    }
    q("status").textContent = detectionMsg;
    q("status").style.color = "#3fb950";
    setTimeout(() => {
      q("status").textContent = "";
      q("status").style.color = "";
    }, 3000);
  }
  
  q("detect").disabled = false;
  q("detect").textContent = "Detectar Rede Atual";
}

q("save").addEventListener("click",save);
q("detect").addEventListener("click",detect);
load();
