// ============================================================
// 模块：剪影猜角色 (shadow)
// 路径：./plugins/guess-plugin/apps/shadow.js
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    games, recentlyUsed,
    loadRoleData,
    randomItem, shuffleArray,
    cleanTimeout, COOLDOWN_MS,
    getExtraData
} from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')

// ---------- 皮影戏视觉参数 ----------
const BG_COLOR = { r: 235, g: 215, b: 180 }
const DARK_COLOR = { r: 75, g: 48, b: 25 }
const LIGHT_COLOR = { r: 245, g: 225, b: 190 }
const OUTLINE_COLOR = { r: 250, g: 240, b: 215 }
const OUTLINE_WIDTH = 3
const GAMMA = 1.6
const SILHOUETTE_OPACITY = 1.0
const GLOW_ALPHA = 0.25
const GLOW_BLUR = 12
const TRIM_PADDING_RATIO = 0.03

const GRID_SIZE = 12
const CELL_FG_THRESHOLD = 0.10

// ---------- 去噪参数 ----------
const MASK_BLUR_SIGMA = 1.5              // 蒙版平滑半径
const MASK_BLUR_THRESHOLD = 200          // 平滑后的高阈值（>200 才算前景）
const COMPONENT_MIN_RATIO = 0.15         // 连通块面积至少是最大块的 15%

// ---------- 路径辅助 ----------
function checkShadowImageExists(name) {
    if (!name || typeof name !== 'string') return false
    const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'Introduction.png')
    return fs.existsSync(p)
}

function getShadowImagePath(name) {
    if (!name || typeof name !== 'string') return null
    const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'Introduction.png')
    return fs.existsSync(p) ? p : null
}

// ---------- Otsu ----------
function computeOtsu(grayBuf) {
    const hist = new Array(256).fill(0)
    for (let i = 0; i < grayBuf.length; i++) hist[grayBuf[i]]++

    const total = grayBuf.length
    let sum = 0
    for (let i = 0; i < 256; i++) sum += i * hist[i]

    let sumB = 0, wB = 0, maxVar = 0, threshold = 128
    for (let i = 0; i < 256; i++) {
        wB += hist[i]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += i * hist[i]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const betweenVar = wB * wF * (mB - mF) ** 2
        if (betweenVar > maxVar) {
            maxVar = betweenVar
            threshold = i
        }
    }
    return threshold
}

// ---------- 填平内部洞 ----------
function fillHoles(maskBuf, width, height) {
    const size = width * height
    const visited = new Uint8Array(size)
    const queue = new Int32Array(size)
    let head = 0, tail = 0

    const push = (idx) => {
        if (maskBuf[idx] === 0 && !visited[idx]) {
            visited[idx] = 1
            queue[tail++] = idx
        }
    }

    for (let x = 0; x < width; x++) {
        push(x)
        push((height - 1) * width + x)
    }
    for (let y = 0; y < height; y++) {
        push(y * width)
        push(y * width + width - 1)
    }

    while (head < tail) {
        const idx = queue[head++]
        const x = idx % width
        const y = (idx - x) / width
        if (x > 0) push(idx - 1)
        if (x < width - 1) push(idx + 1)
        if (y > 0) push(idx - width)
        if (y < height - 1) push(idx + width)
    }

    const result = Buffer.from(maskBuf)
    for (let i = 0; i < size; i++) {
        if (maskBuf[i] === 0 && !visited[i]) {
            result[i] = 255
        }
    }
    return result
}

// ---------- 连通域过滤：只保留主要连通块 ----------
function keepSignificantComponents(maskBuf, width, height, minRatio = COMPONENT_MIN_RATIO) {
    const size = width * height
    const labels = new Int32Array(size).fill(-1)
    const components = []
    let currentLabel = 0

    for (let i = 0; i < size; i++) {
        if (maskBuf[i] > 128 && labels[i] === -1) {
            const stack = [i]
            labels[i] = currentLabel
            const pixels = [i]

            while (stack.length > 0) {
                const idx = stack.pop()
                const x = idx % width
                const y = (idx - x) / width

                if (x > 0 && maskBuf[idx - 1] > 128 && labels[idx - 1] === -1) {
                    labels[idx - 1] = currentLabel
                    stack.push(idx - 1)
                    pixels.push(idx - 1)
                }
                if (x < width - 1 && maskBuf[idx + 1] > 128 && labels[idx + 1] === -1) {
                    labels[idx + 1] = currentLabel
                    stack.push(idx + 1)
                    pixels.push(idx + 1)
                }
                if (y > 0 && maskBuf[idx - width] > 128 && labels[idx - width] === -1) {
                    labels[idx - width] = currentLabel
                    stack.push(idx - width)
                    pixels.push(idx - width)
                }
                if (y < height - 1 && maskBuf[idx + width] > 128 && labels[idx + width] === -1) {
                    labels[idx + width] = currentLabel
                    stack.push(idx + width)
                    pixels.push(idx + width)
                }
            }
            components.push({ pixels })
            currentLabel++
        }
    }

    if (components.length === 0) return maskBuf

    const maxSize = Math.max(...components.map(c => c.pixels.length))
    const areaThreshold = maxSize * minRatio

    const result = Buffer.alloc(size)
    let kept = 0
    for (const comp of components) {
        if (comp.pixels.length >= areaThreshold) {
            for (const idx of comp.pixels) {
                result[idx] = 255
            }
            kept++
        }
    }
    logger?.info(`[剪影猜角色] 连通域过滤：保留 ${kept}/${components.length} 块，最大块 ${maxSize}px`)

    return result
}

// ---------- 构建蒙版（带去噪） ----------
async function buildMask(inputPath, width, height) {
    const meta = await sharp(inputPath).metadata()
    let maskBuf = null

    // 优先用 alpha
    if (meta.hasAlpha) {
        const alphaBuf = await sharp(inputPath)
            .ensureAlpha()
            .extractChannel('alpha')
            .raw()
            .toBuffer()

        let nearZero = 0, nearMax = 0
        for (let i = 0; i < alphaBuf.length; i++) {
            if (alphaBuf[i] < 32) nearZero++
            else if (alphaBuf[i] > 220) nearMax++
        }
        const total = alphaBuf.length
        const zeroRatio = nearZero / total
        const maxRatio = nearMax / total

        if (!(maxRatio > 0.99) && !(zeroRatio > 0.99)) {
            maskBuf = Buffer.alloc(total)
            for (let i = 0; i < total; i++) {
                maskBuf[i] = alphaBuf[i] > 128 ? 255 : 0
            }
            logger?.info(`[剪影猜角色] 使用 alpha 蒙版（透明 ${(zeroRatio*100).toFixed(1)}%，不透明 ${(maxRatio*100).toFixed(1)}%）`)
        }
    }

    // 亮度蒙版回退（带平滑去噪）
    if (!maskBuf) {
        const grayBuf = await sharp(inputPath)
            .resize(width, height)
            .grayscale()
            .raw()
            .toBuffer()

        const threshold = computeOtsu(grayBuf)
        const corners = [
            grayBuf[0],
            grayBuf[width - 1],
            grayBuf[(height - 1) * width],
            grayBuf[height * width - 1],
        ]
        const cornerAvg = corners.reduce((a, b) => a + b, 0) / 4
        const bgIsLight = cornerAvg > 128

        // 初始二值化
        const initialMask = Buffer.alloc(width * height)
        for (let i = 0; i < width * height; i++) {
            const isFg = bgIsLight ? grayBuf[i] < threshold : grayBuf[i] > threshold
            initialMask[i] = isFg ? 255 : 0
        }

        // ★ 形态学平滑：blur 后高阈值化，去掉细小噪点
        const blurred = await sharp(initialMask, { raw: { width, height, channels: 1 } })
            .blur(MASK_BLUR_SIGMA)
            .raw()
            .toBuffer()

        maskBuf = Buffer.alloc(width * height)
        for (let i = 0; i < width * height; i++) {
            maskBuf[i] = blurred[i] > MASK_BLUR_THRESHOLD ? 255 : 0
        }

        logger?.info(`[剪影猜角色] 使用亮度蒙版（阈值 ${threshold}，背景${bgIsLight ? '亮' : '暗'}，已平滑去噪）`)
    }

    // 填洞
    maskBuf = fillHoles(maskBuf, width, height)

    // ★ 连通域过滤
    maskBuf = keepSignificantComponents(maskBuf, width, height)

    // ★ 填洞一次（连通域过滤后可能又有新洞）
    maskBuf = fillHoles(maskBuf, width, height)

    return maskBuf
}

// ---------- 边界裁剪 ----------
function computeTrimBounds(maskBuf, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (maskBuf[y * width + x] > 128) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }
    if (maxX < 0) return null
    return { minX, minY, maxX, maxY }
}

// ---------- 膨胀（外描边） ----------
async function dilateMask(maskBuf, width, height, radius) {
    const blurred = await sharp(maskBuf, { raw: { width, height, channels: 1 } })
        .blur(radius)
        .raw()
        .toBuffer()
    const dilated = Buffer.alloc(width * height)
    for (let i = 0; i < width * height; i++) {
        dilated[i] = blurred[i] > 8 ? 255 : 0
    }
    return dilated
}

// ---------- 预计算 ----------
export async function prepareShadowData(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('无效的图片路径')
    }

    const meta = await sharp(inputPath).metadata()
    const W = meta.width
    const H = meta.height
    if (!W || !H) throw new Error('无法获取图片尺寸')

    const maskBuf = await buildMask(inputPath, W, H)
    const bounds = computeTrimBounds(maskBuf, W, H)
    if (!bounds) throw new Error('图片中没有检测到前景内容')

    const { minX, minY, maxX, maxY } = bounds
    const contentW = maxX - minX + 1
    const contentH = maxY - minY + 1
    const pad = Math.round(Math.max(contentW, contentH) * TRIM_PADDING_RATIO)

    const cropX = Math.max(0, minX - pad)
    const cropY = Math.max(0, minY - pad)
    const cropW = Math.min(W - cropX, contentW + pad * 2)
    const cropH = Math.min(H - cropY, contentH + pad * 2)

    const croppedMask = Buffer.alloc(cropW * cropH)
    for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
            croppedMask[y * cropW + x] = maskBuf[(cropY + y) * W + (cropX + x)]
        }
    }

    const croppedGray = await sharp(inputPath)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(cropW, cropH, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer()

    let grayMin = 255, grayMax = 0
    for (let i = 0; i < cropW * cropH; i++) {
        if (croppedMask[i] > 128) {
            const g = croppedGray[i]
            if (g < grayMin) grayMin = g
            if (g > grayMax) grayMax = g
        }
    }
    if (grayMax <= grayMin) grayMax = grayMin + 1

    return { cropW, cropH, croppedMask, croppedGray, grayMin, grayMax }
}

// ---------- 渲染剪影 ----------
export async function renderShadowImage(data, revealState) {
    if (!data || !data.croppedMask) {
        throw new Error('无效的剪影数据')
    }

    const { cropW, cropH, croppedMask, croppedGray, grayMin, grayMax } = data

    const revealMask = new Uint8Array(cropW * cropH)
    if (revealState && revealState.gridSize) {
        const { gridSize, cellRevealed } = revealState
        const cellW = cropW / gridSize
        const cellH = cropH / gridSize
        for (let gy = 0; gy < gridSize; gy++) {
            for (let gx = 0; gx < gridSize; gx++) {
                if (cellRevealed[gy * gridSize + gx]) {
                    const x0 = Math.floor(gx * cellW)
                    const x1 = Math.floor((gx + 1) * cellW)
                    const y0 = Math.floor(gy * cellH)
                    const y1 = Math.floor((gy + 1) * cellH)
                    for (let y = y0; y < y1; y++) {
                        for (let x = x0; x < x1; x++) {
                            revealMask[y * cropW + x] = 1
                        }
                    }
                }
            }
        }
    }

    const grayRange = grayMax - grayMin || 1

    const silRGBA = Buffer.alloc(cropW * cropH * 4)
    for (let i = 0; i < cropW * cropH; i++) {
        const m = croppedMask[i]
        if (m > 128) {
            let r, g, b
            if (revealMask[i]) {
                const normalized = (croppedGray[i] - grayMin) / grayRange
                const t = Math.pow(Math.max(0, Math.min(1, normalized)), GAMMA)
                r = Math.round(DARK_COLOR.r + (LIGHT_COLOR.r - DARK_COLOR.r) * t)
                g = Math.round(DARK_COLOR.g + (LIGHT_COLOR.g - DARK_COLOR.g) * t)
                b = Math.round(DARK_COLOR.b + (LIGHT_COLOR.b - DARK_COLOR.b) * t)
            } else {
                r = DARK_COLOR.r
                g = DARK_COLOR.g
                b = DARK_COLOR.b
            }
            silRGBA[i * 4] = r
            silRGBA[i * 4 + 1] = g
            silRGBA[i * 4 + 2] = b
            silRGBA[i * 4 + 3] = Math.round(255 * SILHOUETTE_OPACITY)
        }
    }
    const silPNG = await sharp(silRGBA, { raw: { width: cropW, height: cropH, channels: 4 } })
        .png().toBuffer()

    const dilated = await dilateMask(croppedMask, cropW, cropH, OUTLINE_WIDTH)
    const outlineRGBA = Buffer.alloc(cropW * cropH * 4)
    for (let i = 0; i < cropW * cropH; i++) {
        if (dilated[i] > 128 && croppedMask[i] < 128) {
            outlineRGBA[i * 4] = OUTLINE_COLOR.r
            outlineRGBA[i * 4 + 1] = OUTLINE_COLOR.g
            outlineRGBA[i * 4 + 2] = OUTLINE_COLOR.b
            outlineRGBA[i * 4 + 3] = 255
        }
    }
    const outlinePNG = await sharp(outlineRGBA, { raw: { width: cropW, height: cropH, channels: 4 } })
        .png().toBuffer()

    const glowAlpha = await sharp(croppedMask, { raw: { width: cropW, height: cropH, channels: 1 } })
        .blur(GLOW_BLUR)
        .raw()
        .toBuffer()
    const glowRGBA = Buffer.alloc(cropW * cropH * 4)
    for (let i = 0; i < cropW * cropH; i++) {
        glowRGBA[i * 4] = 255
        glowRGBA[i * 4 + 1] = 230
        glowRGBA[i * 4 + 2] = 190
        glowRGBA[i * 4 + 3] = Math.min(255, Math.round(glowAlpha[i] * GLOW_ALPHA))
    }
    const glowPNG = await sharp(glowRGBA, { raw: { width: cropW, height: cropH, channels: 4 } })
        .png().toBuffer()

    return await sharp({
        create: {
            width: cropW,
            height: cropH,
            channels: 4,
            background: { ...BG_COLOR, alpha: 1 }
        }
    })
        .composite([
            { input: glowPNG, blend: 'over' },
            { input: outlinePNG, blend: 'over' },
            { input: silPNG, blend: 'over' },
        ])
        .webp({ quality: 92 })
        .toBuffer()
}

// ---------- 统计 ----------
export function computeInnerCells(data, gridSize, cellRevealed) {
    if (!data || !data.croppedMask || !gridSize || !cellRevealed) return []

    const { cropW, cropH, croppedMask } = data
    const cellW = cropW / gridSize
    const cellH = cropH / gridSize
    const innerCells = []

    for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
            const idx = gy * gridSize + gx
            if (cellRevealed[idx]) continue
            const x0 = Math.floor(gx * cellW)
            const x1 = Math.floor((gx + 1) * cellW)
            const y0 = Math.floor(gy * cellH)
            const y1 = Math.floor((gy + 1) * cellH)
            let count = 0
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    if (croppedMask[y * cropW + x] > 128) count++
                }
            }
            const cellArea = (x1 - x0) * (y1 - y0)
            if (cellArea > 0 && count / cellArea > CELL_FG_THRESHOLD) {
                innerCells.push(idx)
            }
        }
    }
    return innerCells
}

export function countAllInnerCells(data, gridSize) {
    if (!data || !data.croppedMask || !gridSize) return 0

    const { cropW, cropH, croppedMask } = data
    const cellW = cropW / gridSize
    const cellH = cropH / gridSize
    let total = 0

    for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
            const x0 = Math.floor(gx * cellW)
            const x1 = Math.floor((gx + 1) * cellW)
            const y0 = Math.floor(gy * cellH)
            const y1 = Math.floor((gy + 1) * cellH)
            let count = 0
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    if (croppedMask[y * cropW + x] > 128) count++
                }
            }
            const cellArea = (x1 - x0) * (y1 - y0)
            if (cellArea > 0 && count / cellArea > CELL_FG_THRESHOLD) total++
        }
    }
    return total
}

// ---------- 启动 ----------
export async function startShadowGame(e) {
    if (!e || !e.group_id) return false

    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    const groupId = e.group_id

    cleanTimeout(groupId)
    if (games.has(groupId)) {
        await e.reply('当前群已有游戏，请先结束或等待超时')
        return false
    }

    const allAvailable = loadedNames.filter(name => checkShadowImageExists(name))
    if (allAvailable.length === 0) {
        await e.reply('未找到任何角色的 Introduction.png，请检查资源目录')
        return false
    }

    const now = Date.now()
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        recentlyUsed.clear()
        availableNames = allAvailable
        logger?.info('[剪影猜角色] 冷却已清空，所有角色重新可用')
    }

    const name = randomItem(availableNames)
    recentlyUsed.set(name, now)

    const extra = getExtraData(name)
    if (!extra) {
        await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
        return false
    }

    const imgPath = getShadowImagePath(name)
    if (!imgPath) {
        await e.reply(`未找到 ${name} 的 Introduction.png`)
        return false
    }

    let data
    try {
        data = await prepareShadowData(imgPath)
    } catch (err) {
        logger?.error('[剪影猜角色] 预计算失败', err)
        await e.reply(`生成剪影失败：${err.message}`)
        return false
    }

    const cellRevealed = new Array(GRID_SIZE * GRID_SIZE).fill(false)
    const totalInner = countAllInnerCells(data, GRID_SIZE)

    let buffer
    try {
        buffer = await renderShadowImage(data, { gridSize: GRID_SIZE, cellRevealed })
    } catch (err) {
        logger?.error('[剪影猜角色] 生成剪影失败', err)
        await e.reply(`生成剪影失败：${err.message}`)
        return false
    }

    const game = {
        mode: 'shadow',
        name,
        imgPath,
        startedAt: Date.now(),
        groupId,
        extra,
        isIconMode: true,
        shadowMode: true,
        shadowBuffer: buffer,
        shadowData: data,
        shadowGridSize: GRID_SIZE,
        shadowCellRevealed: cellRevealed,
        shadowTotalInner: totalInner,
    }

    const msg = '【剪影猜角色】\n请根据剪影猜角色\n\n发送 #提示 逐步揭示剪影内部，直接发送角色名作答'

    try {
        await e.reply([segment.image(buffer), '\n' + msg])
        games.set(groupId, game)
        logger?.info(`[剪影猜角色] 群${groupId} 开始游戏，角色: ${name}，内部格数: ${totalInner}`)
    } catch (err) {
        logger?.error('[剪影猜角色] 发送失败', err)
        await e.reply(`发送失败：${err.message}`)
        return false
    }
    return true
}