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
                        :designs="item.designs || []"
                        :design-progress="item.designProgress || 0"
                        :raw-text="item._rawText || ''"
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
                <!-- device selector bar -->
                <div v-if="showDeviceBar" class="device-bar">
                    <span class="device-label">选择设备:</span>
                    <button
                        v-for="d in DEVICES"
                        :key="d.id"
                        :class="['device-btn', { active: selectedDevice?.id === d.id }]"
                        @click="pickDevice(d)"
                    >{{ d.name }}</button>
                </div>
                <!-- file previews -->
                <div v-if="pendingFiles.length" class="file-bar">
                    <div
                        v-for="(f, i) in pendingFiles"
                        :key="i"
                        class="file-chip"
                        :style="fileChipStyle(f.name, f.type)"
                        :title="f.name"
                    >
                        <span class="file-chip-name" @click="previewFile(f)">{{ fileLabel(f.name, f.type) }}</span>
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
                        @paste="onPaste"
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
                    @change="onFiles($event)"
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
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'
import { useDebounce } from '../composables/useDebounce.js'
import { saveFile, loadFile } from '../utils/fileDB.js'
import { extractFileContent } from '../utils/extractFile.js'
import { fileChipStyle, fileLabel } from '../utils/fileStyles.js'
import { getEmailTools } from '../utils/functionCalling.js'
import { DEVICES, isDesignRequest, hasDeviceSpecified, buildDesignPrompt, parseDesignBlocks, cleanDesignMarkers, cleanDesignMarkersStreaming, hasOpenDesignBlock, guessDeviceType } from '../utils/designPreview.js'
import { initEmailScheduler } from '../utils/email.js'
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
const showDeviceBar = ref(false)
const selectedDevice = ref(null)
const pendingDesignText = ref('')  // store original text while picking device

const currentTitle = computed(() => {
    const conv = store.conversations.find(c => c.id === store.currentId)
    return conv?.title || '新对话'
})


onMounted(() => {
    store.loadApiKey()
    store.loadConversations()
    if (route.params.id) store.loadMessages(route.params.id)
    initEmailScheduler()
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

function onPaste(e) {
    const items = e.clipboardData?.items
    if (!items) return
    const files = []
    for (const item of items) {
        if (item.kind === 'file') {
            files.push(item.getAsFile())
        }
    }
    if (files.length) {
        e.preventDefault()
        onFiles({ target: { files, value: '' } })
    }
}

// ─── file helpers ───
function pickFile() {
    fileInput.value?.click()
}

async function onFiles(e) {
    const raw = e.target.files
    if (!raw?.length) return
    for (const f of raw) {
        const key = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        const cat = detectCat(f)
        let content = ''
        if (cat === 'image') {
            content = await readAsDataURL(f)  // preview only, no OCR
        } else if (isTextLike(f.name)) {
            content = await readAsText(f)
        } else {
            content = await extractFileContent(f) || ''
        }
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
    const ext = name.split('.').pop()?.toLowerCase()
    return ext || 'other'
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

function pickDevice(d) {
    if (d.id === 'custom') {
        const val = prompt('输入设备尺寸，格式: 宽x高，例如 1024x768')
        if (!val) return
        const parts = val.split(/[x×X,，\s]+/)
        const w = parseInt(parts[0]) || 800
        const h = parseInt(parts[1]) || 600
        selectedDevice.value = { name: `自定义 (${w}x${h})`, w, h }
    } else {
        selectedDevice.value = d
    }
    showDeviceBar.value = false
    // send with device context
    if (pendingDesignText.value) {
        const text = pendingDesignText.value
        pendingDesignText.value = ''
        inputText.value = ''
        _doSend(text)
    }
}

async function send() {
    const text = inputText.value.trim()
    const hasFiles = pendingFiles.value.length > 0
    if (!text && !hasFiles) return
    if (store.isLoading) return

    // check: design request without device specified
    if (isDesignRequest(text) && !hasDeviceSpecified(text) && !selectedDevice.value) {
        pendingDesignText.value = text
        showDeviceBar.value = true
        return
    }
    _doSend(text)
}

async function _doSend(text) {
    const isFirstExchange = store.visibleMessages.filter(m => m.role === 'user').length === 0

    // save file metadata + extracted text content for AI
    const files = pendingFiles.value.map(f => ({
        name: f.name, type: f.type, size: f.size, key: f.key, content: f.content || '',
    }))

    // for design: inject device info into the message
    const isDesign = selectedDevice.value && isDesignRequest(text)
    const deviceInfo = selectedDevice.value  // snapshot before reset
    const finalText = isDesign ? buildDesignPrompt(text, deviceInfo) : text

    // Show clean user message with device badge
    const displayText = isDesign
        ? `🎨 ${text}\n📱 ${deviceInfo.name} (${deviceInfo.w}x${deviceInfo.h})`
        : text
    store.addUserMessage(displayText, files)
    // Override the message text for API calls — buildMessages uses m.text, but we need the prompt
    // Exchange the display text for the prompt text in the stored message for API calls
    const userMsgs = store.messages.filter(m => m.role === 'user')
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    if (lastUserMsg && isDesign) {
        lastUserMsg._apiText = finalText  // used by buildMessages
        lastUserMsg._displayText = displayText
        lastUserMsg._device = deviceInfo
    }

    inputText.value = ''
    pendingFiles.value = []
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto'
    }

    // design requests: skip email tools
    await callStreamAPI(files, isDesign, isDesign)

    // Finalize: parse any remaining design blocks from the finished AI response
    const aiMsgs = store.messages.filter(m => m.role === 'ai')
    const aiMsg = aiMsgs[aiMsgs.length - 1]
    if (aiMsg && isDesign) {
        // Only parse if designs weren't set during streaming
        if (!aiMsg.designs || !aiMsg.designs.length) {
            const designs = parseDesignBlocks(aiMsg.text)
            if (designs.length) {
                aiMsg.designs = designs
            }
        }
        // In design mode: clear the phase-label text, keep only designs
        aiMsg.text = ''
        // Reset progress
        aiMsg.designProgress = 0
    }

    if (isFirstExchange) {
        generateTitle(text || (files[0]?.name || '文件'))
    }

    // reset device selection
    selectedDevice.value = null
}

function buildMessages(tempId) {
    const prevMsgs = store.visibleMessages.filter(m => m.id !== tempId)
    const msgs = [{ role: 'system', content: '你是一个AI助手。用户上传文件时，文件名和内容会附在消息中。请基于文件内容回答。支持 Markdown 格式。' }]
    for (const m of prevMsgs) {
        if (m.role === 'user') {
            let content = m._apiText || m.text || ''
            for (const f of (m.files || [])) {
                if (f.type?.startsWith('image/')) {
                    content += `\n[图片: ${f.name}]`
                } else if (f.content) {
                    content += `\n[文件: ${f.name}]\n${f.content}`
                } else {
                    content += `\n[文件: ${f.name}]`
                }
            }
            msgs.push({ role: 'user', content })
        } else {
            msgs.push({ role: 'assistant', content: m.text })
        }
    }
    return msgs
}

async function doStream(msgs, tempId, tools, isDesign = false) {
    const body = { model: store.model, stream: true, messages: msgs }
    if (tools && tools.length) {
        body.tools = tools
        body.tool_choice = 'auto'
    }

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + store.apikey },
        body: JSON.stringify(body),
        signal: abortController.signal,
    })

    if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try { const d = await res.json(); errMsg = d.error?.message || d.error || errMsg } catch {}
        throw new Error(errMsg)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = '', fullReasoning = '', buffer = ''
    const toolCallMap = {}
    // design mode: track whether content has started
    let contentStarted = false

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
                    if (!contentStarted) contentStarted = true

                    if (isDesign) {
                        // ─── Design mode: suppress raw output, only show phase ───
                        const designs = parseDesignBlocks(fullText)

                        if (designs.length > 0) {
                            // Design complete → show "绘制完成" + design frame
                            store.updateStreamCleanText(tempId, '绘制完成')
                            store.updateStreamDesign(tempId, designs)
                            store.updateStreamRawText(tempId, fullText)
                            store.appendStreamDesignProgress(tempId, 100)
                        } else {
                            // Still generating → show "绘制中..."
                            store.updateStreamCleanText(tempId, '绘制中...')
                            store.updateStreamRawText(tempId, fullText)
                            store.appendStreamDesignProgress(tempId, 50)
                        }
                    } else {
                        // ─── Normal mode: show text, detect designs in real-time ───
                        const hasDesign = fullText.includes('[DESIGN')
                        const designs = parseDesignBlocks(fullText)

                        if (designs.length > 0) {
                            const clean = cleanDesignMarkers(fullText)
                            store.updateStreamCleanText(tempId, clean || ' ')
                            store.updateStreamDesign(tempId, designs)
                            store.appendStreamDesignProgress(tempId, 100)
                        } else if (hasDesign && hasOpenDesignBlock(fullText)) {
                            const clean = cleanDesignMarkersStreaming(fullText)
                            store.updateStreamCleanText(tempId, clean || ' ')
                            store.appendStreamDesignProgress(tempId, 50)
                        } else {
                            store.appendStreamText(tempId, fullText)
                        }
                    }
                }
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index
                        if (!toolCallMap[idx]) toolCallMap[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } }
                        if (tc.id) toolCallMap[idx].id = tc.id
                        if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name
                        if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments
                    }
                }
            } catch {}
        }
    }
    const toolCalls = Object.values(toolCallMap).filter(tc => tc.id && tc.function.name)
    return { text: fullText, reasoning: fullReasoning, toolCalls }
}

async function callStreamAPI(files = [], skipEmail = false, isDesign = false) {
    store.setLoading(true)
    const tempId = store.startStreamReply()
    abortController = new AbortController()
    store.setAbortController(abortController)

    // design mode: show initial "思考中..." if reasoning arrives first
    if (isDesign) {
        store.updateStreamCleanText(tempId, '思考中...')
        store.appendStreamDesignProgress(tempId, 10)
    }

    try {
        const msgs = buildMessages(tempId)
        const { tools, executors } = skipEmail ? { tools: [], executors: {} } : getEmailTools()

        // First call with tools
        const first = await doStream(msgs, tempId, tools, isDesign)
        let finalText = first.text

        // Handle tool calls
        if (first.toolCalls.length > 0 && tools.length > 0) {
            const tc = first.toolCalls[0]
            let args = {}
            try { args = JSON.parse(tc.function.arguments) } catch {}

            const executor = executors[tc.function.name]
            if (executor) {
                const result = await executor(args)
                // Build follow-up messages
                msgs.push({ role: 'assistant', content: first.text || null, tool_calls: [tc] })
                msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: result })

                // Second call to get final response
                store.appendStreamText(tempId, '')
                store.appendStreamReasoning(tempId, first.reasoning)
                const second = await doStream(msgs, tempId, [], isDesign)
                finalText = second.text
            }
        }

        store.finishStreamReply(tempId)
    } catch (e) {
        if (e.name === 'AbortError') {
            store.finishStreamReply(tempId)
        } else {
            store.updateStreamCleanText(tempId, '请求失败: ' + e.message)
            store.finishStreamReply(tempId)
        }
    } finally {
        store.setLoading(false)
        store.setAbortController(null)
        abortController = null
    }
}

async function processActions(msgId) {
    const msg = store.messages.find(m => m.id === msgId)
    if (!msg || msg.role !== 'ai') return
    const actions = parseActions(msg.text)
    if (!actions.length) return

    for (const action of actions) {
        const result = await executeAction(action)
        const status = result.success ? '成功' : '失败'
        const marker = `\n\n---\n[${action.type}: ${status}] ${result.msg}`
        store.appendToMessage(msgId, marker)
    }
    // clean display text (remove action markers)
    const cleaned = cleanDisplayText(msg.text)
    store.updateMessageText(msgId, cleaned)
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

// NOTE: 不在此处 abort，允许用户在页面间切换时后台继续生成
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

/* device selector */
.device-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 6px;
}
.device-label {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
    margin-right: 2px;
}
.device-btn {
    border: 1px solid var(--border-light);
    background: var(--bg);
    color: var(--text-secondary);
    font-size: 11px;
    padding: 3px 10px;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.device-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
}
.device-btn.active {
    background: var(--primary-bg);
    border-color: var(--primary);
    color: var(--primary);
    font-weight: 600;
}

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
