// ─── Design preview: device sizes, design detection, HTML parsing ───

export const DEVICES = [
    { id: 'phone',   name: '手机',  w: 375, h: 667, icon: 'P' },
    { id: 'tablet',  name: '平板',  w: 768, h: 1024, icon: 'T' },
    { id: 'desktop', name: '电脑',  w: 1440, h: 900, icon: 'D' },
    { id: 'custom',  name: '自定义',w: 0,   h: 0,   icon: '?' },
]

const DESIGN_KEYWORDS = [
    '设计', '画', '做', '写', '生成', '创建', '实现', '开发',
    '页面', '界面', 'UI', '按钮', '表单', '登录', '注册',
    '导航', '卡片', '列表', '菜单', '弹窗', '首页', '官网',
    '布局', '样式', '前端', 'HTML', 'CSS', '组件',
    'design', 'layout', 'component',
]

const DEVICE_KEYWORDS = [
    '手机', '移动端', 'mobile', 'phone', 'iPhone', '安卓',
    '平板', 'iPad', 'tablet', 'pad',
    '电脑', '桌面', 'PC', 'desktop', 'laptop', '笔记本',
    '大屏', '宽屏', '显示器',
]

// check if message is a design request
export function isDesignRequest(text) {
    const t = text.toLowerCase()
    return DESIGN_KEYWORDS.some(k => t.includes(k.toLowerCase()))
}

// check if device type is specified
export function hasDeviceSpecified(text) {
    const t = text.toLowerCase()
    return DEVICE_KEYWORDS.some(k => t.includes(k.toLowerCase()))
}

// parse [DESIGN] blocks from AI response text
const DESIGN_RE = /\[DESIGN\s*(?:width=(\d+))?\s*(?:height=(\d+))?\s*\]([\s\S]*?)\[\/DESIGN\]/g

export function parseDesignBlocks(text) {
    const blocks = []
    let m
    while ((m = DESIGN_RE.exec(text)) !== null) {
        blocks.push({
            width: parseInt(m[1]) || 375,
            height: parseInt(m[2]) || 667,
            html: m[3],
            raw: m[0],
        })
    }
    return blocks
}

// remove design blocks from display text
export function cleanDesignMarkers(text) {
    return text.replace(DESIGN_RE, '').trim()
}

// build design prompt for AI
export function buildDesignPrompt(userText, device) {
    let prompt = `[设计任务]\n${userText}\n\n`
    prompt += `设备: ${device.name} (${device.w}x${device.h})\n\n`
    prompt += `【重要】你必须输出一个完整的HTML页面用于即时预览。`
    prompt += `请严格按以下格式输出:\n\n`
    prompt += `[DESIGN width=${device.w} height=${device.h}]\n`
    prompt += `<!DOCTYPE html>\n<html>\n...完整HTML代码...\n</html>\n`
    prompt += `[/DESIGN]\n\n`
    prompt += `设计要求:\n`
    prompt += `1. 完整可独立运行的HTML(内嵌CSS)，无外部依赖\n`
    prompt += `2. 所有UI元素加渐入动画(animation-delay递增，逐个出现)\n`
    prompt += `3. 风格现代简洁，无emoji，配色舒适\n`
    prompt += `4. 尺寸精准适配 ${device.w}x${device.h}\n`
    prompt += `5. [DESIGN]标记必须在回答末尾，不要在其他位置`
    return prompt
}
