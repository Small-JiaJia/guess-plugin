// ============================================================
// 模块：图像处理 (image)
// 职责：图片素材路径、裁剪、提示和揭晓图
// 碎碎冰片段算法位于 ./internal/image-puzzle.js
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { puzzleGames, randomItem, shuffleArray } from './core.js'
import { renderPuzzleState } from './internal/image-puzzle.js'
export { generateVoronoiFragments, renderPuzzleState, renderPuzzleReveal } from './internal/image-puzzle.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')

function getConstellationIconPaths(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
    if (!fs.existsSync(dir)) return []

    return Array.from({ length: 6 }, (_, index) => path.join(dir, `cons-${index + 1}.webp`))
        .filter(filePath => fs.existsSync(filePath))
}

// ---------- 图片路径获取（支持默认和特殊立绘随机） ----------
export function getImagePath(mode, name, fixedPath = null) {
    if (fixedPath) {
        if (fs.existsSync(fixedPath)) return fixedPath
        return null
    }

    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }

    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(p) ? p : null
    }

    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        return randomItem(getConstellationIconPaths(name)) || null
    }

    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        return path.join(dir, randomItem(files))
    }

    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha',
        'puzzle': 'splash',
    }

    const baseName = fileNameMap[mode]
    if (!baseName) return null

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return null

    const available = []
    const specialModes = ['avatar', 'avatar_side', 'splash', 'puzzle']
    const candidates = [`${baseName}.webp`]
    if (specialModes.includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        const p = path.join(imgsDir, candidate)
        if (fs.existsSync(p)) available.push(p)
    }

    if (available.length === 0) return null
    return randomItem(available)
}

// ---------- 检查图片是否存在 ----------
export function checkImageExists(mode, name) {
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(filePath)
    }
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        return getConstellationIconPaths(name).length > 0
    }
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return false
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        return files.length > 0
    }
    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha',
        'puzzle': 'splash',
    }
    const baseName = fileNameMap[mode]
    if (!baseName) return false

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return false

    const candidates = [`${baseName}.webp`]
    if (['avatar', 'avatar_side', 'splash', 'puzzle'].includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(imgsDir, candidate))) return true
    }
    return false
}

// ---------- 获取固定图标路径 ----------
export function getFixedIconPath(mode, name) {
    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(p) ? p : null
    }
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        return randomItem(getConstellationIconPaths(name)) || null
    }
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        return path.join(dir, randomItem(files))
    }
    return getImagePath(mode, name)
}

// ---------- 生日贺图辅助函数 ----------
export function hasBirthdayImages(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return false
    const files = fs.readdirSync(dir)
    return files.some(f => /^Birthday-\d+\.(webp|png|jpg|jpeg)$/i.test(f))
}

export function getRandomBirthdayImage(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter(f => /^Birthday-\d+\.(webp|png|jpg|jpeg)$/i.test(f))
    if (files.length === 0) return null
    const selected = randomItem(files)
    const match = selected.match(/Birthday-(\d+)\./i)
    const year = match ? parseInt(match[1]) : null
    return { filePath: path.join(dir, selected), year }
}

export function getBirthdayImagePath(name, year) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    const exts = ['.webp', '.png', '.jpg', '.jpeg']
    for (const ext of exts) {
        const p = path.join(dir, `Birthday-${year}${ext}`)
        if (fs.existsSync(p)) return p
    }
    return null
}

// ---------- 图像生成核心（裁剪 / 拼图） ----------
export async function generateCrop(game) {
    const { mode, name, iconPath, imgPath } = game

    // 剪影模式：直接返回已缓存的剪影图
    if (game.shadowMode) {
        if (!game.shadowBuffer) {
            throw new Error('剪影图未生成')
        }
        return game.shadowBuffer
    }

    // 命座/天赋/料理模式：直接使用固定图片（不裁剪）
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard' ||
        mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard' ||
        mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        if (!iconPath || !fs.existsSync(iconPath)) {
            throw new Error(`图片不存在: ${name}`)
        }
        const image = sharp(iconPath)
        return await image.webp({ quality: 90 }).toBuffer()
    }

    // ★ 碎碎冰模式：返回当前拼图状态
    if (mode === 'puzzle') {
        // 从 puzzleGames 获取状态
        const puzzleState = puzzleGames.get(game.groupId)
        if (!puzzleState) {
            throw new Error('拼图状态不存在，请重新开始游戏')
        }
        return await renderPuzzleState(
            puzzleState.fragments,
            puzzleState.originalWidth,
            puzzleState.originalHeight
        )
    }

    // 普通模式（头像/立绘/角色/生日贺图）：裁剪局部
    let filePath = imgPath || iconPath
    if (!filePath) throw new Error(`图片不存在: ${name}`)

    let image = sharp(filePath)

    // 获取元数据，若失败则尝试 PNG 中转
    let metadata
    try {
        metadata = await image.metadata()
    } catch (metaErr) {
        logger?.warn(`[猜角色] 获取图片元数据失败，尝试 PNG 中转: ${metaErr.message}`)
        const pngBuffer = await image.png().toBuffer()
        metadata = await sharp(pngBuffer).metadata()
        image = sharp(pngBuffer)
    }

    const w = metadata.width, h = metadata.height
    if (!w || !h) throw new Error('图片尺寸无效')

    // 初始化裁剪参数（如果尚未初始化）
    if (!game.cropSide) {
        const shortSide = Math.min(w, h)
        let ratio = 0.25
        if (mode === 'splash' || mode === 'birthday') {
            ratio = 0.10   // 立绘和生日贺图使用更小裁剪
        }
        const side = Math.min(shortSide, Math.max(50, Math.round(shortSide * ratio)))

        // 智能裁剪：立绘和生日贺图使用内容感知算法
        if (mode === 'splash' || mode === 'birthday') {
            const isBirthday = (mode === 'birthday')
            const cornerMargin = isBirthday ? 0.15 : 0.0

            // ---- 候选生成（带距离约束和四角排除） ----
            const minDistance = Math.max(30, side * 1.2)
            let candidates = []
            let attempts = 0
            const maxAttempts = 200

            while (candidates.length < 30 && attempts < maxAttempts) {
                attempts++
                const maxX = w - side
                const maxY = h - side
                let x = Math.round(Math.random() * Math.max(0, maxX))
                let y = Math.round(Math.random() * Math.max(0, maxY))

                if (isBirthday) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    const inCorner = (
                        (cx < w * cornerMargin && cy < h * cornerMargin) ||
                        (cx > w * (1 - cornerMargin) && cy < h * cornerMargin) ||
                        (cx < w * cornerMargin && cy > h * (1 - cornerMargin)) ||
                        (cx > w * (1 - cornerMargin) && cy > h * (1 - cornerMargin))
                    )
                    if (inCorner) continue
                }

                let tooClose = false
                if (game.shownBounds && game.shownBounds.length > 0) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    for (const bounds of game.shownBounds) {
                        const bcx = bounds.left + bounds.width / 2
                        const bcy = bounds.top + bounds.height / 2
                        const dist = Math.sqrt((cx - bcx) ** 2 + (cy - bcy) ** 2)
                        if (dist < minDistance) {
                            tooClose = true
                            break
                        }
                    }
                }

                if (!tooClose) {
                    candidates.push({ x, y })
                }
            }

            // 候选不足时补随机
            while (candidates.length < 10) {
                const maxX = w - side
                const maxY = h - side
                let x = Math.round(Math.random() * Math.max(0, maxX))
                let y = Math.round(Math.random() * Math.max(0, maxY))
                if (isBirthday) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    const inCorner = (
                        (cx < w * cornerMargin && cy < h * cornerMargin) ||
                        (cx > w * (1 - cornerMargin) && cy < h * cornerMargin) ||
                        (cx < w * cornerMargin && cy > h * (1 - cornerMargin)) ||
                        (cx > w * (1 - cornerMargin) && cy > h * (1 - cornerMargin))
                    )
                    if (inCorner) continue
                }
                candidates.push({ x, y })
            }

            // 获取 raw 数据用于评分
            let rawData, rawInfo
            try {
                const result = await image.clone()
                    .toColorspace('srgb')
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true })
                rawData = result.data
                rawInfo = result.info
            } catch (rawErr) {
                logger?.warn(`[猜角色] raw 转换失败，尝试 PNG 中转: ${rawErr.message}`)
                const pngBuffer = await image.clone().png().toBuffer()
                const result = await sharp(pngBuffer)
                    .toColorspace('srgb')
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true })
                rawData = result.data
                rawInfo = result.info
            }

            const channels = rawInfo.channels
            if (!channels) throw new Error('无法获取图片通道数')

            let bestScore = -Infinity
            let bestPos = { x: 0, y: 0 }

            const centerX = w / 2
            const centerY = h / 2
            const maxDist = Math.sqrt(centerX * centerX + centerY * centerY)
            const edgeThreshold = side * 1.5

            const scores = []
            let varianceScores = []

            // ---- 遍历候选，计算评分 ----
            for (const cand of candidates) {
                const cx = cand.x, cy = cand.y

                let sumR = 0, sumG = 0, sumB = 0, count = 0
                const luminances = []
                const hueSet = new Set()
                let lumMin = Infinity, lumMax = -Infinity
                let sumS = 0, sumS2 = 0
                let sCount = 0

                for (let dy = 0; dy < side; dy++) {
                    for (let dx = 0; dx < side; dx++) {
                        const px = cx + dx, py = cy + dy
                        if (px >= w || py >= h) continue
                        const idx = (py * w + px) * channels
                        const alpha = rawData[idx + 3]
                        if (alpha < 128) continue  // 跳过透明像素

                        const r = rawData[idx] / 255
                        const g = rawData[idx + 1] / 255
                        const b = rawData[idx + 2] / 255
                        const lum = r * 0.299 + g * 0.587 + b * 0.114

                        sumR += rawData[idx]
                        sumG += rawData[idx + 1]
                        sumB += rawData[idx + 2]
                        count++
                        luminances.push(lum)
                        if (lum < lumMin) lumMin = lum
                        if (lum > lumMax) lumMax = lum

                        // 色相分组（12个bin）
                        const max = Math.max(r, g, b)
                        const min = Math.min(r, g, b)
                        if (max !== min) {
                            let hue = 0
                            if (max === r) hue = ((g - b) / (max - min)) % 6
                            else if (max === g) hue = 2 + (b - r) / (max - min)
                            else hue = 4 + (r - g) / (max - min)
                            const hueBin = Math.floor(((hue + 6) % 6) / 0.5)
                            hueSet.add(hueBin)
                        }

                        // 饱和度（HSV 中的 S 通道）
                        const maxRGB = Math.max(r, g, b)
                        const minRGB = Math.min(r, g, b)
                        const s = (maxRGB === 0) ? 0 : (1 - minRGB / maxRGB)
                        sumS += s
                        sumS2 += s * s
                        sCount++
                    }
                }

                if (count < side * side * 0.3) continue

                // 颜色方差
                const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count
                let varR = 0, varG = 0, varB = 0
                for (let dy = 0; dy < side; dy++) {
                    for (let dx = 0; dx < side; dx++) {
                        const px = cx + dx, py = cy + dy
                        if (px >= w || py >= h) continue
                        const idx = (py * w + px) * channels
                        if (rawData[idx + 3] < 128) continue
                        const dr = rawData[idx] - avgR
                        const dg = rawData[idx + 1] - avgG
                        const db = rawData[idx + 2] - avgB
                        varR += dr * dr
                        varG += dg * dg
                        varB += db * db
                    }
                }
                const varianceScore = varR + varG + varB
                varianceScores.push(varianceScore)

                // 纹理（亮度标准差）
                const meanLum = luminances.reduce((a, b) => a + b, 0) / luminances.length
                let varLum = 0
                for (const lum of luminances) {
                    varLum += (lum - meanLum) ** 2
                }
                const textureScore = Math.sqrt(varLum / luminances.length) / 255

                // 中心贴近度
                const regionCenterX = cx + side / 2
                const regionCenterY = cy + side / 2
                const distToCenter = Math.sqrt(
                    Math.pow(regionCenterX - centerX, 2) +
                    Math.pow(regionCenterY - centerY, 2)
                )
                const centerScore = 1 - (distToCenter / maxDist)

                // 色相多样度
                const hueDiversity = Math.min(hueSet.size / 12, 1.0)
                // 亮度对比度
                const contrastScore = Math.min((lumMax - lumMin), 1.0)
                // 饱和度方差
                const meanS = sumS / sCount
                const varS = sumS2 / sCount - meanS * meanS
                const satStd = Math.sqrt(Math.max(varS, 0))

                // 边缘惩罚（仅左/右/上，跳过底部）
                const distToLeft = regionCenterX
                const distToRight = w - regionCenterX
                const distToTop = regionCenterY
                const minDistToEdge = Math.min(distToLeft, distToRight, distToTop)
                let edgePenalty = 0
                if (minDistToEdge < edgeThreshold) {
                    edgePenalty = 1 - (minDistToEdge / edgeThreshold)
                }

                scores.push({
                    cand,
                    varianceScore,
                    textureScore,
                    centerScore,
                    hueDiversity,
                    contrastScore,
                    satStd,
                    edgePenalty
                })
            }

            // 归一化并计算最终得分
            if (varianceScores.length === 0) {
                const maxX = w - side, maxY = h - side
                game.cropX = Math.round(Math.random() * Math.max(0, maxX))
                game.cropY = Math.round(Math.random() * Math.max(0, maxY))
            } else {
                const maxVariance = Math.max(...varianceScores)
                const minVariance = Math.min(...varianceScores)
                const varianceRange = maxVariance - minVariance || 1

                const satStds = scores.map(s => s.satStd)
                const maxSat = Math.max(...satStds)
                const minSat = Math.min(...satStds)
                const satRange = maxSat - minSat || 1

                for (const item of scores) {
                    const normVariance = (item.varianceScore - minVariance) / varianceRange
                    const normSat = (item.satStd - minSat) / satRange

                    let combinedScore
                    if (mode === 'birthday') {
                        // 生日贺图专用权重
                        combinedScore =
                            normSat * 0.28 +
                            item.contrastScore * 0.28 +
                            item.centerScore * 0.24 +
                            item.hueDiversity * 0.10 +
                            item.textureScore * 0.10 -
                            item.edgePenalty * 0.10
                    } else {
                        // 立绘模式（splash）
                        combinedScore =
                            item.textureScore * 0.35 +
                            normVariance * 0.25 +
                            item.centerScore * 0.20 +
                            item.hueDiversity * 0.025 +
                            item.contrastScore * 0.025 -
                            item.edgePenalty * 0.10
                    }

                    if (combinedScore > bestScore) {
                        bestScore = combinedScore
                        bestPos = { x: item.cand.x, y: item.cand.y }
                    }
                }
                game.cropX = bestPos.x
                game.cropY = bestPos.y
            }
        } else {
            // 其他模式：纯随机
            const maxX = w - side, maxY = h - side
            game.cropX = Math.round(Math.random() * Math.max(0, maxX))
            game.cropY = Math.round(Math.random() * Math.max(0, maxY))
        }

        game.cropSide = side
        game.imageWidth = w
        game.imageHeight = h
        game.hints = 0
        if (!game.shownBounds) {
            game.shownBounds = []
        }
    }

    // 记录当前裁剪区域到历史
    const currentBounds = {
        left: game.cropX,
        top: game.cropY,
        width: game.cropSide,
        height: game.cropSide
    }
    const exists = game.shownBounds.some(b =>
        b.left === currentBounds.left && b.top === currentBounds.top &&
        b.width === currentBounds.width && b.height === currentBounds.height
    )
    if (!exists) {
        game.shownBounds.push(currentBounds)
    }

    // 执行裁剪并生成输出
    let pipeline = image.extract({
        left: game.cropX,
        top: game.cropY,
        width: game.cropSide,
        height: game.cropSide
    }).resize(360, 360, { fit: 'fill' })

    if (mode === 'hard') {
        pipeline = pipeline.grayscale()
    } else if (mode === 'hell') {
        pipeline = pipeline.negate()
    }

    return await pipeline.webp({ quality: 90 }).toBuffer()
}

// ---------- 扩大裁剪区域（用于普通模式提示） ----------
export function enlargeCrop(game) {
    const { imageWidth, imageHeight, cropX, cropY, cropSide } = game
    const minSide = Math.min(imageWidth, imageHeight)
    let newSide = Math.min(minSide, Math.round(cropSide * 1.5))
    if (newSide <= cropSide) newSide = Math.min(minSide, cropSide + 10)
    const cx = cropX + cropSide / 2, cy = cropY + cropSide / 2
    let newX = Math.round(cx - newSide / 2)
    let newY = Math.round(cy - newSide / 2)
    newX = Math.max(0, Math.min(imageWidth - newSide, newX))
    newY = Math.max(0, Math.min(imageHeight - newSide, newY))
    game.cropX = newX
    game.cropY = newY
    game.cropSide = newSide
    game.hints = (game.hints || 0) + 1

    const newBounds = {
        left: newX,
        top: newY,
        width: newSide,
        height: newSide
    }
    const exists = game.shownBounds.some(b =>
        b.left === newBounds.left && b.top === newBounds.top &&
        b.width === newBounds.width && b.height === newBounds.height
    )
    if (!exists) {
        game.shownBounds.push(newBounds)
    }

    return newSide >= minSide
}

// ---------- 普通揭晓合成图（矩形区域） ----------
export async function renderReveal(game) {
    let filePath
    if (game.mode === 'birthday') {
        if (!game.iconPath || !fs.existsSync(game.iconPath)) {
            throw new Error('生日贺图原图不存在')
        }
        filePath = game.iconPath
    } else {
        filePath = game.imgPath
        if (!filePath || !fs.existsSync(filePath)) throw new Error('原图不存在')
    }

    let image = sharp(filePath)

    // 获取 raw 数据
    let rawData, rawInfo
    try {
        const result = await image
            .toColorspace('srgb')
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true })
        rawData = result.data
        rawInfo = result.info
    } catch (rawErr) {
        logger?.warn(`[猜角色] renderReveal raw 转换失败，尝试 PNG 中转: ${rawErr.message}`)
        const pngBuffer = await image.clone().png().toBuffer()
        const result = await sharp(pngBuffer)
            .toColorspace('srgb')
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true })
        rawData = result.data
        rawInfo = result.info
    }

    const width = rawInfo.width
    const height = rawInfo.height
    const channels = rawInfo.channels
    if (!channels) throw new Error('无法获取图片通道数')

    const shownBounds = game.shownBounds || []

    // 遍历像素：裁剪区域保持原色，其余变暗
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels
            let visible = false
            for (const bounds of shownBounds) {
                if (x >= bounds.left && x < bounds.left + bounds.width &&
                    y >= bounds.top && y < bounds.top + bounds.height) {
                    visible = true
                    break
                }
            }
            if (!visible) {
                rawData[idx] = Math.round(rawData[idx] * 0.3)
                rawData[idx + 1] = Math.round(rawData[idx + 1] * 0.3)
                rawData[idx + 2] = Math.round(rawData[idx + 2] * 0.3)
            }
        }
    }

    // 为每个历史裁剪区域绘制红框
    for (const bounds of shownBounds) {
        const x1 = bounds.left
        const y1 = bounds.top
        const x2 = bounds.left + bounds.width - 1
        const y2 = bounds.top + bounds.height - 1
        for (let x = x1; x <= x2; x++) {
            const idx = (y1 * width + x) * channels
            rawData[idx] = 255; rawData[idx+1] = 0; rawData[idx+2] = 0; rawData[idx+3] = 255
            const idx2 = (y2 * width + x) * channels
            rawData[idx2] = 255; rawData[idx2+1] = 0; rawData[idx2+2] = 0; rawData[idx2+3] = 255
        }
        for (let y = y1; y <= y2; y++) {
            const idx = (y * width + x1) * channels
            rawData[idx] = 255; rawData[idx+1] = 0; rawData[idx+2] = 0; rawData[idx+3] = 255
            const idx2 = (y * width + x2) * channels
            rawData[idx2] = 255; rawData[idx2+1] = 0; rawData[idx2+2] = 0; rawData[idx2+3] = 255
        }
    }

    return sharp(rawData, { raw: { width, height, channels } })
        .webp({ quality: 90 })
        .toBuffer()
}
