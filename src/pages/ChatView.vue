<template>
    <div class="app-layout">
        <Sidebar />
        <div class="chat-area">
            <div class="chat-header">
                <span class="title">{{ currentTitle }}</span>
                <ModelSelector :model="store.model" @update:model="store.setModel($event)" />
            </div>

            <VirtualList ref="virtualListRef" :items="store.visibleMessages" :estimated-height="60" key-field="id">
                <template #item="{ item }">
                    <MessageBubble
                        :role="item.role"
                        :text="item.text"
                        :reasoning="item.reasoning || ''"
                        :files="item.files || []"
                        :streaming="item.id === store.streamingId"
                        :sibling-count="item.role === 'ai' ? store.siblingInfo(item.parent_id, item.id).count : 1"
                        :sibling-index="item.role === 'ai' ? store.siblingInfo(item.parent_id, item.id).index : 1"
                        @regenerate="regenerate"
                        @edit="onEditMessage(item)"
                        @delete="onDeleteMessage(item)"
                        @prev-branch="store.switchBranch(item.parent_id, 'prev')"
                        @next-branch="store.switchBranch(item.parent_id, 'next')"
                    />
                </template>
            </VirtualList>

            <div class="input-area">
                <!-- file previews -->
                <div v-if="pendingFiles.length" class="file-bar">
                    <div
                        v-for="(f, i) in pendingFiles"
                        :key="i"
                        :class="['file-chip', fileChipClass(f)]"
                        :title="f.name"
                    >
                        <span class="file-chip-name" @click="previewFile(f)">{{ fileLabel(f, i) }}</span>
                        <button class="file-chip-del" @click="removeFile(i)">x</button>
                    </div>
                </div>
                <div class="input-row">
                    <button class="btn-upload" @click="pickFile" title="上传文件">+</button>
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
                        :disabled="!inputText.trim() && !pendingFiles.length"
                    >发送</button>
                </div>
                <input
                    ref="fileInput"
                    type="file"
                    multiple
                    @change="onFilesPicked"
                    accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.js,.py,.html,.css,.json,.xml,.md,.zip,.rar"
                    hidden
                />
            </div>

        <!-- image preview overlay -->
        <div v-if="previewSrc" class="preview-overlay" @click.self="previewSrc = null">
            <button class="preview-close" @click="previewSrc = null">x</button>
            <img :src="previewSrc" class="preview-img" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'
import { useDebounce } from '../composables/useDebounce.js'
import { saveFile, loadFile } from '../utils/fileDB.js'
import { extractFileContent } from '../utils/extractFile.js'
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
const fileInput = ref(null)
const pendingFiles = ref([])   // { name, type, size, key, data }
const previewSrc = ref(null)
let abortController = null

const currentTitle = computed(() => {
    const conv = store.conversations.find(c => c.id === store.currentId)
    return conv?.title || '新对话'
})

onMounted(() => {
    store.loadApiKey()
    store.loadConversations()
    if (route.params.id) store.loadMessages(route.params.id)
})

watch(() => route.params.id, (newId) => {
    if (newId && newId !== store.currentId) store.loadMessages(newId)
})

watch(
    () => store.visibleMessages.length,
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
        const msgs = store.visibleMessages
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

// ─── file helpers ───
function pickFile() {
    fileInput.value?.click()
}

async function onFilesPicked(e) {
    const raw = e.target.files
    if (!raw?.length) return
    for (const f of raw) {
        const key = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        const cat = detectCat(f)
        // try to extract text content for AI
        let content = ''
        if (cat === 'image') {
            content = await readAsDataURL(f)  // for future multimodal use
        } else if (isTextLike(f.name)) {
            content = await readAsText(f)
        } else {
            // try docx/pptx/xlsx extraction
            content = await extractFileContent(f) || ''
        }
        // store blob in IndexedDB
        const blob = new Blob([await readAsBuffer(f)], { type: f.type || 'application/octet-stream' })
        const dataUrl = cat === 'image' ? content : URL.createObjectURL(blob)
        await saveFile(key, blob)
        pendingFiles.value.push({
            name: f.name, type: f.type || guessType(f.name),
            size: f.size, key, data: dataUrl, content,
        })
    }
    fileInput.value.value = ''
}

function detectCat(f) {
    if (f.type?.startsWith('image/')) return 'image'
    return guessType(f.name)
}

function isTextLike(name) {
    const ext = name.split('.').pop()?.toLowerCase()
    return ['txt','js','ts','py','html','css','json','xml','md','yml','yaml','sh','bat','c','cpp','h','java','go','rs','rb','php','sql','csv','log','ini','cfg','toml'].includes(ext)
}

function readAsText(file) {
    return new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => resolve('')
        r.readAsText(file)
    })
}

function readAsDataURL(file) {
    return new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
    })
}

function readAsBuffer(file) {
    return new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => resolve(new ArrayBuffer(0))
        r.readAsArrayBuffer(file)
    })
}

function guessType(name) {
    const ext = name.split('.').pop().toLowerCase()
    const m = {
        jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
        webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',
        doc:'word',docx:'word', ppt:'ppt',pptx:'ppt', xls:'excel',xlsx:'excel',
        pdf:'pdf',
        js:'code',ts:'code',py:'code',html:'code',css:'code',json:'code',
        xml:'code',md:'code',sh:'code',bat:'code',yml:'code',yaml:'code',
    }
    return m[ext] || 'other'
}

function fileCategory(f) {
    if (f.type?.startsWith('image/')) return 'image'
    return guessType(f.name)
}

function fileChipClass(f) {
    return 'fc-' + fileCategory(f)
}

function fileLabel(f, i) {
    const labels = { image:'图片', word:'Word', ppt:'PPT', excel:'Excel', pdf:'PDF', code:'代码', other:'文件' }
    return labels[fileCategory(f)] + ' ' + (i + 1)
}

function removeFile(i) {
    const f = pendingFiles.value[i]
    if (f?.data) URL.revokeObjectURL(f.data)
    pendingFiles.value.splice(i, 1)
}

function previewFile(f) {
    if (f.type?.startsWith('image/')) {
        previewSrc.value = f.data
    } else {
        const w = window.open('', '_blank')
        if (w) {
            w.document.write(`<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;font-family:monospace;font-size:14px"><p>${f.name}<br>${formatSize(f.size)}</p></body></html>`)
        }
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
}

async function send() {
    const text = inputText.value.trim()
    const hasFiles = pendingFiles.value.length > 0
    if (!text && !hasFiles) return
    if (store.isLoading) return

    const isFirstExchange = store.visibleMessages.filter(m => m.role === 'user').length === 0

    // save file metadata + extracted text content for AI
    const files = pendingFiles.value.map(f => ({
        name: f.name, type: f.type, size: f.size, key: f.key, content: f.content || '',
    }))

    store.addUserMessage(text, files)
    inputText.value = ''
    pendingFiles.value = []
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto'
    }

    await callStreamAPI(files)

    if (isFirstExchange) {
        generateTitle(text || (files[0]?.name || '文件'))
    }
}

async function callStreamAPI(files = []) {
    store.setLoading(true)
    const tempId = store.startStreamReply()

    abortController = new AbortController()
    store.setAbortController(abortController)

    try {
        // build messages — include file content for the last user message
        const prevMsgs = store.visibleMessages.filter(m => m.id !== tempId)
        const apiMsgs = [{ role: 'system', content: '你是一个AI助手。用户上传文件时，文件名和内容会附在消息中。请基于文件内容回答。支持 Markdown 格式。' }]
        for (const m of prevMsgs) {
            if (m.role === 'user') {
                // check if this message has files
                let content = m.text || ''
                const mfiles = m.files || []
                if (mfiles.length > 0) {
                    const parts = []
                    if (content) parts.push(content)
                    for (const f of mfiles) {
                        if (f.type?.startsWith('image/') && f.content) {
                            // multimodal: image as separate content block
                            // DeepSeek supports image_url format
                        } else if (f.content && f.type?.startsWith('image/')) {
                            parts.push(`\n[图片文件: ${f.name} (不含文字识别)]`)
                        } else if (f.content) {
                            parts.push(`\n[文件: ${f.name}]\n${f.content}`)
                        } else {
                            parts.push(`\n[文件: ${f.name} (无法读取内容)]`)
                        }
                    }
                    content = parts.join('\n')
                }
                apiMsgs.push({ role: 'user', content })
            } else {
                apiMsgs.push({ role: 'assistant', content: m.text })
            }
        }

        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + store.apikey
            },
            body: JSON.stringify({
                model: store.model,
                stream: true,
                messages: apiMsgs
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
    await callStreamAPI([])
}

async function onEditMessage(item) {
    const newText = prompt('编辑消息:', item.text)
    if (newText === null || !newText.trim() || newText.trim() === item.text) return

    store.editMessage(item.id, newText.trim())
    store.truncateAfter(item.id)
    await callStreamAPI([])
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
    min-height: 44px;
    border-top: 2px solid var(--border);
    padding: 7px 24px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    flex-shrink: 0;
    transition: border-color 0.2s;
}
.input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    width: 100%;
}
.input-row textarea {
    flex: 1;
    border: 1px solid var(--border-light);
    padding: 7px 12px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    resize: none;
    min-height: 28px;
    max-height: 160px;
    overflow-y: auto;
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
    padding: 7px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
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
.btn-upload {
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-muted);
    font-size: 16px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
}
.btn-upload:hover { background: var(--bg-hover); color: var(--text); }

/* file chips above input */
.file-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-bottom: 6px;
}
.file-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font-size: 11px;
    border: 1px solid;
    height: 22px;
}
.file-chip-name {
    cursor: pointer;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.file-chip-del {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.6;
}
.file-chip-del:hover { opacity: 1; }

.fc-image  { background: #f0f0f0; border-color: #bbb; color: #555; }
html.dark .fc-image { background: #222; border-color: #555; color: #999; }
.fc-word   { background: #eff6ff; border-color: var(--primary); color: var(--primary); }
html.dark .fc-word { background: #1a2540; }
.fc-ppt    { background: #fef2f2; border-color: var(--red); color: var(--red); }
html.dark .fc-ppt { background: #2a1515; }
.fc-excel  { background: #f0fdf4; border-color: var(--green); color: var(--green); }
html.dark .fc-excel { background: #152a18; }
.fc-pdf    { background: #fff7ed; border-color: #ea580c; color: #ea580c; }
html.dark .fc-pdf { background: #2a1a10; }
.fc-code   { background: #f5f3ff; border-color: #7c3aed; color: #7c3aed; }
html.dark .fc-code { background: #1a1530; }
.fc-other  { background: #f8f8f8; border-color: #999; color: #666; }
html.dark .fc-other { background: #1a1a1a; border-color: #666; color: #888; }

/* image preview overlay */
.preview-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.85); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
}
.preview-close {
    position: absolute; top: 16px; right: 16px;
    border: 1px solid #666; background: #222; color: #fff;
    width: 32px; height: 32px; font-size: 14px; cursor: pointer; z-index: 1;
}
.preview-img { max-width: 90vw; max-height: 90vh; object-fit: contain; }
</style>
