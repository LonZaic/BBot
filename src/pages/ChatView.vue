<template>
    <div class="app-layout">
        <Sidebar />
        <div class="chat-area">
            <div class="chat-header">
                <span class="title">{{ currentTitle }}</span>
                <ModelSelector :model="store.model" @update:model="store.setModel($event)" />
            </div>

            <VirtualList ref="virtualListRef" :items="store.messages" :estimated-height="60" key-field="id">
                <template #item="{ item }">
                    <MessageBubble
                        :role="item.role"
                        :text="item.text"
                        :reasoning="item.reasoning || ''"
                        :streaming="item.id === store.streamingId"
                        @regenerate="regenerate"
                        @edit="onEditMessage(item)"
                        @delete="onDeleteMessage(item)"
                    />
                </template>
            </VirtualList>

            <div class="input-area">
                <div class="input-row">
                    <textarea
                        ref="textareaRef"
                        v-model="inputText"
                        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                        @keydown="onKeydown"
                        @input="autoResize"
                        :disabled="store.isLoading"
                        rows="1"
                    ></textarea>
                    <button
                        v-if="store.isLoading"
                        class="btn-stop"
                        @click="stopGeneration"
                        title="停止生成"
                    >停</button>
                    <button
                        v-else
                        class="btn-send"
                        @click="send"
                        :disabled="!inputText.trim()"
                    >发送</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
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
const textareaRef = ref(null)
let abortController = null

const currentTitle = computed(() => {
    const conv = store.conversations.find(c => c.id === store.currentId)
    return conv?.title || '新对话'
})

onMounted(() => {
    store.loadApiKey()
    store.loadConversations()
    store.loadMessages(route.params.id)
})

watch(() => route.params.id, (newId) => {
    if (newId) store.loadMessages(newId)
})

watch(
    () => store.messages.length,
    async () => {
        const atBottom = virtualListRef.value?.isAtBottom() ?? true
        await nextTick()
        if (atBottom && virtualListRef.value) {
            virtualListRef.value.scrollToBottom()
        }
    }
)

watch(
    () => {
        const msgs = store.messages
        if (msgs.length === 0) return ''
        return msgs[msgs.length - 1].text
    },
    async () => {
        if (!store.isLoading) return
        const atBottom = virtualListRef.value?.isAtBottom() ?? true
        if (!atBottom) return
        await nextTick()
        if (virtualListRef.value) {
            virtualListRef.value.scrollToBottom()
        }
    }
)

watch(debounced, (val) => {
    if (val.trim()) {
        console.log('用户停下来了，输入的是:', val)
    }
})

function onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
    }
}

function autoResize() {
    const el = textareaRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

async function send() {
    const text = inputText.value.trim()
    if (!text || store.isLoading) return

    const isFirstExchange = store.messages.filter(m => m.role === 'user').length === 0

    store.addUserMessage(text)
    inputText.value = ''
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto'
    }

    await callStreamAPI()

    if (isFirstExchange) {
        generateTitle(text)
    }
}

async function callStreamAPI() {
    store.setLoading(true)
    const tempId = store.startStreamReply()

    abortController = new AbortController()
    store.setAbortController(abortController)

    try {
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + store.apikey
            },
            body: JSON.stringify({
                model: store.model,
                stream: true,
                messages: [
                    { role: 'system', content: '你是一个AI助手，请用简洁的方式回答。支持 Markdown 格式。' },
                    ...store.messages
                        .filter(m => m.id !== tempId)
                        .map(m => ({
                            role: m.role === 'ai' ? 'assistant' : m.role,
                            content: m.text
                        }))
                ]
            }),
            signal: abortController.signal
        })

        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`
            try {
                const errData = await res.json()
                errMsg = errData.error?.message || errData.error || errMsg
            } catch {}
            store.appendStreamText(tempId, '请求失败: ' + errMsg)
            store.finishStreamReply(tempId)
            return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''
        let fullReasoning = ''
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith('data:')) continue

                const payload = trimmed.slice(5).trim()
                if (payload === '[DONE]') continue

                try {
                    const parsed = JSON.parse(payload)
                    const delta = parsed.choices?.[0]?.delta
                    if (delta?.reasoning_content) {
                        fullReasoning += delta.reasoning_content
                        store.appendStreamReasoning(tempId, fullReasoning)
                    }
                    if (delta?.content) {
                        fullText += delta.content
                        store.appendStreamText(tempId, fullText)
                    }
                } catch {}
            }
        }

        store.finishStreamReply(tempId)

    } catch (e) {
        if (e.name === 'AbortError') {
            store.finishStreamReply(tempId)
        } else {
            store.appendStreamText(tempId, '请求失败: ' + e.message)
            store.finishStreamReply(tempId)
        }
    } finally {
        store.setLoading(false)
        store.setAbortController(null)
        abortController = null
    }
}

function stopGeneration() {
    store.abort()
}

async function regenerate() {
    if (store.isLoading) return

    const msgs = store.messages
    if (msgs.length === 0) return

    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg.role === 'ai' && lastMsg.id !== store.streamingId) {
        store.truncateAfter(msgs[msgs.length - 2]?.id)
    }

    await callStreamAPI()
}

async function onEditMessage(item) {
    const newText = prompt('编辑消息:', item.text)
    if (newText === null || !newText.trim() || newText.trim() === item.text) return

    store.editMessage(item.id, newText.trim())
    store.truncateAfter(item.id)
    await callStreamAPI()
}

function onDeleteMessage(item) {
    if (confirm('确定删除这条消息？')) {
        store.removeMessage(item.id)
    }
}

async function generateTitle(userMsg) {
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
                    { role: 'system', content: '根据用户的第一条消息生成简短标题（15字以内）。只返回标题本身，不要引号、标点或多余文字。' },
                    { role: 'user', content: userMsg }
                ],
                max_tokens: 30,
                temperature: 0.3,
            })
        })
        const data = await res.json()
        const title = data.choices?.[0]?.message?.content?.trim().slice(0, 30) || '新对话'
        store.updateConvTitle(store.currentId, title)
    } catch {}
}

onUnmounted(() => {
    if (abortController) {
        abortController.abort()
    }
})
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    width: 100%;
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
.chat-header {
    height: 48px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 2px solid var(--border);
    flex-shrink: 0;
    transition: border-color 0.2s;
}
.title {
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ─── input area ─── */
.input-area {
    height: 44px;
    border-top: 2px solid var(--border);
    padding: 0 24px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    transition: border-color 0.2s;
}
.input-row {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
}
.input-row textarea {
    flex: 1;
    border: 1px solid var(--border-light);
    padding: 8px 12px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    resize: none;
    height: 36px;
    max-height: 160px;
    line-height: 1.4;
    background: var(--bg);
    color: var(--text);
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.input-row textarea:focus {
    border-color: var(--primary);
}
.input-row textarea:disabled {
    opacity: 0.5;
}
.btn-send,
.btn-stop {
    border: 1px solid var(--primary);
    background: var(--primary);
    color: #fff;
    padding: 8px 20px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    height: 36px;
    flex-shrink: 0;
    transition: background 0.15s;
}
.btn-send:hover:not(:disabled) {
    background: var(--primary-hover);
}
.btn-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.btn-stop {
    border-color: var(--red);
    background: var(--red);
}
.btn-stop:hover {
    background: #b91c1c;
}
</style>
