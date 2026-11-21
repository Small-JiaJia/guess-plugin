import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { helpGroups, helpNotes, answerTip } from '../config/help.js'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resourcesRoot = path.join(pluginRoot, 'resources')
const toFileUrl = filePath => pathToFileURL(filePath).href

function buildRows(items, columns = 3) {
    const rows = []
    for (let index = 0; index < items.length; index += columns) {
        const row = items.slice(index, index + columns)
        while (row.length < columns) row.push(null)
        rows.push(row)
    }
    return rows
}

export function getHelpRenderData() {
    return {
        tplFile: path.join(resourcesRoot, 'help', 'index.html'),
        pluginResourcesUrl: toFileUrl(`${resourcesRoot}${path.sep}`),
        title: '猜角色帮助',
        answerTip,
        groupCount: helpGroups.length,
        commandCount: helpGroups.reduce((count, group) => count + group.items.length, 0),
        groups: helpGroups.map((group, index) => ({
            ...group,
            number: String(index + 1).padStart(2, '0'),
            rows: buildRows(group.items)
        })),
        notes: helpNotes,
        saveId: 'help',
        imgType: 'png'
    }
}

export async function renderHelpImage() {
    // Load the Yunzai renderer on demand so help can fall back to text if Chromium is unavailable.
    const { default: rendererLoader } = await import('../../../lib/renderer/loader.js')
    const image = await rendererLoader.getRenderer().render('guess-plugin/help', getHelpRenderData())
    if (!Buffer.isBuffer(image)) throw new Error('帮助图渲染器未返回图片')
    return image
}
