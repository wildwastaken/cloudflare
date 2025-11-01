# Cloudflare AI Chatbot

This is an AI-powered chatbot application built on Cloudflare.

## Running Instructions

### 1. Install Dependencies

Make sure you have [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) installed. Then, install the Cloudflare Wrangler CLI:

```bash
npm install -g wrangler
```

### 2. Create a KV Namespace

Create a KV namespace for storing the chat history:

```bash
wrangler kv:namespace create "CHAT_HISTORY"
```

This command will output an `id` and a `preview_id`. Open the `wrangler.toml` file and add these IDs to the `[[kv_namespaces]]` section:

```toml
[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "<your_id>"
preview_id = "<your_preview_id>"
```

### 3. Run the Worker (Remote Dev Required for AI)

Workers AI bindings run in Cloudflare's infrastructure even during development, so start Wrangler in remote mode:

```bash
wrangler dev --remote
```

If you forget to use `--remote`, the Worker returns an error that the AI binding must run remotely. Once the dev server is up, open `http://localhost:8787` to use the chat UI.

If your network blocks remote previews (TLS handshake failures), you can instead supply a Cloudflare API token with Workers AI permissions and stay in pure local mode:

1. Edit `wrangler.toml` and ensure `CF_ACCOUNT_ID` matches your Cloudflare account.
2. Store the API token as a secret:

   ```bash
   wrangler secret put CF_AI_API_TOKEN
   ```

3. Run local dev:

   ```bash
   wrangler dev
   ```

### 4. Chat Memory

The Worker stores each conversation in `CHAT_HISTORY` (KV) keyed by a generated session ID. The browser keeps this ID in `localStorage`, which lets returning users pick up where they left off. If KV is not configured, the Worker gracefully falls back to in-memory history for the current browser session only.

### 5. Deploy to Cloudflare

To deploy the application to Cloudflare, use the following command:

```bash
wrangler publish
```
