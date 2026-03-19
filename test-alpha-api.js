#!/usr/bin/env node
/**
 * test-alpha-api.js - Alpha API 测试脚本
 * 
 * 测试币安 Alpha 官方 API 端点
 */

const { fetchAlphaPrice, fetchAlphaExchangeInfo, fetchAlphaKlines } = require('./src/monitors');

// 测试用 Alpha ID
const TEST_ALPHA_IDS = ['ALPHA_804', 'ALPHA_173'];

async function testFetchAlphaTokenList() {
  console.log('\n=== 测试 1: 获取 Alpha 代币列表 ===');
  try {
    // 使用 exchange info API（返回 ALPHA_xxx 格式）
    const url = 'https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info';
    const response = await fetch(url);
    const data = await response.json();
    
    const symbols = data.data?.symbols || [];
    const alphaSymbols = symbols.filter(s => s.symbol.endsWith('USDT'));
    
    console.log('✅ 请求成功');
    console.log(`Alpha 代币数量：${alphaSymbols.length}`);
    
    if (alphaSymbols.length > 0) {
      console.log('\n前 10 个 Alpha 代币:');
      alphaSymbols.slice(0, 10).forEach(s => {
        const alphaId = s.symbol.replace('USDT', '');
        console.log(`  - ${alphaId} (${s.status})`);
      });
    }
    
    return alphaSymbols.map(s => ({
      alphaId: s.symbol.replace('USDT', ''),
      status: s.status
    }));
  } catch (err) {
    console.error('❌ 请求失败:', err.message);
    return [];
  }
}

async function testFetchAlphaPrice(alphaId) {
  console.log(`\n=== 测试 2: 获取 ${alphaId} 价格 ===`);
  try {
    const price = await fetchAlphaPrice(alphaId);
    
    if (price) {
      console.log(`✅ ${alphaId} 价格：$${price}`);
      return true;
    } else {
      console.log(`⚠️  ${alphaId} 价格获取失败`);
      return false;
    }
  } catch (err) {
    console.error(`❌ ${alphaId} 价格获取失败:`, err.message);
    return false;
  }
}

async function testFetchAlphaExchangeInfo() {
  console.log('\n=== 测试 3: 获取交易所信息 ===');
  try {
    const info = await fetchAlphaExchangeInfo();
    
    console.log('✅ 请求成功');
    console.log('交易所信息:', JSON.stringify(info, null, 2));
    return true;
  } catch (err) {
    console.error('❌ 请求失败:', err.message);
    return false;
  }
}

async function testFetchAlphaKlines(alphaId) {
  console.log(`\n=== 测试 4: 获取 ${alphaId} K 线数据 ===`);
  try {
    const klines = await fetchAlphaKlines(alphaId, '1m', 5);
    
    if (klines.length > 0) {
      console.log(`✅ 获取到 ${klines.length} 条 K 线`);
      console.log('最近 5 条:');
      klines.forEach(k => {
        // K 线格式：[时间戳，开盘价，最高价，最低价，收盘价，成交量，...]
        console.log(`  - O:${k[1]} H:${k[2]} L:${k[3]} C:${k[4]} V:${k[5]}`);
      });
      return true;
    } else {
      console.log(`⚠️  ${alphaId} K 线数据为空`);
      return false;
    }
  } catch (err) {
    console.error(`❌ ${alphaId} K 线获取失败:`, err.message);
    return false;
  }
}

async function main() {
  console.log('🦞 Alpha API 测试开始');
  console.log('=' .repeat(60));
  
  // 测试 1: Token List (exchange info)
  const tokens = await testFetchAlphaTokenList();
  
  // 测试 2: 价格获取（使用实际的 Alpha ID）
  if (tokens.length > 0) {
    const testToken = tokens[0];
    if (testToken.alphaId) {
      await testFetchAlphaPrice(testToken.alphaId);
    }
  }
  
  // 测试预设的 Alpha ID
  for (const alphaId of TEST_ALPHA_IDS) {
    await testFetchAlphaPrice(alphaId);
  }
  
  // 测试 3: 交易所信息
  await testFetchAlphaExchangeInfo();
  
  // 测试 4: K 线数据
  if (tokens.length > 0) {
    const testToken = tokens[0];
    if (testToken.alphaId) {
      await testFetchAlphaKlines(testToken.alphaId);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Alpha API 测试完成');
  console.log('=' .repeat(60));
}

// 运行测试
main().catch(err => {
  console.error('\n❌ 测试失败:', err.message);
  process.exit(1);
});
