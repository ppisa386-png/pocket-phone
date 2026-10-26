// Keep native editing inside the phone's scroll areas without scrolling the host chat.
export function bindInputViewport({ shadow, phone, content, signal }) {
    const viewport = window.visualViewport;
    let frame = 0, normalHeight = viewport?.height || window.innerHeight;
    const editable = () => {
        const element = shadow.activeElement;
        return element && phone.contains(element) && !element.disabled && !element.readOnly &&
            (element.matches('textarea, [contenteditable="true"]') || element.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])')) ? element : null;
    };
    function reveal(element) {
        // Work from the innermost scroll container outwards, never the document.
        for (let parent = element.parentElement; parent && phone.contains(parent); parent = parent.parentElement) {
            if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
            const field = element.getBoundingClientRect(), box = parent.getBoundingClientRect();
            const top = box.top + 10, bottom = box.bottom - 10;
            // Long editors scroll internally; do not bounce between their two edges.
            if (field.height > bottom - top) {
                if (field.top > bottom - 40 || field.bottom < top + 40) parent.scrollTop += field.top - top;
            } else if (field.bottom > bottom) parent.scrollTop += field.bottom - bottom;
            else if (field.top < top) parent.scrollTop -= top - field.top;
        }
    }
    function update() {
        frame = 0;
        if (signal.aborted) return;
        const field = editable(), height = viewport?.height || window.innerHeight, top = viewport?.offsetTop || 0;
        if (!field) normalHeight = Math.max(height, window.innerHeight);
        const compact = !!field && ((normalHeight - height > 120) || (window.innerWidth <= 600 && height < 520));
        phone.dataset.editing = String(!!field);
        phone.dataset.keyboard = String(compact);
        phone.style.setProperty('--pp-visible-height', height + 'px');
        phone.style.setProperty('--pp-visible-top', top + 'px');
        if (field && !phone.hidden) reveal(field);
    }
    function schedule() {
        if (!frame && !signal.aborted) frame = requestAnimationFrame(update);
    }
    for (const name of ['focusin', 'focusout', 'input']) shadow.addEventListener(name, schedule, { signal });
    window.addEventListener('resize', schedule, { signal });
    viewport?.addEventListener('resize', schedule, { signal });
    viewport?.addEventListener('scroll', schedule, { signal });
    signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once:true });
    return { update: schedule };
}
