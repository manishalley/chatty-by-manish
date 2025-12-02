// frontend/chat.js
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const personaEl = document.getElementById("persona");
const modelEl = document.getElementById("model");
const appTokenEl = document.getElementById("appToken");
const saveTokenBtn = document.getElementById("saveToken");
const exportBtn = document.getElementById("exportBtn");
const downloadFileBtn = document.getElementById("downloadFileBtn");
const themeToggleBtn = document.getElementById("themeToggle");

let sessionToken = sessionStorage.getItem("APP_TOKEN") || "";
if (sessionToken) appTokenEl.value = sessionToken;

// simple session-side conversation (mirrors backend)
let sessionHistory = [
  { role: "system", content: personaEl.value }
];

function timeNow() {
  const d = new Date();
  return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}
function scrollToBottom(){ messagesEl.scrollTop = messagesEl.scrollHeight; }

function pushMessage(text, who="bot", opts={}) {
  const row = document.createElement("div");
  row.className = "row " + (who === "user" ? "user" : "bot");
  const avatar = document.createElement("div");
  avatar.className = "avatar " + (who === "user" ? "user" : "bot");
  avatar.textContent = who === "user" ? (opts.label || "You") : (opts.label || "AI");

  const bubble = document.createElement("div");
  bubble.className = "bubble " + (who === "user" ? "user" : "bot");
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "meta";
  const time = document.createElement("div");
  time.className = "time";
  time.textContent = timeNow();
  meta.appendChild(time);

  const left = document.createElement("div");
  left.style.display = "flex"; left.style.flexDirection = "column";
  left.appendChild(bubble);
  left.appendChild(meta);

  row.appendChild(avatar);
  row.appendChild(left);
  messagesEl.appendChild(row);
  scrollToBottom();
  return {row, bubble};
}

// show typing indicator, returns remover
function showTyping() {
  const row = document.createElement("div"); row.className = "row bot";
  const avatar = document.createElement("div"); avatar.className = "avatar bot"; avatar.textContent = "AI";
  const typing = document.createElement("div"); typing.className = "bubble bot";
  typing.style.background = "rgba(255,255,255,0.03)";
  typing.style.padding = "10px";
  typing.textContent = "• • •";
  row.appendChild(avatar); row.appendChild(typing);
  messagesEl.appendChild(row); scrollToBottom();
  return () => { row.remove(); };
}

// simulate streaming (reveal characters gradually)
async function streamTextInto(element, text, speed=10) {
  element.textContent = "";
  for (let i=0;i<text.length;i++){
    element.textContent += text[i];
    if (i % 2 === 0) scrollToBottom();
    await new Promise(r => setTimeout(r, speed)); // ms per char (adjust)
  }
}

// send message flow
let sending = false;
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || sending) return;
  inputEl.value = "";
  pushMessage(text, "user", {label:"You"});
  sessionHistory.push({role:"user", content:text});

  const removeTyping = showTyping();
  sending = true; sendBtn.disabled = true; inputEl.placeholder = "Waiting for reply...";
  try {
    const payload = {
      message: text,
      persona: personaEl.value,
      model: modelEl.value || undefined
    };
    const headers = {"Content-Type":"application/json"};
    if (sessionToken) headers["X-APP-TOKEN"] = sessionToken;

    const resp = await fetch("/chat", {
      method: "POST", headers, body: JSON.stringify(payload)
    });

    if (resp.status === 429) {
      const data = await resp.json();
      removeTyping();
      pushMessage(data.reply || "[Rate limited]", "bot");
      return;
    }
    if (resp.status === 401) {
      const data = await resp.json();
      removeTyping();
      pushMessage(data.reply || "[Unauthorized]", "bot");
      return;
    }
    if (!resp.ok) {
      const txt = await resp.text();
      removeTyping();
      pushMessage("[Server error] " + txt, "bot");
      return;
    }
    const data = await resp.json();
    removeTyping();

    // simulate streaming reveal
    const {row, bubble} = pushMessage("", "bot", {label:"AI"});
    sessionHistory.push({role:"assistant", content: data.reply});
    await streamTextInto(bubble, data.reply, 6); // speed adjust: 6ms/char

  } catch (err) {
    removeTyping();
    pushMessage("Network error: " + err.message, "bot");
  } finally {
    sending = false; sendBtn.disabled = false; inputEl.placeholder = "Say hi — press Enter to send";
    inputEl.focus();
  }
}

// token save
saveTokenBtn.addEventListener("click", () => {
  sessionToken = appTokenEl.value.trim();
  if (sessionToken) {
    sessionStorage.setItem("APP_TOKEN", sessionToken);
    alert("Token saved to session.");
  } else {
    sessionStorage.removeItem("APP_TOKEN");
    alert("Token cleared.");
  }
});

// export conversation (download JSON or text)
exportBtn.addEventListener("click", () => {
  // build JSON from sessionHistory
  const payload = { exported_at: new Date().toISOString(), conversation: sessionHistory };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "chatty_conversation.json"; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// download server-saved conversation.json (if exists)
downloadFileBtn.addEventListener("click", async () => {
  try {
    const r = await fetch("/conversation.json");
    if (!r.ok) {
      const txt = await r.text();
      alert("No conversation file available: " + txt);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "conversation.json"; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Error downloading conversation file: " + e.message);
  }
});

// theme toggle (simple invert)
themeToggleBtn.addEventListener("click", () => {
  document.documentElement.classList.toggle("light-mode");
  if (document.documentElement.classList.contains("light-mode")) {
    document.body.style.background = "#f6f8fb";
    document.body.style.color = "#0b1220";
  } else {
    document.body.style.background = "";
    document.body.style.color = "";
    location.reload(); // quick reset styles (simple approach)
  }
});

// enter to send
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); sendMessage();
  }
});

// initial greeting
document.addEventListener("DOMContentLoaded", () => {
  pushMessage("Hi! I'm Chatty — ready to chat. Set persona/model or just ask a question.", "bot");
  inputEl.focus();
});
