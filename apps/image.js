// ============================================================
// 模块：图像处理 (image)
// 职责：所有图片生成、裁剪、Voronoi 碎片、渲染拼图和揭示图
// 依赖：sharp, d3-delaunay, fs, path, core（部分路径常量）
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Delaunay } from 'd3-delaunay'
import { randomItem, shuffleArray, readDataJson } from './core.js'  // 导入工具函数

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')

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
        const num = Math.floor(Math.random() * 6) + 1
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(p) ? p : null
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
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', 'cons-1.webp')
        return fs.existsSync(filePath)
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
        const num = Math.floor(Math.random() * 6) + 1
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(p) ? p : null
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

// ---------- ★ 碎片有效评分函数 ----------
async function calculateFragmentScore(fragmentBuffer) {
    try {
        const { data, info } = await sharp(fragmentBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true })
        const channels = info.channels
        let sumR = 0, sumG = 0, sumB = 0, count = 0
        for (let i = 0; i < data.length; i += channels) {
            const a = data[i + 3]
            if (a < 30) continue
            sumR += data[i]
            sumG += data[i + 1]
            sumB += data[i + 2]
            count++
        }
        if (count === 0) return 0
        const avgLum = (sumR + sumG + sumB) / (count * 3)
        let varR = 0, varG = 0, varB = 0
        const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count
        for (let i = 0; i < data.length; i += channels) {
            const a = data[i + 3]
            if (a < 30) continue
            const dr = data[i] - avgR
            const dg = data[i + 1] - avgG
            const db = data[i + 2] - avgB
            varR += dr * dr
            varG += dg * dg
            varB += db * db
        }
        const variance = (varR + varG + varB) / count / (255 * 255)
        const score = (avgLum / 255) * 0.6 + Math.min(variance * 10, 1) * 0.4
        return score
    } catch {
        return 0
    }
}

// ---------- 计算多边形边界框 ----------
function getPolygonBounds(polygon) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of polygon) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ---------- 生成多边形蒙版 ----------
async function generatePolygonMask(points, width, height, offset = { offsetX: 0, offsetY: 0 }) {
    let pathD = 'M'
    for (let i = 0; i < points.length; i += 2) {
        const x = points[i] - offset.offsetX
        const y = points[i + 1] - offset.offsetY
        if (i === 0) {
            pathD += `${x},${y}`
        } else {
            pathD += ` L${x},${y}`
        }
    }
    pathD += ' Z'

    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <path d="${pathD}" fill="white" />
        </svg>
    `

    return await sharp(Buffer.from(svg)).png().toBuffer()
}

// ---------- ★ Voronoi 碎片生成核心 ----------
export async function generateVoronoiFragments(imagePath, fragmentCount = 100, minScore = 0.15) {
    const image = sharp(imagePath)
    const metadata = await image.metadata()
    const { width, height } = metadata

    const points = []
    const margin = 0.05
    const boundaryPoints = [
        [width * margin, height * margin],
        [width * (1 - margin), height * margin],
        [width * margin, height * (1 - margin)],
        [width * (1 - margin), height * (1 - margin)],
        [width / 2, height * margin],
        [width / 2, height * (1 - margin)],
        [width * margin, height / 2],
        [width * (1 - margin), height / 2],
    ]
    for (let i = 0; i < fragmentCount - boundaryPoints.length; i++) {
        points.push([
            Math.random() * width * 0.9 + width * 0.05,
            Math.random() * height * 0.9 + height * 0.05,
        ])
    }
    const allPoints = [...boundaryPoints, ...points]

    const delaunay = Delaunay.from(allPoints)
    const voronoi = delaunay.voronoi([0, 0, width, height])

    const polygons = []
    for (let i = 0; i < allPoints.length; i++) {
        const cell = voronoi.cellPolygon(i)
        if (cell && cell.length >= 3) {
            const bounds = getPolygonBounds(cell)
            if (bounds.w > 0 && bounds.h > 0) {
                polygons.push({
                    id: i,
                    points: cell.flat(),
                    bounds: bounds,
                })
            }
        }
    }

    const fragments = []
    const originalImage = sharp(imagePath)

    for (const poly of polygons) {
        const { x, y, w, h } = poly.bounds
        const extractW = Math.max(1, Math.ceil(w))
        const extractH = Math.max(1, Math.ceil(h))

        try {
            const extractBuffer = await originalImage.clone()
                .extract({ left: Math.floor(x), top: Math.floor(y), width: extractW, height: extractH })
                .png()
                .toBuffer()

            const maskBuffer = await generatePolygonMask(
                poly.points,
                extractW,
                extractH,
                { offsetX: Math.floor(x), offsetY: Math.floor(y) }
            )

            const fragmentBuffer = await sharp(extractBuffer)
                .composite([{ input: maskBuffer, blend: 'dest-in' }])
                .png()
                .toBuffer()

            const score = await calculateFragmentScore(fragmentBuffer)

            const margin2 = 30
            const maxRX = width - extractW - margin2
            const maxRY = height - extractH - margin2

            fragments.push({
                id: poly.id,
                rect: { x: Math.floor(x), y: Math.floor(y), w: extractW, h: extractH },
                polygon: poly.points,
                buffer: fragmentBuffer,
                score: score,
                isRevealed: false,
                isPlaced: false,
                randomX: Math.random() * Math.max(0, maxRX) + margin2 / 2,
                randomY: Math.random() * Math.max(0, maxRY) + margin2 / 2,
            })
        } catch (err) {
            continue
        }
    }

    const filtered = fragments.filter(f => f.score >= minScore)
    if (filtered.length < Math.min(fragmentCount * 0.5, fragmentCount - 10)) {
        const retry = await generateVoronoiFragments(imagePath, fragmentCount, minScore * 0.4)
        return retry
    }

    filtered.sort((a, b) => b.score - a.score)
    const result = filtered.slice(0, fragmentCount)

    const originalImageForFill = sharp(imagePath)
    while (result.length < fragmentCount) {
        const w = Math.random() * 150 + 40
        const h = Math.random() * 150 + 40
        const x = Math.random() * (width - w)
        const y = Math.random() * (height - h)
        try {
            const extractBuffer = await originalImageForFill.clone()
                .extract({ left: Math.floor(x), top: Math.floor(y), width: Math.ceil(w), height: Math.ceil(h) })
                .png()
                .toBuffer()
            const score = await calculateFragmentScore(extractBuffer)
            result.push({
                id: result.length,
                rect: { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w), h: Math.ceil(h) },
                buffer: extractBuffer,
                score: score || 0.3,
                isRevealed: false,
                isPlaced: false,
                randomX: Math.random() * Math.max(0, width - Math.ceil(w) - 30) + 15,
                randomY: Math.random() * Math.max(0, height - Math.ceil(h) - 30) + 15,
            })
        } catch (err) {
            continue
        }
    }

    return result
}

// ---------- ★ 渲染碎碎冰当前状态 ----------
export async function renderPuzzleState(fragments, originalWidth, originalHeight) {
    const revealed = fragments.filter(f => f.isRevealed)

    if (revealed.length === 0) {
        return await sharp({
            create: {
                width: originalWidth,
                height: originalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).webp({ quality: 85 }).toBuffer()
    }

    const layers = []
    for (const frag of revealed) {
        const posX = frag.isPlaced ? frag.rect.x : frag.randomX
        const posY = frag.isPlaced ? frag.rect.y : frag.randomY
        layers.push({
            input: frag.buffer,
            left: Math.round(posX),
            top: Math.round(posY),
        })
    }

    return await sharp({
        create: {
            width: originalWidth,
            height: originalHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 }
        }
    })
        .composite(layers)
        .webp({ quality: 85 })
        .toBuffer()
}

// ---------- ★ 碎碎冰揭晓合成图 ----------
export async function renderPuzzleReveal(puzzleState) {
    const { imgPath, fragments, originalWidth, originalHeight } = puzzleState
    const revealed = fragments.filter(f => f.isRevealed)

    if (revealed.length === 0) {
        return await sharp({
            create: {
                width: originalWidth,
                height: originalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).webp({ quality: 85 }).toBuffer()
    }

    const image = sharp(imgPath)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width, height = info.height, channels = info.channels

    for (let i = 0; i < data.length; i += channels) {
        data[i] = Math.round(data[i] * 0.3)
        data[i + 1] = Math.round(data[i + 1] * 0.3)
        data[i + 2] = Math.round(data[i + 2] * 0.3)
    }

    const darkenedBuffer = await sharp(data, { raw: { width, height, channels } })
        .webp({ quality: 85 })
        .toBuffer()

    const layers = revealed.map(frag => ({
        input: frag.buffer,
        left: frag.rect.x,
        top: frag.rect.y,
        blend: 'over'
    }))

    if (layers.length === 0) return darkenedBuffer

    return await sharp(darkenedBuffer)
        .composite(layers)
        .webp({ quality: 85 })
        .toBuffer()
}

// ---------- 图像生成核心（裁剪） ----------
export async function generateCrop(game) {
    const { mode, name, iconPath, imgPath } = game

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

    // 碎碎冰模式：返回当前拼图状态
    if (mode === 'puzzle') {
        // puzzleGames 在外部引入，但该函数不直接依赖，由调用方传入 game 中已包含所需状态？
        // 注意：原代码中 generateCrop 从 puzzleGames.get(game.groupId) 获取状态，但这里我们需导入 puzzleGames
        // 为避免循环依赖，我们将在调用时传递 puzzleState 或通过 game 引用，但这里沿用原逻辑，需要导入 core 中的 puzzleGames
        // 但为了解耦，我们可以在外部处理，但暂时保持原样，引入 core 的 puzzleGames
        const { puzzleGames } = await import('./core.js')
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

    // 初始化裁剪参数
    if (!game.cropSide) {
        const shortSide = Math.min(w, h)
        let ratio = 0.25
        if (mode === 'splash' || mode === 'birthday') {
            ratio = 0.10
        }
        const side = Math.max(50, Math.round(shortSide * ratio))

        // 智能裁剪（仅立绘/生日）
        if (mode === 'splash' || mode === 'birthday') {
            const isBirthday = (mode === 'birthday')
            const cornerMargin = isBirthday ? 0.15 : 0.0

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

            let rawData, rawInfo
            try {
                const result = await image.clone()
                    .toColorspace('srgb')
                    .raw()
                    .toBuffer({ resolveWithObject: true })
                rawData = result.data
                rawInfo = result.info
            } catch (rawErr) {
                logger?.warn(`[猜角色] raw 转换失败，尝试 PNG 中转: ${rawErr.message}`)
                const pngBuffer = await image.clone().png().toBuffer()
                const result = await sharp(pngBuffer)
                    .toColorspace('srgb')
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
                        if (alpha < 128) continue

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

                        const maxRGB = Math.max(r, g, b)
                        const minRGB = Math.min(r, g, b)
                        const s = (maxRGB === 0) ? 0 : (1 - minRGB / maxRGB)
                        sumS += s
                        sumS2 += s * s
                        sCount++
                    }
                }

                if (count < side * side * 0.3) continue

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

                const meanLum = luminances.reduce((a, b) => a + b, 0) / luminances.length
                let varLum = 0
                for (const lum of luminances) {
                    varLum += (lum - meanLum) ** 2
                }
                const textureScore = Math.sqrt(varLum / luminances.length) / 255

                const regionCenterX = cx + side / 2
                const regionCenterY = cy + side / 2
                const distToCenter = Math.sqrt(
                    Math.pow(regionCenterX - centerX, 2) +
                    Math.pow(regionCenterY - centerY, 2)
                )
                const centerScore = 1 - (distToCenter / maxDist)

                const hueDiversity = Math.min(hueSet.size / 12, 1.0)
                const contrastScore = Math.min((lumMax - lumMin), 1.0)
                const meanS = sumS / sCount
                const varS = sumS2 / sCount - meanS * meanS
                const satStd = Math.sqrt(Math.max(varS, 0))

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
                        combinedScore =
                            normSat * 0.28 +
                            item.contrastScore * 0.28 +
                            item.centerScore * 0.24 +
                            item.hueDiversity * 0.10 +
                            item.textureScore * 0.10 -
                            item.edgePenalty * 0.10
                    } else {
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

// ---------- 普通揭晓合成图 ----------
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