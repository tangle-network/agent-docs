/**
 * Minimal client for DeepWiki's public MCP server (https://mcp.deepwiki.com/mcp)
 * — free, no-auth, PUBLIC GitHub repos only. Three tools:
 *   read_wiki_structure(repoName) → the wiki's page list
 *   read_wiki_contents(repoName)  → the full wiki markdown
 *   ask_question(repoName, question) → a grounded AI answer
 *
 * Entirely best-effort: any failure (repo not indexed, network, protocol drift)
 * resolves to null so the deterministic core is never blocked. This is the ONLY
 * non-deterministic, network, LLM-touching part of cartograph, and it is opt-in.
 */

const ENDPOINT = 'https://mcp.deepwiki.com/mcp'
const PROTOCOL = '2025-06-18'

/** Parse a streamable-HTTP MCP response body (JSON or SSE) into JSON-RPC objects. */
function parseBody(contentType, text) {
  if (contentType.includes('text/event-stream')) {
    const out = []
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.*)$/)
      if (!m) continue
      try {
        out.push(JSON.parse(m[1]))
      } catch {
        /* skip non-JSON data frames */
      }
    }
    return out
  }
  try {
    return [JSON.parse(text)]
  } catch {
    return []
  }
}

async function post(body, sessionId, signal) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal })
  const text = await res.text()
  return { res, messages: parseBody(res.headers.get('content-type') ?? '', text) }
}

function resultOf(messages, id) {
  const msg = messages.find((m) => m && m.id === id)
  if (!msg || msg.error) return null
  return msg.result ?? null
}

/** Flatten an MCP tool result's content array to plain text. */
function toolText(result) {
  if (!result) return ''
  const content = Array.isArray(result.content) ? result.content : []
  return content
    .map((c) => (c && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * Fetch DeepWiki context for `slug` (`owner/repo`). Returns
 * `{ structure, answers: [{q, a}] }` or null. `ask` is a list of questions to
 * put to `ask_question` (e.g. ["What is the high-level architecture?"]).
 */
export async function fetchDeepwiki(slug, { ask = [], timeoutMs = 25000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const init = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: 'cartograph', version: '0.1.0' },
        },
      },
      undefined,
      ac.signal,
    )
    const sessionId = init.res.headers.get('mcp-session-id') ?? undefined
    if (!resultOf(init.messages, 1)) return null

    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId, ac.signal).catch(() => {})

    const call = async (id, name, args) => {
      const { messages } = await post(
        { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
        sessionId,
        ac.signal,
      )
      return toolText(resultOf(messages, id))
    }

    const structure = await call(2, 'read_wiki_structure', { repoName: slug })
    if (!structure) return null

    const answers = []
    let id = 3
    for (const q of ask) {
      const a = await call(id++, 'ask_question', { repoName: slug, question: q })
      if (a) answers.push({ q, a })
    }
    return { structure, answers }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
