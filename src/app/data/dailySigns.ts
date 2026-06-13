export type DailySign = {
  title: string;
  text: string;
  image: string;
};

const image = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

export const dailySigns: DailySign[] = [
  {
    title: '把心事晒一晒',
    text: '今天适合把脑袋里的小结打开一个，不急着解决，先让它透透气。',
    image: image('photo-1500530855697-b586d89ba3ee'),
  },
  {
    title: '先把杯子倒满',
    text: '别急着给世界供电，先给自己充一点温柔的小电量。',
    image: image('photo-1490730141103-6cac27aaab94'),
  },
  {
    title: '慢一点也算前进',
    text: '今天的步子可以小，但请让它落在你真的想去的方向上。',
    image: image('photo-1519681393784-d120267933ba'),
  },
  {
    title: '给灵感留一扇窗',
    text: '别把日程排得太满，空白会偷偷长出答案。',
    image: image('photo-1470770841072-f978cf4d019e'),
  },
  {
    title: '小声但坚定',
    text: '今天不必证明很多，只要把该说的话说得清楚一点。',
    image: image('photo-1506744038136-46273834b3fb'),
  },
  {
    title: '把复杂折成纸船',
    text: '先挑最轻的一件事做完，剩下的水面会慢慢安静。',
    image: image('photo-1518837695005-2083093ee35b'),
  },
  {
    title: '允许自己发芽',
    text: '还没开花也没关系，今天只要向光那边偏一点点。',
    image: image('photo-1493246507139-91e8fad9978e'),
  },
  {
    title: '别和昨天硬碰硬',
    text: '你可以换一种姿势重新开始，不必沿用昨天的疲惫。',
    image: image('photo-1513279922550-250c2129b13a'),
  },
  {
    title: '先收回注意力',
    text: '今天最珍贵的不是答案，是你愿意重新听见自己的声音。',
    image: image('photo-1469474968028-56623f02e42e'),
  },
  {
    title: '让好奇心带路',
    text: '遇到卡住的地方，先问一句“这里是不是还有别的玩法”。',
    image: image('photo-1500534314209-a25ddb2bd429'),
  },
  {
    title: '风会替你翻页',
    text: '有些事情不用用力结束，松手之后它就会自己走远。',
    image: image('photo-1472214103451-9374bd1c798e'),
  },
  {
    title: '今天适合轻装',
    text: '少带一点担心出门，你会发现自己其实走得更快。',
    image: image('photo-1518495973542-4542c06a5843'),
  },
  {
    title: '把问题问漂亮',
    text: '一个好问题会像灯一样，把乱糟糟的房间照出路来。',
    image: image('photo-1507525428034-b723cf961d3e'),
  },
  {
    title: '先别急着完美',
    text: '把第一版做出来，世界才有机会和你一起修改它。',
    image: image('photo-1482192505345-5655af888cc4'),
  },
  {
    title: '给自己一点回声',
    text: '说出来吧，哪怕只是说给屏幕听，你也会更清楚一点。',
    image: image('photo-1500534314209-a25ddb2bd429'),
  },
  {
    title: '今天有小小转机',
    text: '它可能不像烟花，更像一盏刚被点亮的小台灯。',
    image: image('photo-1500530855697-b586d89ba3ee'),
  },
  {
    title: '保持一点笨拙',
    text: '笨拙不是坏事，它说明你正在碰一件新的、真的事情。',
    image: image('photo-1490730141103-6cac27aaab94'),
  },
  {
    title: '把心放回身体里',
    text: '喝水、伸懒腰、慢慢呼吸，灵魂也需要一个落脚点。',
    image: image('photo-1519681393784-d120267933ba'),
  },
  {
    title: '答案在路上晃悠',
    text: '别把它逼到墙角，今天适合边走边等它靠近。',
    image: image('photo-1470770841072-f978cf4d019e'),
  },
  {
    title: '认真也可以很软',
    text: '你可以很在意一件事，同时不把自己拧得太紧。',
    image: image('photo-1506744038136-46273834b3fb'),
  },
  {
    title: '把烦恼摊平',
    text: '它蜷起来的时候很吓人，摊开看也许只是几条线。',
    image: image('photo-1518837695005-2083093ee35b'),
  },
  {
    title: '今天适合试探',
    text: '先伸出一小步，不必立刻决定要不要跑完整条路。',
    image: image('photo-1493246507139-91e8fad9978e'),
  },
  {
    title: '你可以晚一点亮',
    text: '星星也不是一开场就出现，重要的是它终究会亮。',
    image: image('photo-1513279922550-250c2129b13a'),
  },
  {
    title: '别把自己放最后',
    text: '今天至少有一件小事，要优先照顾你的感受。',
    image: image('photo-1469474968028-56623f02e42e'),
  },
  {
    title: '让句号先休息',
    text: '有些关系、有些想法，今天还可以用逗号继续看一看。',
    image: image('photo-1472214103451-9374bd1c798e'),
  },
  {
    title: '小火慢炖也很香',
    text: '别嫌进展慢，耐心正在把粗糙的东西煮出味道。',
    image: image('photo-1518495973542-4542c06a5843'),
  },
  {
    title: '把今天调成柔焦',
    text: '不是所有细节都要看清，有些朦胧本身就是保护。',
    image: image('photo-1507525428034-b723cf961d3e'),
  },
  {
    title: '允许计划长出枝杈',
    text: '偏离路线不一定是错误，也可能是风景先来敲门。',
    image: image('photo-1482192505345-5655af888cc4'),
  },
  {
    title: '请给勇气留座',
    text: '它今天可能来得很小声，但还是值得被你认出来。',
    image: image('photo-1500530855697-b586d89ba3ee'),
  },
  {
    title: '把不确定当成云',
    text: '它会遮住一会儿，但天空并没有真的消失。',
    image: image('photo-1490730141103-6cac27aaab94'),
  },
  {
    title: '今天适合整理一角',
    text: '清出一个小地方，新的心情就有地方坐下。',
    image: image('photo-1519681393784-d120267933ba'),
  },
  {
    title: '别错过微小的好',
    text: '今天的好运可能很小，小到像一句刚好听见的话。',
    image: image('photo-1470770841072-f978cf4d019e'),
  },
  {
    title: '把自己从催促里抱出来',
    text: '你不是进度条，你是一个会累也会发光的人。',
    image: image('photo-1506744038136-46273834b3fb'),
  },
  {
    title: '先相信一厘米',
    text: '不需要一次相信整座桥，今天先相信脚下这一小段。',
    image: image('photo-1518837695005-2083093ee35b'),
  },
  {
    title: '把耳朵借给直觉',
    text: '理性在算账的时候，直觉可能已经轻轻指了方向。',
    image: image('photo-1493246507139-91e8fad9978e'),
  },
  {
    title: '今天适合说谢谢',
    text: '谢谢别人，也谢谢那个撑到现在的自己。',
    image: image('photo-1513279922550-250c2129b13a'),
  },
  {
    title: '别急着给自己定性',
    text: '你不是某个固定标签，你还有很多没打开的抽屉。',
    image: image('photo-1469474968028-56623f02e42e'),
  },
  {
    title: '让快乐有缝可钻',
    text: '别把门关太紧，小小的轻松也想进来坐坐。',
    image: image('photo-1472214103451-9374bd1c798e'),
  },
  {
    title: '今天适合少解释',
    text: '懂你的人会靠近，不懂的人也不必占用太多电量。',
    image: image('photo-1518495973542-4542c06a5843'),
  },
  {
    title: '把想法晾成风',
    text: '写下来、说出来、画出来，别让它一直闷在心里。',
    image: image('photo-1507525428034-b723cf961d3e'),
  },
  {
    title: '好运可能会迟到',
    text: '但你今天做的小准备，会给它留一条清楚的路。',
    image: image('photo-1482192505345-5655af888cc4'),
  },
  {
    title: '请温柔地变厉害',
    text: '成长不一定要很硬，你也可以带着柔软往前走。',
    image: image('photo-1500530855697-b586d89ba3ee'),
  },
  {
    title: '把今天过成草稿',
    text: '草稿也有价值，它让明天知道从哪里继续。',
    image: image('photo-1490730141103-6cac27aaab94'),
  },
  {
    title: '先和自己站一队',
    text: '外面的声音很多，今天请先确认你没有离开自己。',
    image: image('photo-1519681393784-d120267933ba'),
  },
  {
    title: '让心里的灯缓缓开',
    text: '不用一下子照亮全部，照亮脚边也很好。',
    image: image('photo-1470770841072-f978cf4d019e'),
  },
  {
    title: '今天适合一点浪漫',
    text: '给普通事情加一层滤镜，生活会偷偷变轻。',
    image: image('photo-1506744038136-46273834b3fb'),
  },
  {
    title: '把遗憾放低一点',
    text: '别让它挡住视线，你还有新的问题、新的答案、新的路。',
    image: image('photo-1518837695005-2083093ee35b'),
  },
  {
    title: '请收下这阵风',
    text: '它不替你决定方向，只提醒你：你还可以移动。',
    image: image('photo-1493246507139-91e8fad9978e'),
  },
];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickDailySign(visitorId: string, dateKey: string) {
  return dailySigns[hashString(`${visitorId}:${dateKey}`) % dailySigns.length];
}
