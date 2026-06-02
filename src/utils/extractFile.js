import JSZip from 'jszip'

// extract text from docx (word/document.xml)
async function extractDocx(buffer) {
    const zip = await JSZip.loadAsync(buffer)
    const docXml = await zip.file('word/document.xml')?.async('string')
    if (!docXml) return ''
    // strip XML tags, keep text
    const text = docXml
        .replace(/<w:p[ >]/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    return text
}

// extract text from pptx (ppt/slides/slide*.xml)
async function extractPptx(buffer) {
    const zip = await JSZip.loadAsync(buffer)
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort()
    const texts = []
    for (let i = 0; i < slideFiles.length; i++) {
        const xml = await zip.file(slideFiles[i])?.async('string')
        if (!xml) continue
        const text = xml
            .replace(/<a:p[ >]/g, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&[a-z]+;/g, ' ')
            .trim()
        if (text) texts.push(`--- 第${i + 1}页 ---\n${text}`)
    }
    return texts.join('\n\n')
}

// extract text from xlsx (xl/sharedStrings.xml)
async function extractXlsx(buffer) {
    const zip = await JSZip.loadAsync(buffer)
    const stringsXml = await zip.file('xl/sharedStrings.xml')?.async('string')
    if (!stringsXml) return ''
    const items = stringsXml.match(/<t[^>]*>([^<]+)<\/t>/g) || []
    return items.map(s => s.replace(/<[^>]+>/g, '')).join('\t')
}

export async function extractFileContent(file) {
    const ext = (file.name || '').split('.').pop()?.toLowerCase()
    const buffer = await file.arrayBuffer()

    if (ext === 'docx') {
        try { return await extractDocx(buffer) } catch { return '' }
    }
    if (ext === 'pptx') {
        try { return await extractPptx(buffer) } catch { return '' }
    }
    if (ext === 'xlsx') {
        try { return await extractXlsx(buffer) } catch { return '' }
    }
    // text-like files handled by readAsText elsewhere
    return null
}
