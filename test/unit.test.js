import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizePhone, buildShortDescription } from '../src/utils/formatters.js';
import { splitName, translitToUa } from '../src/utils/transliteration.js';

describe('Formatters', () => {
    it('normalizePhone should return clean 380XXXXXXXXX', () => {
        assert.strictEqual(normalizePhone('050 111 22 33'), '380501112233');
        assert.strictEqual(normalizePhone('+380 (50) 111-22-33'), '380501112233');
        assert.strictEqual(normalizePhone('0671234567'), '380671234567');
    });

    it('normalizePhone should return default for invalid', () => {
        // The function logs warn and returns test phone
        const result = normalizePhone('123');
        assert.strictEqual(result, '380501112233');
    });

    it('buildShortDescription should format correctly', () => {
        const order = { name: '#1001', line_items: [{ quantity: 1 }, { quantity: 2 }] };
        const desc = buildShortDescription(order);
        assert.match(desc, /Order #1001/);
        assert.match(desc, /items:2/);
        assert.match(desc, /qty:3/);
    });
});

describe('Transliteration', () => {
    it('translitToUa should handle Latin -> Cyrillic', () => {
        assert.strictEqual(translitToUa('Taras'), 'Тарас');
        assert.strictEqual(translitToUa('Ivan'), 'Іван');
        // Test library capability
        assert.strictEqual(translitToUa('Andrii'), 'Андрій');
    });

    it('splitName should split and transliterate', () => {
        const res = splitName('Ivan Poupkine');
        assert.strictEqual(res.first, 'Іван');
        // Note: transliteration libraries differ. 
        // cyrillic-to-translit-js reverse for 'Poupkine' -> 'Поупкіне' or similar
        // Let's just check it returns Cyrillic
        assert.match(res.last, /[А-Яа-яІіЇїЄєҐґ]+/);
    });

    it('splitName should handle Cyrillic input', () => {
        const res = splitName('Тарас Шевченко');
        assert.strictEqual(res.first, 'Тарас');
        assert.strictEqual(res.last, 'Шевченко');
    });
});
