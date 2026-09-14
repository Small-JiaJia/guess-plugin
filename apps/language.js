// ============================================================
// 模块：多语言猜角色 (language)
// 职责：显示角色 face.webp，从 6 个不同语言的名称中选出正确的
// 路径：./plugins/guess-plugin/apps/language.js
// 依赖：core, genshin-db, node-cron, sharp, fs, path
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import genshindb from 'genshin-db'
import cron from 'node-cron'
import {
    games, recentlyUsed,
    randomItem, shuffleArray,
    cleanTimeout, COOLDOWN_MS,
    getExtraData
} from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')
const PLUGIN_ROOT = path.join(__dirname, '..')

// ---------- 常量 ----------
const OPTION_COUNT = 6
const CHINESE_LANG = 'ChineseSimplified'
const CHINESE_CORRECT_RATE = 0.05
const SAME_LANG_RATE = 0.10

const FIXED_LANGS = ['ChineseSimplified', 'English', 'Japanese', 'Korean', 'Russian']
const EXTRA_LANGS = ['German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']
const SAME_LANG_POOL = ['English', 'Japanese', 'Korean', 'Russian', 'German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']

const ALL_LANGS = [
    'ChineseSimplified', 'ChineseTraditional', 'English', 'Japanese', 'Korean',
    'Russian', 'German', 'Spanish', 'French', 'Indonesian', 'Portuguese',
    'Thai', 'Vietnamese'
]

// ---------- 缓存 ----------
// 结构：{ names: [中文名...], data: { 中文名: { enName, langs: {lang: name} } } }
let cachedRoleNames = null
let cachedRoleData = null
let cacheLoading = false

// ============================================================
// 1. 数据加载与缓存
// ============================================================

/**
 * 查询单个角色（用英文名）在所有语言下的名字
 */
function getRoleAllLangs(roleEnName) {
    const result = {}
    for (const lang of ALL_LANGS) {
        genshindb.setOptions({ resultLanguage: lang })
        const data = genshindb.characters(roleEnName)
        if (data && data.name) {
            result[lang] = data.name
        }
    }
    genshindb.setOptions({ resultLanguage: 'English' })
    return result
}

/**
 * 加载所有角色（以中文名为键）的多语言名到缓存
 */
async function loadAllRoleData(forceRefresh = false) {
    if (cachedRoleNames && cachedRoleData && !forceRefresh) {
        return { names: cachedRoleNames, data: cachedRoleData }
    }
    if (cacheLoading) {
        while (cacheLoading) await new Promise(r => setTimeout(r, 200))
        return { names: cachedRoleNames, data: cachedRoleData }
    }
    cacheLoading = true
    try {
        // genshin-db 返回英文名列表
        const enNames = genshindb.characters('names', { matchCategories: true }) || []
        const names = []
        const data = {}

        for (const enName of enNames) {
            const langs = getRoleAllLangs(enName)
            const chineseName = langs[CHINESE_LANG]
            if (!chineseName) continue

            // ★ 只有本地有对应中文目录的角色才纳入
            if (!fs.existsSync(path.join(GENSHIN_CHARACTER_DIR, chineseName))) continue

            names.push(chineseName)
            data[chineseName] = {
                enName,
                langs,
            }
        }

        cachedRoleNames = names
        cachedRoleData = data
        logger?.info(`[多语言猜角色] 缓存了 ${names.length} 个角色（本地有目录）的多语言名`)
    } catch (err) {
        logger?.error('[多语言猜角色] 加载角色数据失败', err)
        throw err
    } finally {
        cacheLoading = false
    }
    return { names: cachedRoleNames, data: cachedRoleData }
}

// ============================================================
// 2. 自动更新逻辑（每周五凌晨 3 点）
// ============================================================

let updateTaskStarted = false

function updateGenshinDb() {
    return new Promise((resolve) => {
        logger?.info('[多语言猜角色] 开始自动更新 genshin-db...')
        exec(
            'npm install genshin-db@latest --no-audit --no-fund',
            { cwd: PLUGIN_ROOT, timeout: 300000 },
            (error) => {
                if (error) {
                    logger?.error('[多语言猜角色] genshin-db 更新失败', error.message)
                    resolve(false)
                    return
                }
                logger?.info('[多语言猜角色] genshin-db 更新成功')
                cachedRoleNames = null
                cachedRoleData = null
                resolve(true)
            }
        )
    })
}

function startWeeklyUpdateTask() {
    if (updateTaskStarted) return
    updateTaskStarted = true
    // 每周五 03:00（Asia/Shanghai）
    cron.schedule('0 0 3 * * 5', () => {
        updateGenshinDb()
    }, {
        timezone: 'Asia/Shanghai'
    })
    logger?.info('[多语言猜角色] 已启动每周五 03:00 自动更新 genshin-db 的定时任务')
}

startWeeklyUpdateTask()

// ============================================================
// 3. 辅助函数
// ============================================================

function hasFaceImage(chineseName) {
    const p = path.join(GENSHIN_CHARACTER_DIR, chineseName, 'imgs', 'face.webp')
    return fs.existsSync(p)
}

function getFaceImagePath(chineseName) {
    const p = path.join(GENSHIN_CHARACTER_DIR, chineseName, 'imgs', 'face.webp')
    return fs.existsSync(p) ? p : null
}

function getAvailableLangs(langsObj) {
    return Object.keys(langsObj).filter(k =>
        langsObj[k] && String(langsObj[k]).trim() !== ''
    )
}

// ============================================================
// 4. 启动多语言猜角色
// ============================================================

export async function startLanguageGame(e) {
    let roleNames, roleData
    try {
        const data = await loadAllRoleData()
        roleNames = data.names
        roleData = data.data
    } catch (err) {
        await e.reply('角色数据加载失败，请检查 genshin-db 依赖是否安装')
        return false
    }

    if (!roleNames || roleNames.length === 0) {
        await e.reply('未获取到角色数据，请检查 genshin-db 或本地资源目录')
        return false
    }

    const groupId = e.group_id
    if (!groupId) return false

    cleanTimeout(groupId)
    if (games.has(groupId)) {
        await e.reply('当前群已有游戏，请先结束或等待超时')
        return false
    }

    // ★ 以中文名为主键；只保留本地有 face.webp 的
    const available = roleNames.filter(name => hasFaceImage(name))
    if (available.length < OPTION_COUNT + 1) {
        await e.reply(`可用角色不足（需至少 ${OPTION_COUNT + 1} 个，当前 ${available.length} 个），请检查资源目录`)
        return false
    }

    // 冷却过滤（用中文名做键）
    const now = Date.now()
    let cooled = available.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (cooled.length < OPTION_COUNT + 1) {
        recentlyUsed.clear()
        cooled = available
    }

    // 选目标角色（中文名）
    const targetName = randomItem(cooled)
    recentlyUsed.set(targetName, now)
    const targetLangs = roleData[targetName].langs
    const targetAvailableLangs = getAvailableLangs(targetLangs)

    // ========== 1. 判断恶趣味模式 ==========
    const isSameLangMode = Math.random() < SAME_LANG_RATE

    // ========== 2. 确定 6 个选项的语言 ==========
    let optionLangs = []
    let correctLang

    if (isSameLangMode) {
        const candidateSameLangs = SAME_LANG_POOL.filter(l =>
            targetAvailableLangs.includes(l)
        )
        const sameLang = candidateSameLangs.length > 0
            ? randomItem(candidateSameLangs)
            : randomItem(SAME_LANG_POOL)

        optionLangs = Array(OPTION_COUNT).fill(sameLang)
        correctLang = sameLang
        logger?.info(`[多语言猜角色] 触发恶趣味模式，全部选项语言: ${sameLang}`)
    } else {
        if (Math.random() < CHINESE_CORRECT_RATE && targetAvailableLangs.includes(CHINESE_LANG)) {
            correctLang = CHINESE_LANG
        } else {
            const nonChineseFixed = ['English', 'Japanese', 'Korean', 'Russian']
            const candidates = [...nonChineseFixed, ...EXTRA_LANGS].filter(l =>
                targetAvailableLangs.includes(l)
            )
            correctLang = candidates.length > 0 ? randomItem(candidates) : CHINESE_LANG
        }

        const randomExtraLang = randomItem(EXTRA_LANGS)
        const base = new Set([...FIXED_LANGS, randomExtraLang])
        if (!base.has(correctLang)) {
            base.delete(randomExtraLang)
            base.add(correctLang)
        }
        optionLangs = Array.from(base).slice(0, OPTION_COUNT)

        if (optionLangs.length > OPTION_COUNT) {
            optionLangs = optionLangs.filter((l, i) =>
                l === correctLang || i < OPTION_COUNT
            )
            while (optionLangs.length > OPTION_COUNT) {
                const idx = optionLangs.findIndex(l => l !== correctLang)
                optionLangs.splice(idx, 1)
            }
        }
    }

    // ========== 3. 构建 6 个选项 ==========
    const options = []
    const usedRoles = new Set([targetName])
    const usedNames = new Set()

    // 正确选项
    const correctName = targetLangs[correctLang]
    if (correctName) {
        options.push({
            name: correctName,
            lang: correctLang,
            role: targetName,
            isCorrect: true,
        })
        usedNames.add(correctName)
    }

    // 干扰项语言槽位
    let langSlots = []
    if (isSameLangMode) {
        for (let i = 0; i < OPTION_COUNT - 1; i++) {
            langSlots.push(optionLangs[i])
        }
    } else {
        for (const l of optionLangs) {
            if (l === correctLang) continue
            langSlots.push(l)
        }
    }

    for (const lang of langSlots) {
        const pool = roleNames.filter(n =>
            !usedRoles.has(n) && roleData[n].langs[lang]
        )
        let found = false

        for (let attempt = 0; attempt < 300 && pool.length > 0; attempt++) {
            const otherName = randomItem(pool)
            const name = roleData[otherName].langs[lang]
            if (!name || usedNames.has(name)) continue
            options.push({
                name,
                lang,
                role: otherName,
                isCorrect: false,
            })
            usedRoles.add(otherName)
            usedNames.add(name)
            found = true
            break
        }

        if (!found) {
            for (let attempt = 0; attempt < 300; attempt++) {
                const otherName = randomItem(roleNames)
                if (otherName === targetName) continue
                const name = roleData[otherName].langs[lang]
                if (!name || usedNames.has(name)) continue
                options.push({
                    name,
                    lang,
                    role: otherName,
                    isCorrect: false,
                })
                usedNames.add(name)
                found = true
                break
            }
        }

        if (!found) {
            logger?.warn(`[多语言猜角色] 无法为语言 ${lang} 找到干扰项`)
        }
    }

    if (options.length < OPTION_COUNT) {
        await e.reply('生成选项失败（干扰项不足），请重试')
        return false
    }
    if (options.length > OPTION_COUNT) {
        options.length = OPTION_COUNT
    }

    shuffleArray(options)

    // ========== 4. 生成头像 ==========
    const imgPath = getFaceImagePath(targetName)
    if (!imgPath) {
        await e.reply(`未找到 ${targetName} 的头像图片`)
        return false
    }

    let imgBuffer
    try {
        imgBuffer = await sharp(imgPath).webp({ quality: 90 }).toBuffer()
    } catch (err) {
        logger?.error('[多语言猜角色] 生成图片失败', err)
        await e.reply(`生成图片失败：${err.message}`)
        return false
    }

    // ========== 5. 保存游戏状态 ==========
    const game = {
        mode: 'language',
        name: targetName,
        imgPath,
        options,
        startedAt: Date.now(),
        groupId,
        extra: getExtraData(targetName),
        isLanguageMode: true,
    }
    games.set(groupId, game)

    // ========== 6. 组装并发送题目 ==========
    const letters = ['A', 'B', 'C', 'D', 'E', 'F']
    let title = isSameLangMode ? '【多语言猜角色 · 恶趣味】' : '【多语言猜角色】'
    let msg = `${title}\n图片中的角色是？\n\n`
    options.forEach((opt, i) => {
        msg += `${letters[i]}. ${opt.name}\n`
    })
    msg += `\n发送 A-F 中对应字母作答（不分大小写）`

    try {
        await e.reply([segment.image(imgBuffer), '\n' + msg])
        const correctLetter = letters[options.findIndex(o => o.isCorrect)]
        logger?.info(`[多语言猜角色] 群${groupId} 开始游戏，角色: ${targetName}，正确选项: ${correctLetter}（${correctLang}）${isSameLangMode ? ' [恶趣味]' : ''}`)
    } catch (err) {
        logger?.error('[多语言猜角色] 发送题目失败', err)
        games.delete(groupId)
        return false
    }
    return true
}