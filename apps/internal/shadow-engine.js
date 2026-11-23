// ============================================================
// 模块：剪影猜角色 (shadow)
// 路径：./plugins/guess-plugin/apps/shadow.js
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../../resources/genshin/character')

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

export const GRID_SIZE = 12
const CELL_FG_THRESHOLD = 0.10

// ---------- 去噪参数 ----------
const MASK_BLUR_SIGMA = 1.5
const MASK_BLUR_THRESHOLD = 200
const COMPONENT_MIN_RATIO = 0.15

// ---------- 支持的图源 ----------
// 固定文件名（角色目录下必须存在）
// ---------- 支持的图源与权重 ----------
const FIXED_SHADOW_SOURCES = {
    'portrait.png': 3,
    'Introduction.png': 3,
    'Activityillustration.png': 5,
}
const REGEX_SHADOW_SOURCES = [
    { re: /^Activityillustration\d+\.png$/i, weight: 5 },
]
// ---------- 路径辅助 ----------
// 返回该角色可用的所有图源路径
function getAvailableSourcePaths(name) {
    if (!name || typeof name !== 'string') return []
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return []

    const result = []
    const seen = new Set()
    const files = fs.readdirSync(dir)

    // 固定文件名（按权重表）
    for (const [fileName, weight] of Object.entries(FIXED_SHADOW_SOURCES)) {
        const p = path.join(dir, fileName)
        if (fs.existsSync(p)) {
            result.push({ path: p, weight })
            seen.add(fileName)
        }
    }

    // 正则匹配（未在上面出现过的文件）
    for (const file of files) {
        if (seen.has(file)) continue
        for (const { re, weight } of REGEX_SHADOW_SOURCES) {
            if (re.test(file)) {
                result.push({ path: path.join(dir, file), weight })
                seen.add(file)
                break
            }
        }
    }

    return result
}

export function checkShadowImageExists(name) {
    return getAvailableSourcePaths(name).length > 0
}

// 加权随机选图源
export function getRandomShadowImagePath(name) {
    const candidates = getAvailableSourcePaths(name)
    if (candidates.length === 0) return null

    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0)
    let r = Math.random() * totalWeight
    for (const c of candidates) {
        r -= c.weight
        if (r <= 0) return c.path
    }
    return candidates[candidates.length - 1].path
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

// ---------- 连通域过滤 ----------
function keepSignificantComponents(maskBuf, width, height, minRatio = COMPONENT_MIN_RATIO) {
    const size = width * height
    const labels = new Int32Array(size)
    const queue = new Int32Array(size)
    const componentSizes = new Uint32Array(Math.ceil(size / 2) + 1)
    let currentLabel = 0

    for (let i = 0; i < size; i++) {
        if (maskBuf[i] > 128 && labels[i] === 0) {
            const label = ++currentLabel
            let head = 0
            let tail = 0
            let componentSize = 0
            labels[i] = label
            queue[tail++] = i

            while (head < tail) {
                const idx = queue[head++]
                componentSize++
                const x = idx % width
                const y = (idx - x) / width

                if (x > 0 && maskBuf[idx - 1] > 128 && labels[idx - 1] === 0) {
                    labels[idx - 1] = label
                    queue[tail++] = idx - 1
                }
                if (x < width - 1 && maskBuf[idx + 1] > 128 && labels[idx + 1] === 0) {
                    labels[idx + 1] = label
                    queue[tail++] = idx + 1
                }
                if (y > 0 && maskBuf[idx - width] > 128 && labels[idx - width] === 0) {
                    labels[idx - width] = label
                    queue[tail++] = idx - width
                }
                if (y < height - 1 && maskBuf[idx + width] > 128 && labels[idx + width] === 0) {
                    labels[idx + width] = label
                    queue[tail++] = idx + width
                }
            }
            componentSizes[label] = componentSize
        }
    }

    if (currentLabel === 0) return maskBuf

    let maxSize = 0
    for (let label = 1; label <= currentLabel; label++) {
        if (componentSizes[label] > maxSize) maxSize = componentSizes[label]
    }
    const areaThreshold = maxSize * minRatio

    const result = Buffer.alloc(size)
    let kept = 0
    for (let label = 1; label <= currentLabel; label++) {
        if (componentSizes[label] >= areaThreshold) kept++
    }
    for (let i = 0; i < size; i++) {
        const label = labels[i]
        if (label > 0 && componentSizes[label] >= areaThreshold) {
            result[i] = 255
        }
    }
    logger?.info(`[剪影猜角色] 连通域过滤：保留 ${kept}/${currentLabel} 块，最大块 ${maxSize}px`)

    return result
}

// ---------- 构建蒙版 ----------
async function buildMask(inputPath, width, height) {
    const meta = await sharp(inputPath).metadata()
    let maskBuf = null

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

        const initialMask = Buffer.alloc(width * height)
        for (let i = 0; i < width * height; i++) {
            const isFg = bgIsLight ? grayBuf[i] < threshold : grayBuf[i] > threshold
            initialMask[i] = isFg ? 255 : 0
        }

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

    maskBuf = fillHoles(maskBuf, width, height)
    maskBuf = keepSignificantComponents(maskBuf, width, height)
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
