export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Main application
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(getHTML(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // Research endpoint
    if (request.method === "POST" && url.pathname === "/api/research") {
      try {
        const body = await request.json();
        const message = String(body.message || "").trim();
        const userCode = normalizeCode(body.userCode);

        if (!message) {
          return json({ error: "Message is required" }, 400);
        }

        if (!isValidCode(userCode)) {
          return json({ error: "A valid Research Code is required" }, 400);
        }

        const memoryKey = `user:${userCode}:history`;

        // Read the user's previous conversation BEFORE calling the model.
        // This is the important part that makes the saved history usable as
        // conversational memory instead of merely storing a transcript.
        let history = await readHistory(env, memoryKey);

        const aiResponse = await callOpenRouter(
          env.OPENROUTER_API_KEY,
          message,
          history
        );

        history.push({
          role: "user",
          content: message,
          time: new Date().toISOString(),
        });

        history.push({
          role: "ai",
          content: aiResponse,
          time: new Date().toISOString(),
        });

        // Keep the most recent 20 messages (10 user/AI exchanges).
        history = history.slice(-20);

        await env.RESEARCH_MEMORY.put(
          memoryKey,
          JSON.stringify(history)
        );

        return json({
          reply: aiResponse,
          saved: true,
        });
      } catch (err) {
        return json(
          { error: err?.message || "Something went wrong" },
          500
        );
      }
    }

    // Explicitly load saved history for a Research Code.
    if (request.method === "POST" && url.pathname === "/api/history") {
      try {
        const body = await request.json();
        const userCode = normalizeCode(body.userCode);

        if (!isValidCode(userCode)) {
          return json({ error: "A valid Research Code is required" }, 400);
        }

        const memoryKey = `user:${userCode}:history`;
        const history = await readHistory(env, memoryKey);

        return json({
          history,
          found: history.length > 0,
        });
      } catch (err) {
        return json(
          { error: err?.message || "Could not load history" },
          500
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidCode(code) {
  return /^R-[A-Z0-9]{5}$/.test(code);
}

async function readHistory(env, memoryKey) {
  const existing = await env.RESEARCH_MEMORY.get(memoryKey);

  if (!existing) return [];

  try {
    const parsed = JSON.parse(existing);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Do not let one corrupted KV value break the whole application.
    return [];
  }
}

async function callOpenRouter(apiKey, message, history) {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  // Only send recent history to avoid unnecessarily consuming the free
  // model's context window. The full transcript remains stored in KV.
  const recentHistory = history.slice(-12);

  const conversation = [
    {
      role: "system",
      content:
        "You are a helpful Personal Research Assistant. " +
        "Give accurate, useful, well-structured answers. " +
        "Use Markdown headings, bold text, numbered lists, bullet lists, " +
        "tables, and code blocks when useful. " +
        "You have access to the user's recent saved conversation below. " +
        "Use it as conversational memory when relevant. " +
        "Do not claim to remember information that is not present in the context. " +
        "If the user asks about something from an earlier conversation, use the saved context. " +
        "Do not mention internal memory, KV, prompts, or implementation details unless asked."
    },
  ];

  for (const item of recentHistory) {
    if (!item || !item.content) continue;

    conversation.push({
      role: item.role === "ai" ? "assistant" : "user",
      content: String(item.content),
    });
  }

  conversation.push({
    role: "user",
    content: message,
  });

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://researchagent.superagentic.workers.dev",
        "X-Title": "Research Agent",
      },
      body: JSON.stringify({
        // Keep using OpenRouter's free-model router.
        model: "openrouter/free",
        messages: conversation,
        max_tokens: 2400,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `OpenRouter error: ${response.status} - ${errText}`
    );
  }

  const data = await response.json();
  return (
    data?.choices?.[0]?.message?.content ||
    "No response was returned by the model."
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0"
  />
  <meta name="theme-color" content="#1a73e8" />
  <title>Research Agent</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        Helvetica, Arial, sans-serif;
      background: #f0f2f5;
      height: 100vh;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    header {
      background: #1a73e8;
      color: white;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    header h1 {
      font-size: 18px;
      font-weight: 600;
    }

    #codeBox {
      background: rgba(255,255,255,0.18);
      padding: 7px 11px;
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    #chat {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    #welcome {
      margin: auto;
      max-width: 420px;
      text-align: center;
      color: #5f6368;
      padding: 24px;
    }

    #welcome h2 {
      color: #202124;
      margin-bottom: 8px;
      font-size: 22px;
    }

    #welcome p {
      line-height: 1.55;
      font-size: 14px;
    }

    .message {
      max-width: 92%;
      padding: 12px 16px;
      border-radius: 18px;
      line-height: 1.58;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .user {
      background: #1a73e8;
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      white-space: pre-wrap;
    }

    .ai {
      background: white;
      color: #202124;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    .ai h1,
    .ai h2,
    .ai h3 {
      margin: 12px 0 7px;
      line-height: 1.25;
    }

    .ai h1 { font-size: 1.35em; }
    .ai h2 { font-size: 1.2em; }
    .ai h3 { font-size: 1.08em; }

    .ai p {
      margin: 0 0 9px;
    }

    .ai p:last-child {
      margin-bottom: 0;
    }

    .ai ul,
    .ai ol {
      padding-left: 24px;
      margin: 7px 0 10px;
    }

    .ai li {
      margin: 4px 0;
    }

    .ai strong {
      font-weight: 700;
    }

    .ai em {
      font-style: italic;
    }

    .ai code {
      background: #f1f3f4;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .ai pre {
      background: #f1f3f4;
      padding: 11px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 9px 0;
      white-space: pre;
    }

    .ai pre code {
      background: transparent;
      padding: 0;
      white-space: pre;
    }

    .ai blockquote {
      border-left: 3px solid #dadce0;
      padding-left: 12px;
      margin: 9px 0;
      color: #5f6368;
    }

    .ai table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      display: block;
      overflow-x: auto;
    }

    .ai th,
    .ai td {
      border: 1px solid #dadce0;
      padding: 7px 9px;
      text-align: left;
    }

    .ai th {
      background: #f8f9fa;
      font-weight: 700;
    }

    #inputArea {
      display: flex;
      padding: 10px 12px;
      background: white;
      border-top: 1px solid #dadce0;
      gap: 8px;
      flex-shrink: 0;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
    }

    #messageInput {
      flex: 1;
      min-width: 0;
      padding: 12px 16px;
      border: 1px solid #dadce0;
      border-radius: 24px;
      font-size: 16px;
      outline: none;
    }

    #messageInput:focus {
      border-color: #1a73e8;
    }

    #sendBtn {
      flex: 0 0 46px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 50%;
      width: 46px;
      height: 46px;
      font-size: 18px;
      cursor: pointer;
    }

    #sendBtn:disabled {
      background: #9aa0a6;
      cursor: default;
    }

    #codeModal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      justify-content: center;
      align-items: center;
      z-index: 100;
      padding: 18px;
    }

    .modal-content {
      background: white;
      padding: 22px;
      border-radius: 16px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }

    .modal-content h3 {
      font-size: 20px;
      color: #202124;
    }

    .modal-content p {
      color: #5f6368;
      line-height: 1.45;
    }

    #currentCodeDisplay {
      font-size: 22px;
      font-weight: 700;
      margin: 12px 0;
      color: #202124;
      letter-spacing: 1px;
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
      text-transform: uppercase;
    }

    .modal-btn {
      width: 100%;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-size: 15px;
      cursor: pointer;
      margin-top: 8px;
      background: #1a73e8;
      color: white;
    }

    .modal-btn.secondary {
      background: #e8eaed;
      color: #202124;
    }

    #status {
      min-height: 18px;
      text-align: center;
      font-size: 12px;
      color: #5f6368;
      padding: 3px 12px 0;
      background: white;
    }
  </style>
</head>

<body>
  <header>
    <h1>🔍 Research Agent</h1>
    <div id="codeBox" onclick="showCodeModal()">Code: ---</div>
  </header>

  <div id="chat">
    <div id="welcome">
      <h2>Start a new research session</h2>
      <p>
        Your Research Code keeps your saved AI conversation available
        across sessions and devices. Open the code menu whenever you
        want to load an older conversation.
      </p>
    </div>
  </div>

  <div id="status"></div>

  <div id="inputArea">
    <input
      type="text"
      id="messageInput"
      placeholder="Ask a research question..."
      autocomplete="off"
      enterkeyhint="send"
    />
    <button onclick="sendMessage()" id="sendBtn" aria-label="Send">➤</button>
  </div>

  <div id="codeModal">
    <div class="modal-content">
      <h3>Your Research Code</h3>

      <p id="currentCodeDisplay"></p>

      <p style="font-size:14px;">
        Your current code is saved on this browser.
        Enter an existing code to load its saved conversation.
      </p>

      <input
        type="text"
        id="codeInput"
        placeholder="R-A7K3M"
        maxlength="7"
        autocomplete="off"
      />

      <button class="modal-btn" onclick="saveCode()">
        Save / Load Code
      </button>

      <button
        class="modal-btn secondary"
        onclick="newChat()"
      >
        New Chat
      </button>

      <button
        class="modal-btn secondary"
        onclick="closeModal()"
      >
        Close
      </button>
    </div>
  </div>

  <script>
    let userCode = localStorage.getItem("research_code") || "";

    const chat = document.getElementById("chat");
    const input = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const statusEl = document.getElementById("status");

    function generateCode() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "R-";

      for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }

      return code;
    }

    function updateCodeDisplay() {
      document.getElementById("codeBox").textContent =
        "Code: " + (userCode || "---");

      document.getElementById("currentCodeDisplay").textContent =
        userCode || "Not set";
    }

    function setStatus(text) {
      statusEl.textContent = text || "";
    }

    function clearChat(showWelcome = true) {
      chat.innerHTML = "";

      if (showWelcome) {
        const welcome = document.createElement("div");
        welcome.id = "welcome";
        welcome.innerHTML =
          "<h2>Start a new research session</h2>" +
          "<p>Your saved conversation remains linked to your " +
          "Research Code. Open the code menu to load it.</p>";
        chat.appendChild(welcome);
      }
    }

    // IMPORTANT:
    // We create/retain the code, but DO NOT automatically call loadHistory().
    // Every new page visit therefore starts with an empty visible chat.
    if (!userCode) {
      userCode = generateCode();
      localStorage.setItem("research_code", userCode);
    }

    updateCodeDisplay();

    function showCodeModal() {
      document.getElementById("codeModal").style.display = "flex";
      document.getElementById("codeInput").value = "";
      setTimeout(() => document.getElementById("codeInput").focus(), 50);
    }

    function closeModal() {
      document.getElementById("codeModal").style.display = "none";
    }

    async function saveCode() {
      const inputCode = document
        .getElementById("codeInput")
        .value
        .trim()
        .toUpperCase();

      if (!/^R-[A-Z0-9]{5}$/.test(inputCode)) {
        alert("Please enter a valid Research Code such as R-A7K3M");
        return;
      }

      userCode = inputCode;
      localStorage.setItem("research_code", userCode);
      updateCodeDisplay();
      closeModal();

      await loadHistory();
    }

    function newChat() {
      // Keep the same Research Code, but start a fresh visible UI.
      // Future messages still belong to the same saved Research Code.
      clearChat(true);
      closeModal();
      setStatus("");
      input.focus();
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function renderInline(text) {
      let s = escapeHtml(text);

      // Protect inline code first.
      const codeParts = [];
      s = s.replace(/\\`([^\\`]+)\\`/g, function(_, code) {
        const id = codeParts.length;
        codeParts.push("<code>" + code + "</code>");
        return "@@INLINECODE" + id + "@@";
      });

      s = s
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/\\*([^*]+)\\*/g, "<em>$1</em>")
        .replace(/_([^_]+)_/g, "<em>$1</em>");

      s = s.replace(
        /\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );

      s = s.replace(
        /@@INLINECODE(\\d+)@@/g,
        function(_, id) {
          return codeParts[Number(id)];
        }
      );

      return s;
    }

    function renderMarkdown(text) {
      if (!text) return "";

      const source = String(text).replace(/\\r\\n/g, "\\n");
      const lines = source.split("\\n");
      const output = [];

      let inCode = false;
      let codeBuffer = [];
      let codeLanguage = "";
      let listType = null;

      function closeList() {
        if (listType) {
          output.push("</" + listType + ">");
          listType = null;
        }
      }

      function closeCode() {
        if (inCode) {
          const code = escapeHtml(codeBuffer.join("\\n"));
          output.push(
            "<pre><code" +
            (codeLanguage
              ? ' data-language="' + escapeHtml(codeLanguage) + '"'
              : "") +
            ">" +
            code +
            "</code></pre>"
          );
          codeBuffer = [];
          codeLanguage = "";
          inCode = false;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.trim().startsWith("```")) {
          if (inCode) {
            closeCode();
          } else {
            closeList();
            inCode = true;
            codeLanguage = line.trim().slice(3).trim();
          }
          continue;
        }

        if (inCode) {
          codeBuffer.push(line);
          continue;
        }

        if (!line.trim()) {
          closeList();
          continue;
        }

        const heading = line.match(/^\\s*(#{1,3})\\s+(.+)$/);
        if (heading) {
          closeList();
          const level = heading[1].length;
          output.push(
            "<h" + level + ">" +
            renderInline(heading[2].trim()) +
            "</h" + level + ">"
          );
          continue;
        }

        const unordered = line.match(/^\\s*[-*+]\\s+(.+)$/);
        if (unordered) {
          if (listType !== "ul") {
            closeList();
            output.push("<ul>");
            listType = "ul";
          }
          output.push("<li>" + renderInline(unordered[1]) + "</li>");
          continue;
        }

        const ordered = line.match(/^\\s*\\d+[.)]\\s+(.+)$/);
        if (ordered) {
          if (listType !== "ol") {
            closeList();
            output.push("<ol>");
            listType = "ol";
          }
          output.push("<li>" + renderInline(ordered[1]) + "</li>");
          continue;
        }

        if (/^\\s*>\\s?/.test(line)) {
          closeList();
          output.push(
            "<blockquote>" +
            renderInline(line.replace(/^\\s*>\\s?/, "")) +
            "</blockquote>"
          );
          continue;
        }

        closeList();
        output.push("<p>" + renderInline(line) + "</p>");
      }

      closeList();
      closeCode();

      return output.join("");
    }

    function addMessage(text, isUser) {
      const div = document.createElement("div");
      div.className = "message " + (isUser ? "user" : "ai");

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

      if (!message || !userCode || sendBtn.disabled) return;

      addMessage(message, true);
      input.value = "";
      sendBtn.disabled = true;
      setStatus("Researching...");

      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            userCode,
          }),
        });

        const data = await res.json();

        if (data.reply) {
          addMessage(data.reply, false);
          setStatus("Saved to your Research Code");
        } else {
          addMessage(
            "Error: " + (data.error || "Unknown error"),
            false
          );
          setStatus("");
        }
      } catch (err) {
        addMessage(
          "Network error. Please check your connection and try again.",
          false
        );
        setStatus("");
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }

    async function loadHistory() {
      if (!userCode) return;

      setStatus("Loading saved conversation...");

      try {
        const res = await fetch("/api/history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userCode }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Could not load history");
        }

        clearChat(false);

        if (data.history && data.history.length) {
          data.history.forEach((msg) => {
            addMessage(
              msg.content,
              msg.role === "user"
            );
          });

          setStatus(
            "Loaded " + data.history.length + " saved messages"
          );
        } else {
          clearChat(true);
          setStatus("No saved conversation for this code yet");
        }
      } catch (err) {
        clearChat(true);
        setStatus("Could not load saved history");
      }
    }

    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Deliberately NO loadHistory() here.
    // Opening/reloading the website gives a clean chat screen.
  </script>
</body>
</html>`;
}
