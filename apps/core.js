// ============================================================
// 模块：核心工具入口
// 职责：重导出游戏状态、数据服务与通用工具
// ============================================================

export {
    games, puzzleGames, recentlyUsed, GAME_TIMEOUT, COOLDOWN_MS,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, cleanPuzzleGame, cleanTimeout
} from './internal/game-state.js'
export {
    roleNames, aliasMap, birthdayMessages,
    loadRoleData, loadBirthdayMessages, readDataJson, getExtraData, getBirthdayMessage
} from './internal/game-data.js'

// ---------- 工具函数 ----------
export function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}

// ---------- 获取生日完整日期 ----------
export function getBirthDateString(json) {
    if (!json || !json.birth) return null
    const parts = json.birth.split('-')
    if (parts.length !== 2) return null
    return `${parts[0]}月${parts[1]}日`
}

// ---------- 格式化贺语 ----------
export function formatBirthdayMessage(msg) {
    if (!msg) return null
    return msg.replace(/<br>/g, '\n').trim()
}
