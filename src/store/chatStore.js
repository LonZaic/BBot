import { defineStore } from 'pinia'
import {
    createConversation as dbCreateConv,
    getMessages, addMessage, getConversations,
    deleteConversation, updateConversationTitle,
    updateMessage, deleteMessage, deleteMessagesSince
} from '../db/database.js'

let _abortController = null

export const useChatStore = defineStore('chat', {
    state: () => ({
        conversations: [],
        currentId: null,
        messages: [],
        branchState: {},   // { parentId: activeMessageId }
        apikey: '',
        model: 'deepseek-v4-flash',
        isLoading: false,
        streamingId: null,
    }),

    getters: {
        visibleMessages(state) {
            const result = []
            const bs = state.branchState || {}
            for (const msg of state.messages) {
                if (msg.role === 'user') {
                    result.push(msg)
                } else if (msg.role === 'ai') {
                    const pid = msg.parent_id
                    if (pid != null) {
                        // streaming messages always visible; finalized ones check branch
                        if (msg.streaming || bs[pid] === msg.id) {
                            result.push(msg)
                        }
                    } else {
                        result.push(msg)
                    }
                }
            }
            return result
        },

        hasApikey: (state) => state.apikey.length > 0,

        lastUserMessage: (state) => {
            const msgs = state.messages || []
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'user') return msgs[i]
            }
            return null
        },
    },

    actions: {
        // ─── conversation ───
        createConversation(id) {
            if (!this.apikey) this.loadApiKey()
            dbCreateConv(id, this.model)
            this.currentId = id
            this.messages = getMessages(id)
            this.branchState = {}
            this.conversations = getConversations()
        },

        loadMessages(id) {
            this.messages = getMessages(id).map(m => {
                let files = []
                if (m.files && m.files !== '[]') {
                    try { files = JSON.parse(m.files) } catch {}
                }
                return { ...m, files }
            })
            // init branch state — show the latest AI response for each parent
            const bs = {}
            for (const m of this.messages) {
                if (m.role === 'ai' && m.parent_id != null) {
                    bs[m.parent_id] = m.id
                }
            }
            this.branchState = bs
            this.currentId = id
        },

        loadConversations() {
            this.conversations = getConversations()
        },

        deleteConv(id) {
            deleteConversation(id)
            this.conversations = getConversations()
        },

        updateConvTitle(id, title) {
            updateConversationTitle(id, title)
            const conv = this.conversations.find(c => c.id === id)
            if (conv) conv.title = title
        },

        // ─── messages ───
        addUserMessage(text, files = []) {
            if (!this.currentId) return null
            const filesJson = JSON.stringify(files)
            const newId = addMessage(this.currentId, 'user', text, null, filesJson)
            const msg = { role: 'user', text, id: newId, files }
            this.messages.push(msg)
            return msg
        },

        startStreamReply() {
            const tempId = 'stream_' + Date.now()
            // parent is the last user message
            let parentId = null
            for (let i = this.messages.length - 1; i >= 0; i--) {
                if (this.messages[i].role === 'user') {
                    parentId = this.messages[i].id
                    break
                }
            }
            this.messages.push({
                role: 'ai', text: '', reasoning: '', id: tempId,
                streaming: true, parent_id: parentId,
            })
            this.streamingId = tempId
            return tempId
        },

        appendStreamText(tempId, fullText) {
            const msg = this.messages.find(m => m.id === tempId)
            if (msg) msg.text = fullText
        },

        appendStreamReasoning(tempId, text) {
            const msg = this.messages.find(m => m.id === tempId)
            if (msg) msg.reasoning = text
        },

        finishStreamReply(tempId) {
            const idx = this.messages.findIndex(m => m.id === tempId)
            if (idx === -1) {
                this.streamingId = null
                return null
            }
            const msg = this.messages[idx]
            const realId = addMessage(this.currentId, 'ai', msg.text, msg.parent_id, '[]')
            this.messages[idx] = {
                role: 'ai', text: msg.text, reasoning: msg.reasoning || '',
                id: realId, parent_id: msg.parent_id,
            }
            if (msg.parent_id != null) {
                this.branchState[msg.parent_id] = realId
                this.branchState = { ...this.branchState }
            }
            this.streamingId = null
            return realId
        },

        // ─── branch navigation ───
        siblingInfo(parentId, msgId) {
            if (parentId == null) return { count: 1, index: 1 }
            // only count finalized messages (exclude streaming temp ones)
            const siblings = this.messages
                .filter(m => m.role === 'ai' && m.parent_id === parentId && !m.streaming)
                .sort((a, b) => a.id - b.id)
            if (siblings.length <= 1) return { count: 1, index: 1 }
            const idx = siblings.findIndex(s => s.id === msgId)
            return { count: siblings.length, index: idx >= 0 ? idx + 1 : 1 }
        },

        switchBranch(parentId, direction) {
            if (parentId == null) return
            const siblings = this.messages
                .filter(m => m.role === 'ai' && m.parent_id === parentId)
                .sort((a, b) => a.id - b.id)
            if (siblings.length <= 1) return
            const current = this.branchState[parentId]
            const idx = siblings.findIndex(s => s.id === current)
            const newIdx = direction === 'next'
                ? (idx + 1) % siblings.length
                : (idx - 1 + siblings.length) % siblings.length
            this.branchState[parentId] = siblings[newIdx].id
            this.branchState = { ...this.branchState }
        },

        // ─── message operations ───
        appendToMessage(id, text) {
            const msg = this.messages.find(m => m.id === id)
            if (msg) msg.text += text
        },

        updateMessageText(id, text) {
            const msg = this.messages.find(m => m.id === id)
            if (msg) msg.text = text
        },

        editMessage(id, text) {
            updateMessage(id, text)
            const msg = this.messages.find(m => m.id === id)
            if (msg) msg.text = text
        },

        removeMessage(id) {
            deleteMessage(id)
            this.messages = this.messages.filter(m => m.id !== id)
            // clean up branch state
            const bs = { ...this.branchState }
            let changed = false
            for (const [pid, mid] of Object.entries(bs)) {
                if (mid === id) { delete bs[pid]; changed = true }
            }
            if (changed) this.branchState = bs
        },

        truncateAfter(messageId) {
            if (!this.currentId) return
            deleteMessagesSince(this.currentId, messageId)
            const idx = this.messages.findIndex(m => m.id === messageId)
            if (idx !== -1) {
                this.messages = this.messages.slice(0, idx + 1)
            }
        },

        // ─── loading ───
        setLoading(val) {
            this.isLoading = val
        },

        // ─── API key & model ───
        setApiKey(key) {
            this.apikey = key
            localStorage.setItem('apikey', key)
        },

        loadApiKey() {
            const savedKey = localStorage.getItem('apikey')
            this.apikey = savedKey || ''
            const savedModel = localStorage.getItem('model')
            if (savedModel) this.model = savedModel
        },

        setModel(model) {
            this.model = model
            localStorage.setItem('model', model)
        },

        // ─── abort controller ───
        setAbortController(ctrl) {
            _abortController = ctrl
        },

        abort() {
            if (_abortController) {
                _abortController.abort()
                _abortController = null
            }
        },
    }
})
