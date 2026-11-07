import { icon } from './icons.js?v=1.1.29';

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

function interactive(node) {
    return !!(node?.closest?.('button, a, input, textarea, select, label, [contenteditable="true"]'));
}

export function createPressMenu({ shadow, root, phone, getActions }) {
    let bubble = null;
    let menuState = null;
    let activeTarget = null;
    let pressTimer = 0;
    let pressTarget = null;
    let startX = 0;
    let startY = 0;
    let suppressClickUntil = 0;
    let closeTimer = 0;

    function clearPress() {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = 0;
        pressTarget = null;
    }

    function close(immediate = false) {
        clearPress();
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = 0;
        activeTarget?.classList.remove('pp-press-active');
        activeTarget = null;
        const node = bubble;
        bubble = null;
        menuState = null;
        if (!node) return;
        if (immediate) {
            node.remove();
            return;
        }
        node.classList.add('pp-press-closing');
        closeTimer = setTimeout(() => node.remove(), 120);
    }

    function position(node, target) {
        const view = phone.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const size = node.getBoundingClientRect();
        const gap = 10;
        let below = rect.top - size.height - gap < view.top + 6;
        let top = below ? rect.bottom + gap : rect.top - size.height - gap;
        top = Math.min(Math.max(top, view.top + 6), Math.max(view.top + 6, view.bottom - size.height - 6));
        const center = rect.left + rect.width / 2;
        let left = center - size.width / 2;
        left = Math.min(Math.max(left, view.left + 6), Math.max(view.left + 6, view.right - size.width - 6));
        node.style.left = Math.round(left) + 'px';
        node.style.top = Math.round(top) + 'px';
        node.classList.toggle('pp-press-above', !below);
        node.classList.toggle('pp-press-below', below);
        const tail = node.querySelector('.pp-press-tail');
        if (tail) {
            const offset = Math.min(Math.max(center - left, 18), Math.max(18, size.width - 18));
            tail.style.left = Math.round(offset - 6) + 'px';
        }
        node.style.visibility = 'visible';
    }

    function open(target, actions) {
        close(true);
        activeTarget = target;
        target.classList.add('pp-press-active');
        const node = document.createElement('div');
        node.className = 'pp-press-bubble';
        node.setAttribute('role', 'menu');
        node.setAttribute('aria-label', '内容操作');
        node.innerHTML = '<div class="pp-press-actions">' + actions.map((action, index) =>
            '<button type="button" role="menuitem" class="pp-press-action" data-press-index="' + index + '"' +
            ' data-kind="' + action.icon + '" aria-label="' + String(action.label).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) + '"' +
            ' title="' + String(action.label).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) + '"' +
            (action.danger ? ' data-danger="true"' : '') + (action.active ? ' data-active="true"' : '') +
            (action.disabled ? ' disabled aria-disabled="true"' : '') + '>' + icon(action.icon) + '</button>').join('') +
            '</div><span class="pp-press-tail" aria-hidden="true"></span>';
        bubble = node;
        menuState = { actions };
        node.style.visibility = 'hidden';
        root.append(node);
        position(node, target);
        suppressClickUntil = Date.now() + 900;
        node.addEventListener('click', event => {
            const button = event.target.closest('button[data-press-index]');
            if (!button || button.disabled) return;
            event.preventDefault();
            event.stopPropagation();
            const action = menuState?.actions[Number(button.dataset.pressIndex)];
            close();
            if (action?.run) Promise.resolve().then(() => action.run()).catch(() => {});
        });
    }

    function startLongPress(target, event) {
        clearPress();
        pressTarget = target;
        startX = event.clientX;
        startY = event.clientY;
        pressTimer = setTimeout(() => {
            pressTimer = 0;
            const node = pressTarget;
            pressTarget = null;
            if (!node?.isConnected) return;
            const actions = getActions(node);
            if (!Array.isArray(actions) || !actions.length) return;
            open(node, actions);
        }, LONG_PRESS_MS);
    }

    function onPointerDown(event) {
        if (bubble && !bubble.contains(event.target)) close();
        if (interactive(event.target)) return;
        const target = event.target.closest?.('[data-press]');
        if (!target) return;
        if (event.pointerType === 'mouse') return;
        startLongPress(target, event);
    }

    function onPointerMove(event) {
        if (!pressTimer) return;
        if (Math.abs(event.clientX - startX) > MOVE_CANCEL_PX || Math.abs(event.clientY - startY) > MOVE_CANCEL_PX) {
            clearPress();
        }
    }

    function onContextMenu(event) {
        if (interactive(event.target)) return;
        const target = event.target.closest?.('[data-press]');
        if (!target) return;
        event.preventDefault();
        if (bubble) return;
        const actions = getActions(target);
        if (Array.isArray(actions) && actions.length) open(target, actions);
    }

    function onKeyDown(event) {
        if (!((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) return;
        const target = shadow.activeElement?.closest?.('[data-press]');
        if (!target) return;
        event.preventDefault();
        const actions = getActions(target);
        if (Array.isArray(actions) && actions.length) open(target, actions);
    }

    function onClickCapture(event) {
        if (bubble?.contains(event.target)) return;
        if (Date.now() >= suppressClickUntil) return;
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    shadow.addEventListener('pointerdown', onPointerDown, true);
    shadow.addEventListener('pointermove', onPointerMove, true);
    shadow.addEventListener('pointerup', clearPress, true);
    shadow.addEventListener('pointercancel', clearPress, true);
    shadow.addEventListener('contextmenu', onContextMenu, true);
    shadow.addEventListener('keydown', onKeyDown, true);
    shadow.addEventListener('click', onClickCapture, true);
    shadow.addEventListener('scroll', () => close(true), true);

    return {
        close,
        get isOpen() { return !!bubble; },
        get target() { return activeTarget; },
    };
}
