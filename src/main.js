import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
//导入自己写的路由配置
import router from './router/index.js'
//导入根组件
import App from './App.vue'
//导入数据库初始化函数
import { initDB } from './db/database.js'
import { vDebounce } from './directives/index.js'

//创建Vue实例   
const app = createApp(App)
//app 被用来安装插件
app.use(createPinia())
//app 被用来安装路由
app.use(router)
app.directive('debounce', vDebounce)
//挂载实例，挂载这个才可以用<router-view> 和 <router-link>
initDB()
app.mount('#app')
