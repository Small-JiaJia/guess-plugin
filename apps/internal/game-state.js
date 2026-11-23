export const games = new Map()
export const puzzleGames = new Map()
export const recentlyUsed = new Map()
export const GAME_TIMEOUT = 5 * 60 * 1000
export const COOLDOWN_MS = 24 * 60 * 60 * 1000

const startingGroups = new Set()
const reservedRoles = new Set()

export async function withGameStartLock(groupId, onBusy, start) {
    cleanTimeout(groupId)
    if (startingGroups.has(groupId) || games.has(groupId) || puzzleGames.has(groupId)) {
        await onBusy()
        return false
    }

    startingGroups.add(groupId)
    try {
        return await start()
    } finally {
        startingGroups.delete(groupId)
    }
}

export function isRoleReserved(name) {
    return reservedRoles.has(name)
}

export async function withRoleReservation(name, start) {
    if (!name || reservedRoles.has(name)) return false
    reservedRoles.add(name)
    try {
        return await start(() => recentlyUsed.set(name, Date.now()))
    } finally {
        reservedRoles.delete(name)
    }
}

export async function replyOrThrow(e, message) {
    const result = await e.reply(message)
    if (result === false || result == null) {
        throw new Error('消息发送失败')
    }
    return result
}

export function cleanPuzzleGame(groupId) {
    if (puzzleGames.has(groupId)) {
        const pState = puzzleGames.get(groupId)
        if (pState && pState.fragments) {
            pState.fragments = null
        }
        puzzleGames.delete(groupId)
    }
    if (games.has(groupId)) {
        games.delete(groupId)
    }
}

export function cleanTimeout(groupId) {
    const game = games.get(groupId)
    if (game && Date.now() - game.startedAt > GAME_TIMEOUT) {
        cleanPuzzleGame(groupId)
        return true
    }
    if (puzzleGames.has(groupId)) {
        const pState = puzzleGames.get(groupId)
        if (Date.now() - pState.startedAt > GAME_TIMEOUT) {
            cleanPuzzleGame(groupId)
            return true
        }
    }
    return false
}

const gameCleanupTimer = setInterval(() => {
    const groupIds = new Set([...games.keys(), ...puzzleGames.keys()])
    for (const groupId of groupIds) cleanTimeout(groupId)
}, Math.min(GAME_TIMEOUT, 60_000))
gameCleanupTimer.unref?.()
