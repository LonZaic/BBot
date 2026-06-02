const express = require('express')
const http = require('http')
const cors = require('cors')
const { v4: uuid } = require('uuid')
const { user, friend, dm, room } = require('./db')
const { authRequired } = require('./auth')
const { setupWebSocket } = require('./ws')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ══════════════════════════════════════
// Auth routes
// ══════════════════════════════════════

app.post('/api/auth/register', (req, res) => {
  const { name, password } = req.body
  if (!name || !password) return res.status(400).json({ error: '昵称和密码不能为空' })
  if (name.length > 20) return res.status(400).json({ error: '昵称最多20个字符' })
  if (password.length < 3) return res.status(400).json({ error: '密码最少3个字符' })

  const existing = user.findByName(name)
  if (existing) return res.status(409).json({ error: '该昵称已被使用' })

  const id = 'u_' + uuid().slice(0, 8)
  user.create(id, name, password)
  const token = 'tk_' + uuid()
  user.setToken(id, token)

  res.json({ id, name, token })
})

app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body
  if (!name || !password) return res.status(400).json({ error: '昵称和密码不能为空' })

  const u = user.findByName(name)
  if (!u || u.password !== password) return res.status(401).json({ error: '昵称或密码错误' })

  const token = 'tk_' + uuid()
  user.setToken(u.id, token)

  res.json({ id: u.id, name: u.name, token })
})

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name })
})

// ══════════════════════════════════════
// User routes
// ══════════════════════════════════════

app.get('/api/users/search', authRequired, (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])
  const results = user.searchByName(q, req.user.id)
  res.json(results)
})

app.get('/api/users/online', authRequired, (req, res) => {
  const all = user.listAll()
  res.json(all)
})

// ══════════════════════════════════════
// Friend routes
// ══════════════════════════════════════

app.get('/api/friends', authRequired, (req, res) => {
  const list = friend.getList(req.user.id)
  const pending = friend.getPending(req.user.id)
  res.json({ list, pending })
})

app.post('/api/friends/add', authRequired, (req, res) => {
  const { friendName } = req.body
  if (!friendName) return res.status(400).json({ error: '请输入好友昵称' })

  const target = user.findByName(friendName)
  if (!target) return res.status(404).json({ error: '未找到该用户' })
  if (target.id === req.user.id) return res.status(400).json({ error: '不能添加自己为好友' })

  if (friend.areFriends(req.user.id, target.id)) {
    return res.status(400).json({ error: '已经是好友了' })
  }
  if (friend.hasPending(req.user.id, target.id)) {
    return res.status(400).json({ error: '已发送过好友申请，等待对方同意' })
  }
  // Check if the target has already sent a request to us
  if (friend.hasPending(target.id, req.user.id)) {
    // Auto-accept
    friend.accept(req.user.id, target.id)
    return res.json({ ok: true, autoAccepted: true })
  }

  friend.add(req.user.id, target.id)
  res.json({ ok: true, pending: true })
})

app.post('/api/friends/accept', authRequired, (req, res) => {
  const { friendId } = req.body
  friend.accept(req.user.id, friendId)
  res.json({ ok: true })
})

app.post('/api/friends/reject', authRequired, (req, res) => {
  const { friendId } = req.body
  friend.reject(req.user.id, friendId)
  res.json({ ok: true })
})

app.delete('/api/friends/:friendId', authRequired, (req, res) => {
  friend.remove(req.user.id, req.params.friendId)
  res.json({ ok: true })
})

// ══════════════════════════════════════
// DM routes
// ══════════════════════════════════════

app.get('/api/dm/:friendId', authRequired, (req, res) => {
  if (!friend.areFriends(req.user.id, req.params.friendId)) {
    return res.status(403).json({ error: '还不是好友，无法查看消息' })
  }
  const { before } = req.query
  const msgs = dm.getHistory(req.user.id, req.params.friendId, 50, before ? parseInt(before) : null)
  res.json(msgs)
})

app.post('/api/dm/:friendId', authRequired, (req, res) => {
  if (!friend.areFriends(req.user.id, req.params.friendId)) {
    return res.status(403).json({ error: '还不是好友，无法发送消息' })
  }
  const { text, aiReply } = req.body
  const result = dm.send(req.user.id, req.params.friendId, text, aiReply || null)
  res.json({ id: result.lastInsertRowid, ok: true })
})

// ══════════════════════════════════════
// Group routes
// ══════════════════════════════════════

app.get('/api/groups', authRequired, (req, res) => {
  const list = room.listForUser(req.user.id)
  res.json(list)
})

app.get('/api/groups/all', authRequired, (req, res) => {
  const list = room.listAll()
  res.json(list)
})

app.post('/api/groups', authRequired, (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) return res.status(400).json({ error: '群名不能为空' })
  const id = 'room_' + uuid().slice(0, 8)
  const inviteCode = 'ROOM' + Math.random().toString(36).slice(2, 6).toUpperCase()
  room.create(id, name.trim(), req.user.id, inviteCode)
  res.json({ id, name: name.trim(), invite_code: inviteCode })
})

app.post('/api/groups/join', authRequired, (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: '请输入邀请码' })
  const r = room.findByInvite(code.toUpperCase())
  if (!r) return res.status(404).json({ error: '邀请码无效' })
  if (room.isMember(r.id, req.user.id)) return res.status(400).json({ error: '你已经在群里了' })
  room.join(r.id, req.user.id)
  res.json({ id: r.id, name: r.name })
})

app.get('/api/groups/:id', authRequired, (req, res) => {
  const r = room.findById(req.params.id)
  if (!r) return res.status(404).json({ error: '群不存在' })
  if (!room.isMember(r.id, req.user.id)) return res.status(403).json({ error: '你不在这个群里' })
  const members = room.getMembers(r.id)
  res.json({ ...r, members })
})

app.get('/api/groups/:id/messages', authRequired, (req, res) => {
  const r = room.findById(req.params.id)
  if (!r || !room.isMember(r.id, req.user.id)) return res.status(403).json({ error: '无权访问' })
  const { before } = req.query
  const msgs = room.getMessages(req.params.id, 50, before ? parseInt(before) : null)
  res.json(msgs)
})

app.post('/api/groups/:id/leave', authRequired, (req, res) => {
  room.leave(req.params.id, req.user.id)
  res.json({ ok: true })
})

// ══════════════════════════════════════
// AI proxy - @ds chat
// ══════════════════════════════════════

app.post('/api/ai/chat', authRequired, async (req, res) => {
  const { messages, model } = req.body
  const apiKey = req.headers['x-api-key']

  if (!apiKey) return res.status(400).json({ error: '缺少 API Key' })

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model || 'deepseek-v4-flash',
        messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: false
      })
    })
    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }
    const data = await response.json()
    res.json({ reply: data.choices?.[0]?.message?.content || '(无响应)' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/ai/chat/stream', authRequired, async (req, res) => {
  const { messages, model } = req.body
  const apiKey = req.headers['x-api-key']

  if (!apiKey) return res.status(400).json({ error: '缺少 API Key' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model || 'deepseek-v4-flash',
        messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: true
      })
    })

    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: 'API error ' + response.status })}\n\n`)
      res.end()
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) {
          res.write(trimmed + '\n\n')
        }
      }
    }
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`)
    res.end()
  }
})

// ══════════════════════════════════════
// Start server
// ══════════════════════════════════════

const PORT = process.env.PORT || 3001
const server = http.createServer(app)

// Reset all users to offline on startup
user.setAllOffline()

setupWebSocket(server)

server.listen(PORT, () => {
  console.log(`[Server] BBot API server running on http://localhost:${PORT}`)
  console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`)
})
