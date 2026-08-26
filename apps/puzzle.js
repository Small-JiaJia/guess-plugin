// ============================================================
// 模块：碎碎冰拼图 (puzzle)
// 职责：处理 #碎碎冰猜立绘 和 #碎碎冰猜角色 指令
// 依赖：core, image, sharp
// ============================================================

import sharp from 'sharp'
import {
    games, puzzleGames, recentlyUsed,
    loadRoleData,
    randomItem, shuffleArray,
    cleanTimeout, cleanPuzzleGame, COOLDOWN_MS,
    getExtraData
} from './core.js'
import {
    checkImageExists,
    getImagePath,
    generateVoronoiFragments,
    generateCrop,
    renderPuzzleReveal
} from './image.js'

// ---------- 带超时的 Promise 包装 ----------
function withTimeout(promise, ms = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('操作超时')), ms))
    ])
}

export async function startPuzzle(e) {
    // 加载角色数据
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    const groupId = e.group_id
    if (!groupId) return false

    // 清理超时游戏
    cleanTimeout(groupId)
    if (puzzleGames.has(groupId)) {
        await e.reply('当前群已有碎碎冰游戏，请先结束或等待超时')
        return false
    }

    // 解析指令：匹配 #碎碎冰猜立绘 或 #碎碎冰猜角色，可选数量
    const cmdMatch = e.msg.match(/^#碎碎冰猜(立绘|角色)\s*(\d+)?$/)
    if (!cmdMatch) return false

    const imageType = cmdMatch[1] // '立绘' 或 '角色'
    const imageMode = imageType === '立绘' ? 'splash' : 'gacha'
    const modeName = imageType === '立绘' ? '立绘' : '角色'

    let fragmentCount = 100
    if (cmdMatch[2]) {
        const num = parseInt(cmdMatch[2])
        if (num >= 20 && num <= 200) {
            fragmentCount = num
        } else {
            await e.reply('碎片数量请设置在 20~200 之间，已使用默认值 100')
        }
    }

    // 自适应归位阈值（占比 5%、10%、15%、25%、40%）
    const ratios = [0.05, 0.10, 0.15, 0.25, 0.40]
    const mergeThresholds = ratios.map(r => Math.max(3, Math.round(fragmentCount * r)))

    // 冷却过滤
    const now = Date.now()
    const allAvailable = loadedNames.filter(name => checkImageExists(imageMode, name))
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        recentlyUsed.clear()
        availableNames = allAvailable
        logger?.info(`[猜角色] 碎碎冰${modeName}冷却已清空，所有角色重新可用`)
    }

    if (availableNames.length === 0) {
        await e.reply(`未找到可用的${modeName}图片`)
        return false
    }

    // 随机选角色
    const name = randomItem(availableNames)
    recentlyUsed.set(name, now)

    // 获取角色额外信息（用于提示，但碎碎冰模式暂未使用，保留）
    const extra = getExtraData(name)
    if (!extra) {
        await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
        return false
    }

    const imgPath = getImagePath(imageMode, name)
    if (!imgPath) {
        await e.reply(`未找到 ${name} 的${modeName}图片，请检查`)
        return false
    }

    let fragments
    let originalWidth, originalHeight
    try {
        await e.reply(`⏳ 正在生成碎碎冰${modeName}碎片，请稍候…`)

        // 获取图片尺寸（带10秒超时）
        const meta = await withTimeout(sharp(imgPath).metadata(), 10000)
        originalWidth = meta.width
        originalHeight = meta.height

        // 生成 Voronoi 碎片（带60秒超时，内部也有递归深度限制）
        fragments = await withTimeout(
            generateVoronoiFragments(imgPath, fragmentCount, 0.15),
            60000
        )
        logger?.info(`[碎碎冰猜${modeName}] 已生成 ${fragments.length} 个碎片`)
    } catch (err) {
        logger?.error(`[碎碎冰猜${modeName}] 生成碎片失败`, err)
        await e.reply(`生成碎片失败：${err.message || '未知错误'}`)
        cleanPuzzleGame(groupId)
        return false
    }

    // 初始揭示 2 块碎片（随机挑选）
    const shuffled = shuffleArray([...fragments])
    for (let i = 0; i < Math.min(2, shuffled.length); i++) {
        shuffled[i].isRevealed = true
    }

    // 构建碎碎冰游戏状态
    const puzzleState = {
        fragments,
        originalWidth,
        originalHeight,
        name,
        groupId,
        startedAt: Date.now(),
        imgPath,
        extra,
        wrongCount: 0,
        mergeThresholds: mergeThresholds,
        totalCount: fragments.length,
        imageType: imageType,
    }

    puzzleGames.set(groupId, puzzleState)

    // 同时存入普通 games 映射，用于 generateCrop 获取
    const game = {
        mode: 'puzzle',
        name,
        imgPath,
        startedAt: Date.now(),
        groupId,
    }
    games.set(groupId, game)

    try {
        // 渲染初始拼图状态（带30秒超时）
        const buffer = await withTimeout(generateCrop(game), 30000)
        await e.reply([
            segment.image(buffer),
            `\n🧊 已分割为 ${fragmentCount} 块碎片（${modeName}），初始揭示 2 块（随机位置）\n猜错一次揭示 1 块并累计猜错次数，累计猜错 ${mergeThresholds.join('、')} 次时自动归位\n#提示 可额外揭示 1 块碎片（不消耗猜错次数）`
        ])
        logger?.info(`[碎碎冰猜${modeName}] 群${groupId} 开始游戏，角色: ${name}，碎片: ${fragmentCount}块`)
    } catch (err) {
        logger?.error(`[碎碎冰猜${modeName}] 发送初始碎片失败`, err)
        await e.reply(`发送碎片失败：${err.message || '未知错误'}`)
        cleanPuzzleGame(groupId)
        return false
    }
    return true
}