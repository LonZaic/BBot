<template>
    <div :class="['msg', role, { streaming }]">
        <div class="avatar">{{ role === 'user' ? 'U' : 'A' }}</div>
        <div class="body">
            <!-- AI: rendered markdown -->
            <div
                v-if="role === 'ai'"
                ref="bubbleRef"
                class="bubble markdown-body"
                v-html="renderedText"
            ></div>
            <!-- User: plain text -->
            <div v-else class="bubble">{{ text }}</div>

            <!-- streaming cursor -->
            <span v-if="streaming" class="stream-cursor">▌</span>

            <!-- action buttons (hover reveal) -->
            <div class="msg-actions" v-if="!streaming">
                <button
                    v-if="role === 'ai'"
                    class="act-btn"
                    title="重新生成"
                    @click="$emit('regenerate')"
                >🔄</button>
                <button
                    class="act-btn"
                    title="复制"
                    @click="copyText"
                >📋</button>
                <button
                    class="act-btn"
                    title="编辑"
                    @click="$emit('edit', text)"
                >✏️</button>
                <button
                    class="act-btn act-del"
                    title="删除"
                    @click="$emit('delete')"
                >🗑</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { renderMarkdown } from '../utils/markdown.js'

const props = defineProps({
    role: { type: String, required: true },
    text: { type: String, required: true },
    streaming: { type: Boolean, default: false },
})

defineEmits(['regenerate', 'edit', 'delete'])

const bubbleRef = ref(null)

const renderedText = computed(() => {
    if (props.role !== 'ai') return ''
    return renderMarkdown(props.text)
})

async function copyText() {
    try {
        await navigator.clipboard.writeText(props.text)
    } catch {
        // fallback for older browsers
        const ta = document.createElement('textarea')
        ta.value = props.text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
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
    gap: 10px;
    max-width: 90%;
}
.msg.user {
    align-self: flex-end;
    flex-direction: row-reverse;
}
.avatar {
    width: 32px;
    height: 32px;
    border: 2px solid var(--border);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
    color: var(--text);
    background: var(--bg-secondary);
}
.msg.user .avatar { border-color: var(--primary); }
.msg.ai .avatar { border-color: var(--green); }

.body {
    position: relative;
    min-width: 0;
}
.bubble {
    border: 2px solid var(--border);
    padding: 10px 14px;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
    background: var(--bg);
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.msg.user .bubble {
    border-color: var(--primary);
    background: var(--primary-bg);
    white-space: pre-wrap;
}
.msg.ai .bubble {
    border-color: var(--green);
}

/* streaming cursor blink */
.stream-cursor {
    display: inline;
    color: var(--primary);
    font-size: 14px;
    animation: blink 0.8s infinite;
}
@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}

/* ─── action buttons ─── */
.msg-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
.body:hover .msg-actions {
    opacity: 1;
}
.act-btn {
    width: 26px;
    height: 26px;
    font-size: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.1s;
}
.act-btn:hover {
    background: var(--bg-hover);
}
.act-del:hover {
    border-color: var(--red);
    color: var(--red);
}
</style>
