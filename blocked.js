const params = new URLSearchParams(location.search);

function set(id, v) {
  const elem = document.getElementById(id);
  if (elem) {
    elem.textContent = v || "-";
  }
}

// Check if we have encoded data
const encodedData = params.get("data");
if (encodedData) {
  try {
    const decoded = atob(encodedData);
    const data = JSON.parse(decoded);
    
    set("ref4", data.refIPv4);
    set("ref6", data.refIPv6);
    set("refIsp", data.refISP);
    set("cur4", data.ipv4);
    set("cur6", data.ipv6);
    set("curIsp", data.isp);
  } catch(e) {
    console.error("Failed to decode data:", e);
  }
} else {
  // Fallback to old URL parameter method
  set("ref4", params.get("refIPv4"));
  set("ref6", params.get("refIPv6"));
  set("refIsp", params.get("refISP"));
  set("cur4", params.get("ipv4"));
  set("cur6", params.get("ipv6"));
  set("curIsp", params.get("isp"));
}

const settingsLink = document.getElementById("settings");
if (settingsLink) {
  settingsLink.href = chrome.runtime.getURL("options.html");
}
