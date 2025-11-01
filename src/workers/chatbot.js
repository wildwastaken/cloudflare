const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>AI Chatbot</title>
  <style>
    body {
      font-family: sans-serif;
    }

    #chat-window {
      width: 400px;
      margin: 50px auto;
      border: 1px solid #ccc;
      padding: 20px;
    }

    #chat-messages {
      height: 300px;
      overflow-y: scroll;
      border-bottom: 1px solid #ccc;
      margin-bottom: 10px;
    }

    .message {
      padding: 5px;
      margin-bottom: 5px;
    }

    .user {
      text-align: right;
    }

    .bot {
      text-align: left;
    }

    #message-input {
      width: 300px;
    }
  </style>
</head>
<body>
  <div id="chat-window">
    <div id="chat-messages"></div>
    <input type="text" id="message-input" placeholder="Type your message..." />
    <button id="send-button">Send</button>
  </div>
  <script>
    (function () {
      const messageInput = document.getElementById('message-input');
      const sendButton = document.getElementById('send-button');
      const chatMessages = document.getElementById('chat-messages');

      const STORAGE_KEY = 'cf-ai-chatbot-session';
      let sessionId = window.localStorage.getItem(STORAGE_KEY) || '';
      let history = [];
      let isSending = false;

      sendButton.addEventListener('click', trySendMessage);
      messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          trySendMessage();
        }
      });

      function addMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);
        messageElement.innerText = message;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      async function trySendMessage() {
        if (isSending) {
          return;
        }

        const message = messageInput.value.trim();
        if (!message) {
          return;
        }

        isSending = true;
        addMessage('user', message);
        messageInput.value = '';

        try {
          const response = await fetch('/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message, history, sessionId }),
          });

          const data = await response.json();

          if (!response.ok || data.error) {
            const errorMessage = data && typeof data.error === 'string'
              ? data.error
              : 'Something went wrong. Please try again.';
            addMessage('bot', errorMessage);
            return;
          }

          if (data.sessionId && !sessionId) {
            sessionId = data.sessionId;
            window.localStorage.setItem(STORAGE_KEY, sessionId);
          }

          if (Array.isArray(data.history)) {
            history = data.history;
          } else {
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: data.response || '' });
          }

          addMessage('bot', data.response || '');
        } catch (err) {
          console.error(err);
          addMessage('bot', 'Network error. Please try again.');
        } finally {
          isSending = false;
        }
      }
    })();
  </script>
</body>
</html>`;

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_HISTORY_LENGTH = 20;
const HISTORY_TTL_SECONDS = 60 * 60 * 24;
const MODEL_ID = '@cf/meta/llama-3-8b-instruct';

function isRemoteBindingError(error) {
  return (
    error &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    /Binding AI needs to be run remotely/i.test(error.message)
  );
}

async function runModel(env, chat) {
  let lastError = null;

  if (env.AI && typeof env.AI.run === 'function') {
    try {
      return await env.AI.run(MODEL_ID, { messages: chat });
    } catch (error) {
      lastError = error;
      if (!isRemoteBindingError(error)) {
        throw error;
      }
    }
  }

  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CF_AI_API_TOKEN;
  if (!accountId || !apiToken) {
    throw lastError || new Error('AI binding unavailable and no API token configured.');
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL_ID}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ messages: chat }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Cloudflare AI HTTP error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  if (!payload || payload.success === false) {
    throw new Error('Cloudflare AI returned an error response.');
  }

  // REST API nests the model output under result.response.
  if (payload.result && typeof payload.result === 'object') {
    const responseText =
      typeof payload.result.response === 'string'
        ? payload.result.response
        : typeof payload.result.output_text === 'string'
          ? payload.result.output_text
          : '';
    return { response: responseText };
  }

  return { response: '' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        // Serve the bundled single-page UI for simple local testing.
        return new Response(request.method === 'HEAD' ? null : HTML_PAGE, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8',
          },
        });
      }

      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const body = await request.json();
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      const incomingHistory = Array.isArray(body?.history) ? body.history : [];

      if (!message) {
        return new Response(JSON.stringify({ error: 'Message is required.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const existingSessionId =
        typeof body?.sessionId === 'string' && body.sessionId
          ? body.sessionId
          : '';
      const sessionId = existingSessionId || crypto.randomUUID();
      const historyKey = `session:${sessionId}`;

      let persistedHistory = [];
      if (env.CHAT_HISTORY) {
        try {
          const storedHistory = await env.CHAT_HISTORY.get(historyKey, {
            type: 'json',
          });
          if (Array.isArray(storedHistory)) {
            persistedHistory = storedHistory;
          }
        } catch (kvError) {
          console.warn('Unable to read history from KV:', kvError);
        }
      } else {
        persistedHistory = incomingHistory;
      }

      const trimmedHistory = Array.isArray(persistedHistory)
        ? persistedHistory.slice(-MAX_HISTORY_LENGTH)
        : [];

      const chat = [
        { role: 'system', content: 'You are a friendly chatbot.' },
        ...trimmedHistory,
        { role: 'user', content: message },
      ];

      const aiResult = await runModel(env, chat);

      const responseText =
        typeof aiResult?.response === 'string' ? aiResult.response : '';
      const updatedHistory = [
        ...trimmedHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: responseText },
      ].slice(-MAX_HISTORY_LENGTH);

      if (env.CHAT_HISTORY) {
        try {
          await env.CHAT_HISTORY.put(
            historyKey,
            JSON.stringify(updatedHistory),
            { expirationTtl: HISTORY_TTL_SECONDS },
          );
        } catch (kvWriteError) {
          console.warn('Unable to persist history to KV:', kvWriteError);
        }
      }

      return new Response(
        JSON.stringify({
          sessionId,
          response: responseText,
          history: updatedHistory,
        }),
        { headers: JSON_HEADERS },
      );
    } catch (error) {
      console.error(error);
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : '';

      if (isRemoteBindingError(error)) {
        return new Response(
          JSON.stringify({
            error:
              'Remote Workers AI required. Either switch networks and rerun `wrangler dev --remote`, or configure `CF_AI_API_TOKEN` for direct API access.',
          }),
          { status: 503, headers: JSON_HEADERS },
        );
      }

      if (
        typeof message === 'string' &&
        /sslv3 alert handshake failure/i.test(message)
      ) {
        return new Response(
          JSON.stringify({
            error:
              'TLS handshake failed. This usually means the network is intercepting HTTPS traffic. Try another network or a hotspot.',
          }),
          { status: 503, headers: JSON_HEADERS },
        );
      }

      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        { status: 500, headers: JSON_HEADERS },
      );
    }
  },
};
