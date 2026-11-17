// Business tests inject a deterministic model. Their historic Quiet-shaped
// callback is only a fixture protocol; production never invokes that API.
import { createPhoneService as createRealPhoneService } from '../src/phone.js';
export { parseJSON, validateContacts } from '../src/phone.js';
export function createPhoneService(options) {
    return createRealPhoneService({ ...options, modelClient:options.modelClient || {
        generate(prompt, contact, _current, _progress, request = {}) {
            const context = options.getContext();
            return context.generateQuietPrompt({quietPrompt:prompt,quietToLoud:false,skipWIAN:false,
                forceChId:context.groupId ? contact?.characterId ?? null : null,responseLength:request.maxTokens});
        },
    }});
}
