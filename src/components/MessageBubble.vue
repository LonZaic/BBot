<template>
    <div :class="['msg', role, { streaming }]">
        <span class="avatar">{{ role === 'user' ? 'U' : 'A' }}</span>
        <div class="body">
            <!-- thinking / reasoning -->
            <div v-if="role === 'ai' && reasoning" class="thinking-box">
                <div class="thinking-head" @click="toggleThinking">
                    <span class="thinking-arrow">{{ thinkingOpen ? 'v' : '>' }}</span>
                    <span class="thinking-label">思考过程</span>
                </div>
                <div v-if="thinkingOpen" class="thinking-body">{{ reasoning }}</div>
            </div>
            <!-- file chips (user messages) -->
            <div v-if="role === 'user' && files && files.length" class="file-bar">
                <div
                    v-for="(f, i) in files"
                    :key="i"
                    :class="['file-chip', chipClass(f)]"
                    :title="f.name"
                >
                    <span class="file-chip-name" @click="previewFile(f)">{{ chipLabel(f, i) }}</span>
                </div>
            </div>
            <!-- bubble -->
            <div v-if="role === 'ai'" class="bubble markdown-body" v-html="renderedText"></div>
            <div v-else class="bubble">{{ text }}</div>
            <span v-if="streaming && !text" class="stream-cursor"></span>
            <!-- branch version navigator -->
            <div v-if="role === 'ai' && !streaming && siblingCount > 1" class="branch-nav">
                <button class="branch-btn" title="上一版本" @click="$emit('prevBranch')">&lt;</button>
                <span class="branch-num">{{ siblingIndex }}/{{ siblingCount }}</span>
                <button class="branch-btn" title="下一版本" @click="$emit('nextBranch')">&gt;</button>
            </div>
            <div class="msg-actions" v-if="!streaming && text">
                <button v-if="role === 'ai'" title="重新生成" @click="$emit('regenerate')">重</button>
                <button title="复制" @click="copyText">抄</button>
                <button v-if="role === 'user'" title="编辑" @click="$emit('edit', text)">改</button>
                <button title="删除" class="del" @click="$emit('delete')">删</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { renderMarkdown } from '../utils/markdown.js'
import { loadFile } from '../utils/fileDB.js'

const props = defineProps({
    role: { type: String, required: true },
    text: { type: String, required: true },
    reasoning: { type: String, default: '' },
    files: { type: Array, default: () => [] },
    streaming: { type: Boolean, default: false },
    siblingCount: { type: Number, default: 1 },
    siblingIndex: { type: Number, default: 1 },
})

defineEmits(['regenerate', 'edit', 'delete', 'prevBranch', 'nextBranch'])

function chipCat(f) {
    if (f.type?.startsWith('image/')) return 'image'
    const ext = (f.name||'').split('.').pop()?.toLowerCase()
    const m = { doc:'word',docx:'word', ppt:'ppt',pptx:'ppt', xls:'excel',xlsx:'excel', pdf:'pdf', js:'code',ts:'code',py:'code',html:'code',css:'code',json:'code',xml:'code',md:'code' }
    return m[ext] || 'other'
}
function chipClass(f) { return 'fc-' + chipCat(f) }
function chipLabel(f, i) {
    const cats = { image:'图片', word:'Word', ppt:'PPT', excel:'Excel', pdf:'PDF', code:'代码', other:'文件' }
    return cats[chipCat(f)] + ' ' + (i + 1)
}
async function previewFile(f) {
    if (f.type?.startsWith('image/')) {
        let src = f.data
        // load from IndexedDB if not already in memory
        if (!src && f.key) {
            const blob = await loadFile(f.key)
            if (blob) src = URL.createObjectURL(blob)
        }
        if (src) {
            const w = window.open('', '_blank')
            if (w) w.document.write(`<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(0,0,0,.9)"><img src="${src}" style="max-width:90vw;max-height:90vh;object-fit:contain"></body></html>`)
        }
    }
}

const thinkingOpen = ref(false)
const userToggled = ref(false)

// auto-expand during thinking phase, collapse when content arrives
watch(() => props.reasoning, (val) => {
    if (val && !props.text && !userToggled.value) {
        thinkingOpen.value = true
    }
})
watch(() => props.text, (val) => {
    if (val && !userToggled.value) {
        thinkingOpen.value = false
    }
})

function toggleThinking() {
    thinkingOpen.value = !thinkingOpen.value
    userToggled.value = true
}

const renderedText = computed(() => {
    if (props.role !== 'ai') return ''
    return renderMarkdown(props.text)
})

async function copyText() {
    try {
        await navigator.clipboard.writeText(props.text)
    } catch {
        const ta = document.createElement('textarea')
        ta.value = props.text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
    }
}
</script>

<style scoped>
.msg {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 75%;
}
.msg.user {
    margin-left: auto;
    max-width: 60%;
    flex-direction: row-reverse;
    margin-right: 4px;
}
.avatar {
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-light);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    color: var(--text-muted);
    background: var(--bg-secondary);
}
.msg.user .avatar {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-bg);
}
.msg.ai .avatar {
    border-color: var(--green);
    color: var(--green);
}
.body {
    position: relative;
    min-width: 0;
}
.bubble {
    border: 1px solid var(--border-light);
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
    word-break: break-word;
    background: var(--bg);
    border-radius: 0;
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.msg.user .bubble {
    background: var(--primary-bg);
    border-color: var(--primary);
    white-space: pre-wrap;
}
.msg.ai .bubble {
}
/* ─── thinking / reasoning ─── */
.thinking-box {
    border-left: 2px solid var(--border-light);
    margin-bottom: 6px;
    padding-left: 8px;
}
.thinking-head {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;
    padding: 2px 0;
}
.thinking-head:hover {
    color: var(--text-secondary);
}
.thinking-arrow {
    font-size: 10px;
    width: 10px;
    flex-shrink: 0;
    color: var(--text-muted);
}
.thinking-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.3px;
}
.thinking-body {
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    padding: 4px 0 2px;
}
/* ─── branch version ─── */
.branch-nav {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
}
.branch-btn {
    height: 18px;
    padding: 0 5px;
    font-size: 10px;
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background 0.1s;
}
.branch-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
}
.branch-num {
    font-size: 10px;
    color: var(--text-muted);
    min-width: 24px;
    text-align: center;
}

/* file chips on user bubble */
.file-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
    justify-content: flex-end;
}
.file-chip {
    display: flex;
    align-items: center;
    gap: 3px;
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

.stream-cursor {
    display: inline-block;
    width: 6px;
    height: 14px;
    margin-left: 2px;
    background: var(--primary);
    animation: blink 0.8s infinite;
}
@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
}
.msg-actions {
    display: flex;
    gap: 3px;
    margin-top: 3px;
    opacity: 0;
    transition: opacity 0.12s;
}
.msg.user .msg-actions {
    justify-content: flex-end;
}
.body:hover .msg-actions {
    opacity: 1;
}
.msg-actions button {
    height: 20px;
    padding: 0 6px;
    font-size: 11px;
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.msg-actions button:hover {
    background: var(--bg-hover);
    color: var(--text);
}
.msg-actions button.del:hover {
    border-color: var(--red);
    color: var(--red);
}
</style>
