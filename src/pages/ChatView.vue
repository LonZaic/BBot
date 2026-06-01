<template>
    <div class="app-layout">
        <Sidebar />
        <div class="chat-area">
            <div class="header">
                <span class="title">对话</span>
                <ModelSelector :model="store.model" @update:model="store.setModel($event)" />
            </div>

            <VirtualList ref="virtualListRef" :items="store.messages" :estimated-height="70" key-field="id">
                <template #item="{ item }">
                    <MessageBubble :role="item.role" :text="item.text" />
                </template>
            </VirtualList>

            <div class="input-area">
                <input
                    v-model="inputText"
                    placeholder="输入消息"
                    @keydown.enter="send"
                />
                <button @click="send">{{ store.isLoading ? '...' : '发送' }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'
import { useDebounce } from '../composables/useDebounce.js'
import Sidebar from '../components/Sidebar.vue'
import VirtualList from '../components/VirtualList.vue'
import MessageBubble from '../components/MessageBubble.vue'
import ModelSelector from '../components/ModelSelector.vue'

const route = useRoute()
const router = useRouter()
const store = useChatStore()
const inputText = ref('')
const { debounced } = useDebounce(inputText, 400)
const virtualListRef = ref(null)

onMounted(async () => {
    store.loadApiKey()
    store.loadConversations()
    await store.loadMessages(route.params.id)
})

watch(() => route.params.id, async (newId) => {
    if (newId) {
        await store.loadMessages(newId)
    }
})

watch(() => store.messages.length, async () => {
    const atBottom = virtualListRef.value?.isAtBottom() ?? true
    await nextTick()
    if (atBottom && virtualListRef.value) {
        virtualListRef.value.scrollToBottom()
    }
})

watch(debounced, (val) => {
    if (val.trim()) {
        console.log('用户停下来了，输入的是:', val)
    }
})

async function send() {
    const text = inputText.value.trim()
    if (!text || store.isLoading) return

    await store.sendMessage(text)
    inputText.value = ''

    store.setLoading(true)
    try {
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + store.apikey
            },
            body: JSON.stringify({
                model: store.model,
                messages: [
                    { role: 'system', content: '你是一个AI助手，请用简洁的方式回答' },
                    ...store.messages.map(m => ({
                        role: m.role === 'ai' ? 'assistant' : m.role,
                        content: m.text
                    }))
                ]
            })
        })
        const data = await res.json()
        if (!res.ok) {
            const errMsg = data.error?.message || data.error || 'API 返回错误'
            await store.addReply('请求失败: ' + errMsg)
            return
        }
        const reply = data.choices[0].message.content
        await store.addReply(reply)
    } catch (e) {
        await store.addReply('请求失败: ' + e.message)
    } finally {
        store.setLoading(false)
    }
}
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    width: 100vw;
    background: var(--bg);
    transition: background 0.2s;
}
.chat-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
}
.header {
    border-bottom: 2px solid var(--border);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: border-color 0.2s;
}
.title {
    font-weight: 700;
    font-size: 16px;
    color: var(--text);
}
.header {
    border-top: 2px solid var(--border);
    padding: 14px 24px;
    display: flex;
    gap: 10px;
    transition: border-color 0.2s;
}
.input-area input {
    flex: 1;
    border: 2px solid var(--border);
    padding: 10px 14px;
    font-size: 14px;
    outline: none;
    background: var(--bg);
    color: var(--text);
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.input-area input:focus {
    border-color: var(--primary);
}
.input-area button {
    border: 2px solid var(--border);
    background: transparent;
    padding: 10px 24px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text);
    transition: background 0.15s, color 0.15s;
}
.input-area button:hover {
    background: var(--text);
    color: var(--bg);
}
</style>
