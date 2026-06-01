import { defineStore } from 'pinia'
import { createConversation as dbCreateConv, getMessages, addMessage, getConversations, deleteConversation } from '../db/database.js'

export const useChatStore = defineStore('chat', {
    state: () => ({
        conversations: [],
        currentId: null,
        messages: [],
        apikey: '',
        model:'deepseek-v4-flash',
        isLoading: false,
    }),

    //getters 定义计算属性，有缓存，依赖不变就不会重新计算。
    getters:{
        currentMessages:(state) => {
            return state.messages || []
        },

        hasApikey:(state) => {
            return state.apikey.length > 0
        }
    },

    //actions 定义异步操作，比如发送请求、修改状态等,可以修改state
    actions: {
        async createConversation(id) {
            dbCreateConv(id, this.model)
            this.currentId = id
            this.messages = getMessages(id)
        },

        async loadMessages(id) {
            this.messages = getMessages(id)
            this.currentId = id
        },

        async sendMessage(text) {
            if (!this.currentId) return
            addMessage(this.currentId, 'user', text)
            this.messages.push({ role: 'user', text, id: Date.now()})
        },

        async addReply(text) {
            if (!this.currentId) return
            addMessage(this.currentId, 'ai', text)
            this.messages.push({ role: 'ai', text, id: Date.now()})
        },

        setApiKey(key) {
            this.apikey = key
            localStorage.setItem('apikey', key)
        },

        loadApiKey() {
            const savedKey = localStorage.getItem('apikey')
            this.apikey = savedKey || ''
            const savedModel = localStorage.getItem('model')
            if (savedModel) {
                this.model = savedModel
            }
        },

        loadConversations() {
            this.conversations = getConversations()
        },

        deleteConv(id) {
            deleteConversation(id)
            this.conversations = getConversations()
        },

        setModel(model) {
            this.model = model
            localStorage.setItem('model', model)
        },

        setLoading(val) {
            this.isLoading = val
        }
    }
})