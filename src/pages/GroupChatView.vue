<template>
  <div class="app-layout">
    <Sidebar />
    <div class="main-area">
      <div class="chat-header">
        <button class="btn-back" @click="$router.push('/groups')">&lt; 群列表</button>
        <span class="chat-title">{{ groupName }}</span>
        <span class="chat-subtitle">{{ memberCount }} 人</span>
        <span class="invite-tag">邀请码: {{ inviteCode }}</span>
        <button class="btn-leave" @click="leaveGroup">退出</button>
      </div>

      <div class="msg-list" ref="msgListRef">
        <div v-if="loading" class="loading">加载中...</div>
        <div
          v-for="msg in messages"
          :key="msg._key"
          :class="['msg', msg._isAi ? 'ai' : (msg._mine ? 'me' : 'them')]"
        >
          <div class="msg-sender">{{ msg._isAi ? 'DS' : (msg._mine ? '我' : (msg.sender_name || '未知')) }}</div>
          <div class="msg-bubble" :class="{ 'ai-bubble': msg._isAi }">{{ msg.text }}</div>
        </div>
        <div v-if="streamingText" class="msg ai">
          <div class="msg-sender">DS</div>
          <div class="msg-bubble ai-bubble">{{ streamingText }}<span class="cursor"></span></div>
        </div>
      </div>

      <div class="input-area">
        <textarea
          v-model="inputText"
          placeholder="输入消息，@ds 提问..."
          @keydown="onKeydown"
          rows="1"
          :disabled="sending"
        ></textarea>
        <button class="btn-send" @click="sendMessage" :disabled="!inputText.trim() || sending">发送</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { groups, getSavedUser } from '../api/index.js'
import { on as wsOn, send as wsSend } from '../api/ws.js'
import Sidebar from '../components/Sidebar.vue'

const route = useRoute()
const router = useRouter()
const roomId = route.params.id
const groupName = ref('')
const inviteCode = ref('')
const memberCount = ref(0)

const myId = (getSavedUser() || {}).id || ''

const messages = ref([])
const inputText = ref('')
const loading = ref(true)
const sending = ref(false)
const streamingText = ref('')
const msgListRef = ref(null)
const seenIds = new Set()
let _kid = 0

let unsubs = []

function makeKey(prefix) { return prefix + '_' + (++_kid) }

async function loadData() {
  try {
    const g = await groups.detail(roomId)
    groupName.value = g.name
    inviteCode.value = g.invite_code
    memberCount.value = g.members?.length || 0
    const msgs = await groups.messages(roomId)
    messages.value = []
    seenIds.clear()
    for (const m of msgs) {
      const key = 'h_' + m.id
      seenIds.add(key)
      messages.value.push({
        ...m,
        _mine: m.sender_id === myId,
        _isAi: !!m.is_ai,
        _key: key
      })
    }
  } catch (e) {
    groupName.value = roomId
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = msgListRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function upsertMessage(m) {
  const timekey = (m.created_at || '').slice(0, 16)
  const dedup = (m.sender_id || 'ai') + '|' + (m.text || '').slice(0, 40) + '|' + timekey
  if (seenIds.has(dedup)) return
  seenIds.add(dedup)

  const mine = m.sender_id === myId
  const isAi = !!m.is_ai
  const key = makeKey('m')
  messages.value.push({ ...m, _mine: mine, _isAi: isAi, _key: key })
  scrollToBottom()
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || sending.value) return

  const dsMatch = text.match(/@ds\s+(.+)/i)
  const hasDS = !!dsMatch

  inputText.value = ''

  wsSend({ type: 'group_msg', roomId, text, isAi: false })

  if (hasDS) {
    sending.value = true
    streamingText.value = ''

    try {
      const recentMsgs = messages.value.slice(-15).map(m => ({
        role: m._isAi ? 'assistant' : 'user',
        content: `[${m._isAi ? 'DS' : (m.sender_name || '未知')}]: ${m.text}`
      }))
      const aiMessages = [
        { role: 'system', content: '你在一个群聊对话中。根据对话上下文回答问题，结合群聊语境给出有帮助的回复。' },
        ...recentMsgs,
        { role: 'user', content: dsMatch[1] }
      ]

      const { ai: aiApi } = await import('../api/index.js')
      await aiApi.chatStream(
        aiMessages,
        'deepseek-v4-flash',
        (fullText) => { streamingText.value = fullText; scrollToBottom() },
        (fullText) => {
          streamingText.value = ''
          const aiText = '[DS] ' + fullText
          const aiKey = makeKey('ai')
          messages.value.push({
            _key: aiKey, _mine: false, _isAi: true,
            room_id: roomId, sender_id: null, sender_name: 'DS',
            text: aiText, is_ai: 1, created_at: new Date().toISOString()
          })
          wsSend({ type: 'group_msg', roomId, text: aiText, isAi: true })
          scrollToBottom()
          sending.value = false
        },
        (err) => {
          streamingText.value = '[DS 请求失败: ' + err.message + ']'
          sending.value = false
        }
      )
    } catch (e) {
      streamingText.value = '[DS 请求失败]'
      sending.value = false
    }
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

async function leaveGroup() {
  if (!confirm('确定退出这个群聊？')) return
  try {
    await groups.leave(roomId)
    router.push('/groups')
  } catch (e) { alert(e.message) }
}

function setupWS() {
  unsubs.push(wsOn('group_msg', (msg) => {
    const m = msg.message
    if (m.room_id !== roomId) return
    upsertMessage(m)
  }))
}

onMounted(() => {
  loadData()
  setupWS()
})

onUnmounted(() => {
  unsubs.forEach(fn => fn())
})
</script>

<style scoped>
.app-layout { display: flex; height: 100vh; background: var(--bg); }
.main-area { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100vh; }
.chat-header { height: 48px; padding: 0 16px; display: flex; align-items: center; gap: 10px; border-bottom: 2px solid var(--border); flex-shrink: 0; }
.btn-back { border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); padding: 4px 10px; font-size: 12px; cursor: pointer; }
.btn-back:hover { background: var(--bg-hover); }
.chat-title { font-size: 14px; font-weight: 600; color: var(--text); }
.chat-subtitle { font-size: 11px; color: var(--text-muted); }
.invite-tag { font-size: 10px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.5px; border: 1px solid var(--border-light); padding: 2px 6px; margin-left: auto; }
.btn-leave { border: 1px solid var(--red); background: transparent; color: var(--red); padding: 4px 10px; font-size: 11px; cursor: pointer; }
.btn-leave:hover { background: var(--red); color: #fff; }
.msg-list { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.loading { text-align: center; font-size: 12px; color: var(--text-muted); padding: 20px; }
.msg { max-width: 75%; display: flex; flex-direction: column; gap: 2px; }
.msg.me { align-self: flex-end; }
.msg.them { align-self: flex-start; }
.msg.ai { align-self: flex-start; max-width: 85%; }
.msg-sender { font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.3px; }
.msg-bubble { border: 1px solid var(--border-light); padding: 8px 12px; font-size: 13px; line-height: 1.5; color: var(--text); word-break: break-word; background: var(--bg); }
.msg.me .msg-bubble { background: var(--primary-bg); border-color: var(--primary); }
.ai-bubble { border-color: var(--green); border-left: 3px solid var(--green); }
.cursor { display: inline-block; width: 6px; height: 14px; background: var(--primary); animation: blink 0.8s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
.input-area { border-top: 2px solid var(--border); padding: 12px 20px; display: flex; gap: 10px; flex-shrink: 0; }
.input-area textarea { flex: 1; border: 1px solid var(--border-light); padding: 8px 12px; font-size: 13px; font-family: inherit; outline: none; resize: none; min-height: 28px; max-height: 100px; background: var(--bg); color: var(--text); }
.input-area textarea:focus { border-color: var(--primary); }
.input-area textarea:disabled { opacity: 0.5; }
.btn-send { border: 1px solid var(--primary); background: var(--primary); color: #fff; padding: 6px 16px; font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.btn-send:hover:not(:disabled) { background: var(--primary-hover); }
.btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
@media (max-width: 768px) {
  .chat-header { padding: 0 8px 0 44px; height: 44px; gap: 4px; flex-wrap: wrap; }
  .chat-title { font-size: 13px; }
  .invite-tag { font-size: 9px; padding: 1px 4px; }
  .msg-list { padding: 12px; gap: 8px; }
  .msg { max-width: 88% !important; }
  .input-area { padding: 8px 12px; gap: 6px; }
  .input-area textarea { font-size: 16px; padding: 10px 12px; }
  .btn-send { padding: 10px 14px; font-size: 14px; }
}
</style>
