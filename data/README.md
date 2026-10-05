# 教育部《成語典》資料

`moe-idioms-2020-20260929.json` 由教育部《成語典》文字資料庫
`dict_idioms_2020_20260929.xlsx` 篩選產生，保留四個純漢字的詞目、注音與
「主條成語／非主條成語」分類，共 5,310 筆。

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
