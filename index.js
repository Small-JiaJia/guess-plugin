import fs from 'node:fs'
import {
  pluginName,
  pluginApplications
} from "./config/constant.js"

const files = fs.readdirSync(pluginApplications).filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}
logger.info('------(ˊ·ω·ˋ)------');
logger.info('guess-plugin载入成功!');
logger.info('仓库地址 https://github.com/Small-JiaJia/guess-plugin.git');
logger.info('Created By 小佳佳');
logger.info('-------------------');

export { apps };