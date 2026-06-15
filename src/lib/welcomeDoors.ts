const WELCOME_VIRTUAL_DOORS = [
  '⚔️ 接一个小冒险任务',
  '🪙 去金币商店看看',
  '🗺️ 打开今晚地图',
  '🛡️ 领取打怪委托',
  '🎒 整理随机背包',
  '🐉 翻开怪物图鉴',
  '🚪 进入雾里副本',
  '🎲 掷一次剧情骰子',
  '🏰 逛逛云端小镇',
  '✨ 捡一枚发光金币',
];

const WELCOME_MEDIA_DOORS = [
  '💿 推荐一首夜路歌',
  '🎬 放映一部午夜电影',
  '📚 抽一本今晚的书',
  '📻 打开午夜电台',
  '🌃 开始霓虹夜行',
  '📝 写个随机小故事',
  '🎞️ 生成电影开场',
  '🎧 配一段夜行BGM',
  '🍿 推荐一部怪电影',
  '🕯️ 讲个温柔短篇',
];

const WELCOME_MOOD_DOORS = [
  '🫧 生成今日心情怪',
  '☕ 随便聊点轻松的',
  '🌙 今天适合发呆吗',
  '🎐 抽一枚今日小签',
  '🧊 给情绪降降温',
  '🍰 给我一个甜点脑洞',
  '🧭 今天从哪儿开始',
  '🌧️ 给坏心情找出口',
  '🪴 说点舒服的小事',
  '🧃 来点低压闲聊',
];

const pickRandomItem = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const shuffleItems = <T>(items: readonly T[]) => [...items].sort(() => Math.random() - 0.5);

export function buildWelcomeDoorOptions() {
  return shuffleItems([
    pickRandomItem(WELCOME_VIRTUAL_DOORS),
    pickRandomItem(WELCOME_MEDIA_DOORS),
    pickRandomItem(WELCOME_MOOD_DOORS),
  ]);
}
