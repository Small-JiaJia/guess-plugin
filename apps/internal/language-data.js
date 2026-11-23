import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import genshindb from 'genshin-db'
import cron from 'node-cron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../../resources/genshin/character')
const PLUGIN_ROOT = path.join(__dirname, '../..')
const CHINESE_LANG = 'ChineseSimplified'
const ALL_LANGS = [
    'ChineseSimplified', 'ChineseTraditional', 'English', 'Japanese', 'Korean',
    'Russian', 'German', 'Spanish', 'French', 'Indonesian', 'Portuguese',
    'Thai', 'Vietnamese'
]

let cachedRoleNames = null
let cachedRoleData = null
let cacheLoading = null

function getRoleAllLangs(roleEnName) {
    const result = {}
    for (const lang of ALL_LANGS) {
        genshindb.setOptions({ resultLanguage: lang })
        const data = genshindb.characters(roleEnName)
        if (data && data.name) result[lang] = data.name
    }
    genshindb.setOptions({ resultLanguage: 'English' })
    return result
}

export async function loadAllRoleData() {
    if (cachedRoleNames && cachedRoleData) {
        return { names: cachedRoleNames, data: cachedRoleData }
    }
    if (!cacheLoading) {
        cacheLoading = Promise.resolve().then(() => {
            const enNames = genshindb.characters('names', { matchCategories: true }) || []
            const names = []
            const data = {}

            for (const enName of enNames) {
                const langs = getRoleAllLangs(enName)
                const chineseName = langs[CHINESE_LANG]
                if (!chineseName) continue
                if (!fs.existsSync(path.join(GENSHIN_CHARACTER_DIR, chineseName))) continue
                names.push(chineseName)
                data[chineseName] = { enName, langs }
            }

            cachedRoleNames = names
            cachedRoleData = data
            logger?.info(`[多语言猜角色] 缓存了 ${names.length} 个角色（本地有目录）的多语言名`)
            return { names, data }
        }).catch(err => {
            logger?.error('[多语言猜角色] 加载角色数据失败', err)
            throw err
        }).finally(() => {
            cacheLoading = null
        })
    }
    return cacheLoading
}

let updateTaskStarted = false

function updateGenshinDb() {
    return new Promise(resolve => {
        logger?.info('[多语言猜角色] 开始自动更新 genshin-db...')
        exec(
            'npm install genshin-db@latest --no-audit --no-fund',
            { cwd: PLUGIN_ROOT, timeout: 300000 },
            error => {
                if (error) {
                    logger?.error('[多语言猜角色] genshin-db 更新失败', error.message)
                    resolve(false)
                    return
                }
                logger?.info('[多语言猜角色] genshin-db 已更新到磁盘；当前进程仍使用已加载版本，重启云崽后生效')
                resolve(true)
            }
        )
    })
}

function startWeeklyUpdateTask() {
    if (updateTaskStarted) return
    updateTaskStarted = true
    cron.schedule('0 0 3 * * 5', () => updateGenshinDb(), {
        timezone: 'Asia/Shanghai'
    })
    logger?.info('[多语言猜角色] 已启动每周五 03:00 自动更新 genshin-db 的定时任务')
}

startWeeklyUpdateTask()
