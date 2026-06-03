// ══════════════════════════════════════════════════════
// BBot Agent Engine v3 — Built on Claude Code architecture
//
// Architecture adapted from CC source:
// - agent loop: single while, tool_choice: auto, parallel tools
// - system prompt: 9-part structure (identity→tools→flow→rules→style)
// - permission: tool-level safety (dangerous commands blocked)
// - context: auto-read CLAUDE.md/package.json/README.md on start
// - memory: file-based project context persistence
// - anti-loop: noop detection + max rounds
// ══════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const https = require('https')

// ─── Config ───
const MAX_ROUNDS = 50
const MAX_NOOP_REPEAT = 3
const TOOL_TIMEOUT_MS = 30000
const AGENT_TIMEOUT_MS = 600000
const MAX_FILE_SIZE = 500 * 1024
// CC-style: work in the user's real filesystem, not a sandbox.
// Default starting directory is the user's home.
const os = require('os')
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE || os.homedir()

// ─── System directories protected from writes ───
const PROTECTED_DIRS = process.platform === 'win32' ? [
  'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
  'C:\\Program Files', 'C:\\Program Files (x86)',
  'C:\\ProgramData\\Microsoft', 'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
] : [
  '/System', '/etc', '/boot', '/usr/lib', '/usr/bin', '/sbin', '/bin',
]

// ─── Safety: forbidden commands ───
const FORBIDDEN = [
  /rm\s+-rf/, /sudo/, /chmod\s+777/, />\s*\/dev\//,
  /mkfs/, /dd\s+if=/, /:\s*\(\)\s*\{/, /fork\s*bomb/,
  /shutdown/, /reboot/, /init\s+[0-6]/,
  /del\s+\/F\s+\/S\s+\/\w:/, /diskpart/i, /format\s+[a-z]:/i,
]
const ALLOWED = [
  /^node\s/, /^python\s/, /^pip\s/, /^npm\s/, /^npx\s/,
  /^ls\s/, /^dir\s/, /^cat\s/, /^echo\s/, /^mkdir\s/,
  /^cd\s/, /^pwd/, /^cp\s/, /^mv\s/, /^git\s/,
  /^curl\s/, /^type\s/, /^find\s/, /^tree\s/,
  /^del\s/, /^copy\s/, /^xcopy\s/, /^sort\s/,
  /^where\s/, /^whoami/, /^set\s/,
]

function isCommandSafe(cmd) {
  const t = cmd.trim()
  for (const re of FORBIDDEN) { if (re.test(t)) return { safe: false, reason: `Blocked: ${t.slice(0, 40)}` } }
  for (const re of ALLOWED) { if (re.test(t)) return { safe: true } }
  return { safe: true, warning: `Unknown: ${t.slice(0, 40)}` }
}

// CC-style: resolve any path. Write protection for system dirs only.
function resolvePath(p) {
  if (path.isAbsolute(p)) return path.normalize(p)
  return path.resolve(WORKSPACE_ROOT, p)
}

function isSystemPath(p) {
  const r = path.resolve(p)
  return PROTECTED_DIRS.some(d => r.toLowerCase().startsWith(d.toLowerCase()))
}

// ─── DuckDuckGo Web Search ───
function duckDuckGoSearch(query) {
  return new Promise((resolve) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    https.get(url, { timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          const results = []
          if (j.AbstractText) results.push(`📖 ${j.AbstractText}`)
          if (j.AbstractURL) results.push(`🔗 ${j.AbstractURL}`)
          if (j.RelatedTopics) {
            for (const t of j.RelatedTopics.slice(0, 5)) {
              if (t.Text) results.push(`• ${t.Text}${t.FirstURL ? ' — ' + t.FirstURL : ''}`)
            }
          }
          resolve(results.length ? results.join('\n') : `No results found for: ${query}`)
        } catch { resolve(`Search completed but could not parse results for: ${query}`) }
      })
    }).on('error', () => resolve(`Search failed (network error) for: ${query}`))
  })
}

// ═══════════════════════════════════════
// Tool definitions — CC style
// ═══════════════════════════════════════
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories. Use any path — you have access to the entire computer. Default: current directory.',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'Directory path. Accepts absolute paths (E:\\, C:\\Users\\...) or relative paths.' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read any file on the computer. Shows line numbers. Use offset/limit for large files. ALWAYS read before editing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path. Accepts absolute (E:\\file.txt) or relative paths.' },
          offset: { type: 'number', description: 'Start line (1-based). Optional.' },
          limit: { type: 'number', description: 'Max lines to read. Default 2000. Optional.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file. For small changes to existing files, prefer edit_file instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          content: { type: 'string', description: 'Complete file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace exact text in a file. old_string must match exactly (including indentation). This is the PREFERRED way to modify existing files — no need to rewrite the whole thing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'Exact text to replace (must match exactly)' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files by glob pattern. E.g. **/*.js, src/**/*.vue, *.json',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string', description: 'Glob pattern like **/*.js or src/**/*.ts' } },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents with regex. Shows file:line matches. Use to find code across the project.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern or search text' },
          glob: { type: 'string', description: 'Filter files by name pattern, e.g. *.js' },
          context: { type: 'number', description: 'Show N lines before/after each match' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute commands on the computer (node, python, git, npm, dir, ls, etc.). Dangerous commands (rm -rf, format, shutdown) are blocked. You can access any drive.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Command to execute' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo. Use for looking up current information, documentation, or anything you need to verify online.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query']
      }
    }
  }
]

// ═══════════════════════════════════════
// Tool executors
// ═══════════════════════════════════════
const executors = {
  list_files(args) {
    const dirPath = args.dir ? resolvePath(args.dir) : WORKSPACE_ROOT
    if (!fs.existsSync(dirPath)) return `Error: directory not found: ${args.dir || '.'}`
    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    const lines = items.map(i => {
      try {
        const full = path.join(dirPath, i.name)
        const stat = fs.statSync(full)
        return `${i.isDirectory() ? '📁' : '📄'} ${i.name}${i.isDirectory() ? '/' : ''}  ${stat.isFile() ? stat.size + 'B' : ''}`
      } catch { return `${i.isDirectory() ? '📁' : '📄'} ${i.name}` }
    })
    return lines.join('\n') || '(empty)'
  },

  read_file(args) {
    const fp = resolvePath(args.path)
    if (!fs.existsSync(fp)) return `Error: file not found: ${args.path}`
    const stat = fs.statSync(fp)
    if (stat.size > MAX_FILE_SIZE) return `Error: file too large (${(stat.size / 1024).toFixed(0)}KB). Use offset/limit to read in chunks.`
    const content = fs.readFileSync(fp, 'utf-8')
    const lines = content.split('\n')
    const offset = args.offset ? Math.max(0, args.offset - 1) : 0
    const limit = args.limit || 2000
    const slice = lines.slice(offset, offset + limit)
    const numbered = slice.map((l, i) => `${String(offset + i + 1).padStart(4)}| ${l}`).join('\n')
    const hdr = `📄 ${args.path} (${lines.length} lines, ${stat.size}B)`
    if (lines.length > limit) return `${hdr}\nShowing lines ${offset + 1}-${offset + slice.length}:\n${numbered}\n... ${lines.length} total. Use offset/limit for more.`
    return `${hdr}\n${numbered}`
  },

  write_file(args) {
    const fp = resolvePath(args.path)
    if (isSystemPath(fp)) return `❌ Cannot write to system path: ${args.path}. Protected directories: ${PROTECTED_DIRS.join(', ')}`
    const dir = path.dirname(fp)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fp, args.content, 'utf-8')
    return `✅ Wrote: ${args.path} (${args.content.length} chars, ${args.content.split('\n').length} lines)`
  },

  edit_file(args) {
    const fp = resolvePath(args.path)
    if (!fs.existsSync(fp)) return `Error: file not found: ${args.path}. Use write_file to create new files.`
    if (isSystemPath(fp)) return `❌ Cannot edit system path: ${args.path}. Protected directories: ${PROTECTED_DIRS.join(', ')}`
    const content = fs.readFileSync(fp, 'utf-8')
    if (!content.includes(args.old_string)) {
      const search = args.old_string.split('\n')[0].trim().slice(0, 30)
      const lines = content.split('\n')
      const hints = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(search)) hints.push(`  line ${i + 1}: ${lines[i].trim().slice(0, 80)}`)
      }
      let msg = `❌ Edit failed: old_string not found in ${args.path}.\n`
      if (hints.length) msg += `Possible matches:\n${hints.slice(0, 5).join('\n')}\n`
      msg += `Tip: use read_file first to confirm the exact content, including indentation.`
      return msg
    }
    const count = args.replace_all ? content.split(args.old_string).length - 1 : 1
    const newContent = args.replace_all ? content.split(args.old_string).join(args.new_string) : content.replace(args.old_string, args.new_string)
    fs.writeFileSync(fp, newContent, 'utf-8')
    const preview = args.old_string.length > 30 ? `"${args.old_string.slice(0, 30)}..."` : `"${args.old_string}"`
    return `✅ Edited: ${args.path} — replaced ${count} occurrence(s) of ${preview}`
  },

  glob(args) {
    const pattern = args.pattern
    const regexStr = pattern.replace(/\./g, '\\.').replace(/\*\*/g, '<<<DS>>>').replace(/\*/g, '[^/\\\\]*').replace(/<<<DS>>>/g, '.*')
    const re = new RegExp('^' + regexStr + '$', 'i')
    const results = []
    function scan(dir) {
      try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name); const rel = path.relative(WORKSPACE_ROOT, full)
          if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === '$RECYCLE.BIN') continue
          if (item.isDirectory()) { if (!isSystemPath(full)) scan(full) }
          else if (re.test(rel) || re.test(item.name)) {
            try { results.push(`${full}  (${fs.statSync(full).size}B)`) } catch { results.push(full) }
          }
        }
      } catch {}
    }
    scan(WORKSPACE_ROOT)
    return results.length ? `Found ${results.length} files:\n${results.slice(0, 100).join('\n')}` : `No files matching "${pattern}"`
  },

  grep(args) {
    const results = []
    const fileGlob = args.glob || '*'
    const ctx = args.context || 0
    const searchDir = args.path ? resolvePath(args.path) : WORKSPACE_ROOT
    const reGlob = new RegExp('^' + fileGlob.replace(/\./g, '\\.').replace(/\*/g, '[^/\\\\]*').replace(/\*\*/g, '.*') + '$', 'i')
    function scan(dir) {
      try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name)
          if (item.name.startsWith('.') || item.name === 'node_modules') continue
          if (item.isDirectory()) { if (!isSystemPath(full)) scan(full) }
          else if (reGlob.test(item.name)) {
            try {
              const lines = fs.readFileSync(full, 'utf-8').split('\n')
              for (let i = 0; i < lines.length; i++) {
                let matched = false
                try { matched = new RegExp(args.pattern, 'i').test(lines[i]) } catch { matched = lines[i].toLowerCase().includes(args.pattern.toLowerCase()) }
                if (matched) {
                  if (ctx > 0) {
                    const s = Math.max(0, i - ctx); const e = Math.min(lines.length, i + ctx + 1)
                    const block = []; for (let j = s; j < e; j++) block.push(`${j === i ? '>' : ' '}${String(j + 1).padStart(4)}| ${lines[j].slice(0, 120)}`)
                    results.push(`\n📄 ${full}:\n${block.join('\n')}`)
                  } else {
                    results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 120)}`)
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
    }
    scan(searchDir)
    return results.length ? results.slice(0, 60).join('\n') + (results.length > 60 ? `\n... +${results.length - 60} more` : '') : `No matches for "${args.pattern}"`
  },

  run_command(args) {
    const check = isCommandSafe(args.command)
    if (!check.safe) return `❌ ${check.reason}`
    try {
      const r = execSync(args.command, { cwd: WORKSPACE_ROOT, timeout: TOOL_TIMEOUT_MS, encoding: 'utf-8', maxBuffer: 1024 * 1024 })
      const out = r.trim() || '(ok, no output)'
      return (check.warning ? `⚠ ${check.warning}\n` : '') + out
    } catch (e) {
      return `❌ Command failed (exit ${e.status}): ${(e.stderr || e.message).slice(0, 800)}`
    }
  },

  web_search(args) {
    return duckDuckGoSearch(args.query)
  }
}

// ─── Project context auto-detection ───
function readProjectContext() {
  const contextFiles = []
  const priorityFiles = ['CLAUDE.md', 'README.md', 'package.json', 'tsconfig.json', 'vite.config.js', 'vite.config.ts']
  for (const f of priorityFiles) {
    const full = path.join(WORKSPACE_ROOT, f)
    if (fs.existsSync(full)) {
      try {
        const stat = fs.statSync(full)
        if (stat.size < 80 * 1024) {
          contextFiles.push({ name: f, content: fs.readFileSync(full, 'utf-8').slice(0, 5000) })
        }
      } catch {}
    }
  }
  return contextFiles
}

// ═══════════════════════════════════════
// Build CC-style system prompt
// ═══════════════════════════════════════
function buildSystemPrompt(projectContext) {
  let prompt = `You are an AI coding agent with full access to the user's computer (like Claude Code). You can read and write files on any drive (C:\\, D:\\, E:\\, etc.), execute commands, and search the web.

## Core Principles

1. **Read before you act** — Always read files before modifying them. Never guess what's in a file.
2. **Use edit_file for small changes** — For existing files, use edit_file (precise string replacement). Only use write_file for new files or complete rewrites.
3. **Verify after changes** — Read the file back after editing to confirm correctness.
4. **Handle errors gracefully** — If something fails, try a different approach. Don't repeat the same failing action.
5. **Be thorough** — Complete the task fully. Don't leave it half-done.

## Your Capabilities

- **Full filesystem access** — You can read/write any file on any drive (E:\\, C:\\, D:\\, etc.). Use absolute paths like E:\\project\\file.js.
- **System directories are write-protected** — Cannot write to C:\\Windows, C:\\Program Files, etc. (read is still allowed).
- **Command execution** — Run node, python, git, npm, and other safe commands. Dangerous commands (format, shutdown, rm -rf) are blocked.
- **Web search** — Search the internet via DuckDuckGo.

## Workflow

For each task, follow this order:
1. **Explore** — Use list_files to understand the directory structure. Ask the user if you're unsure where something is.
2. **Understand** — Read relevant files before changing them
3. **Execute** — Make changes using edit_file (preferred) or write_file
4. **Verify** — Check your work by reading files back or running commands
5. **Report** — Summarize what you did in 1-2 sentences

## Tools

| Tool | Use | Key Params |
|------|-----|------------|
| list_files | List directory contents | dir (absolute or relative path) |
| read_file | Read any file with line numbers | path |
| write_file | Create or overwrite a file | path, content |
| edit_file | Precise text replacement (PREFERRED) | path, old_string, new_string |
| glob | Find files by name pattern | pattern (e.g. **/*.js) |
| grep | Search file contents | pattern, path?, glob? |
| run_command | Execute commands | command |
| web_search | Search the web via DuckDuckGo | query |

## Rules

1. You can call multiple tools per round — they execute in sequence.
2. edit_file's old_string must match EXACTLY (including spaces and indentation).
3. Absolute paths work everywhere — use them! The user may reference any drive or directory.
4. Never repeat the same operation more than 3 times — pause, think, try something different.`

  if (projectContext.length > 0) {
    prompt += `\n\n## Current Directory Context\n\n`
    for (const f of projectContext) {
      prompt += `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n\n`
    }
  }

  prompt += '\n\nNow begin. Explore the relevant directories, understand the task, and complete it thoroughly.'
  return prompt
}

// Agent loop — CC pattern
// ═══════════════════════════════════════
async function runAgent({ task, apiKey, model = 'deepseek-v4-pro', onProgress, signal }) {
  const projectContext = readProjectContext()
  const systemPrompt = buildSystemPrompt(projectContext)

  if (projectContext.length > 0) {
    onProgress({ type: 'context', text: 'Found ' + projectContext.length + ' project file(s): ' + projectContext.map(f => f.name).join(', ') })
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '## Task\n\n' + task + '\n\nStart by exploring the relevant paths. Use list_files to understand what you are working with, then complete the task.' }
  ]

  let rounds = 0
  let finalResult = ''
  let lastError = ''
  const startTime = Date.now()
  const actionHistory = []
  let consecutiveNoop = 0

  onProgress({ type: 'start', task })

  while (rounds < MAX_ROUNDS) {
    // Timeout check
    if (Date.now() - startTime > AGENT_TIMEOUT_MS) {
      onProgress({ type: 'warning', text: 'Agent timeout reached (10 min)' })
      finalResult = lastError || 'Timeout — agent ran for 10 minutes. Check workspace for partial results.'
      break
    }

    // Abort check
    if (signal && signal.aborted) {
      onProgress({ type: 'aborted' })
      finalResult = 'Task was aborted.'
      break
    }

    rounds++
    onProgress({ type: 'round', round: rounds, max: MAX_ROUNDS })

    // ─── Call API ───
    let response
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 8192, temperature: 0.3 }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`)
      }

      response = await res.json()
    } catch (e) {
      const errMsg = `API call failed: ${e.message}`
      onProgress({ type: 'error', text: errMsg })
      lastError = errMsg

      // Retry once for network errors
      if (e.message.includes('fetch') || e.message.includes('network') || e.message.includes('ECONN')) {
        onProgress({ type: 'thinking', text: 'Network error, retrying...' })
        await new Promise(r => setTimeout(r, 2000))
        try {
          const retryRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 8192, temperature: 0.3 }),
          })
          if (retryRes.ok) { response = await retryRes.json(); onProgress({ type: 'thinking', text: 'Retry succeeded.' }) }
          else { finalResult = errMsg; break }
        } catch { finalResult = errMsg; break }
      } else {
        finalResult = errMsg
        break
      }
    }

    if (!response) continue

    const msg = response.choices?.[0]?.message
    if (!msg) { onProgress({ type: 'error', text: 'Model returned empty response.' }); break }

    // Report thinking
    if (msg.content) {
      onProgress({ type: 'thinking', text: msg.content })
    }

    // ─── No more tool calls → agent is done ───
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalResult = msg.content || 'Task completed.'
      onProgress({ type: 'done', text: finalResult, rounds })
      break
    }

    // ─── Add assistant message ───
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls })

    // ─── Execute tool calls (support parallel) ───
    for (const tc of msg.tool_calls) {
      const toolName = tc.function?.name
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}

      onProgress({ type: 'tool_start', tool: toolName, args })

      // No-op detection
      const actionKey = `${toolName}:${JSON.stringify(args)}`
      actionHistory.push(actionKey)
      if (actionHistory.length > 10) actionHistory.shift()
      const recent = actionHistory.slice(-MAX_NOOP_REPEAT)
      if (recent.length >= MAX_NOOP_REPEAT && new Set(recent).size === 1) {
        consecutiveNoop++
        const warnMsg = `Repeated action: ${toolName} (${consecutiveNoop}x). Try a different approach.`
        onProgress({ type: 'warning', text: warnMsg })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `[System] You've repeated ${toolName} ${MAX_NOOP_REPEAT} times with the same args. STOP. Try something different or summarize your progress.` })
        if (consecutiveNoop >= 2) {
          onProgress({ type: 'warning', text: 'Agent stuck in loop, forcing summary.' })
          messages.push({ role: 'user', content: 'You have been repeating the same action. Stop calling tools and summarize what you have done so far.' })
        }
        continue
      } else {
        consecutiveNoop = 0
      }

      // Execute
      const executor = executors[toolName]
      let result
      if (!executor) {
        result = `Unknown tool: ${toolName}. Available: ${Object.keys(executors).join(', ')}`
      } else {
        try {
          const p = await executor(args)
          result = typeof p === 'string' ? p : JSON.stringify(p)
        } catch (e) {
          result = `Tool error: ${e.message}`
        }
      }

      onProgress({ type: 'tool_result', tool: toolName, result: result.slice(0, 500) })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }

    // Force break if too many noop cycles
    if (consecutiveNoop >= 3) {
      onProgress({ type: 'warning', text: 'Agent severely stuck, stopping.' })
      finalResult = 'Agent stopped due to repeated loops. Check workspace for partial progress.'
      break
    }
  }

  // ─── Exhausted rounds ───
  if (rounds >= MAX_ROUNDS && !finalResult) {
    messages.push({ role: 'user', content: 'You have reached the round limit. Summarize what you did. Do NOT call any tools — just output a summary.' })
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: messages.slice(-20), max_tokens: 1024, temperature: 0.3 }),
      })
      const data = await res.json()
      finalResult = data.choices?.[0]?.message?.content || 'Agent reached max rounds.'
    } catch {
      finalResult = 'Agent reached max rounds. Check workspace for results.'
    }
    onProgress({ type: 'done', text: finalResult, rounds, truncated: true })
  }

  // ─── Final workspace state ───
  try {
    function listAll(d, pre = '') {
      const r = []
      for (const item of fs.readdirSync(d, { withFileTypes: true })) {
        if (item.name.startsWith('.') || item.name === 'node_modules') continue
        const rel = pre + item.name
        if (item.isDirectory()) { r.push(rel + '/'); r.push(...listAll(path.join(d, item.name), rel + '/')) }
        else { try { r.push(`${rel} (${fs.statSync(path.join(d, item.name)).size}B)`) } catch { r.push(rel) } }
      }
      return r
    }
    onProgress({ type: 'workspace', files: listAll(WORKSPACE_ROOT).slice(0, 100) })
  } catch {}

  return finalResult
}

function cleanWorkspace() {
  try {
    for (const item of fs.readdirSync(WORKSPACE_ROOT)) {
      fs.rmSync(path.join(WORKSPACE_ROOT, item), { recursive: true, force: true })
    }
  } catch {}
}

module.exports = { runAgent, cleanWorkspace, WORKSPACE_ROOT }
