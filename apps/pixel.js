// ============================================================
// 模块：像素猜角色 (pixel)
// 职责：将立绘转为 8x8 像素马赛克，让群友猜角色
// 路径：./plugins/guess-plugin/apps/pixel.js
// 依赖：core, image, sharp
// ============================================================

import sharp from 'sharp'
import {
    games, recentlyUsed,
    loadRoleData,
    randomItem,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, COOLDOWN_MS,
    getExtraData
} from './core.js'
import {
    checkImageExists,
    getImagePath
} from './image.js'

// 分辨率阶梯（网格数），从小到大：8 → 12 → 16 → 24 → 32
export const GRID_STAGES = [8, 12, 16, 24, 32]

// 输出图片边长
const OUTPUT_SIZE = 400
// 背景颜色（白色）
const BG_COLOR = '#ffffff'

/**
 * 生成像素化图片（核心算法）
 * 原理：先缩小到 grid×grid（nearest 插值，PNG 无损），
 *       再放大到 outputSize×outputSize（nearest 插值，输出 WebP）。
 * 关键点：两次 resize 都必须使用 kernel: 'nearest'，
 *        否则默认的 lanczos 会平滑过渡，看起来就像"处理过的原图"。
 * @param {string} imagePath - 原图路径
 * @param {number} grid - 网格数（如 8、12、16...）
 * @param {number} outputSize - 输出边长
 * @param {string} bgColor - 背景色（十六进制）
 * @returns {Promise<Buffer>}
 */
async function generatePixelImage(imagePath, grid, outputSize = OUTPUT_SIZE, bgColor = BG_COLOR) {
    // 第一步：缩小到 grid×grid（无损 PNG）
    const smallBuffer = await sharp(imagePath)
        .flatten({ background: bgColor })            // 透明区域填充背景色
        .resize(grid, grid, {
            kernel: 'nearest',                       // 关键：最近邻插值
            fit: 'fill'
        })
        .png()                                       // PNG 保证颜色不丢
        .toBuffer()

    // 第二步：放大到 outputSize（nearest 保证方块边缘锐利）
    return await sharp(smallBuffer)
        .resize(outputSize, outputSize, {
            kernel: 'nearest',
            fit: 'fill'
        })
        .webp({ quality: 90 })
        .toBuffer()
}

/**
 * 启动像素猜角色游戏
 */
export async function startPixelGame(e) {
    const groupId = e.group_id
    if (!groupId) return false
    return withGameStartLock(groupId,
        () => e.reply('当前群已有游戏，请先结束或等待超时'),
        () => startPixelGameReserved(e, groupId)
    )
}

async function startPixelGameReserved(e, groupId) {
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    // 固定使用立绘（splash）
    const mode = 'splash'
    const now = Date.now()
    const imageNames = loadedNames.filter(name => checkImageExists(mode, name))
    const allAvailable = imageNames.filter(name => !isRoleReserved(name))
    if (imageNames.length === 0) {
        await e.reply('未找到可用的立绘图片，请检查资源')
        return false
    }
    if (allAvailable.length === 0) {
        await e.reply('所有可用角色正在生成游戏，请稍后重试')
        return false
    }
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        availableNames = allAvailable
        logger?.info('[猜角色] 像素猜角色候选均在冷却中，本次从全部候选中选择')
    }

    if (availableNames.length === 0) {
        await e.reply('未找到可用的立绘图片，请检查资源')
        return false
    }

    const name = randomItem(availableNames)
    return withRoleReservation(name, commitRole => startPixelGameForRole(e, groupId, name, commitRole))
}

async function startPixelGameForRole(e, groupId, name, commitRole) {
    const extra = getExtraData(name)
    if (!extra) {
        await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
        return false
    }

    const imgPath = getImagePath('splash', name)
    if (!imgPath) {
        await e.reply(`未找到 ${name} 的立绘图片`)
        return false
    }

    // 初始分辨率（8x8）
    const initialGrid = GRID_STAGES[0]
    let pixelBuffer
    try {
        pixelBuffer = await generatePixelImage(imgPath, initialGrid, OUTPUT_SIZE, BG_COLOR)
    } catch (err) {
        logger?.error('[像素猜角色] 生成像素图失败', err)
        await e.reply(`生成像素图失败：${err.message}`)
        return false
    }

    // 保存游戏状态
    const game = {
        mode: 'pixel',
        name,
        imgPath,
        startedAt: Date.now(),
        groupId,
        extra,
        isPixelMode: true,           // 标记：像素模式
        originalPath: imgPath,
        currentGridIndex: 0,         // 当前分辨率索引（0 → 8x8）
    }
    games.set(groupId, game)

    try {
        await replyOrThrow(e, [
            segment.image(pixelBuffer),
            `\n🧱 ${initialGrid}x${initialGrid} 像素化立绘，猜猜这是谁？\n发送 #提示 提升分辨率，直接发送角色名作答`
        ])
        commitRole()
        logger?.info(`[像素猜角色] 群${groupId} 开始游戏，角色: ${name}，初始分辨率: ${initialGrid}x${initialGrid}`)
    } catch (err) {
        logger?.error('[像素猜角色] 发送图片失败', err)
        games.delete(groupId)
        await e.reply(`发送图片失败：${err.message}`)
        return false
    }
    return true
}

/**
 * 处理像素模式的 #提示：提升一格分辨率
 * @param {object} game - 游戏状态对象
 * @param {string} groupId - 群号
 * @returns {{buffer: Buffer|null, message: string}}
 */
export async function handlePixelHint(game) {
    // 已到达最高清晰度
    if (game.currentGridIndex >= GRID_STAGES.length - 1) {
        return {
            buffer: null,
            message: '🔍 已是最高清晰度（32x32），请作答或发送 #看答案'
        }
    }

    const nextGridIndex = game.currentGridIndex + 1
    const newGrid = GRID_STAGES[nextGridIndex]

    try {
        const buffer = await generatePixelImage(game.imgPath, newGrid, OUTPUT_SIZE, BG_COLOR)
        return {
            buffer,
            nextGridIndex,
            message: `🧱 分辨率已提升至 ${newGrid}x${newGrid}（第 ${nextGridIndex + 1}/${GRID_STAGES.length} 级）`
        }
    } catch (err) {
        logger?.error('[像素猜角色] 生成提示图失败', err)
        return {
            buffer: null,
            message: `生成提示图失败：${err.message}`
        }
    }
}

/**
 * 揭晓答案时使用：返回原图缩略图（可选，用于扩展对比图）
 */
export async function renderPixelReveal(game) {
    if (!game.originalPath) return null
    try {
        return await sharp(game.originalPath)
            .flatten({ background: BG_COLOR })
            .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'inside' })
            .webp({ quality: 90 })
            .toBuffer()
    } catch (err) {
        logger?.error('[像素猜角色] 生成揭晓图失败', err)
        return null
    }
}
