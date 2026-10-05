# Bot 架構

程式依責任分為五層，依賴方向由入口往功能與基礎設施流動：

```text
src/
├─ app/                    # 建立 Bot、組裝依賴、綁定 Discord 事件
├─ commands/               # Slash command 輸入驗證與輸出格式
├─ core/                   # 無領域歸屬的設定、日誌、共用佇列
├─ discord/                # 指令載入與 Interaction 路由
├─ features/
│  ├─ activity/            # 文字與語音活動統計
│  ├─ members/             # 成員名冊與伺服器統計
│  ├─ fun-images/          # 外部趣味圖片 API、驗證與冷卻
│  └─ games/               # 頻道遊戲與共用遊戲鎖
└─ infrastructure/
   └─ database/            # PostgreSQL client、migration runner 與 SQL
```

## 責任界線

- `index.js` 只處理設定、資料庫 migration、登入與正常關閉。
- `app/create-bot.js` 是 composition root，集中建立 repository、service、tracker 與 Discord client。
- `app/register-events.js` 只負責 Gateway 事件到應用服務的轉送及統一錯誤記錄。
- `commands/` 不直接查詢資料庫；它只驗證 Discord interaction 並呼叫 context 中的服務或 repository。
- `features/` 保存領域規則。Repository 封裝 SQL，service/tracker 負責流程，純計算放在 domain/game 模組。
- `infrastructure/` 不依賴 Discord，讓 migration 與資料庫連線可獨立測試。

## 新增功能

1. 在合適的 `features/<功能>` 目錄加入純規則、repository 與 service。
2. 在 `commands/<分類>` 新增薄指令模組，匯出 `data` 與 `execute`。
3. 在 `app/create-bot.js` 建立依賴並放入 command context。
4. 若需要 Gateway 事件，在 `app/register-events.js` 綁定並使用統一的非同步錯誤觀察器。
5. Schema 變更以遞增編號 SQL 放入 `infrastructure/database/migrations`。
6. 純規則寫單元測試；涉及鎖定或交易的行為加入 PostgreSQL 整合測試。

## 版本化資料

成語接龍的教育部詞庫放在 `data/`，由可重複執行的轉換腳本從官方 XLSX
產生。資料庫 migration 只建立 schema；`seed-idioms.js` 在 Discord 登入前以
來源版本為鍵執行冪等匯入，避免 migration 內嵌大量第三方資料。

開卷有益的會考題庫也放在 `data/`，由固定的上游 commit 轉換成純文字四選一格式；
`seed-open-book-questions.js` 使用獨立 advisory lock 匯入。按鈕 interaction 由 router
分派至遊戲服務，頻道狀態與作答去重由 PostgreSQL transaction 保護。
