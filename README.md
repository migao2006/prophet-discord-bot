# 預言者 Discord Bot

使用 Node.js 24 與 discord.js 製作的輕量 Discord 機器人，提供：

- `/今日發言 使用者:成員`：使用 Discord 原生成員選擇器，公開統計該成員今天在一般文字與公告頻道的發言次數（台灣時間）。

機器人透過 Discord Gateway 主動連線，不需要網域、HTTP 伺服器或公開連接埠。

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
```

`.env` 已被 Git 排除，請勿將 Bot Token 提交到版本控制、Issue 或聊天訊息。

## Discord 應用程式

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立「預言者」。
2. 從 **General Information** 取得 Application ID。
3. 從 **Bot** 取得 Token。
4. 在 **Installation** 啟用 Guild Install，加入 `bot` 和 `applications.commands` scopes。
5. Bot 權限需要 **View Channels**、**Send Messages** 與 **Read Message History**。
6. 將 Bot 加入至少一個伺服器；每個要使用指令的伺服器都必須安裝此 Bot。
7. 保持 **Interactions Endpoint URL** 空白；本專案使用 Gateway 接收互動。

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
4. 建立 **Deployment Service**，來源選 **External image**，填入上述映像路徑。
5. 使用免費的 `nf-compute-10`，維持一個 instance。
6. 不建立公開連接埠、網域或 HTTP health check。
7. 在 Runtime variables 加入 `DISCORD_TOKEN`。
8. 部署後在 Logs 確認出現 `已上線`。

推送新版程式後，GitHub Actions 會更新 `latest` 映像；在 Northflank 重新部署服務即可套用新版。

Application ID 只在註冊指令時使用，不需要放入長時間執行的 Northflank Service。`DISCORD_GUILD_ID` 是選填；若設定，註冊流程會移除該伺服器裡舊的伺服器專用指令。修改指令定義後，重新執行 `npm run register`。

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

部署後在 Discord 測試 `/今日發言`。若全域指令尚未更新，先稍候 Discord 同步並確認該伺服器已安裝 Bot；若統計略過頻道，確認 Bot 在該頻道具有 View Channel 與 Read Message History；若指令逾時，檢查 Northflank Logs 與 Bot Token。

## 安全性

- Bot 不需要 Administrator、Server Members Intent 或 Message Content Intent。
- 不要在 GitHub 或 Northflank build arguments 儲存 Token；使用 Runtime Secret。
- 如果 Token 曾外洩，立即在 Discord Developer Portal 重設，再更新 Northflank Secret。
