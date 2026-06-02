<template>
    <div class="home">
        <h1>AI Chat</h1>
        <div class="card">
            <label>API Key</label>
            <input v-model="apiKeyInput" placeholder="输入 DeepSeek API Key" />
            <button class="btn-save" @click="saveApiKey">保存 Key</button>
        </div>
        <p class="hint" v-if="saved">API Key 已保存到本地</p>

        <div class="card">
            <label class="section-label" @click="showSMTP = !showSMTP">
                <span class="section-arrow">{{ showSMTP ? 'v' : '>' }}</span>
                SMTP 发邮件（可选）
            </label>
            <template v-if="showSMTP">
                <label class="sub-label">邮箱服务商</label>
                <select v-model="smtpProvider" @change="onProviderChange">
                    <option value="">-- 请选择 --</option>
                    <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <div class="inline-row">
                    <input v-model="smtp.host" placeholder="SMTP 服务器" class="flex-2" />
                    <input v-model="smtp.port" placeholder="端口" class="flex-1" />
                </div>
                <input v-model="smtp.user" placeholder="邮箱地址" />
                <input v-model="smtp.pass" type="password" placeholder="授权码 (非登录密码)" />
                <button class="btn-save" @click="saveSMTP">保存 SMTP</button>
                <p class="hint" v-if="smtpSaved">SMTP 已保存</p>
            </template>
        </div>

        <div class="card">
            <button class="btn-new" @click="newConversation">+ 新建对话</button>
        </div>

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
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'
import { loadSMTPConfig, saveSMTPConfig } from '../utils/email.js'

const router = useRouter()
const store = useChatStore()
const apiKeyInput = ref('')
const saved = ref(false)
const smtpSaved = ref(false)
const showSMTP = ref(false)
const smtpProvider = ref('')

const providers = [
    { id: 'qq',     name: 'QQ 邮箱',            host: 'smtp.qq.com',       port: '465', domain: '@qq.com' },
    { id: '163',    name: '163 邮箱',            host: 'smtp.163.com',      port: '465', domain: '@163.com' },
    { id: '126',    name: '126 邮箱',            host: 'smtp.126.com',      port: '465', domain: '@126.com' },
    { id: 'gmail',  name: 'Gmail',               host: 'smtp.gmail.com',    port: '465', domain: '@gmail.com' },
    { id: 'outlook',name: 'Outlook / Hotmail',   host: 'smtp-mail.outlook.com', port: '587', domain: '@outlook.com' },
    { id: 'yeah',   name: 'Yeah 邮箱',           host: 'smtp.yeah.net',     port: '465', domain: '@yeah.net' },
    { id: 'sina',   name: '新浪邮箱',            host: 'smtp.sina.com',     port: '465', domain: '@sina.com' },
    { id: 'sohu',   name: '搜狐邮箱',            host: 'smtp.sohu.com',     port: '465', domain: '@sohu.com' },
    { id: 'aliyun', name: '阿里云企业邮箱',      host: 'smtp.qiye.aliyun.com', port: '465', domain: '@' },
    { id: 'custom', name: '其他（手动输入）',    host: '', port: '', domain: '' },
]

const smtp = reactive({
    host: '', port: '465', user: '', pass: '',
})

function onProviderChange() {
    const p = providers.find(p => p.id === smtpProvider.value)
    if (p && p.id !== 'custom') {
        smtp.host = p.host
        smtp.port = p.port
        // pre-fill email with suffix, keep existing username if any
        const cur = smtp.user || ''
        const atIdx = cur.indexOf('@')
        const username = atIdx > 0 ? cur.slice(0, atIdx) : cur
        smtp.user = username + p.domain
    }
}

store.loadApiKey()
apiKeyInput.value = store.apikey

const savedCfg = loadSMTPConfig()
if (savedCfg) {
    Object.assign(smtp, savedCfg)
    // try to detect provider from saved host
    const match = providers.find(p => p.host === savedCfg.host)
    if (match) smtpProvider.value = match.id
    else smtpProvider.value = 'custom'
    showSMTP.value = true
}

onMounted(() => {
    store.loadConversations()
})

function saveApiKey() {
    store.setApiKey(apiKeyInput.value)
    saved.value = true
    setTimeout(() => saved.value = false, 2000)
}

function saveSMTP() {
    saveSMTPConfig({ ...smtp })
    smtpSaved.value = true
    setTimeout(() => smtpSaved.value = false, 2000)
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
.section-label {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
}
.section-arrow {
    font-size: 10px;
    width: 12px;
    flex-shrink: 0;
    color: var(--text-muted);
}
.sub-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: none;
    letter-spacing: 0;
}
select {
    border: 2px solid var(--border);
    padding: 10px 14px;
    font-size: 14px;
    outline: none;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.2s;
    appearance: auto;
}
select:focus {
    border-color: var(--primary);
}
.inline-row {
    display: flex;
    gap: 8px;
}
.inline-row input.flex-2 { flex: 2; }
.inline-row input.flex-1 { flex: 1; }
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
