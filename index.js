// ============================================================
// 插件入口
// 只导出 Guess 主插件类，避免把 apps 中的工具函数误当成插件实例化。
// ============================================================

import Guess from './apps/guess.js'

const apps = { guess: Guess }

logger.info('------(ˊ·ω·ˋ)------');
logger.info('guess-plugin载入成功!');
logger.info('仓库地址 https://github.com/Small-JiaJia/guess-plugin.git');
logger.info('Created By 小佳佳');
logger.info('-------------------');

export { apps };
