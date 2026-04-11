function deterministicStringifyOld(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        const arr = obj.map(item => JSON.parse(deterministicStringifyOld(item)));
        return JSON.stringify(arr);
    }

    const sortedKeys = Object.keys(obj).sort();
    const result = {};
    for (const key of sortedKeys) {
        const val = obj[key];
        if (val === undefined) {
             // old code would fail here, let's try
             // actually JSON.stringify(undefined) returns undefined, JSON.parse(undefined) throws SyntaxError
        }
        result[key] = JSON.parse(deterministicStringifyOld(val));
    }
    return JSON.stringify(result);
}

function deterministicStringifyNew(obj) {
    // Sort keys purely in memory
    function sortObject(val) {
        if (val === null || typeof val !== 'object') {
            return val;
        }
        if (Array.isArray(val)) {
            return val.map(sortObject);
        }
        const sortedKeys = Object.keys(val).sort();
        const result = {};
        for (const key of sortedKeys) {
            result[key] = sortObject(val[key]);
        }
        return result;
    }
    return JSON.stringify(sortObject(obj));
}

const obj = {
  z: 1,
  a: 2,
  c: [
    { y: 1, x: 2, arr: [1,2,3,{b:1,a:2}] },
    { b: 3, a: 4 }
  ],
  d: {
    w: 5,
    v: 6
  }
};

const start1 = performance.now();
for (let i = 0; i < 10000; i++) {
  deterministicStringifyOld(obj);
}
const end1 = performance.now();

const start2 = performance.now();
for (let i = 0; i < 10000; i++) {
  deterministicStringifyNew(obj);
}
const end2 = performance.now();

console.log(`Old: ${end1 - start1} ms`);
console.log(`New: ${end2 - start2} ms`);
console.log(deterministicStringifyOld(obj) === deterministicStringifyNew(obj) ? 'Outputs match' : 'Outputs DO NOT match');

try {
  deterministicStringifyOld({ a: undefined });
  console.log('Old handled undefined');
} catch (e) {
  console.log('Old failed on undefined:', e.message);
}

try {
  console.log('New on undefined:', deterministicStringifyNew({ a: undefined }));
} catch (e) {
  console.log('New failed on undefined:', e.message);
}
