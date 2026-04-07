import { performance } from 'perf_hooks';

function deterministicStringifyNew(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    function sortKeys(o) {
        if (o === null || typeof o !== 'object') {
            return o;
        }
        if (Array.isArray(o)) {
            return o.map(sortKeys);
        }
        const sortedKeys = Object.keys(o).sort();
        const result = {};
        for (const key of sortedKeys) {
            result[key] = sortKeys(o[key]);
        }
        return result;
    }

    return JSON.stringify(sortKeys(obj));
}

const complexObj = {
    a: 1,
    c: [
        { z: 1, a: 2, y: { foo: 'bar', baz: 'qux' } },
        { z: 1, a: 2, y: { foo: 'bar', baz: 'qux' } }
    ],
    b: {
        d: 4,
        c: 3,
        e: {
            g: 7,
            f: 6,
            h: [
                { j: 10, i: 9 },
                { j: 10, i: 9 },
            ]
        }
    }
};

const start = performance.now();
for (let i = 0; i < 10000; i++) {
    deterministicStringifyNew(complexObj);
}
const end = performance.now();
console.log(`New: ${end - start} ms`);
