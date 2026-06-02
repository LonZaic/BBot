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

const props = defineProps({
    role: { type: String, required: true },
    text: { type: String, required: true },
    reasoning: { type: String, default: '' },
    streaming: { type: Boolean, default: false },
    siblingCount: { type: Number, default: 1 },
    siblingIndex: { type: Number, default: 1 },
})

defineEmits(['regenerate', 'edit', 'delete', 'prevBranch', 'nextBranch'])

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
