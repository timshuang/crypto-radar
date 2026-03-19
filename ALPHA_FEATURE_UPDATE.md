# Alpha 代币搜索功能更新

## 更新日期
2026-03-13

## 更新内容

### 1. 新增 Alpha 代币数据源

在 `src/web-server.js` 中添加了硬编码的 Alpha 代币列表（50 个常见代币）：
- BERAUSDT, PENGUUSDT, MOVEUSDT, VANAUSDT, USUALUSDT
- VIRTUALUSDT, AIXBTUSDT, GRIFFAINUSDT, ANIMEUSDT, FORMUSDT
- 等等...

**说明：** 由于币安 Alpha API 未公开，采用硬编码方式。后续可定期更新此列表。

### 2. 搜索功能增强

修改了 `searchSymbols()` 方法：
- 同时搜索现货（spot）和 Alpha（alpha）代币
- 返回结果带来源标识，格式：`SYMBOL (source)`
- 示例：`BTCUSDT (spot)`、`BERAUSDT (alpha)`

### 3. 前端显示优化

#### `public/app.js` 修改：
- `showAutocomplete()`: 在自动补全下拉中显示来源标签
- `selectSymbol()`: 自动解析来源并设置下拉选择器
- `updateSymbolSelect()`: 在币种选择器中显示来源标识

#### `public/style.css` 新增样式：
```css
.autocomplete-source.source-spot {
  background: rgba(0, 217, 255, 0.3);
  color: #00d9ff;
}

.autocomplete-source.source-alpha {
  background: rgba(255, 165, 0, 0.3);
  color: #ffa500;
}
```

### 4. 添加币种时自动识别来源

修改了 `_addSymbol()` 方法：
- 自动解析用户输入的 `SYMBOL (source)` 格式
- 正确设置 `source` 字段（spot 或 alpha）

## API 测试

### 搜索 API
```bash
# 搜索 BTC
curl "http://localhost:3000/api/symbols/search?q=BTC" \
  -H "X-API-Token: crypto_radar_token_2024"

# 返回：["BTCUSDT (spot)"]

# 搜索 BERA (Alpha 代币)
curl "http://localhost:3000/api/symbols/search?q=BERA" \
  -H "X-API-Token: crypto_radar_token_2024"

# 返回：["BERAUSDT (spot)", "BERAUSDT (alpha)"]
```

### 添加 Alpha 代币
```bash
curl -X POST "http://localhost:3000/api/symbols" \
  -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BERAUSDT (alpha)", "enabled": true}'

# 返回：{"success":true,"data":{"symbol":"BERAUSDT","source":"alpha",...}}
```

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/web-server.js` | 添加 Alpha 代币列表、`getAlphaSymbols()`、`getAllSymbols()`、修改 `searchSymbols()`、修改 `_addSymbol()` |
| `public/app.js` | 修改 `showAutocomplete()`、`selectSymbol()`、`updateSymbolSelect()` |
| `public/style.css` | 添加来源标签样式（`.autocomplete-source`） |

## 使用说明

### 添加 Alpha 代币

1. 打开 Web UI (http://localhost:3000)
2. 进入「币种管理」页面
3. 点击「+ 添加币种」
4. 在输入框中输入代币代码（如 `BERA`）
5. 从自动补全下拉中选择带 `(alpha)` 标识的选项
6. 数据源会自动设置为 `Alpha`
7. 点击「添加」

### 搜索代币

- 输入代币代码时，自动补全会显示来源标识
- 蓝色标签 = spot（现货）
- 橙色标签 = alpha（Alpha 代币）

## 后续优化建议

1. **Alpha API 集成**：如果币安 Alpha 开放公开 API，可替换硬编码列表
2. **定期更新**：建立 Alpha 代币列表更新机制（每周/每月）
3. **来源过滤**：在搜索界面添加来源过滤选项（只看 spot / 只看 alpha）
4. **价格监控**：为 Alpha 代币实现独立的价格监控（使用 `wss://ws.alpha.binance.com/ws`）

## 测试状态

✅ 语法检查通过  
✅ 服务重启成功  
✅ 搜索 API 测试通过  
✅ 添加 Alpha 代币测试通过  
✅ 来源标识显示正常  

---

_更新完成，老板可以搜 Alpha 代币了！_ 🦞
