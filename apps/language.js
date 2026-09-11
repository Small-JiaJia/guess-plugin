// ============================================================
// 模块：多语言猜角色 (language)
// 职责：显示角色 face.webp，从 6 个不同语言的名称中选出正确的
// 路径：./plugins/guess-plugin/apps/language.js
// 依赖：core, sharp, fs, path
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    games, recentlyUsed,
    randomItem, shuffleArray,
    cleanTimeout, COOLDOWN_MS,
    getExtraData
} from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')
const ROLE_DICT_PATH = path.join(__dirname, '../data/roledictionary.json')

// ---------- 常量 ----------
const OPTION_COUNT = 6                       // 选项数量（A-F）
const CHINESE_LANG = 'ChineseSimplified'     // 中文键名
const CHINESE_CORRECT_RATE = 0.05            // 中文作为正确答案的概率
const SAME_LANG_RATE = 0.20                  // ★ 恶趣味概率：6 个选项全是同一非中文语言

// 固定的 5 种必出语言（正常模式）
const FIXED_LANGS = ['ChineseSimplified', 'English', 'Japanese', 'Korean', 'Russian']
// 第 6 个选项从这些语言中随机出（正常模式）
const EXTRA_LANGS = ['German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']
// 恶趣味模式可选的"同一语言"池（排除中文，避免太简单）
const SAME_LANG_POOL = ['English', 'Japanese', 'Korean', 'Russian', 'German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']

// ---------- 词典缓存 ----------
let roleDict = null
let dictLoading = false

/**
 * 加载多语言词典
 */
async function loadRoleDict() {
    if (roleDict) return roleDict
    if (dictLoading) {
        while (dictLoading) await new Promise(r => setTimeout(r, 100))
        return roleDict
    }
    dictLoading = true
    try {
        const content = fs.readFileSync(ROLE_DICT_PATH, 'utf-8')
        roleDict = JSON.parse(content)
        logger?.info(`[多语言猜角色] 加载了 ${Object.keys(roleDict).length} 个角色的多语言名`)
    } catch (err) {
        logger?.error('[多语言猜角色] 加载词典失败', err)
        roleDict = {}
    } finally {
        dictLoading = false
    }
    return roleDict
}

/**
 * 检查角色是否有 face.webp 头像
 */
function hasFaceImage(name) {
    const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'face.webp')
    return fs.existsSync(p)
}

/**
 * 获取角色 face.webp 路径
 */
function getFaceImagePath(name) {
    const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'face.webp')
    return fs.existsSync(p) ? p : null
}

/**
 * 从角色数据中获取所有非空语言名
 */
function getAvailableLangs(roleData) {
    return Object.keys(roleData).filter(k =>
        roleData[k] && String(roleData[k]).trim() !== ''
    )
}

/**
 * 启动多语言猜角色
 */
export async function startLanguageGame(e) {
    const dict = await loadRoleDict()
    const allNames = Object.keys(dict)
    if (allNames.length === 0) {
        await e.reply('多语言词典加载失败，请检查 data/roledictionary.json')
        return false
    }

    const groupId = e.group_id
    if (!groupId) return false

    cleanTimeout(groupId)
    if (games.has(groupId)) {
        await e.reply('当前群已有游戏，请先结束或等待超时')
        return false
    }

    // 过滤：有 face.webp 的角色
    const available = allNames.filter(name => hasFaceImage(name))
    if (available.length < OPTION_COUNT + 1) {
        await e.reply(`可用角色不足（需至少 ${OPTION_COUNT + 1} 个），请检查资源`)
        return false
    }

    // 冷却过滤
    const now = Date.now()
    let cooled = available.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (cooled.length < OPTION_COUNT + 1) {
        recentlyUsed.clear()
        cooled = available
    }

    // 选目标角色
    const targetName = randomItem(cooled)
    recentlyUsed.set(targetName, now)
    const targetData = dict[targetName]
    const targetLangs = getAvailableLangs(targetData)

    // ========== 1. 判断本次是否为恶趣味模式 ==========
    // 触发条件：随机命中 且 目标角色在某个非中文语言下有名字
    const isSameLangMode = Math.random() < SAME_LANG_RATE

    // ========== 2. 确定 6 个选项的语言 ==========
    let optionLangs = []
    let correctLang

    if (isSameLangMode) {
        // ★ 恶趣味：6 个选项全部为同一非中文语言
        // 从目标角色有名字的语言中挑一个，尽量选"恶趣味"味道浓的
        const candidateSameLangs = SAME_LANG_POOL.filter(l =>
            targetLangs.includes(l)
        )
        const sameLang = candidateSameLangs.length > 0
            ? randomItem(candidateSameLangs)
            : randomItem(SAME_LANG_POOL)

        optionLangs = Array(OPTION_COUNT).fill(sameLang)
        correctLang = sameLang
        logger?.info(`[多语言猜角色] 触发恶趣味模式，全部选项语言: ${sameLang}`)
    } else {
        // 正常模式：6 种不同语言
        // 先决定中文是否作为正确答案（5%）
        if (Math.random() < CHINESE_CORRECT_RATE && targetLangs.includes(CHINESE_LANG)) {
            correctLang = CHINESE_LANG
        } else {
            // 从非中文语言中选一个目标角色有名字的作为正确语言
            const nonChineseFixed = ['English', 'Japanese', 'Korean', 'Russian']
            const candidates = [...nonChineseFixed, ...EXTRA_LANGS].filter(l =>
                targetLangs.includes(l)
            )
            correctLang = candidates.length > 0 ? randomItem(candidates) : CHINESE_LANG
        }

        // 语言组合：固定 5 种 + 1 随机，确保 correctLang 一定在集合中
        const randomExtraLang = randomItem(EXTRA_LANGS)
        const base = new Set([...FIXED_LANGS, randomExtraLang])
        if (!base.has(correctLang)) {
            base.delete(randomExtraLang)
            base.add(correctLang)
        }
        optionLangs = Array.from(base).slice(0, OPTION_COUNT)

        // 集合可能多于 6（如果 correctLang 加入了），需要裁剪但保留 correctLang
        if (optionLangs.length > OPTION_COUNT) {
            // 移除一个非 correctLang 的元素
            optionLangs = optionLangs.filter((l, i) =>
                l === correctLang || i < OPTION_COUNT
            )
            // 确保长度为 6
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

    // 先把正确选项放进去（避免被去重逻辑影响）
    const correctName = targetData[correctLang]
    if (correctName) {
        options.push({
            name: correctName,
            lang: correctLang,
            role: targetName,
            isCorrect: true,
        })
        usedNames.add(correctName)
    }

    // 处理剩余的（OPTION_COUNT-1）个语言槽位
    // 注意：恶趣味模式下 optionLangs 长度为 6，但只有 1 个是 correctLang 的"正确位置"
    //      其余 5 个都是 sameLang 的干扰项，需要找同语言的其他角色
    let langSlots = []
    if (isSameLangMode) {
        // 5 个干扰位
        for (let i = 0; i < OPTION_COUNT - 1; i++) {
            langSlots.push(optionLangs[i])
        }
    } else {
        // 5 个不同语言的干扰位
        for (const l of optionLangs) {
            if (l === correctLang) continue
            langSlots.push(l)
        }
    }

    for (const lang of langSlots) {
        const pool = allNames.filter(n => !usedRoles.has(n))
        let found = false
        // 优先找未用过的角色
        for (let attempt = 0; attempt < 300 && pool.length > 0; attempt++) {
            const otherName = randomItem(pool)
            const otherData = dict[otherName]
            const name = otherData[lang]
            if (!name || String(name).trim() === '') continue
            if (usedNames.has(name)) continue
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
            // 兜底：允许角色复用，只保证名字不重复
            for (let attempt = 0; attempt < 300; attempt++) {
                const otherName = randomItem(allNames)
                if (otherName === targetName) continue
                const otherData = dict[otherName]
                const name = otherData[lang]
                if (!name || String(name).trim() === '') continue
                if (usedNames.has(name)) continue
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

    // 选项不足时兜底
    if (options.length < OPTION_COUNT) {
        await e.reply('生成选项失败（干扰项不足），请重试')
        return false
    }

    // 只保留前 OPTION_COUNT 个
    if (options.length > OPTION_COUNT) {
        options.length = OPTION_COUNT
    }

    // 打乱选项顺序
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