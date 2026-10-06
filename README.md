# 預言者 Discord Bot

使用 Node.js 24、discord.js 與 PostgreSQL 製作的 Discord 機器人，提供：

- `/今日發言 使用者:成員`：使用 Discord 原生成員選擇器，公開統計該成員今天在一般文字與公告頻道的發言次數（台灣時間）。
- `/成員活躍查詢 使用者:成員`：限管理員使用，公開顯示成員近 30 個台灣日曆日的發言、活躍天數、語音時數、最後活動與前三個文字頻道。
- `/伺服器統計`：限管理員使用，公開顯示近 30 天的目前會員、新增、離開、活躍、沉睡與淨成長；所有會員統計排除 Bot。
- `/數字接龍 狀態:開啟|關閉`：限管理員使用，在執行指令的文字頻道開關數字接龍；正確數字加 ✅，錯誤數字加 ❌ 並用可愛提示宣布從 1 重新開始，同一位成員不能連續接龍。
- `/幾a幾b 狀態:開啟|關閉`：限管理員使用；開啟後成員直接輸入四個不重複的數字，全頻道共同破解答案，猜中後自動開始下一局。
- `/成語接龍 狀態:開啟|關閉`：限管理員使用；由機器人隨機出題，成員直接輸入四字成語，以相同漢字接龍，同一位成員不能連續作答。
- `/開卷有益 狀態:開啟|關閉 科目:全部|國文|英文|數學|社會|自然`：所有成員都能開啟無限時四選一問答；每人每題只能回答一次，答對後自動換題。只有開啟者或管理員能關閉。
- `/狼人殺 操作:開啟|開始|關閉`：所有成員可在目前頻道開房，透過按鈕加入 6～10 人局；房主或管理員可開始、取消。
- `/遊戲等級 使用者:成員`：查看自己或指定成員的全域遊戲等級、稱號、經驗進度與五種遊戲的成功次數。
- `/遊戲排行`：顯示目前伺服器成員的全域遊戲經驗前十名；同經驗值會並列名次。
- `/身分組稱號 狀態:開啟|關閉`：限管理員使用；開啟後建立每五級一個的稱號身分組，並自動同步現有成員與新加入成員。關閉時會移除成員身上的遊戲稱號。
- `/升等通知 狀態:開啟|關閉`：限管理員使用；在哪個文字頻道開啟，往後就會在該頻道公開 @ 升級的玩家。再次開啟可更換頻道，預設為關閉。
- `/隨機料理`：從 TheMealDB 隨機取得一張料理圖片。
- `/隨機貓咪`：從 The Cat API 隨機取得一張貓咪圖片。
- 同一個頻道一次只能開啟數字接龍、1A2B、成語接龍、開卷有益或狼人殺其中一種遊戲。

四種遊戲成功時會累積全域經驗：數字接龍 4 XP、成語接龍 16 XP、開卷有益 20 XP、1A2B 猜中 50 XP。等級最高 100 級，經驗仍可繼續累積；啟用升等通知後，升級時會在指定頻道公布最後到達的等級。稱號從「小小萌芽」開始，每五級更新一次，最高為「永恆預言者」；21 個稱號身分組各有對應的幻想漸層顏色。

機器人透過 Discord Gateway 主動連線，不需要網域、HTTP 伺服器或公開連接埠。程式採用模組化指令、服務層與資料存取層，方便繼續增加功能。

程式已依 `app`、`commands`、`core`、`discord`、`features` 與 `infrastructure` 分層；各層責任與擴充流程請參考 [架構文件](docs/architecture.md)。

發言次數會即時彙總到 PostgreSQL。首次部署當天使用 Discord 歷史訊息確保結果完整；下一個台灣日開始優先查詢資料庫。機器人重連時會按照各頻道游標補抓遺漏訊息。

新版啟動後會在背景以兩個頻道的併發量補抓最近 30 天訊息，完成前活躍查詢會標示「歷史發言同步中」。語音只會從語音追蹤功能上線後開始累積，計入一般語音與舞台頻道，排除伺服器 AFK 頻道；即使成員獨處、靜音或拒聽仍會計時。

## 狼人殺

開房者自動加入，等待房間 10 分鐘未開始會取消；同一玩家不能同時參與多個狼人殺房間。等待時房主退出會轉交給最早加入者，開始後不能退出。

6～8 人配置 2 狼人、1 預言家、1 女巫，其餘村民；9～10 人配置 3 狼人、1 預言家、1 女巫，其餘村民。身分與夜晚選單都以僅本人可見的訊息提供，不需要私訊或私人頻道。

每夜狼人 45 秒、預言家 30 秒、女巫 30 秒；白天討論 180 秒、投票 45 秒，截止前可改選。狼人票最多者遭襲擊，平手隨機；預言家只在查驗階段結束後取得最後選擇的結果。女巫整局各有一瓶解藥、毒藥，每夜最多用一瓶，可自救；解藥用完後不再得知被襲擊者。夜間死亡在天亮同時結算，死亡角色到結局才公布。白天投票最高票平手或無有效票時無人出局。

全部狼人死亡時好人勝；存活狼人數至少等於存活好人數時狼人勝。勝方全員（包括已死亡隊友）各獲 100 XP，取消與平局不發獎，並沿用稱號、排行與升等通知設定。玩家離開伺服器、頻道刪除、公開面板持續無法更新或整個日夜循環無人操作，遊戲會取消。

房間、身分、行動、階段截止時間與待送升等通知存入 PostgreSQL。重啟後接續遊戲，過期階段只結算一次，下一階段從恢復時開始倒數；勝利經驗與房間結束同一交易提交，避免重複發獎。機器人不會禁言死亡玩家，請玩家自行遵守觀戰規則。

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
5. Bot 權限需要 **View Channels**、**Send Messages**、**Read Message History**、**Embed Links** 與 **Add Reactions**；若要使用遊戲等級身分組，另需 **Manage Roles**。
6. 將 Bot 加入至少一個伺服器；每個要使用指令的伺服器都必須安裝此 Bot。
7. 保持 **Interactions Endpoint URL** 空白；本專案使用 Gateway 接收互動。
8. 在 **Bot → Privileged Gateway Intents** 開啟 **Server Members Intent** 與 **Message Content Intent**；後者只用於辨識頻道遊戲的作答訊息。
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

首次使用本機自動部署前，安裝並登入 Northflank CLI：

```powershell
npm.cmd install --global @northflank/cli
northflank login
```

程式已提交且工作目錄乾淨時，可用一條指令完成檢查、推送、等待容器建置、重新啟動服務、確認 `bot_ready` 及同步 Discord 指令：

```powershell
npm.cmd run deploy
```

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

設定 `TEST_DATABASE_URL` 後，`npm test` 也會執行真實 PostgreSQL migration、去重、刪除回減、狼人殺並發操作與發獎交易測試；未設定時略過兩項資料庫整合測試。

部署後由伺服器管理者自行測試 `/今日發言`、`/成員活躍查詢`、`/伺服器統計`、四種頻道遊戲、遊戲等級、排行榜、升等通知、`/隨機料理` 與 `/隨機貓咪`。若統計略過頻道，確認 Bot 在該頻道具有 View Channel 與 Read Message History；若訊息型頻道遊戲沒有反應，確認 Message Content Intent 已開啟；需要反應符號的遊戲另需 Add Reactions，圖片與問答功能需 Embed Links。稱號身分組需要 Manage Roles，且 Bot 自己的身分組必須高於自動建立的稱號。若指令逾時，檢查 Northflank Logs、資料庫連線與 Bot Token。

## 安全性

- Bot 不需要 Administrator；完整伺服器統計與稱號同步需要 Server Members Intent，三種訊息型頻道遊戲需要 Message Content Intent。
- 成語接龍使用教育部《成語典》2020，資料來源、版本及授權說明請見 [data/README.md](data/README.md)。
- 開卷有益使用國中教育會考公開試題，遊戲畫面不顯示來源資訊；資料版本與來源說明保留於 [data/README.md](data/README.md)。
- 資料庫保存 Discord ID、成員加入／離開時間、日期、每日彙總次數、遊戲經驗與成功次數、稱號及升等通知設定、同步游標、語音進出時間，以及狼人殺房間、身分與行動紀錄；不保存暱稱、頭像、訊息內容或語音內容。
- 不要在 GitHub 或 Northflank build arguments 儲存 Token；使用 Runtime Secret。
- 如果 Token 曾外洩，立即在 Discord Developer Portal 重設，再更新 Northflank Secret。
