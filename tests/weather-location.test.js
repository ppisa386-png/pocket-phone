// Location import contract: importStoryLocation must return {journal, changed}
// like every other importer, whether or not the city actually changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { messageSignatures, revisionsFor, replayJournal, readJournal } from '../src/journal.js';
import { importStoryLocation } from '../src/weather.js';

const marker = (prose, city) => ({ mes: prose + (city ? `<!--durian-location:{"city":"${city}"}-->` : ''), is_user: false, name: 'Alex' });
const revisionsOf = async chat => await revisionsFor(messageSignatures(chat));

test('a newly marked city imports location events, replays to the latest city, and re-importing the same chat changes nothing', async () => {
    const chat = [
        { mes: '用户开场白，尚未提及城市。', is_user: true },
        marker('Sam arrived in Shanghai and checked into a small hotel.', '上海'),
        { mes: '用户问起下一步的安排。', is_user: true },
        marker('After a long train ride Sam reached Beijing at dusk.', '北京'),
    ];
    const revisions = await revisionsOf(chat);
    const first = importStoryLocation(readJournal(undefined), revisions, chat);
    assert.equal(first.changed, true);
    assert.equal(first.journal.events.length, 2);
    assert.deepEqual(first.journal.events[0].changes[0].value, { city: '上海', sourceIndex: 1 });
    assert.equal(first.journal.events[0].source.index, 1);
    assert.equal(first.journal.events[0].id, 'story-location:' + revisions[1]);
    assert.equal(first.journal.events[1].source.index, 3);
    assert.equal(replayJournal(first.journal).location.current.city, '北京');
    const second = importStoryLocation(first.journal, revisions, chat);
    assert.deepEqual(second, { journal: first.journal, changed: false });
});

test('a chat without markers (including user-authored markers) returns the same journal unchanged', async () => {
    const chat = [
        { mes: '只是普通的一天，没有提到任何地点。', is_user: false, name: 'Alex' },
        { mes: '<!--durian-location:{"city":"上海"}-->用户消息里的标记不算数。', is_user: true },
        marker('An ordinary evening at home, no city mentioned.', null),
    ];
    const revisions = await revisionsOf(chat);
    const raw = readJournal(undefined);
    const result = importStoryLocation(raw, revisions, chat);
    assert.deepEqual(result, { journal: raw, changed: false });
    assert.equal(result.journal.events.length, 0);
});

test('re-marking the current city adds no event and the result stays a valid {journal, changed} pair', async () => {
    const chat = [marker('Sam settled into the Shanghai apartment.', '上海'), marker('Another quiet day in Shanghai.', '上海')];
    const revisions = await revisionsOf(chat);
    const first = importStoryLocation(readJournal(undefined), revisions, chat);
    assert.equal(first.changed, true);
    assert.equal(first.journal.events.length, 1);
    const second = importStoryLocation(first.journal, revisions, chat);
    assert.equal(second.changed, false);
    assert.equal(typeof second.changed, 'boolean');
    assert.ok(second.journal && Array.isArray(second.journal.events));
    assert.equal(second.journal.events.length, 1);
});
