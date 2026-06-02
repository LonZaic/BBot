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
        <p class="hint" v-if="saved">API Key 已保存到本地</p>

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
                <button class="btn-delete" @click="deleteChat($event, conv.id)">x</button>
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
    color: var(--text);
    font-weight: 700;
}
.card {
    width: 100%;
    border: 2px solid var(--border);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.card label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.card input {
    border: 2px solid var(--border);
    padding: 10px 14px;
    font-size: 14px;
    outline: none;
    font-family: monospace;
    background: var(--bg);
    color: var(--text);
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.card input:focus {
    border-color: var(--primary);
}
.btn-save {
    border: 2px solid var(--border);
    background: transparent;
    padding: 10px 0;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    color: var(--text);
    transition: background 0.15s, color 0.15s;
}
.btn-save:hover {
    background: var(--text);
    color: var(--bg);
}
.btn-new {
    border: 2px solid var(--primary);
    background: var(--primary);
    color: #fff;
    padding: 14px 0;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    width: 100%;
    transition: background 0.15s, border-color 0.15s;
}
.btn-new:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
}
.hint {
    font-size: 13px;
    color: var(--success);
}
.conversations {
    width: 100%;
}
.section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
}
.conv-item {
    border: 2px solid var(--border);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    margin-bottom: 8px;
    transition: background 0.15s;
}
.conv-item:hover {
    background: var(--bg-hover);
}
.conv-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.conv-time {
    font-size: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
}
.btn-delete {
    border: 1px solid var(--border-light);
    background: transparent;
    width: 26px;
    height: 26px;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
}
.btn-delete:hover {
    border-color: var(--red);
    color: var(--red);
}
</style>
