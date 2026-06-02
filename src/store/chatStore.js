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
        apikey: '',
        model: 'deepseek-v4-flash',
        isLoading: false,
        streamingId: null,
    }),

    getters: {
        currentMessages: (state) => state.messages || [],
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
            this.conversations = getConversations()
        },

        loadMessages(id) {
            this.messages = getMessages(id)
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
        addUserMessage(text) {
            if (!this.currentId) return null
            const newId = addMessage(this.currentId, 'user', text)
            const msg = { role: 'user', text, id: newId }
            this.messages.push(msg)
            return msg
        },

        startStreamReply() {
            const tempId = 'stream_' + Date.now()
            this.messages.push({ role: 'ai', text: '', id: tempId, streaming: true })
            this.streamingId = tempId
            return tempId
        },

        appendStreamText(tempId, fullText) {
            const msg = this.messages.find(m => m.id === tempId)
            if (msg) msg.text = fullText
        },

        finishStreamReply(tempId) {
            const idx = this.messages.findIndex(m => m.id === tempId)
            if (idx === -1) {
                this.streamingId = null
                return
            }
            const msg = this.messages[idx]
            const realId = addMessage(this.currentId, 'ai', msg.text)
            this.messages[idx] = { role: 'ai', text: msg.text, id: realId }
            this.streamingId = null
            return realId
        },

        // ─── message operations ───
        editMessage(id, text) {
            updateMessage(id, text)
            const msg = this.messages.find(m => m.id === id)
            if (msg) msg.text = text
        },

        removeMessage(id) {
            deleteMessage(id)
            this.messages = this.messages.filter(m => m.id !== id)
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
