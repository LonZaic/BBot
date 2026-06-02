<template>
  <div class="login-page">
    <div class="login-card">
      <h1>BBot</h1>
      <p class="subtitle">登录或注册以开始使用</p>

      <div class="form">
        <input
          v-model="name"
          placeholder="昵称"
          maxlength="20"
          @keydown.enter="submit"
          autofocus
        />
        <input
          v-model="password"
          type="password"
          placeholder="密码"
          @keydown.enter="submit"
        />
        <button class="btn-primary" @click="submit" :disabled="loading">
          {{ isRegister ? '注册' : '登录' }}
        </button>
        <button class="btn-link" @click="isRegister = !isRegister">
          {{ isRegister ? '已有账号？去登录' : '没有账号？去注册' }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { auth, saveAuth } from '../api/index.js'
import { connect } from '../api/ws.js'

const router = useRouter()
const name = ref('')
const password = ref('')
const isRegister = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!name.value.trim() || !password.value) {
    error.value = '请填写昵称和密码'
    return
  }
  loading.value = true
  try {
    let result
    if (isRegister.value) {
      result = await auth.register(name.value.trim(), password.value)
    } else {
      result = await auth.login(name.value.trim(), password.value)
    }
    saveAuth(result.token, { id: result.id, name: result.name })
    connect(result.token)
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.login-card {
  border: 2px solid var(--border);
  padding: 40px;
  width: 360px;
  max-width: 90vw;
  background: var(--bg-secondary);
}
.login-card h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  text-align: center;
  margin-bottom: 4px;
}
.subtitle {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin-bottom: 24px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form input {
  border: 2px solid var(--border);
  padding: 10px 14px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  background: var(--bg);
  color: var(--text);
}
.form input:focus {
  border-color: var(--primary);
}
.btn-primary {
  border: 2px solid var(--primary);
  background: var(--primary);
  color: #fff;
  padding: 12px 0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-link {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  padding: 4px 0;
}
.btn-link:hover { color: var(--primary); }
.error {
  font-size: 12px;
  color: var(--red);
  text-align: center;
}
@media (max-width: 768px) {
  .login-card {
    padding: 28px 20px;
    width: 100%;
    max-width: 100vw;
    border: none;
  }
  .login-card h1 {
    font-size: 22px;
  }
  .form input {
    font-size: 16px;
    padding: 12px 14px;
  }
  .btn-primary {
    padding: 14px 0;
    font-size: 16px;
  }
}
</style>
