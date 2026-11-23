import { games, puzzleGames, cleanTimeout, cleanPuzzleGame } from '../../core.js'

// ---------- 结束游戏 ----------
export async function endGame(e) {
    const groupId = e.group_id
    if (!groupId) return false
    cleanTimeout(groupId)
    const game = games.get(groupId)
    if (!game && !puzzleGames.has(groupId)) {
        await e.reply('当前没有进行中的游戏')
        return false
    }
    cleanPuzzleGame(groupId)
    await e.reply('游戏已结束')
    return true
}
