// Desktop Enter and mobile soft-keyboard line breaks share the same local action.
export function bindComposerKeys(root,{queue,onError=()=>{},signal}) {
    const selector='textarea[data-sms-draft],textarea[data-snap-field="message"]';
    const composing=new WeakSet(),finishing=new WeakSet();
    let pending=false;
    const composer=event=>event.target?.matches?.(selector)?event.target:null;
    function submit(event) {
        const input=composer(event);if(!input||input.disabled)return;
        if(event.isComposing||event.keyCode===229||composing.has(input)||finishing.has(input))return;
        event.preventDefault();
        if(pending||!input.value.trim())return;
        pending=true;
        Promise.resolve().then(()=>queue(input)).catch(onError).finally(()=>{pending=false;});
    }
    root.addEventListener('compositionstart',e=>{const input=composer(e);if(input)composing.add(input);},{signal});
    root.addEventListener('compositionend',e=>{const input=composer(e);if(input){composing.delete(input);finishing.add(input);setTimeout(()=>finishing.delete(input),0);}},{signal});
    root.addEventListener('keydown',e=>{if(e.key==='Enter')submit(e);},{signal});
    root.addEventListener('beforeinput',e=>{if(['insertLineBreak','insertParagraph'].includes(e.inputType)&&e.cancelable)submit(e);},{signal});
    // Some mobile keyboards deliver only a non-cancelable input event.
    root.addEventListener('input',e=>{if(['insertLineBreak','insertParagraph'].includes(e.inputType))submit(e);},{signal});
}
