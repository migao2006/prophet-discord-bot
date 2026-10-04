# 預言者 Discord Bot

使用 Node.js 24、discord.js 與 PostgreSQL 製作的 Discord 機器人，提供：

- `/今日發言 使用者:成員`：使用 Discord 原生成員選擇器，公開統計該成員今天在一般文字與公告頻道的發言次數（台灣時間）。
- `/成員活躍查詢 使用者:成員`：限管理員使用，公開顯示成員近 30 個台灣日曆日的發言、活躍天數、語音時數、最後活動與前三個文字頻道。
- `/伺服器統計`：限管理員使用，公開顯示近 30 天的目前會員、新增、離開、活躍、沉睡與淨成長；所有會員統計排除 Bot。
- `/數字接龍 狀態:開啟|關閉`：限管理員使用，在執行指令的文字頻道開關數字接龍；正確數字加 ✅，錯誤數字加 ❌ 並用可愛提示宣布從 1 重新開始，同一位成員不能連續接龍。

機器人透過 Discord Gateway 主動連線，不需要網域、HTTP 伺服器或公開連接埠。程式採用模組化指令、服務層與資料存取層，方便繼續增加功能。

發言次數會即時彙總到 PostgreSQL。首次部署當天使用 Discord 歷史訊息確保結果完整；下一個台灣日開始優先查詢資料庫。機器人重連時會按照各頻道游標補抓遺漏訊息。

新版啟動後會在背景以兩個頻道的併發量補抓最近 30 天訊息，完成前活躍查詢會標示「歷史發言同步中」。語音只會從語音追蹤功能上線後開始累積，計入一般語音與舞台頻道，排除伺服器 AFK 頻道；即使成員獨處、靜音或拒聽仍會計時。

## 本機設定

需要 Node.js 24.17.0 或更新版本。

```powershell
npm.cmd ci
Copy-Item .env.example .env
notepad .env
```

`.env` 需要以下資料：

```dotenv
DISCORD_TOKEN=你的_Bot_Token
DISCORD_APPLICATION_ID=你的_Application_ID
DISCORD_GUILD_ID=你的測試伺服器_ID
DATABASE_URL=postgresql://使用者:密碼@主機:5432/資料庫
DATABASE_SSL=false
```

`.env` 已被 Git 排除，請勿將 Bot Token 提交到版本控制、Issue 或聊天訊息。

## Discord 應用程式

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立「預言者」。
2. 從 **General Information** 取得 Application ID。
3. 從 **Bot** 取得 Token。
4. 在 **Installation** 啟用 Guild Install，加入 `bot` 和 `applications.commands` scopes。
5. Bot 權限需要 **View Channels**、**Send Messages**、**Read Message History** 與 **Add Reactions**。
6. 將 Bot 加入至少一個伺服器；每個要使用指令的伺服器都必須安裝此 Bot。
7. 保持 **Interactions Endpoint URL** 空白；本專案使用 Gateway 接收互動。
8. 在 **Bot → Privileged Gateway Intents** 開啟 **Server Members Intent** 與 **Message Content Intent**；後者只用於辨識數字接龍訊息。
9. 程式同時使用一般的 Guilds、Guild Messages 與 Guild Voice States Intents。

首次建立或修改指令後執行以下命令，將指令註冊為所有伺服器都能使用的全域指令：

```powershell
npm.cmd run register
```

本機啟動：

```powershell
npm.cmd start
```

## Northflank 免費部署

Northflank 的 Developer Sandbox 運算資源本身免費，但建立 Service 仍要求新增信用卡作為防濫用驗證。

1. 建立 Northflank Free Project，Deployment target 選 **Northflank Cloud**。
2. 選擇免費可用的 `us-central` 區域。
3. 本儲存庫的 GitHub Actions 會將 `main` 建置為公開映像 `ghcr.io/migao2006/prophet-discord-bot:latest`。
4. 在同一專案建立免費 **PostgreSQL 18 addon**；啟用 TLS、關閉 public access。
5. 建立 Secret group，將 addon 的 `POSTGRES_URI` 以 `DATABASE_URL` 名稱提供給服務，並設定 `DATABASE_SSL=true`。
6. 建立 **Deployment Service**，來源選 **External image**，填入上述映像路徑。
7. 使用免費的 `nf-compute-10`，維持一個 instance。
8. 不建立公開連接埠、網域或 HTTP health check。
9. 在 Runtime variables 加入 `DISCORD_TOKEN`，並套用資料庫 Secret group。
10. 部署後在 Logs 確認 migration 沒有錯誤，並出現 `bot_ready`。

推送新版程式後，GitHub Actions 會更新 `latest` 映像；在 Northflank 重新部署服務即可套用新版。

Application ID 只在註冊指令時使用，不需要放入長時間執行的 Northflank Service。`DISCORD_GUILD_ID` 是選填；若設定，註冊流程會移除該伺服器裡舊的伺服器專用指令。修改指令定義後，重新執行 `npm run register`。資料庫 migration 會在服務登入 Discord 前自動執行。

## Docker

```powershell
docker build -t prophet-discord-bot .
docker run --rm --env-file .env prophet-discord-bot
```

## 驗證

```powershell
npm.cmd run check
npm.cmd test
docker build -t prophet-discord-bot .
```

設定 `TEST_DATABASE_URL` 後，`npm test` 也會執行真實 PostgreSQL migration、去重與刪除回減測試；未設定時只略過這一項整合測試。

部署後由伺服器管理者自行測試 `/今日發言`、`/成員活躍查詢`、`/伺服器統計` 與 `/數字接龍`。若統計略過頻道，確認 Bot 在該頻道具有 View Channel 與 Read Message History；若數字接龍沒有反應，確認 Message Content Intent 已開啟，且 Bot 具有 Add Reactions；若指令逾時，檢查 Northflank Logs、資料庫連線與 Bot Token。

## 安全性

- Bot 不需要 Administrator；完整伺服器統計需要 Server Members Intent，數字接龍需要 Message Content Intent。
- 資料庫只保存 Discord ID、成員加入／離開時間、日期、每日彙總次數、同步游標與語音進出時間，不保存暱稱、頭像、訊息內容或語音內容。
- 不要在 GitHub 或 Northflank build arguments 儲存 Token；使用 Runtime Secret。
- 如果 Token 曾外洩，立即在 Discord Developer Portal 重設，再更新 Northflank Secret。
