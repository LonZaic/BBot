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
                    class="file-chip"
                    :style="fileChipStyle(f.name, f.type)"
                    :title="f.name"
                >
                    <span class="file-chip-name" @click="previewFile(f)">{{ fileLabel(f.name, f.type) }}</span>
                </div>
            </div>

            <!-- ═══ AI with completed designs (shown immediately, even during streaming tail) ═══ -->
            <template v-if="role === 'ai' && designs && designs.length > 0">
                <div v-if="isRealContent" class="bubble markdown-body" v-html="renderedText"></div>
                <div class="design-previews">
                    <div v-for="(d, i) in designs" :key="i" class="design-frame-wrap" :style="{ animationDelay: (i * 0.1) + 's' }">
                        <div :class="['design-device-frame', deviceFrameClass(d)]">
                            <!-- device notch / camera (phone only) -->
                            <div v-if="deviceType(d) === 'phone'" class="device-notch"></div>
                            <!-- device title bar (desktop only) -->
                            <div v-if="deviceType(d) === 'desktop'" class="device-titlebar">
                                <span class="titlebar-dot"></span>
                                <span class="titlebar-dot"></span>
                                <span class="titlebar-dot"></span>
                            </div>
                            <div class="design-frame-box" :style="designBoxStyle(d)">
                                <iframe
                                    :srcdoc="d.html"
                                    sandbox="allow-scripts"
                                    scrolling="no"
                                    class="design-iframe"
                                    :style="designIframeStyle(d)"
                                />
                            </div>
                        </div>
                        <div class="design-meta">
                            <span class="design-device-label">{{ deviceLabel(d) }}</span>
                            <span class="design-size-label">{{ d.width }}&times;{{ d.height }}</span>
                            <button class="design-export-btn" @click="exportDesign(d, i)">导出</button>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ═══ AI streaming: drawing phase (design being generated) ═══ -->
            <template v-else-if="role === 'ai' && isDrawing">
                <div class="design-drawing">
                    <svg class="design-drawing-icon" viewBox="0 0 24 24" width="16" height="16">
                        <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                        <line x1="3" y1="8" x2="21" y2="8" stroke="currentColor" stroke-width="1.5"/>
                        <circle cx="8" cy="5.5" r="0.8" fill="currentColor"/>
                    </svg>
                    <span class="design-drawing-label">{{ phaseLabel }}</span>
                </div>
            </template>

            <!-- ═══ AI normal message (with or without streaming) ═══ -->
            <template v-else-if="role === 'ai'">
                <div class="bubble markdown-body" v-html="renderedText"></div>
                <span v-if="streaming && !text" class="stream-cursor"></span>
            </template>

            <!-- ═══ User message ═══ -->
            <template v-else>
                <div class="bubble">{{ text }}</div>
            </template>

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
import { fileChipStyle, fileLabel } from '../utils/fileStyles.js'
import { guessDeviceType } from '../utils/designPreview.js'

const props = defineProps({
    role: { type: String, required: true },
    text: { type: String, required: true },
    reasoning: { type: String, default: '' },
    files: { type: Array, default: () => [] },
    designs: { type: Array, default: () => [] },
    designProgress: { type: Number, default: 0 },
    streaming: { type: Boolean, default: false },
    siblingCount: { type: Number, default: 1 },
    siblingIndex: { type: Number, default: 1 },
})

defineEmits(['regenerate', 'edit', 'delete', 'prevBranch', 'nextBranch'])

async function previewFile(f) {
    if (f.type?.startsWith('image/')) {
        let src = f.data
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

watch(() => props.reasoning, (val) => {
    if (val && !props.text && !userToggled.value) {
        thinkingOpen.value = true
    }
})
watch(() => props.text, (val) => {
    if (val && !userToggled.value && !hasDesignText.value) {
        thinkingOpen.value = false
    }
})

function toggleThinking() {
    thinkingOpen.value = !thinkingOpen.value
    userToggled.value = true
}

const hasDesignText = computed(() => {
    return props.designs && props.designs.length > 0
})

const isDrawing = computed(() => {
    return props.streaming && props.designProgress > 0 && props.designProgress < 100
})

// Phase labels used during design generation (not real AI content)
const PHASE_LABELS = ['思考中...', '绘制中...', '绘制完成']

const isRealContent = computed(() => {
    const t = (props.text || '').trim()
    return t && !PHASE_LABELS.includes(t)
})

const phaseLabel = computed(() => {
    // Map designProgress to phase label
    if (props.designProgress >= 100) return '绘制完成'
    if (props.designProgress >= 50) return '绘制中...'
    if (props.designProgress >= 10) return '思考中...'
    return '绘制中...'
})

const displayText = computed(() => {
    if (!props.text || !props.text.trim()) return ''
    return props.text.trim()
})

const renderedText = computed(() => {
    if (props.role !== 'ai') return ''
    const txt = props.text || ''
    return renderMarkdown(txt)
})

// ─── device helpers ───
function deviceType(d) {
    return guessDeviceType(d)
}

function deviceFrameClass(d) {
    return 'frame-' + guessDeviceType(d)
}

function deviceLabel(d) {
    const map = { phone: '手机', tablet: '平板', desktop: '电脑' }
    return map[guessDeviceType(d)] || '设备'
}

const MAX_PREVIEW_W = 480

function designScale(d) {
    const s = Math.min(1, MAX_PREVIEW_W / d.width)
    return { s, w: Math.round(d.width * s), h: Math.round(d.height * s) }
}

function designBoxStyle(d) {
    const scale = designScale(d)
    return { width: scale.w + 'px', height: scale.h + 'px' }
}

function designIframeStyle(d) {
    const scale = designScale(d)
    return { width: d.width + 'px', height: d.height + 'px', transform: 'scale(' + scale.s + ')' }
}

function exportDesign(d, i) {
    const blob = new Blob([d.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `design-${d.width}x${d.height}-${i + 1}.html`
    a.click()
    URL.revokeObjectURL(url)
}

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
.thinking-head:hover { color: var(--text-secondary); }
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
.branch-btn:hover { background: var(--bg-hover); color: var(--text); }
.branch-num {
    font-size: 10px;
    color: var(--text-muted);
    min-width: 24px;
    text-align: center;
}

/* ─── file chips on user bubble ─── */
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

/* ─── stream cursor ─── */
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

/* ─── message actions ─── */
.msg-actions {
    display: flex;
    gap: 3px;
    margin-top: 3px;
    opacity: 0;
    transition: opacity 0.12s;
}
.msg.user .msg-actions { justify-content: flex-end; }
.body:hover .msg-actions { opacity: 1; }
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
.msg-actions button:hover { background: var(--bg-hover); color: var(--text); }
.msg-actions button.del:hover { border-color: var(--red); color: var(--red); }

/* ══════════════════════════════════════════
   Design preview — device frame + iframe
   ══════════════════════════════════════════ */

.design-previews {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.design-frame-wrap {
    animation: previewReveal 0.5s ease both;
}
@keyframes previewReveal {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* ─── device frames (line-style) ─── */
.design-device-frame {
    position: relative;
    display: inline-block;
    border: 1px solid var(--border);
    background: var(--bg);
    overflow: hidden;
    transition: border-color 0.2s;
}

/* Phone frame */
.frame-phone {
    border-width: 2px;
    border-top-width: 18px;
    border-bottom-width: 14px;
    border-radius: 2px;
}
.frame-phone .device-notch {
    position: absolute;
    top: -14px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 4px;
    border: 1px solid var(--border);
    background: var(--border);
}

/* Tablet frame */
.frame-tablet {
    border-width: 2px;
    border-top-width: 16px;
    border-bottom-width: 12px;
    border-radius: 2px;
}

/* Desktop frame */
.frame-desktop {
    border-width: 2px;
    border-top-width: 20px;
    border-bottom-width: 2px;
    border-radius: 2px;
}
.frame-desktop .device-titlebar {
    position: absolute;
    top: -16px;
    left: 6px;
    display: flex;
    gap: 4px;
}
.frame-desktop .device-titlebar .titlebar-dot {
    width: 6px;
    height: 6px;
    border: 1px solid var(--text-muted);
    border-radius: 50%;
}

/* Inner box */
.design-frame-box {
    overflow: hidden;
    max-width: 100%;
}
.design-iframe {
    border: none;
    display: block;
    transform-origin: 0 0;
}

/* ─── design meta row ─── */
.design-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}
.design-device-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.3px;
}
.design-size-label {
    font-size: 10px;
    color: var(--text-muted);
}
.design-export-btn {
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 8px;
    line-height: 1.5;
    transition: background 0.1s, color 0.1s;
}
.design-export-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    border-color: var(--border);
}

/* ══════════════════════════════════════════
   Drawing indicator
   ══════════════════════════════════════════ */

.design-drawing {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
}
.design-drawing-icon {
    color: var(--text-muted);
    animation: drawingPulse 1.5s ease-in-out infinite;
}
@keyframes drawingPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}
.design-drawing-label {
    font-size: 12px;
    color: var(--text-secondary);
}
</style>
