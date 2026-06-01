//这是路由配置文件，告诉vue，当url是什么的时候，显示什么页面
import { createRouter, createWebHistory } from 'vue-router'
// - History 模式： http://localhost:5173/chat/123 （好看，但需要后端配合）
// - Hash 模式： http://localhost:5173/#/chat/123 （丑，但不用配后端）
const routes = [
    {
        path: '/',
        name: 'home',
        component: () => import('../pages/HomeView.vue')
    },
    {
        path: '/chat/:id',//动态路由参数，:id 表示 id 是一个变量
        //在组件里用 route.params.id 拿到这个参数值
        name: 'chat',
        component: () => import('../pages/ChatView.vue')
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router