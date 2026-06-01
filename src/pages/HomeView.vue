<template>
    <div class="home">
        <h1>AI Chat</h1>
        <div class="card">
            <label>API Key</label>
            <input v-model="apiKeyInput" placeholder="输入 DeepSeek API Key" />
            <button class="btn-save" @click="saveApiKey">保存 Key</button>
        </div>
        <div class="card">
            <button class="btn-new" @click="newConversation">+ 新建对话</button>
        </div>
        <p class="hint" v-if="saved">✅ API Key 已保存到本地</p>

        <div class="conversations" v-if="store.conversations.length > 0">
            <div class="section-title">历史对话</div>
            <div
                class="conv-item"
                v-for="conv in store.conversations"
                :key="conv.id"
                @click="goToChat(conv.id)"
            >
                <span class="conv-title">{{ conv.title || '新对话' }}</span>
                <span class="conv-time">{{ conv.created_at }}</span>
                <button class="btn-delete" @click="deleteChat($event, conv.id)">✕</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'

const router = useRouter()
const store = useChatStore()
const apiKeyInput = ref('')
const saved = ref(false)

store.loadApiKey()
apiKeyInput.value = store.apikey

onMounted(() => {
    store.loadConversations()
})

function saveApiKey() {
    store.setApiKey(apiKeyInput.value)
    saved.value = true
    setTimeout(() => saved.value = false, 2000)
}

function newConversation() {
    if (!store.apikey) {
        alert('请先输入 API Key')
        return
    }
    const id = 'conv_' + Date.now()
    store.createConversation(id)
    router.push('/chat/' + id)
}

function goToChat(id) {
    router.push('/chat/' + id)
}

function deleteChat(e, id) {
    e.stopPropagation()
    store.deleteConv(id)
}
</script>

<style scoped>
.home {
    max-width: 500px;
    margin: 80px auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 0 20px;
}
.home h1 {
    font-size: 28px;
    color: #333;
    font-weight: 700;
}
.card {
    width: 100%;
    border: 2px solid #333;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.card label {
    font-size: 13px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.card input {
    border: 2px solid #333;
    padding: 10px 14px;
    font-size: 14px;
    outline: none;
    font-family: monospace;
}
.card input:focus {
    border-color: #2563eb;
}
.btn-save {
    border: 2px solid #333;
    background: #fff;
    padding: 10px 0;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
}
.btn-save:hover {
    background: #333;
    color: #fff;
}
.btn-new {
    border: 2px solid #2563eb;
    background: #2563eb;
    color: #fff;
    padding: 14px 0;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    width: 100%;
}
.btn-new:hover {
    background: #1d4ed8;
    border-color: #1d4ed8;
}
.hint {
    font-size: 13px;
    color: #16a34a;
}
.conversations {
    width: 100%;
}
.section-title {
    font-size: 13px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
}
.conv-item {
    border: 2px solid #333;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    margin-bottom: 8px;
    transition: background 0.15s;
}
.conv-item:hover {
    background: #f5f5f5;
}
.conv-title {
    font-weight: 600;
    font-size: 14px;
    color: #333;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.conv-time {
    font-size: 12px;
    color: #999;
    flex-shrink: 0;
}
.btn-delete {
    border: 1px solid #ccc;
    background: #fff;
    width: 26px;
    height: 26px;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #999;
}
.btn-delete:hover {
    border-color: #dc2626;
    color: #dc2626;
}
</style>
