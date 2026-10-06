# 教育部《成語典》資料

`moe-idioms-2020-20260929.json` 由教育部《成語典》文字資料庫
`dict_idioms_2020_20260929.xlsx` 篩選產生，保留四個純漢字的詞目、注音與
「主條成語／非主條成語」分類，共 5,310 筆。

`moe-idioms-expanded-20261006-f3.json` 再合併教育部《成語典》「編輯總資料庫」：
只納入四個純漢字且在彙整的成語工具書中出現至少 3 次的詞目，與正文去重後
共 14,382 筆。機器人實際使用此擴充版本；正文條目保留原有注音與分類，新增
條目則保留編輯總資料庫的收錄頻次。官方說明提醒總資料庫可能含有不同用字與
重複條目，因此不直接納入只出現於少數工具書的詞目。

- 資料來源：中華民國教育部（Ministry of Education, R.O.C.）《成語典》
- 版本：2020_20260929
- 網址：https://dict.idioms.moe.edu.tw/
- 下載：https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/dict_idiomsdict_download.html
- 授權：創用 CC 姓名標示－禁止改作 3.0 臺灣（CC BY-ND 3.0 TW）
- 授權說明：https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/idiomsdict_10409.pdf

本專案不修改個別條目的內容。更新資料時，下載新的官方 XLSX 後執行：

```powershell
python scripts/build-idiom-dataset.py `
  dict_idioms_2020_YYYYMMDD.xlsx `
  data/moe-idioms-2020-YYYYMMDD.json `
  --source-version 2020_YYYYMMDD
```

更新檔名後，也要同步調整 `seed-idioms.js` 的預設資料路徑與測試版本。

擴充版本使用「編輯總資料庫下載(CSV)」產生：

```powershell
python scripts/build-expanded-idiom-dataset.py `
  data/moe-idioms-2020-20260929.json `
  editorial-total.csv `
  data/moe-idioms-expanded-YYYYMMDD-f3.json `
  --source-version 2020_20260929+editorial-YYYYMMDD-f3 `
  --minimum-frequency 3
```

# 「開卷有益」國中教育會考題庫

`open-book-cap-390fcf615d08.json` 由「開卷有益」專案的國中教育會考題庫篩選產生，
只保留適合 Discord 顯示的純文字四選一題目。遊戲介面不顯示年份與題號，讓題目保持簡潔；
資料來源及版本仍記錄於本檔與資料集 metadata。

- 來源：https://github.com/5219rayhsu/open-book-is-good-platform
- 固定版本：`390fcf615d08362e4885c43058f4ac3c128c2ec2`
- 原始檔案：`data/cap/bank.json`
- 試題性質：依法令舉行之考試試題，依中華民國著作權法第 9 條不受著作權保護

更新時下載指定版本的 `bank.json`，再執行：

```powershell
python scripts/build-open-book-quiz.py bank.json `
  data/open-book-cap-VERSION.json `
  --source-version FULL_COMMIT_SHA
```
