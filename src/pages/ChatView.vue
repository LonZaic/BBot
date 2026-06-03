<template>
    <div class="app-layout">
        <Sidebar />
        <div class="chat-area">
            <div class="chat-header">
                <!-- ─── Tab bar ─── -->
                <div class="tab-bar">
                    <div
                        v-for="(tab, i) in store.openTabList"
                        :key="tab.id"
                        :class="['tab', { active: tab.id === store.currentId }]"
                        :style="{ borderColor: tabColor(i) }"
                        @click="switchToTab(tab.id)"
                    >
                        <span class="tab-title">{{ tab.title || '新对话' }}</span>
                        <button class="tab-close" @click.stop="closeTab(tab.id)">&times;</button>
                    </div>
                    <button class="tab-add" @click="newTab" title="新建对话">+</button>
                </div>
                <ModelSelector :model="store.model" @update:model="store.setModel($event)" />
                <button :class="['btn-agent-mode', { on: agentMode }]" @click="agentMode = !agentMode" title="Agent 模式">A</button>
            </div>

            <AgentPanel ref="agentPanelRef" :visible="agentPanelVisible" :events="agentEvents" @close="agentPanelVisible = false" />

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
                        :agent-events="item._agentEvents || []"
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
                <div v-if="showDeviceBar" class="device-bar">
                    <span class="device-label">选择设备:</span>
                    <button
                        v-for="d in DEVICES"
                        :key="d.id"
                        :class="['device-btn', { active: selectedDevice?.id === d.id }]"
                        @click="pickDevice(d)"
                    >{{ d.name }}</button>
                </div>
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
import { DEVICES, isDesignRequest, hasDeviceSpecified, buildDesignPrompt, parseDesignBlocks, cleanDesignMarkers, cleanDesignMarkersStreaming, hasOpenDesignBlock, guessDeviceType, extractFirstHtmlBlock, extractRawHtml } from '../utils/designPreview.js'
import { initEmailScheduler } from '../utils/email.js'
import Sidebar from '../components/Sidebar.vue'
import VirtualList from '../components/VirtualList.vue'
import MessageBubble from '../components/MessageBubble.vue'
import ModelSelector from '../components/ModelSelector.vue'
import AgentPanel from '../components/AgentPanel.vue'

const route = useRoute()
const router = useRouter()
const store = useChatStore()
const inputText = ref('')
const { debounced } = useDebounce(inputText, 400)
const virtualListRef = ref(null)
const textareaRef = ref(null)
const fileInput = ref(null)
const pendingFiles = ref([])
const previewSrc = ref(null)
let abortController = null
const showDeviceBar = ref(false)
const selectedDevice = ref(null)
const pendingDesignText = ref('')
const agentMode = ref(false)
const agentPanelVisible = ref(false)
const agentEvents = ref([])
const agentPanelRef = ref(null)

// ─── tab colors: rainbow cycle ───
const TAB_COLORS = ['#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c']
function tabColor(index) {
    return TAB_COLORS[index % TAB_COLORS.length]
}

function newTab() {
    if (!store.apikey) {
        alert('请先输入 API Key')
        return
    }
    const id = 'conv_' + Date.now()
    store.createConversation(id)
    router.push('/chat/' + id)
}

function switchToTab(id) {
    if (id !== store.currentId) {
        store.switchTab(id)
        router.push('/chat/' + id)
    }
}

function closeTab(id) {
    const idx = store.openTabs.indexOf(id)
    store.closeTab(id)
    // navigate to adjacent tab or home
    if (store.currentId === id) {
        const tabs = store.openTabs
        if (tabs.length > 0) {
            const next = tabs[Math.min(idx, tabs.length - 1)]
            switchToTab(next)
        } else {
            router.push('/')
        }
    }
}

onMounted(() => {
    store.loadApiKey()
    store.loadConversations()
    if (route.params.id) {
        store.switchTab(route.params.id)
    }
    initEmailScheduler()
})

watch(() => route.params.id, (newId) => {
    if (newId && newId !== store.currentId) {
        store.switchTab(newId)
    }
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
function pickFile() { fileInput.value?.click() }

async function onFiles(e) {
    const raw = e.target.files
    if (!raw?.length) return
    for (const f of raw) {
        const key = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        const cat = detectCat(f)
        let content = ''
        if (cat === 'image') {
            content = await readAsDataURL(f)
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

    if (agentMode.value) {
        await sendToAgent(text)
        return
    }

    if (isDesignRequest(text) && !hasDeviceSpecified(text) && !selectedDevice.value) {
        pendingDesignText.value = text
        showDeviceBar.value = true
        return
    }
    _doSend(text)
}

async function sendToAgent(task) {
    if (!store.apikey) { alert('请先输入 API Key'); return }
    store.addUserMessage('[Agent] ' + task, [])
    inputText.value = ''
    store.setLoading(true)

    const tempId = store.startStreamReply()

    agentEvents.value = []
    agentPanelVisible.value = true
    if (agentPanelRef.value) agentPanelRef.value.start()

    let logText = ''
    function push(t) { logText += t; store.updateStreamCleanText(tempId, logText) }
    const collected = []
    try {
        const res = await fetch('/api/agent/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('bbot_token'),
                'x-api-key': store.apikey,
            },
            body: JSON.stringify({ task, model: 'deepseek-v4-pro' })
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data:')) continue
                let evt
                try { evt = JSON.parse(trimmed.slice(5).trim()) } catch { continue }
                collected.push(evt)
                agentEvents.value = [...collected]
                store.updateStreamAgentEvents(tempId, collected)
                // Stream thinking text from AI — it speaks for itself
                if (evt.type === 'thinking' && evt.text) {
                    if (!logText) push(evt.text)
                    else push('\n\n' + evt.text)
                } else if (evt.type === 'error') {
                    push('\n\n出错了: ' + evt.text)
                }
            }
        }
    } catch (e) {
        push('error: ' + e.message + '\n')
        collected.push({ type: 'error', text: e.message })
        agentEvents.value = [...collected]
        store.updateStreamAgentEvents(tempId, collected)
    }

    store.setLoading(false)
    const finalEvt = collected.find(e => e.type === 'done' || e.type === 'final')
    if (finalEvt && finalEvt.text && finalEvt.text.length > 5) {
        store.updateStreamCleanText(tempId, finalEvt.text)
    } else if (logText) {
        store.updateStreamCleanText(tempId, logText)
    }
    store.finishStreamReply(tempId)
}

async function _doSend(text) {
    const isFirstExchange = (store.messagesMap[store.currentId] || []).filter(m => m.role === 'user').length === 0

    const files = pendingFiles.value.map(f => ({
        name: f.name, type: f.type, size: f.size, key: f.key, content: f.content || '',
    }))

    const isDesign = selectedDevice.value && isDesignRequest(text)
    const deviceInfo = selectedDevice.value
    const finalText = isDesign ? buildDesignPrompt(text, deviceInfo) : text

    const displayText = isDesign
        ? `[设计] ${text}\n[设备] ${deviceInfo.name} (${deviceInfo.w}x${deviceInfo.h})`
        : text
    store.addUserMessage(displayText, files)
    const userMsgs = (store.messagesMap[store.currentId] || []).filter(m => m.role === 'user')
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    if (lastUserMsg && isDesign) {
        lastUserMsg._apiText = finalText
        lastUserMsg._displayText = displayText
        lastUserMsg._device = deviceInfo
    }

    // Fire title generation immediately (don't wait for stream)
    if (isFirstExchange) {
        generateTitle(text || (files[0]?.name || '文件'), store.currentId)
    }

    inputText.value = ''
    pendingFiles.value = []
    if (textareaRef.value) textareaRef.value.style.height = 'auto'

    await callStreamAPI(files, isDesign, isDesign, deviceInfo)

    // Finalize design extraction
    const aiMsgs = (store.messagesMap[store.currentId] || []).filter(m => m.role === 'ai')
    const aiMsg = aiMsgs[aiMsgs.length - 1]
    if (aiMsg && isDesign) {
        if (!aiMsg.designs || !aiMsg.designs.length) {
            const rawText = aiMsg._rawText || ''
            let designs = parseDesignBlocks(rawText)
            if (!designs.length) {
                const mdBlock = extractFirstHtmlBlock(rawText)
                if (mdBlock) designs = [{ width: deviceInfo.w, height: deviceInfo.h, html: mdBlock }]
            }
            if (!designs.length) {
                const html = extractRawHtml(rawText)
                if (html) designs = [{ width: deviceInfo.w, height: deviceInfo.h, html }]
            }
            if (designs.length) aiMsg.designs = designs
        }
        aiMsg.text = ''
        aiMsg.designProgress = 0
    }

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

async function doStream(msgs, tempId, tools, isDesign = false, deviceW = 375, deviceH = 667) {
    // Force V4 Pro for design tasks — better quality, reasoning support
    const model = isDesign ? 'deepseek-v4-pro' : store.model
    const body = { model, stream: true, messages: msgs }
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
                    if (isDesign) {
                        store.updateStreamCleanText(tempId, '思考中...')
                        store.appendStreamDesignProgress(tempId, 10)
                    }
                }
                if (delta?.content) {
                    fullText += delta.content

                    if (isDesign) {
                        const designs = parseDesignBlocks(fullText)
                        const hasOpenDesign = hasOpenDesignBlock(fullText)

                        if (designs.length > 0) {
                            store.updateStreamCleanText(tempId, '绘制完成')
                            store.updateStreamDesign(tempId, designs)
                            store.updateStreamRawText(tempId, fullText)
                            store.appendStreamDesignProgress(tempId, 100)
                        } else if (fullText.length > 500 && !hasOpenDesign) {
                            const fallbackHtml = extractFirstHtmlBlock(fullText) || extractRawHtml(fullText)
                            if (fallbackHtml) {
                                const d = { width: deviceW, height: deviceH, html: fallbackHtml }
                                store.updateStreamCleanText(tempId, '绘制完成')
                                store.updateStreamDesign(tempId, [d])
                                store.updateStreamRawText(tempId, fullText)
                                store.appendStreamDesignProgress(tempId, 100)
                            } else {
                                store.updateStreamCleanText(tempId, '绘制中...')
                                store.updateStreamRawText(tempId, fullText)
                                store.appendStreamDesignProgress(tempId, 50)
                            }
                        } else if (!hasOpenDesign && fullText.length < 300) {
                            contentStarted = true
                            store.updateStreamCleanText(tempId, '思考完成')
                            store.updateStreamRawText(tempId, fullText)
                            store.appendStreamDesignProgress(tempId, 20)
                        } else {
                            store.updateStreamCleanText(tempId, '绘制中...')
                            store.updateStreamRawText(tempId, fullText)
                            store.appendStreamDesignProgress(tempId, 50)
                        }
                    } else {
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

async function callStreamAPI(files = [], skipEmail = false, isDesign = false, device = null) {
    store.setLoading(true)
    const tempId = store.startStreamReply()
    abortController = new AbortController()
    store.setAbortController(abortController)

    if (isDesign) {
        store.updateStreamCleanText(tempId, '思考中...')
        store.appendStreamDesignProgress(tempId, 10)
    }

    try {
        const msgs = buildMessages(tempId)
        const { tools, executors } = skipEmail ? { tools: [], executors: {} } : getEmailTools()

        const dw = device?.w || 375
        const dh = device?.h || 667
        const first = await doStream(msgs, tempId, tools, isDesign, dw, dh)
        let finalText = first.text

        if (first.toolCalls.length > 0 && tools.length > 0) {
            const tc = first.toolCalls[0]
            let args = {}
            try { args = JSON.parse(tc.function.arguments) } catch {}

            const executor = executors[tc.function.name]
            if (executor) {
                const result = await executor(args)
                msgs.push({ role: 'assistant', content: first.text || null, tool_calls: [tc] })
                msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: result })

                store.appendStreamText(tempId, '')
                store.appendStreamReasoning(tempId, first.reasoning)
                const second = await doStream(msgs, tempId, [], isDesign, dw, dh)
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

function stopGeneration() {
    store.abort()
}

async function regenerate() {
    if (store.isLoading) return
    // Find if the last user message had design info
    const msgs = store.visibleMessages
    let device = null
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user' && msgs[i]._device) {
            device = msgs[i]._device
            break
        }
    }
    const isDesign = !!device
    await callStreamAPI([], isDesign, isDesign, device)
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

async function generateTitle(userMsg, convId) {
    // Fallback title from first N chars of user input
    const fallback = (userMsg || '新对话').replace(/[\n\r]/g, ' ').slice(0, 15).trim() || '新对话'
    console.log('[Title] generating for:', convId, 'input:', (userMsg || '').slice(0, 30))
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
        if (!res.ok) {
            console.warn('[Title] API failed, using fallback')
            store.updateConvTitle(convId, fallback)
            return
        }
        const data = await res.json()
        const title = data.choices?.[0]?.message?.content?.trim().slice(0, 30)
        if (title) {
            console.log('[Title] got:', title)
            store.updateConvTitle(convId, title)
        } else {
            console.log('[Title] using fallback:', fallback)
            store.updateConvTitle(convId, fallback)
        }
    } catch (e) {
        console.warn('[Title] error, using fallback:', e.message)
        store.updateConvTitle(convId, fallback)
    }
}
</script>

<style scoped>
.app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    height: 100dvh;
    width: 100%;
    background: var(--bg);
    transition: background 0.2s;
    overflow: hidden;
}
.chat-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
}
.chat-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 2px solid var(--border);
    flex-shrink: 0;
    transition: border-color 0.2s;
    background: var(--bg);
    z-index: 10;
}

/* ─── Tab bar ─── */
.tab-bar {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0;
    overflow-x: auto;
    overflow-y: hidden;
    min-width: 0;
    height: 100%;
}
.tab-bar::-webkit-scrollbar { height: 2px; }
.tab-bar::-webkit-scrollbar-thumb { background: var(--border-light); }

.tab {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border-light);
    border-bottom: none;
    cursor: pointer;
    flex-shrink: 0;
    background: var(--bg);
    transition: background 0.1s, border-color 0.1s;
    position: relative;
}
.tab:hover {
    background: var(--bg-hover);
}
.tab.active {
    background: var(--bg-active);
    border-color: var(--primary);
    z-index: 1;
}
.tab-title {
    font-size: 11px;
    color: var(--text);
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
}
.tab-close {
    border: none;
    background: transparent;
    width: 16px;
    height: 16px;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
    line-height: 1;
}
.tab:hover .tab-close { opacity: 1; }
.tab-close:hover { color: var(--red); }

.tab-add {
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
    line-height: 1;
    transition: background 0.1s, color 0.1s;
}
.tab-add:hover {
    background: var(--bg-hover);
    color: var(--text);
}

/* Agent mode toggle */
.btn-agent-mode {
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    width: 28px;
    height: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
    margin-left: 6px;
}
.btn-agent-mode:hover { border-color: var(--primary); color: var(--primary); }
.btn-agent-mode.on { background: var(--primary); border-color: var(--primary); color: #fff; }

/* ─── Agent streaming scan effect ─── */
:deep(.agent-streaming) {
  position: relative;
  overflow: hidden;
}
:deep(.agent-streaming::after) {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(96,165,250,0.06), transparent);
  animation: agentScan 2s ease-in-out infinite;
}
@keyframes agentScan {
  0% { left: -60%; }
  100% { left: 120%; }
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
    background: var(--bg);
    z-index: 10;
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
.input-row textarea:focus { border-color: var(--primary); }
.input-row textarea:disabled { opacity: 0.5; }
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
.btn-send:hover:not(:disabled) { background: var(--primary-hover); }
.btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-stop { border-color: var(--red); background: var(--red); }
.btn-stop:hover { background: #b91c1c; }
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
.device-bar { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; }
.device-label { font-size: 11px; color: var(--text-muted); flex-shrink: 0; margin-right: 2px; }
.device-btn {
    border: 1px solid var(--border-light);
    background: var(--bg);
    color: var(--text-secondary);
    font-size: 11px;
    padding: 3px 10px;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.device-btn:hover { background: var(--bg-hover); color: var(--text); }
.device-btn.active { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); font-weight: 600; }

/* file chips */
.file-bar { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 6px; }
.file-chip {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 6px; font-size: 11px; border: 1px solid; height: 22px;
}
.file-chip-name { cursor: pointer; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-chip-del {
    border: none; background: transparent; color: inherit;
    font-size: 10px; cursor: pointer; padding: 0 2px; opacity: 0.6;
}
.file-chip-del:hover { opacity: 1; }

/* preview overlay */
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

/* ═══ Mobile ═══ */
@media (max-width: 768px) {
    .app-layout {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
    }
    .chat-area {
        padding-left: 0;
        overflow: visible;
    }
    .chat-header {
        padding: 0 8px 0 32px;
        padding-top: env(safe-area-inset-top, 0px);
        min-height: 44px;
        gap: 6px;
    }
    .input-area {
        padding: 6px 10px;
        padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
    }
    .tab {
        height: 26px;
        padding: 0 5px;
    }
    .tab-title {
        font-size: 10px;
        max-width: 60px;
    }
    .tab-close {
        opacity: 1;
        width: 16px;
        height: 16px;
        font-size: 9px;
    }
    .tab-add {
        width: 24px;
        height: 24px;
        font-size: 13px;
    }
    .msg {
        max-width: 88% !important;
    }
    .msg.user {
        max-width: 80% !important;
    }
    .input-row {
        gap: 5px;
    }
    .input-row textarea {
        font-size: 15px;
        padding: 6px 10px;
        border-radius: 6px;
    }
    .input-row textarea::placeholder {
        font-size: 12px;
    }
    .btn-upload {
        min-width: 36px;
        min-height: 36px;
        width: 36px;
        height: 36px;
        font-size: 18px;
        border-radius: 50%;
    }
    .btn-send, .btn-stop {
        min-height: 36px;
        padding: 6px 14px;
        font-size: 13px;
        border-radius: 6px;
    }
    .file-bar {
        gap: 4px;
        padding-bottom: 4px;
    }
    .file-chip {
        padding: 3px 6px;
        font-size: 10px;
        height: 20px;
    }
    .device-bar {
        flex-wrap: wrap;
    }
    .device-btn {
        padding: 5px 10px;
        font-size: 12px;
    }
}
</style>
