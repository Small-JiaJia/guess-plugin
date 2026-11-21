// ============================================================
// 模块：多语言猜角色 (language)
// 职责：显示角色 face.webp，从 6 个不同语言的名称中选出正确的
// 路径：./plugins/guess-plugin/apps/language.js
// 依赖：core, language-data, sharp, fs, path
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadAllRoleData } from './internal/language-data.js'
import {
    games, recentlyUsed,
    randomItem, shuffleArray,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, COOLDOWN_MS,
    getExtraData
} from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')

// ---------- 常量 ----------
const OPTION_COUNT = 6
const CHINESE_LANG = 'ChineseSimplified'
const CHINESE_CORRECT_RATE = 0.05
const SAME_LANG_RATE = 0.10

const FIXED_LANGS = ['ChineseSimplified', 'English', 'Japanese', 'Korean', 'Russian']
const EXTRA_LANGS = ['German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']
const SAME_LANG_POOL = ['English', 'Japanese', 'Korean', 'Russian', 'German', 'Spanish', 'French', 'Indonesian', 'Portuguese', 'Thai', 'Vietnamese']

// ---------- 本地资源辅助 ----------

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
    const groupId = e.group_id
    if (!groupId) return false
    return withGameStartLock(groupId,
        () => e.reply('当前群已有游戏，请先结束或等待超时'),
        () => startLanguageGameReserved(e, groupId)
    )
}

async function startLanguageGameReserved(e, groupId) {
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

    // ★ 以中文名为主键；只保留本地有 face.webp 的
    const available = roleNames.filter(name => hasFaceImage(name))
    if (available.length < OPTION_COUNT + 1) {
        await e.reply(`可用角色不足（需至少 ${OPTION_COUNT + 1} 个，当前 ${available.length} 个），请检查资源目录`)
        return false
    }

    // 冷却过滤（用中文名做键）
    const now = Date.now()
    const unreserved = available.filter(name => !isRoleReserved(name))
    if (unreserved.length === 0) {
        await e.reply('所有可用角色正在生成游戏，请稍后重试')
        return false
    }

    let cooled = unreserved.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (cooled.length < OPTION_COUNT + 1) {
        cooled = unreserved
    }
    // 选目标角色（中文名）
    const targetName = randomItem(cooled)
    return withRoleReservation(targetName, commitRole => startLanguageGameForRole(
        e, groupId, targetName, roleNames, roleData, commitRole
    ))
}

async function startLanguageGameForRole(e, groupId, targetName, roleNames, roleData, commitRole) {
    const targetLangs = roleData[targetName].langs
    const targetAvailableLangs = getAvailableLangs(targetLangs)
    if (targetAvailableLangs.length === 0) {
        await e.reply(`角色 ${targetName} 缺少可用语言名称，无法开始游戏`)
        return false
    }

    // ========== 1. 判断恶趣味模式 ==========
    const candidateSameLangs = SAME_LANG_POOL.filter(l => targetAvailableLangs.includes(l))
    const isSameLangMode = Math.random() < SAME_LANG_RATE && candidateSameLangs.length > 0

    // ========== 2. 确定 6 个选项的语言 ==========
    let optionLangs = []
    let correctLang

    if (isSameLangMode) {
        const sameLang = randomItem(candidateSameLangs)
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
            correctLang = candidates.length > 0 ? randomItem(candidates) : randomItem(targetAvailableLangs)
        }

        const randomExtraLang = randomItem(EXTRA_LANGS)
        const base = new Set([...FIXED_LANGS, randomExtraLang])
        if (!base.has(correctLang)) {
            base.delete(randomExtraLang)
            base.add(correctLang)
        }
        optionLangs = Array.from(base).slice(0, OPTION_COUNT)

    }

    // ========== 3. 构建 6 个选项 ==========
    const options = []
    const usedRoles = new Set([targetName])
    const usedNames = new Set()

    // 正确选项
    const correctName = targetLangs[correctLang]
    if (!correctName) {
        await e.reply(`角色 ${targetName} 缺少 ${correctLang} 名称，无法生成选项`)
        return false
    }
    options.push({
        name: correctName,
        lang: correctLang,
        role: targetName,
        isCorrect: true,
    })
    usedNames.add(correctName)

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

    if (options.length !== OPTION_COUNT || options.filter(option => option.isCorrect).length !== 1) {
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
    // ========== 6. 组装并发送题目 ==========
    const letters = ['A', 'B', 'C', 'D', 'E', 'F']
    let title = isSameLangMode ? '【多语言猜角色 · 恶趣味】' : '【多语言猜角色】'
    let msg = `${title}\n图片中的角色是？\n\n`
    options.forEach((opt, i) => {
        msg += `${letters[i]}. ${opt.name}\n`
    })
    msg += `\n发送 A-F 中对应字母作答（不分大小写）`

    try {
        games.set(groupId, game)
        await replyOrThrow(e, [segment.image(imgBuffer), '\n' + msg])
        commitRole()
        const correctLetter = letters[options.findIndex(o => o.isCorrect)]
        logger?.info(`[多语言猜角色] 群${groupId} 开始游戏，角色: ${targetName}，正确选项: ${correctLetter}（${correctLang}）${isSameLangMode ? ' [恶趣味]' : ''}`)
    } catch (err) {
        logger?.error('[多语言猜角色] 发送题目失败', err)
        games.delete(groupId)
        await e.reply(`发送题目失败：${err.message}`)
        return false
    }
    return true
}
