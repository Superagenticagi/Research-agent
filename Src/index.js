export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(getHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/research") {
      try {
        const body = await request.json();
        const message = (body.message || "").trim();
        const userCode = (body.userCode || "").trim().toUpperCase();

        if (!message) return json({ error: "Message is required" }, 400);
        if (!userCode) return json({ error: "User code is required" }, 400);

        const aiResponse = await callOpenRouter(env.OPENROUTER_API_KEY, message);

        // Save to history
        const memoryKey = `user:${userCode}:history`;
        let history = [];
        const existing = await env.RESEARCH_MEMORY.get(memoryKey);
        if (existing) history = JSON.parse(existing);

        history.push({
          role: "user",
          content: message,
          time: new Date().toISOString()
        });
        history.push({
          role: "ai",
          content: aiResponse,
          time: new Date().toISOString()
        });

        // Keep last 20 messages
        if (history.length > 20) history = history.slice(-20);
        await env.RESEARCH_MEMORY.put(memoryKey, JSON.stringify(history));

        return json({ reply: aiResponse });
      } catch (err) {
        return json({ error: err.message || "Something went wrong" }, 500);
      }
    }

    // Get history
    if (request.method === "POST" && url.pathname === "/api/history") {
      try {
        const body = await request.json();
        const userCode = (body.userCode || "").trim().toUpperCase();
        if (!userCode) return json({ error: "User code required" }, 400);

        const memoryKey = `user:${userCode}:history`;
        const existing = await env.RESEARCH_MEMORY.get(memoryKey);
        const history = existing ? JSON.parse(existing) : [];

        return json({ history });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function callOpenRouter(apiKey, message) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://researchagent.superagentic.workers.dev",
      "X-Title": "Research Agent",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        {
          role: "system",
          content: "You are a helpful Personal Research Assistant. Give clear, well-structured answers using Markdown (headings, bold, lists) when useful."
        },
        { role: "user", content: message }
      ],
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Research Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f0f2f5;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #1a73e8;
      color: white;
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header h1 { font-size: 18px; font-weight: 600; }
    #codeBox {
      background: rgba(255,255,255,0.2);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
    }
    #chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .message {
      max-width: 88%;
      padding: 12px 16px;
      border-radius: 18px;
      line-height: 1.55;
      word-wrap: break-word;
    }
    .user {
      background: #1a73e8;
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .ai {
      background: white;
      color: #202124;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .ai h1, .ai h2, .ai h3 { margin: 10px 0 6px; }
    .ai ul, .ai ol { padding-left: 20px; margin: 8px 0; }
    .ai code { background: #f1f3f4; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
    .ai pre { background: #f1f3f4; padding: 10px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
    #inputArea {
      display: flex;
      padding: 12px;
      background: white;
      border-top: 1px solid #dadce0;
      gap: 8px;
    }
    #messageInput {
      flex: 1;
      padding: 13px 16px;
      border: 1px solid #dadce0;
      border-radius: 24px;
      font-size: 16px;
      outline: none;
    }
    button {
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 50%;
      width: 46px;
      height: 46px;
      font-size: 18px;
      cursor: pointer;
    }
    button:disabled { background: #9aa0a6; }
    #codeModal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      justify-content: center;
      align-items: center;
      z-index: 100;
    }
    .modal-content {
      background: white;
      padding: 24px;
      border-radius: 16px;
      width: 90%;
      max-width: 360px;
      text-align: center;
    }
    .modal-content input {
      width: 100%;
      padding: 12px;
      margin: 12px 0;
      border: 1px solid #dadce0;
      border-radius: 8px;
      font-size: 16px;
      text-align: center;
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <header>
    <h1>🔍 Research Agent</h1>
    <div id="codeBox" onclick="showCodeModal()">Code: ---</div>
  </header>

  <div id="chat"></div>

  <div id="inputArea">
    <input type="text" id="messageInput" placeholder="Ask a research question..." autocomplete="off" />
    <button onclick="sendMessage()" id="sendBtn">➤</button>
  </div>

  <!-- Code Modal -->
  <div id="codeModal">
    <div class="modal-content">
      <h3>Your Research Code</h3>
      <p id="currentCodeDisplay" style="font-size:22px; font-weight:bold; margin:12px 0;"></p>
      <p style="font-size:14px; color:#5f6368;">Save this code to access your history later on any device.</p>
      <input type="text" id="codeInput" placeholder="Enter existing code" maxlength="8" />
      <button onclick="saveCode()" style="width:100%; border-radius:8px; margin-top:8px;">Save / Load Code</button>
      <button onclick="closeModal()" style="width:100%; border-radius:8px; margin-top:8px; background:#dadce0; color:#202124;">Close</button>
    </div>
  </div>

  <script>
    let userCode = localStorage.getItem('research_code') || "";

    function generateCode() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "R-";
      for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
      return code;
    }

    function updateCodeDisplay() {
      document.getElementById('codeBox').textContent = "Code: " + (userCode || "---");
      document.getElementById('currentCodeDisplay').textContent = userCode || "Not set";
    }

    if (!userCode) {
      userCode = generateCode();
      localStorage.setItem('research_code', userCode);
    }
    updateCodeDisplay();

    function showCodeModal() {
      document.getElementById('codeModal').style.display = 'flex';
      document.getElementById('codeInput').value = "";
    }

    function closeModal() {
      document.getElementById('codeModal').style.display = 'none';
    }

    function saveCode() {
      const input = document.getElementById('codeInput').value.trim().toUpperCase();
      if (input.length >= 4) {
        userCode = input;
        localStorage.setItem('research_code', userCode);
        updateCodeDisplay();
        closeModal();
        loadHistory();
      } else {
        alert("Please enter a valid code");
      }
    }

    // Simple Markdown renderer
    function renderMarkdown(text) {
      if (!text) return "";
      text = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\\*\\*(.*?)\\*\\*/gim, '<strong>$1</strong>')
        .replace(/\\*(.*?)\\*/gim, '<em>$1</em>')
        .replace(/\`(.*?)\`/gim, '<code>$1</code>')
        .replace(/^\\s*[-*] (.*)/gim, '<li>$1</li>')
        .replace(/\\n/g, '<br>');
      return text;
    }

    const chat = document.getElementById('chat');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    function addMessage(text, isUser) {
      const div = document.createElement('div');
      div.className = 'message ' + (isUser ? 'user' : 'ai');
      if (isUser) {
        div.textContent = text;
      } else {
        div.innerHTML = renderMarkdown(text);
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    async function sendMessage() {
      const message = input.value.trim();
      if (!message || !userCode) return;

      addMessage(message, true);
      input.value = '';
      sendBtn.disabled = true;

      try {
        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, userCode }),
        });
        const data = await res.json();
        if (data.reply) {
          addMessage(data.reply, false);
        } else {
          addMessage('Error: ' + (data.error || 'Unknown'), false);
        }
      } catch (err) {
        addMessage('Network error', false);
      }
      sendBtn.disabled = false;
      input.focus();
    }

    async function loadHistory() {
      if (!userCode) return;
      try {
        const res = await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userCode }),
        });
        const data = await res.json();
        chat.innerHTML = '';
        if (data.history && data.history.length) {
          data.history.forEach(msg => {
            addMessage(msg.content, msg.role === 'user');
          });
        }
      } catch (e) {}
    }

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    // Load history on start
    loadHistory();
  </script>
</body>
</html>`;
}
