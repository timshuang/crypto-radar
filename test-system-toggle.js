/**
 * 测试系统总开关 API
 */

const API_TOKEN = 'crypto_radar_token_2024';
const BASE_URL = 'http://localhost:3000';

async function testSystemToggle() {
  console.log('🧪 测试系统总开关 API\n');
  
  try {
    // 1. 获取当前状态
    console.log('1️⃣ 获取系统状态...');
    const statusRes = await fetch(`${BASE_URL}/api/status`, {
      headers: { 'X-API-Token': API_TOKEN }
    });
    const statusData = await statusRes.json();
    console.log('   当前状态:', statusData.data);
    console.log('   - running:', statusData.data.running);
    console.log('   - systemEnabled:', statusData.data.systemEnabled);
    console.log('');
    
    // 2. 切换系统（关闭）
    console.log('2️⃣ 关闭系统...');
    const toggleOffRes = await fetch(`${BASE_URL}/api/system/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN
      },
      body: JSON.stringify({ enabled: false })
    });
    const toggleOffData = await toggleOffRes.json();
    console.log('   响应:', toggleOffData);
    console.log('');
    
    // 3. 再次获取状态
    console.log('3️⃣ 验证状态已更新...');
    const statusRes2 = await fetch(`${BASE_URL}/api/status`, {
      headers: { 'X-API-Token': API_TOKEN }
    });
    const statusData2 = await statusRes2.json();
    console.log('   当前状态:', statusData2.data);
    console.log('   - running:', statusData2.data.running);
    console.log('   - systemEnabled:', statusData2.data.systemEnabled);
    console.log('');
    
    // 4. 切换系统（开启）
    console.log('4️⃣ 重新开启系统...');
    const toggleOnRes = await fetch(`${BASE_URL}/api/system/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN
      },
      body: JSON.stringify({ enabled: true })
    });
    const toggleOnData = await toggleOnRes.json();
    console.log('   响应:', toggleOnData);
    console.log('');
    
    // 5. 最终验证
    console.log('5️⃣ 最终验证状态...');
    const statusRes3 = await fetch(`${BASE_URL}/api/status`, {
      headers: { 'X-API-Token': API_TOKEN }
    });
    const statusData3 = await statusRes3.json();
    console.log('   当前状态:', statusData3.data);
    console.log('   - running:', statusData3.data.running);
    console.log('   - systemEnabled:', statusData3.data.systemEnabled);
    console.log('');
    
    console.log('✅ 测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testSystemToggle();
