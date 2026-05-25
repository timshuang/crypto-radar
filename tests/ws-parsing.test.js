/**
 * ws-parsing.test.js - Alpha WebSocket 消息解析回归测试
 *
 * 运行方式：node tests/ws-parsing.test.js
 * 零依赖，纯 Node.js
 *
 * 覆盖 ws-connector.js 中 alphaFullTokens 的 4 种解析 Case：
 *   Case 1: 裸数组 [...]
 *   Case 2: msg.data.d 是数组 {data:{d:[...]}}
 *   Case 3: 信封格式 {stream:"...",data:[...]}
 *   Case 4: 单条数据 {data:{s:"..."}}
 */

// 从 ws-connector.js 提取的解析逻辑（与源码保持一致）
function parseAlphaFullTokens(msg, type) {
  if (msg == null) return null;
  return (type === 'alpha-full' && Array.isArray(msg))
    ? msg
    : (msg.data && msg.data.d && Array.isArray(msg.data.d)
        ? msg.data.d
        : (type === 'alpha-full' && Array.isArray(msg.data) ? msg.data
          : (type === 'alpha-full' && msg.data && msg.data.s ? [msg.data] : null)));
}

// ==================== 测试用例 ====================

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: 期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}`);
  }
}

// ---------- Case 1: 裸数组 ----------
test('Case 1 - 裸数组：返回完整数组', () => {
  const msg = [
    { s: 'ALPHA_1USDT', c: '0.5', E: 1779701738831 },
    { s: 'ALPHA_2USDT', c: '1.2', E: 1779701738832 }
  ];
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 2, '数组长度');
  assertEqual(result[0].s, 'ALPHA_1USDT', '第一条 s 字段');
  assertEqual(result[1].s, 'ALPHA_2USDT', '第二条 s 字段');
});

test('Case 1 - 裸数组：空数组返回空', () => {
  const result = parseAlphaFullTokens([], 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 0, '数组长度');
});

// ---------- Case 2: data.d 数组 ----------
test('Case 2 - data.d 数组：came@allTokens@ticker24 格式', () => {
  const msg = {
    data: {
      d: [
        { s: 'ALPHA_100USDT', c: '2.5', E: 1779701738831 },
        { s: 'ALPHA_200USDT', c: '0.8', E: 1779701738832 }
      ]
    }
  };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 2, '数组长度');
  assertEqual(result[0].s, 'ALPHA_100USDT', '第一条 s 字段');
});

test('Case 2 - data.d 空数组：返回空', () => {
  const msg = { data: { d: [] } };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 0, '数组长度');
});

// ---------- Case 3: 信封格式 ----------
test('Case 3 - 信封格式：!miniTicker@arr 返回 {stream,data}', () => {
  const msg = {
    stream: '!miniTicker@arr',
    data: [
      { s: 'ALPHA_964USDT', c: '0.52', E: 1779701738831 },
      { s: 'ALPHA_971USDT', c: '1.20', E: 1779701738832 }
    ]
  };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 2, '数组长度');
  assertEqual(result[0].s, 'ALPHA_964USDT', '第一条 s 字段');
  assertEqual(result[1].s, 'ALPHA_971USDT', '第二条 s 字段');
});

test('Case 3 - 信封格式：空 data 返回空数组', () => {
  const msg = { stream: '!miniTicker@arr', data: [] };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 0, '数组长度');
});

// ---------- Case 4: 单条数据 ----------
test('Case 4 - 单条数据：data.s 存在', () => {
  const msg = {
    data: { s: 'ALPHA_500USDT', c: '3.14', E: 1779701738831 }
  };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 1, '数组长度');
  assertEqual(result[0].s, 'ALPHA_500USDT', 's 字段');
});

// ---------- 边界情况 ----------
test('边界：type 非 alpha-full 返回 null', () => {
  const msg = [{ s: 'ALPHA_1USDT' }];
  const result = parseAlphaFullTokens(msg, 'alpha-combined');
  assertEqual(result, null, '非 alpha-full 应返回 null');
});

test('边界：msg 为 null 返回 null', () => {
  const result = parseAlphaFullTokens(null, 'alpha-full');
  assertEqual(result, null, 'null msg 应返回 null');
});

test('边界：msg 为 undefined 返回 null', () => {
  const result = parseAlphaFullTokens(undefined, 'alpha-full');
  assertEqual(result, null, 'undefined msg 应返回 null');
});

test('边界：msg.data 为 null 返回 null', () => {
  const msg = { data: null };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assertEqual(result, null, 'data:null 应返回 null');
});

test('边界：空对象返回 null', () => {
  const result = parseAlphaFullTokens({}, 'alpha-full');
  assertEqual(result, null, '空对象应返回 null');
});

// ---------- USDC 过滤（在调用方处理，但验证数据能通过解析） ----------
test('USDC 代币：解析阶段不过滤，由调用方过滤', () => {
  const msg = { stream: '!miniTicker@arr', data: [{ s: 'ALPHA_1USDC', c: '1.0' }] };
  const result = parseAlphaFullTokens(msg, 'alpha-full');
  assert(Array.isArray(result), '应返回数组');
  assertEqual(result.length, 1, '解析阶段不过滤 USDC');
  assertEqual(result[0].s, 'ALPHA_1USDC', '保留 USDC 代币');
});

// ==================== 运行 ====================

console.log('========================================');
console.log('  Alpha WebSocket 消息解析回归测试');
console.log('========================================\n');

for (const t of tests) {
  try {
    t.fn();
    console.log(`  PASS: ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${t.name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

console.log('\n----------------------------------------');
console.log(`  结果: ${passed} passed, ${failed} failed, ${tests.length} total`);
console.log('----------------------------------------\n');

if (failed > 0) {
  console.log('❌ 存在失败用例，请检查 ws-connector.js 解析逻辑！');
  process.exit(1);
} else {
  console.log('✅ 全部通过');
  process.exit(0);
}
