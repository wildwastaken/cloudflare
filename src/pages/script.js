const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const chatMessages = document.getElementById('chat-messages');

const STORAGE_KEY = 'cf-ai-chatbot-session';
let sessionId = window.localStorage.getItem(STORAGE_KEY) || '';
let history = [];
let isSending = false;

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

function addMessage(sender, message) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', sender);
  messageElement.innerText = message;
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
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
  } catch (error) {
    console.error(error);
    addMessage('bot', 'Network error. Please try again.');
  } finally {
    isSending = false;
  }
}
