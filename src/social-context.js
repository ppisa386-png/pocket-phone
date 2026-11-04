// Send publication anchors, never copies of the narrative around them.
export function publicationScenePrompt(_context,publications){
    if(!publications.length)return '';
    return '\n发布来源楼层仅供定位，以酒馆当前提供的剧情理解推文或动态的指代。不能把私人经过当成公众消息。来源：'+JSON.stringify(publications.map(({id,sourceIndex})=>({id,sourceIndex:sourceIndex??null})));
}
