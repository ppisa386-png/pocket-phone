export const eventKey = id => 'contactEvent:' + id;
export const isBlocked = (state, id, channel) => state.profiles?.['blocked:' + id]?.[channel] === true;

// A normal telephone/SMS reply can recognize an event in the user's own words
// without making another API call or automatically generating a second response.
export function communicationEvent(data, previous, participant, userText, sourceIndex) {
    if (data.event_action === 'end' && previous) return { ...previous, active: false };
    if (data.event_action !== 'start' || data.event_requires_response !== true || !userText) return null;
    return { id: crypto.randomUUID(), participant, active: true, sourceIndex, origin: 'communication' };
}
