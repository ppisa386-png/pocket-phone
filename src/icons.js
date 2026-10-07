const paths = {
    phone: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>',
    messages: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',
    snapchat: '<path d="M8 10V8a4 4 0 0 1 8 0v2l2 1-2 2c0 2 2 3 3 3-1 2-3 1-3 3-2-1-2-1-4 0-2-1-2-1-4 0 0-2-2-1-3-3 1 0 3-1 3-3l-2-2 2-1Z"/>',
    x: '<path d="m5 4 14 16h-4L1 4h4Zm14 0L5 20" transform="translate(2 0) scale(.9 1)"/>',
    amazon: '<path d="M5 8h14l1 13H4L5 8ZM8 8V6a4 4 0 0 1 8 0v2M8 15c2 2 6 2 8 0"/>',
    settings: '<path d="m9 3-.7 2.3-2 .9L4 5.7 2 9l1.7 1.8v2.4L2 15l2 3.3 2.3-.5 2 .9L9 21h6l.7-2.3 2-.9 2.3.5 2-3.3-1.7-1.8v-2.4L22 9l-2-3.3-2.3.5-2-.9L15 3H9Z"/><circle cx="12" cy="12" r="3"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    home: '<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3V11Z"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    display: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 3v18"/>',
    api: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    prompts: '<path d="M5 3h14v18H5V3Zm3 5h8M8 12h8M8 16h5"/>',
    retry: '<path d="M4 9a8 8 0 1 1 1 9M4 3v6h6"/>',
};

export function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.phone) + '</svg>';
}
